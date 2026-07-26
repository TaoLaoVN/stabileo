/**
 * Legal physical layout candidates for one member's bar group.
 *
 * ── Why a candidate, and not a nudge ───────────────────────────────
 *
 * Two attempts at post-hoc threading failed, and they failed for the same structural
 * reason: a beam spans TWO joints. Moving a straight bar sideways to clear the column at
 * one end moves it at the other end too, so resolving joints one at a time makes each
 * undo the last. Measured, the second attempt made the flagship worse — overlaps 409 → 461
 * — because packing bars into whatever channel was free clustered them, and the clustering
 * cost more in bar-to-bar clearance than it bought in column clearance.
 *
 * The fix is to stop nudging. A member's arrangement is CHOSEN ONCE, as a whole, from a set
 * of complete legal alternatives, and the choice is made against every joint the member
 * touches at the same time. This module produces those alternatives.
 *
 * ── What a candidate is ────────────────────────────────────────────
 *
 * One complete, code-legal transverse arrangement for a group of bars on one face of one
 * member: how many layers, how many bars per layer, and where each sits across the section.
 * It is valid for the member's whole length by construction, so it cannot be legal at one
 * end and illegal at the other.
 *
 * Every candidate satisfies, on its own, before any joint is considered:
 *   * cover — no bar outside the clear width between the stirrup legs;
 *   * §25.2.1 / §25.2.3 clear spacing within a layer, PLUS the placement tolerance;
 *   * §25.2.2 clear distance between layers;
 *   * the bar count and diameter the verifier certified — never changed here.
 *
 * The placement allowance is added to the nominal spacing and never subtracted from the
 * code minimum. `worstCasePlacementSpacing` states that as an invariant a test can assert.
 *
 * Pure: no store, no runes, no i18n.
 */

import { minClearBetweenLayers, minClearSpacingFor } from '../../codes/cirsoc201/spacing';
import type { ClauseRef, RegulationEdition } from '../../codes/regulation';

/** One bar's position within a candidate, relative to the section centreline. */
export interface CandidateSlot {
  /** Offset across the section, m. */
  across: number;
  /** Layer index; 0 is nearest the face. */
  layer: number;
}

export interface LayoutCandidate {
  /**
   * Deterministic identity. Built from the shape of the layout, never from a counter, so
   * the same geometry always produces the same id and a stored choice survives a re-run.
   */
  id: string;
  slots: CandidateSlot[];
  layers: number;
  /** Bars in the widest layer — the congestion measure the objective ranks on. */
  maxPerLayer: number;
  /** Smallest clear distance between any two bars in the same layer, m. */
  minClearInLayer: number;
  /** Half-width actually occupied, m. Narrower arrangements thread more easily. */
  halfSpan: number;
  refs: ClauseRef[];
}

export interface CandidateRequest {
  count: number;
  diameterMm: number;
  /** Clear width between the stirrup legs, m. */
  clearWidth: number;
  edition: RegulationEdition;
  maxAggregateSizeMm: number;
  memberKind: 'beam' | 'column' | 'wall' | 'slab';
  /** Placement tolerance to ADD to the nominal spacing, m. */
  placementTolerance: number;
  /**
   * Transverse positions the user pinned. A locked bar restricts the domain — candidates
   * that do not honour it are never generated — rather than being shoved during repair.
   */
  lockedAcross?: readonly number[];
}

/** How many bars of this diameter fit in one layer at this spacing. */
function perLayerCapacity(clearWidth: number, d: number, pitch: number): number {
  if (clearWidth < d) return 0;
  return Math.max(1, Math.floor((clearWidth - d) / pitch) + 1);
}

/**
 * Positions for `n` bars in one layer, centred, at `pitch`, shifted by `shift`.
 *
 * `shift` is what makes alternatives exist. A symmetric row is the natural first choice,
 * but it is only one of the legal arrangements, and when a column bar happens to sit on
 * the centreline it is the worst one.
 */
function row(n: number, pitch: number, shift: number): number[] {
  const span = pitch * (n - 1);
  return Array.from({ length: n }, (_, k) => -span / 2 + k * pitch + shift);
}

/**
 * The worst clear spacing a candidate can present once every bar has drifted by the
 * placement tolerance in the least helpful direction.
 *
 * Exported so a gate can assert the thing that must never be true: that the tolerance was
 * used to EXCUSE a spacing shortfall rather than to guard against one. Two adjacent bars
 * can each move by half the tolerance toward the other, so the nominal pitch has to carry
 * the full allowance for the worst case still to be code-legal.
 */
export function worstCasePlacementSpacing(
  candidate: LayoutCandidate, diameterMm: number, placementTolerance: number,
): number {
  return candidate.minClearInLayer - diameterMm / 1000 - placementTolerance;
}

/**
 * Generate the legal alternatives, best-first.
 *
 * Deterministic: the candidate list depends only on the request, and the order is fixed by
 * (layers, congestion, |shift|, span). No counters, no clocks, no input ordering.
 */
export function generateLayoutCandidates(req: CandidateRequest): LayoutCandidate[] {
  const d = req.diameterMm / 1000;
  const spacing = minClearSpacingFor(req.edition, req.memberKind, {
    barDiameterMm: req.diameterMm, maxAggregateSizeMm: req.maxAggregateSizeMm,
  });
  const layerRule = minClearBetweenLayers(req.edition);
  const refs = [...spacing.refs, ...layerRule.refs];

  // The nominal pitch carries the code minimum PLUS the placement allowance. The allowance
  // only ever widens the drawing; it can never narrow what the code demands.
  const nominalClear = spacing.minClear + req.placementTolerance;
  const pitch = d + nominalClear;

  const capacity = perLayerCapacity(req.clearWidth, d, pitch);
  if (capacity === 0 || req.count === 0) return [];

  const out: LayoutCandidate[] = [];
  const seen = new Set<string>();

  // Layer counts worth trying: the fewest that fit, and one more. Splitting into an extra
  // layer frees plan width, which is exactly the trade a congested joint needs — but it
  // costs effective depth, so it is never the first choice.
  const minLayers = Math.ceil(req.count / capacity);
  const layerOptions = [minLayers, minLayers + 1]
    .filter((n) => n >= 1 && n <= req.count);

  for (const layers of layerOptions) {
    const base = Math.ceil(req.count / layers);
    if (base > capacity) continue;

    // Lateral shifts. Zero first (symmetric is the natural arrangement), then progressively
    // offset rows, each still fully inside the clear width.
    const span = pitch * (base - 1);
    const room = (req.clearWidth - d) / 2 - span / 2;
    const shifts = [0];
    for (const frac of [0.5, 1.0]) {
      const s = room * frac;
      if (s > 1e-4) shifts.push(s, -s);
    }
    // A quarter-pitch stagger breaks alignment with a column bar sitting on the centreline
    // without moving the group off centre.
    if (room > pitch / 4) shifts.push(pitch / 4, -pitch / 4);

    for (const shift of shifts) {
      const slots: CandidateSlot[] = [];
      let placed = 0;
      for (let layer = 0; layer < layers; layer++) {
        const inThis = Math.min(base, req.count - placed);
        if (inThis <= 0) break;
        for (const across of row(inThis, pitch, shift)) slots.push({ across, layer });
        placed += inThis;
      }
      if (slots.length !== req.count) continue;

      // Cover: every bar inside the clear width.
      const halfSpan = Math.max(...slots.map((s) => Math.abs(s.across))) + d / 2;
      if (halfSpan > req.clearWidth / 2 + 1e-9) continue;

      // Locked bars restrict the domain: a candidate that does not place a bar where the
      // user pinned one is not offered at all.
      if (req.lockedAcross && req.lockedAcross.length > 0) {
        const honours = req.lockedAcross.every((lock) =>
          slots.some((s) => Math.abs(s.across - lock) < 1e-6));
        if (!honours) continue;
      }

      const byLayer = new Map<number, number[]>();
      for (const s of slots) byLayer.set(s.layer, [...(byLayer.get(s.layer) ?? []), s.across]);
      let minClearInLayer = Infinity;
      for (const [, xs] of byLayer) {
        const sorted = [...xs].sort((a, b) => a - b);
        for (let i = 1; i < sorted.length; i++) {
          minClearInLayer = Math.min(minClearInLayer, sorted[i] - sorted[i - 1]);
        }
      }
      if (!Number.isFinite(minClearInLayer)) minClearInLayer = req.clearWidth;
      // Never emit a candidate that breaches the code minimum, tolerance aside.
      if (minClearInLayer - d < spacing.minClear - 1e-9) continue;

      const id = `L${layers}:${slots.map((s) => `${s.layer}@${Math.round(s.across * 10000)}`).join(',')}`;
      if (seen.has(id)) continue;
      seen.add(id);

      out.push({
        id, slots, layers,
        maxPerLayer: Math.max(...[...byLayer.values()].map((v) => v.length)),
        minClearInLayer, halfSpan, refs,
      });
    }
  }

  // Best-first and fully deterministic: fewest layers, then least congested, then most
  // centred, then narrowest, then id.
  return out.sort((a, b) =>
    a.layers - b.layers
    || a.maxPerLayer - b.maxPerLayer
    || centrality(a) - centrality(b)
    || a.halfSpan - b.halfSpan
    || a.id.localeCompare(b.id));
}

/** How far off centre a candidate sits. Zero for a symmetric arrangement. */
function centrality(c: LayoutCandidate): number {
  const mean = c.slots.reduce((s, x) => s + x.across, 0) / Math.max(1, c.slots.length);
  return Math.round(Math.abs(mean) * 1e6) / 1e6;
}

/**
 * Keep-out bands a candidate must avoid at a joint, in the member's transverse coordinate.
 *
 * Returned rather than applied: the search asks "is this candidate compatible here?", and
 * the answer has to be computable without moving anything.
 */
export interface KeepOut {
  at: number;
  halfWidth: number;
}

/** Does every bar in this candidate clear every keep-out band? */
export function candidateClears(
  candidate: LayoutCandidate, diameterMm: number, keepOuts: readonly KeepOut[],
): { ok: boolean; worstOverlap: number } {
  const half = diameterMm / 2000;
  let worst = 0;
  for (const slot of candidate.slots) {
    for (const k of keepOuts) {
      const gap = Math.abs(slot.across - k.at) - half - k.halfWidth;
      if (gap < 0) worst = Math.min(worst, gap);
    }
  }
  return { ok: worst >= 0, worstOverlap: worst };
}
