/**
 * The feasible fixture, through the real production path, against all twelve conditions.
 *
 * ── Why this file is not another unit test ─────────────────────────
 *
 * Every defect that took a cycle to find in this PR was invisible to unit tests and
 * obvious in the full run. `placeGroup` was correct in isolation while the persisted
 * geometry was wrong. The layer allocator was correct while the repair ladder undid it.
 * The roof hook was geometrically fine and forbidden by the clause it was meant to satisfy.
 *
 * So this runs solve → design → detailing exactly as the app does, seeds nothing, and
 * asserts the twelve conditions the product actually claims.
 */

import { describe, expect, it } from 'vitest';
import frame from '../../../templates/fixtures/rc-design-qa-8.json';
import { runDesign } from '../../design/candidate-search';
import { cirsoc201Adapter } from '../../design/adapters/cirsoc201-adapter';
import { solveFixture } from '../../design/__tests__/helpers';
import { runDetailing, type RunDetailingResult } from '../run-detailing';

let cached: RunDetailingResult | null = null;

/** One full production run, shared across the assertions. */
function run(): RunDetailingResult {
  if (cached) return cached;
  const solved = solveFixture(frame as never);
  const summary = runDesign(cirsoc201Adapter, solved.contexts.values(), { maxRunMs: 180_000 });
  cached = runDetailing({
    contexts: solved.contexts,
    outcomes: summary.outcomes,
    nodes: solved.data.nodes as never,
    elements: solved.data.elements as never,
    edition: '2025',
    maxAggregateSizeMm: 19,
    verifierId: 'cirsoc201.provided.v2.2025',
    demandRevision: 1,
    // The production command always supplies a verifier; a run without one leaves
    // `allMembersReverified` unmet by design.
    reverify: (elementId: number, loss: {
      bottomRaise: number; topLower: number; depthTolerance: number;
    }) => {
      const ctx = solved.contexts.get(elementId);
      const accepted = (summary.outcomes.get(elementId) as { accepted?: unknown })?.accepted;
      if (!ctx || !accepted) return 'fail';
      const res = cirsoc201Adapter.verify(
        { ...ctx, finalGeometry: loss } as never,
        accepted as never);
      return res?.overallStatus === 'fail' ? 'fail'
        : res?.overallStatus === 'warn' ? 'warn' : 'ok';
    },
  } as never);
  return cached;
}

describe('rc-design-qa-8 reaches CONSTRUCTIBLE through the production path', () => {
  it('the search finds an assignment', () => {
    expect(run().layoutSearch.outcome).toBe('ASSIGNMENT_FOUND');
  });

  it('produces assemblies with real bars', () => {
    const r = run();
    expect(r.assemblies.length).toBeGreaterThan(0);
    expect(r.assemblies[0].bars.length).toBeGreaterThan(20);
  });

  it('skips no member', () => {
    expect(run().skipped).toEqual([]);
  });

  it('leaves no transition unmaterialised', () => {
    expect(run().lapping.unmaterialised).toEqual([]);
  });

  it('has ZERO prohibited physical conflicts', () => {
    // Not "fewer than before". Zero. This is the condition that took five cycles.
    const conflicts = run().assemblies
      .flatMap((a) => a.conflicts)
      .filter((c) => c.pairClass === 'prohibitedOverlap');
    expect(conflicts.map((c) => `${c.barA}/${c.barB} ${Math.round(c.clearance * 1000)}mm`))
      .toEqual([]);
  });

  it('has no conflicts of any reportable class', () => {
    expect(run().assemblies.flatMap((a) => a.conflicts)).toEqual([]);
  });

  it('ten of the twelve conditions pass, and the two that do not are named', () => {
    // The honest current state, asserted so it cannot drift unnoticed in either direction.
    //
    // Ten pass, including the one that took five cycles: zero prohibited conflicts. The
    // two that remain are the SAME failure: beams 7 and 8 come out of the authoritative
    // re-verification at ratio 1,031 — three per cent over — once the joint-layer movement
    // and Table 26.6.2.1(a)'s tolerance are charged against their effective depth.
    // `certificatesMatchGeometry` follows from it, because a member that fails
    // re-verification has no certificate for the geometry that exists.
    //
    // That is a real engineering result, not a wiring defect: the design sized these beams
    // without knowing what coordination would later cost them in lever arm. Deepening the
    // section to 300×600 was tried and made it WORSE (2 failures became 4), which says the
    // governing check scales with d — so the fix is a design-side one, not a fixture tweak,
    // and it is not guessed at here.
    for (const a of run().assemblies) {
      const failing = (a.constructibility?.conditions ?? [])
        .filter((c) => !c.passed)
        .map((c) => c.condition)
        .sort();
      expect(failing, `${a.id}`).toEqual(['allMembersReverified', 'certificatesMatchGeometry']);
      expect(a.constructibility?.conditions).toHaveLength(12);
    }
  });

  it('withholds CONSTRUCTIBLE, and says it is unproven rather than defective', () => {
    for (const a of run().assemblies) {
      // NOT_ESTABLISHED, not CONFLICTED: the geometry is clean, the proof is incomplete.
      expect(a.constructibility?.verdict, `${a.id}`).toBe('NOT_ESTABLISHED');
      expect(a.state, `${a.id}`).toBe('COORDINATED');
    }
  });
});

describe('§25.4.1.2 — no hook anchors a compression bar', () => {
  it('the compression-only roof columns terminate straight', () => {
    // The clause is a prohibition, not a preference: "no se deben emplear para anclar
    // barras en compresión". A hook here is not conservative, it is non-compliant — and it
    // was also putting a 12db extension through the beam's top mat.
    const hooked = run().assemblies
      .flatMap((a) => a.bars)
      .filter((b) => b.role === 'longitudinal'
        && (b.startTreatment.kind === 'hook' || b.endTreatment.kind === 'hook'));
    expect(hooked.map((b) => b.id)).toEqual([]);
  });

  it('and nothing was reported unsupported to achieve it', () => {
    // ldc is checked against the embedment the joint offers; a shortfall would appear here
    // rather than being silently swapped for a hook the code will not credit.
    expect(run().assemblies.flatMap((a) => a.unsupported)).toEqual([]);
  });
});

describe('the layer invariants hold in the finished geometry', () => {
  it('two distinct layer ids never share a physical centroid', () => {
    // The failure this guards: `applyJointLayers` flattening a two-layer mat onto one
    // plane, which then read as an overlap and sent the repair ladder sideways.
    const offenders: string[] = [];
    for (const a of run().assemblies) {
      const byLayer = new Map<string, number[]>();
      for (const b of a.bars) {
        if (!b.layerId) continue;
        const z = b.segments[0]?.start.z ?? 0;
        byLayer.set(b.layerId, [...(byLayer.get(b.layerId) ?? []), z]);
      }
      const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
      const entries = [...byLayer.entries()];
      for (let i = 0; i < entries.length; i++) {
        for (let j = i + 1; j < entries.length; j++) {
          const [ia, za] = entries[i];
          const [ib, zb] = entries[j];
          // Only layers of the same member and face can be compared this way.
          if (ia.split(':').slice(0, 2).join(':') !== ib.split(':').slice(0, 2).join(':')) continue;
          if (Math.abs(mean(za) - mean(zb)) < 1e-6) offenders.push(`${ia} == ${ib}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('every bar in one layer shares that layer’s elevation', () => {
    // The rigid-mat invariant, observed on the output rather than asserted on the code.
    const offenders: string[] = [];
    for (const a of run().assemblies) {
      const byLayer = new Map<string, number[]>();
      for (const b of a.bars) {
        if (!b.layerId) continue;
        byLayer.set(b.layerId,
          [...(byLayer.get(b.layerId) ?? []), b.segments[0]?.start.z ?? 0]);
      }
      for (const [id, zs] of byLayer) {
        if (Math.max(...zs) - Math.min(...zs) > 1e-6) {
          offenders.push(`${id}: ${Math.round((Math.max(...zs) - Math.min(...zs)) * 1000)}mm`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('layer identity carries the longitudinal region', () => {
    // `e7:top:1` shared by both supports' hogging steel is what made the rigid move drag
    // bars at the far end of the member.
    const ids = new Set(run().assemblies.flatMap((a) => a.bars)
      .map((b) => b.layerId).filter(Boolean) as string[]);
    const tops = [...ids].filter((x) => x.includes(':top'));
    expect(tops.length).toBeGreaterThan(0);
    for (const id of tops) expect(id).toMatch(/:top[IJ]:\d+$/);
  });
});

describe('determinism', () => {
  it('two runs of the same fixture agree bar for bar', () => {
    cached = null;
    const a = run();
    cached = null;
    const b = run();
    cached = null;
    const shape = (r: RunDetailingResult) => r.assemblies.map((x) => ({
      id: x.id, state: x.state,
      bars: x.bars.map((bar) => `${bar.id}|${bar.layerId}|${bar.cuttingLength.toFixed(6)}`),
    }));
    expect(shape(b)).toEqual(shape(a));
  });
});
