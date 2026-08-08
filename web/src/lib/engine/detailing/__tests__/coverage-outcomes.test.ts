/**
 * The 408/373 discrepancy — what the outcome population actually is.
 *
 * A live run on the 408-member flagship reported "408 members, 373 verified". "373" is a
 * DISPLAY BAND (utilisation below a threshold), not an outcome split. If detailing keyed off
 * the band rather than the outcome it would silently drop fully compliant members, which is
 * the confusion these two assertions exist to prevent.
 *
 * ── Recalibrated 408 → 386 by the PR78 review fixes ────────────
 *
 * This file used to assert 408/408 VERIFIED and an empty non-VERIFIED population, which was
 * true when it was written. The biaxial column-axis mapping and biaxial-beam refusal that
 * arrived with the merged PR15 changed the honest answer to 386 VERIFIED and 22
 * refusals — the fixture's BEAM-Y members, whose secondary Mz/Vy demand crosses the
 * 10% biaxial threshold on an axis this verifier never checks for beams. Before the fix they
 * were certified having never been checked; the 22 refusals are the correction, not a
 * regression, and `autodesign-regression.test.ts` is the gate that owns those numbers.
 *
 * So the assertion below is no longer "nothing is refused". It is the sharper claim the file
 * was always making: the members detailing works on are exactly the members that hold a
 * VERIFIED outcome, and anything excluded is excluded on OUTCOME grounds — never because it
 * sat in a low-utilisation display band.
 *
 * Split from the coverage-invariant suite because these two assertions need only the SOLVE and
 * DESIGN steps. Keeping them beside the detailing invariants meant every run of this concern
 * also paid for the detailing ones.
 */

import { describe, it, expect } from 'vitest';
import { flagshipRun, membersOfKind } from './helpers/flagship';
import { detailingReadiness } from '../run-detailing';
import type { MemberDesignOutcome } from '../../design/outcome';

describe('the 408/373 discrepancy', () => {
  it('the outcome population is 386 VERIFIED + 22 honest refusals — 373 is a display band', () => {
    const { summary } = flagshipRun();
    expect(summary.total).toBe(408);
    expect(summary.verified).toBe(386);

    // Every member that is not VERIFIED is refused for a stated reason. A member sitting in a
    // low-utilisation display band is NOT one of them, which is the whole point: 373 never was
    // an outcome, and the 22 that are outcomes all name the same honest cause.
    const notVerified = [...summary.outcomes.values()].filter((o) => o.outcome !== 'VERIFIED');
    expect(notVerified).toHaveLength(22);
    /**
     * UNSUPPORTED, not SEARCH_EXHAUSTED.
     *
     * The refusal was moved to the adapter's capability gate. `SEARCH_EXHAUSTED` means a
     * bounded search explored the envelope and found nothing, which invites the engineer to
     * try a larger section or a longer run; neither can help, because no arrangement is
     * checked on the secondary axis. `UNSUPPORTED` is the accurate claim — a required check
     * is not implemented for this member — and it also stops the search burning its whole
     * candidate budget to rediscover a fact known before the first candidate.
     */
    expect([...new Set(notVerified.map((o) => o.outcome))]).toEqual(['UNSUPPORTED']);
    // And the cause is named, not left to the outcome kind alone.
    expect([...new Set(notVerified.flatMap((o) => o.limiting))]).toEqual(['biaxial']);
  }, 300_000);

  it('detailing keys off the OUTCOME, so compliant warning members are not lost', () => {
    const { solved, summary } = flagshipRun();
    const readiness = detailingReadiness({
      contexts: solved.contexts,
      outcomes: summary.outcomes as ReadonlyMap<number, MemberDesignOutcome>,
    });
    // Walls are PR18's; this fixture carries none, so the detailable population is exactly the
    // VERIFIED one. Asserted against `summary.verified` rather than a literal so the tie
    // between the two is what is being checked, not a number that happens to match.
    expect(membersOfKind('wall')).toHaveLength(0);
    expect(readiness.detailable.length).toBe(summary.verified);
    // Nothing compliant is dropped: every VERIFIED member is detailable.
    const verifiedIds = [...summary.outcomes.values()]
      .filter((o) => o.outcome === 'VERIFIED').map((o) => o.elementId).sort((a, b) => a - b);
    // `detailable` is a sorted id list, so this is an id-for-id comparison.
    expect([...readiness.detailable].sort((a, b) => a - b)).toEqual(verifiedIds);
  }, 300_000);
});
