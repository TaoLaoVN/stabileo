/**
 * Member-to-assembly coverage: nothing verified may disappear silently.
 *
 * ── Why ────────────────────────────────────────────────────────────
 *
 * A live run on the 408-member flagship reported "408 members, 373 verified, 10 assemblies,
 * 114 bars". Two of those numbers deserved an explanation and neither had one:
 *
 *   - PR15's own gate asserts 408/408 VERIFIED on this fixture. "373" is a DISPLAY BAND
 *     (utilisation ≤ some threshold) sitting next to 35 compliant warnings, not an outcome
 *     split. If detailing were keying off the band rather than the outcome it would be
 *     dropping 35 fully compliant members.
 *   - 114 bars across 408 members is roughly one bar every four members. A single beam
 *     produces bottom runners, curtailed bottoms and top bars at both supports. That
 *     number is only explicable if most members never reached the generator.
 *
 * This suite pins both down with the real fixture and the real design run, and then states
 * the invariant as a gate: every VERIFIED, applicable member is either owned by exactly one
 * assembly or carries an explicit, translatable reason for its absence. Silence is failure.
 */
import { describe, it, expect } from 'vitest';
import frame from '../../../templates/fixtures/rc-design-frame.json';
import { runDesign } from '../../design/candidate-search';
import { cirsoc201Adapter } from '../../design/adapters/cirsoc201-adapter';
import { solveFixture, assertRealSolver } from '../../design/__tests__/helpers';
import { runDetailing, detailingReadiness } from '../run-detailing';
import { teAt } from '../../../i18n/engine-text';
import type { MemberDesignOutcome } from '../../design/outcome';

/** Solve + design the flagship once; every test below reads the same run. */
function flagship() {
  assertRealSolver();
  const solved = solveFixture(frame);
  const summary = runDesign(cirsoc201Adapter, solved.contexts.values(), { maxRunMs: 180_000 });
  return { solved, summary };
}

let cached: ReturnType<typeof flagship> | null = null;
function run() {
  if (!cached) cached = flagship();
  return cached;
}

function detail() {
  const { solved, summary } = run();
  return runDetailing({
    contexts: solved.contexts,
    outcomes: summary.outcomes as ReadonlyMap<number, MemberDesignOutcome>,
    nodes: solved.data.nodes as never,
    elements: solved.data.elements as never,
    edition: '2025',
    verifierId: 'coverage-invariant',
    demandRevision: 1,
    maxAggregateSizeMm: 19,
  });
}

describe('the 408/373 discrepancy', () => {
  it('every member is VERIFIED as an OUTCOME — 373 is a display band, not a split', () => {
    const { summary } = run();
    expect(summary.total).toBe(408);
    expect(summary.verified).toBe(408);
    // No member sits in any non-VERIFIED outcome, so there is no population for
    // detailing to legitimately skip on outcome grounds.
    const notVerified = [...summary.outcomes.values()].filter((o) => o.outcome !== 'VERIFIED');
    expect(notVerified.map((o) => o.elementId)).toEqual([]);
  }, 300_000);

  it('detailing keys off the OUTCOME, so compliant warning members are not lost', () => {
    const { solved, summary } = run();
    const readiness = detailingReadiness({
      contexts: solved.contexts,
      outcomes: summary.outcomes as ReadonlyMap<number, MemberDesignOutcome>,
    });
    // Walls are PR18's; everything else is detailable.
    const walls = [...solved.contexts.values()].filter((c) => c.elementType === 'wall').length;
    expect(readiness.detailable.length).toBe(408 - walls);
    expect(readiness.prerequisites).toEqual([]);
  }, 300_000);
});

describe('member-to-assembly coverage invariant', () => {
  it('every detailable member is owned by exactly one assembly, or explicitly excluded', () => {
    const r = detail();

    const owned = new Map<number, string[]>();
    for (const a of r.assemblies) {
      for (const id of a.elementIds) {
        owned.set(id, [...(owned.get(id) ?? []), a.id]);
      }
    }
    const skipped = new Set(r.skipped.map((s) => s.elementId));

    const missing: number[] = [];
    const duplicated: Array<{ id: number; assemblies: string[] }> = [];
    for (const id of r.readiness.detailable) {
      const owners = owned.get(id);
      if (!owners || owners.length === 0) {
        if (!skipped.has(id)) missing.push(id);
        continue;
      }
      if (owners.length > 1) duplicated.push({ id, assemblies: owners });
    }

    expect(missing,
      `${missing.length} verified member(s) vanished with no assembly and no stated reason`)
      .toEqual([]);
    expect(duplicated,
      'a member owned by two assemblies would be detailed, scheduled and drawn twice')
      .toEqual([]);
  }, 300_000);

  it('every skipped member states a reason that renders in both languages', () => {
    const r = detail();
    for (const s of r.skipped) {
      for (const locale of ['en', 'es']) {
        const text = teAt({ key: s.key }, locale);
        expect(text, `${s.key} in ${locale}`).not.toBe(s.key);
      }
    }
  }, 300_000);

  it('produces bars in proportion to the members detailed, not a token few', () => {
    const r = detail();
    const bars = r.assemblies.reduce((n, a) => n + a.bars.length, 0);
    const members = new Set(r.assemblies.flatMap((a) => a.elementIds)).size;

    // A beam yields bottom runners plus top bars at two supports; a column lift yields its
    // longitudinal cage. Fewer than two bars per member means most members never reached
    // the generator — which is exactly what "114 bars for 408 members" was telling us.
    expect(members).toBeGreaterThan(300);
    expect(bars / members,
      `${bars} bars across ${members} members is too few to be a real cage`)
      .toBeGreaterThan(2);
  }, 300_000);

  it('every column lift appears in its stack assembly, not just the lowest one', () => {
    const { solved } = run();
    const r = detail();
    const columnIds = [...solved.contexts.values()]
      .filter((c) => c.elementType === 'column').map((c) => c.elementId);
    const owned = new Set(r.assemblies.flatMap((a) => a.elementIds));
    const orphanedLifts = columnIds.filter((id) => !owned.has(id)
      && !r.skipped.some((s) => s.elementId === id));
    expect(orphanedLifts,
      `${orphanedLifts.length} column lift(s) are detailed as part of a stack but are not `
      + 'listed on any assembly, so nothing in the UI, the schedule or the drawings owns them')
      .toEqual([]);
  }, 300_000);

  it('reports the coverage numbers it claims, so a live count can be checked against it', () => {
    const r = detail();
    const members = new Set(r.assemblies.flatMap((a) => a.elementIds));
    const bars = r.assemblies.reduce((n, a) => n + a.bars.length, 0);
    // Not an assertion on exact values — a record, so a future change that halves the
    // output is visible in the diff rather than only in a manual QA session.
    expect({
      assemblies: r.assemblies.length > 0,
      membersOwned: members.size,
      detailable: r.readiness.detailable.length,
      skipped: r.skipped.length,
      barsPositive: bars > 0,
    }).toMatchObject({
      assemblies: true,
      membersOwned: r.readiness.detailable.length - r.skipped.length,
      barsPositive: true,
    });
  }, 300_000);
});
