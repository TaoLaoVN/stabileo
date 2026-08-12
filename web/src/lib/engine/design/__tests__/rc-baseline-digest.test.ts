/**
 * The concrete design, pinned member by member, before the metallic work touches anything.
 *
 * ── Why the existing gate is not enough ────────────────────────────
 *
 * `autodesign-regression.test.ts` asserts the AGGREGATE on the same fixture: 386 verified,
 * 22 search-exhausted, nothing else. That is a real gate and it stays. It is also blind to
 * the failure mode this branch can actually cause.
 *
 * PR21 has to touch `member-context.ts` — the builder that reads a material's `fy` as a
 * concrete `f'c` and hands it to every adapter. A change there that shifted one column's
 * effective depth, or swapped which axis governs on a handful of members, would move
 * utilizations and reinforcement while leaving the counts at 386/22 exactly. The aggregate
 * cannot see it. A digest of every member's own result can.
 *
 * ── What is pinned, and what deliberately is not ───────────────────
 *
 * Per element: the outcome, the governing constraints, and the certified utilization
 * rounded to four decimals. That last rounding is the one judgement call here — the search
 * is deterministic, but pinning a full double would make the test a hostage to the last
 * bit of a square root on a different CPU. Four decimals is far tighter than any change
 * that matters and far looser than floating-point noise.
 *
 * NOT pinned: timings, candidate counts, verifier call counts. Those are performance
 * facts, they already have their own budgets in the regression suite, and freezing them
 * here would make every optimisation look like a correctness regression.
 *
 * ── When this test fails ───────────────────────────────────────────
 *
 * It means the concrete design changed. That is a defect in this branch until proven
 * otherwise: PR21 is not allowed to change a concrete result. Do not re-record the digest
 * to make it pass — find what moved.
 */

import { describe, it, expect } from 'vitest';
import frame from '../../../templates/fixtures/rc-design-frame.json';
import { runDesign } from '../candidate-search';
import { cirsoc201Adapter } from '../adapters/cirsoc201-adapter';
import { solveFixture, assertRealSolver } from './helpers';
import type { DesignRunSummary } from '../outcome';

/**
 * One line per member: `id|OUTCOME|limiting,in,order|utilization`.
 *
 * Sorted by element id so the comparison is order-independent — the run's own map order
 * is an implementation detail and would otherwise make a scheduling change look like a
 * design change.
 */
function digestLines(s: DesignRunSummary): string[] {
  return [...s.outcomes.values()]
    .sort((a, b) => a.elementId - b.elementId)
    .map((o) => {
      const util = o.certificate ? o.certificate.worstUtilization.toFixed(4) : '—';
      const limiting = [...o.limiting].sort().join(',');
      return `${o.elementId}|${o.outcome}|${limiting}|${util}`;
    });
}

/** Small stable hash, so a mismatch reports one changed number instead of 408 lines. */
function fingerprint(lines: readonly string[]): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (const line of lines) {
    for (let i = 0; i < line.length; i++) {
      h1 = Math.imul(h1 ^ line.charCodeAt(i), 0x01000193) >>> 0;
      h2 = Math.imul(h2 + line.charCodeAt(i), 0x85ebca6b) >>> 0;
    }
  }
  return `${h1.toString(16).padStart(8, '0')}${h2.toString(16).padStart(8, '0')}`;
}

describe('RC design baseline — the flagship frame, member by member', () => {
  const solved = solveFixture(frame);
  const summary = runDesign(cirsoc201Adapter, solved.contexts.values(), { maxRunMs: 180_000 });
  const lines = digestLines(summary);

  it('still designs the same number of members the same ways', () => {
    assertRealSolver();
    // Restated here rather than only in the aggregate suite: if these move, the digest
    // below has moved too, and the reader should see the coarse reason first.
    expect(summary.total).toBe(408);
    expect(summary.verified).toBe(386);
    expect(summary.searchExhausted).toBe(22);
    expect(summary.sectionInadequate).toBe(0);
    expect(summary.demandUnavailable).toBe(0);
    expect(summary.unsupported).toBe(0);
    expect(summary.aborted).toBe(false);
  });

  it('produces one digest line per member, and no member without an id', () => {
    expect(lines).toHaveLength(408);
    expect(new Set(lines.map((l) => l.split('|')[0])).size).toBe(408);
  });

  it('never certifies above the fail threshold', () => {
    for (const o of summary.outcomes.values()) {
      if (!o.certificate) continue;
      expect(o.certificate.worstUtilization).toBeLessThanOrEqual(1.000001);
    }
  });

  /**
   * The gate itself.
   *
   * The expected fingerprint is recorded from this branch at its base commit, with no
   * metallic code in the path. Every later commit on this branch must reproduce it.
   */
  it('reproduces the recorded per-member fingerprint exactly', () => {
    const actual = fingerprint(lines);
    // Recorded 2026-08-12 on feat/pro-steel-family @ 542fc664 (origin/main), before any
    // change to the design path. See the header: do NOT re-record to make this pass.
    expect(actual).toBe(RECORDED_FINGERPRINT);
  });

  it('keeps the members that refuse, refusing for the same reason', () => {
    // The 22 exhausted members are the fixture's BEAM-Y set, refused on unchecked biaxial
    // demand. Pinned separately from the fingerprint because this is the assertion whose
    // meaning a reader can check without recomputing a hash.
    const refused = [...summary.outcomes.values()].filter((o) => o.outcome !== 'VERIFIED');
    expect(refused).toHaveLength(22);
    for (const o of refused) {
      expect(o.outcome).toBe('SEARCH_EXHAUSTED');
      expect(o.limiting).toContain('biaxial');
      expect(o.certificate).toBeUndefined();
      expect(o.accepted).toBeUndefined();
    }
  });
});

/**
 * Filled from the first run on this branch — see the sibling script note in the commit.
 *
 * Kept as a named constant at the bottom rather than inline so that the one line anybody
 * would be tempted to edit is the one line that says, immediately above it, not to.
 */
const RECORDED_FINGERPRINT = '1bd4d9c1d575b085';
