/**
 * Physical transverse reinforcement — closed stirrups and crossties as real bars.
 *
 * ── What this replaces ─────────────────────────────────────────────
 *
 * `StirrupZone` said "Ø8, 3 legs, every 50 mm, from x=0 to x=0,6". That is an instruction,
 * not a bar. Nothing had coordinates, so nothing could be collision-checked, marked,
 * scheduled, weighed, cut or drawn. The leg COUNT was correct and verified against Table
 * 9.7.6.2.2; the steel did not exist.
 *
 * This module fabricates the pieces. One closed perimeter stirrup plus `legs − 2` crossties,
 * repeated at every station the zone's spacing produces.
 *
 * ── The regulation, verbatim, and where each number comes from ──────
 *
 * §25.7.1.1  Stirrups must be placed as close to the tension and compression surfaces as
 *            cover and the proximity of other reinforcement allow, and **must be anchored at
 *            both ends**. As shear reinforcement they must extend a distance `d` from the
 *            extreme compression fibre.
 *
 * §25.7.1.2  "Entre los extremos anclados, cada doblez en la parte continua de los estribos
 *            en U, sencillos o múltiples, y cada doblez en un estribo cerrado, debe contener
 *            una barra longitudinal o cordón." — **every bend must contain a longitudinal
 *            bar.** This is a geometric requirement, not a detailing preference, and it is
 *            what ties the cage corners to the actual bar positions. Asserted, not assumed:
 *            `cornerContainment` reports which longitudinal bar each corner encloses and
 *            flags any corner that encloses none.
 *
 * §25.7.1.3(a) For d_b ≤ 16 mm — every stirrup diameter this app generates — anchorage is
 *            "un gancho normal alrededor de la armadura longitudinal": a standard hook per
 *            §25.3.2, hooked around a longitudinal bar. No embedment length is required;
 *            that is §25.7.1.3(b), which applies to Ø20–25 with f_yt > 220 MPa and is not
 *            reachable here. `assertHookAnchorageSupported` refuses rather than silently
 *            applying (a) outside its range.
 *
 * §25.3.2 / Table 25.3.2  Mandrel diameter and hook extension. Already implemented and
 *            verified cell-by-cell against the rendered PDF in `bar-geometry.ts`; this module
 *            calls `standardHook(d, angle, 'transverse')` and invents nothing.
 *
 * §25.3.5    THE crosstie ("gancho suplementario") clause, and the one that governs a beam's
 *            internal legs. It lives in §25.3 "Ganchos normales y ganchos suplementarios",
 *            NOT in the column-tie section, so it applies to beams:
 *              (a) continuous between its ends;
 *              (b) a 135° hook at ONE end;
 *              (c) a standard hook with a minimum 90° bend at the OTHER end;
 *              (d) the hooks must embrace the PERIPHERAL longitudinal bars;
 *              (e) the 90° hooks of two successive crossties embracing the same longitudinal
 *                  bars must have their ends ALTERNATED, unless INPRES-CIRSOC 103-II or
 *                  §25.7.1.6.1 is satisfied.
 *            §22.5.8.5.5 confirms a crosstie counts as shear reinforcement: "Para cada
 *            estribo... o gancho suplementario, Av debe tomarse como el área efectiva de las
 *            ramas... dentro de la separación s."
 *
 *            (e) is a "deben" — NORMATIVE. An earlier revision of this module implemented
 *            alternation from C 25.7.2.3.1's "deberían... cuando sea posible" and therefore
 *            labelled it *practice*. That was wrong twice: it cited a COLUMN clause for a beam
 *            piece, and it downgraded a requirement to a preference.
 *
 * §25.7.2.3  NOT USED for beams. It sits under "§25.7.2 Estribos cerrados de COLUMNAS".
 *            `unbracedBarReport` implements its (b) sub-clause and is retained for the column
 *            generator only; a source gate asserts no column-only clause reaches a beam's
 *            transverse bars.
 *
 * Table 9.7.6.2.2 (via `./transverse-spacing`) remains the sole authority on the row, the
 * along-member limit, the across-width limit, the required leg count and the leg
 * coordinates. This module consumes `legOffsetsAcross` rather than computing positions, so
 * the cage, the verifier, the collision checker and the drawing cannot disagree.
 *
 * ── What is NOT invented here ──────────────────────────────────────
 *
 * No hook angle, extension, mandrel, spacing, first-stirrup offset or cover allowance is
 * chosen by this module. §25.7.1.1 prescribes no longitudinal offset for the first stirrup —
 * the "s/2 from the support face" rule of common practice has no clause — so stations are
 * generated at `from + k·s` from the zone boundary, which invents nothing, and adjacent-zone
 * duplicates are removed geometrically.
 *
 * All lengths in metres unless the name says `Mm`. Pure: no store, no runes.
 */

import {
  arcSegment, centrelineRadius, developedLength, minMandrelDiameter, standardHook,
  straightSegment, type BarPath, type BarSegment, type HookAngle, type HookGeometry,
  type Point3,
} from './bar-geometry';
import {
  LENGTH_EPS, legOffsetsAcross, type TransverseSpacingLimits,
} from './transverse-spacing';
import { clause, type ClauseRef } from '../regulation';

// ─── Shapes ──────────────────────────────────────────────────────

/**
 * What a fabricated transverse piece IS, not what it does.
 *
 * The bender needs the shape; the engineer needs the role. A closed stirrup and a crosstie
 * are different fabricated items with different cutting lengths and different marks, so they
 * are different shapes even when they sit at the same station.
 */
export type TransverseShape = 'closedStirrup' | 'crosstie';

/** Largest stirrup diameter §25.7.1.3(a) covers without an added embedment length. */
export const HOOK_ANCHORAGE_MAX_DIA_MM = 16;

/**
 * Closing-hook angle for a CLOSED STIRRUP.
 *
 * §25.7.1.3(a) requires "un gancho normal alrededor de la armadura longitudinal" for
 * d_b ≤ 16 mm and does not fix the angle; Table 25.3.2 tabulates 90°, 135° and 180° for
 * transverse bars. 135° is chosen among the tabulated options and its mandrel and extension
 * are read from the table rather than invented.
 */
export const STIRRUP_HOOK_ANGLE: HookAngle = 135;

/**
 * Crosstie hook angles — §25.3.5(b) and (c), not a choice.
 *
 * (b) 135° at one end. (c) a standard hook with a minimum 90° bend at the other. A crosstie
 * with 135° at BOTH ends, which this module produced first, satisfies neither (c) as written
 * nor (e)'s alternation, whose whole subject is the 90° end.
 */
export const CROSSTIE_HOOK_ANGLE_135: HookAngle = 135;
export const CROSSTIE_HOOK_ANGLE_90: HookAngle = 90;

/** @deprecated Split into the stirrup and crosstie constants above. */
export const TRANSVERSE_HOOK_ANGLE: HookAngle = STIRRUP_HOOK_ANGLE;

export interface TransversePiece {
  /** The fabricated bar. `role` is always `'transverse'`. */
  path: BarPath;
  shape: TransverseShape;
  /** Owning member. */
  elementId: number;
  /** Zone this piece belongs to, e.g. `e162:support:0`. */
  zoneId: string;
  /** Distance along the member axis, m, from the member's i end. */
  station: number;
  /**
   * How many legs of the SET this piece contributes across the width.
   * A closed stirrup contributes 2; a crosstie contributes 1.
   */
  legsContributed: number;
  /** Across-width offsets of this piece's legs, m from the section centreline. */
  legOffsets: number[];
  /**
   * Which longitudinal bar each bend of this piece encloses — §25.7.1.2.
   * A `null` entry is a bend that encloses nothing, which is a defect, not a detail.
   */
  cornerContainment: Array<{ at: Point3; longitudinalBarId: string | null }>;
  /** Hook orientation, so consecutive pieces can be staggered (C 25.7.2.3.1, practice). */
  hookOrientation: 'a' | 'b';
  refs: ClauseRef[];
}

/** A longitudinal bar this cage has to enclose, in section coordinates. */
export interface LongitudinalBarRef {
  id: string;
  /** Across-width offset from the section centreline, m. */
  across: number;
  /** Height above the section centreline, m. Positive toward the top face. */
  up: number;
  diameterMm: number;
}

export interface StirrupSetInput {
  elementId: number;
  zoneId: string;
  /** Station along the member axis, m. */
  station: number;
  /** Web width and overall depth, m. */
  b: number;
  h: number;
  /** Cover to the OUTSIDE of the stirrup, m. */
  cover: number;
  stirrupDiaMm: number;
  /** Legs across the width, from Table 9.7.6.2.2. Never below 2. */
  legs: number;
  /** Longitudinal bars present at this station, for the §25.7.1.2 containment check. */
  longitudinalBars: readonly LongitudinalBarRef[];
  /** Member frame. `across` = axis × up, matching the longitudinal generator exactly. */
  origin: Point3;
  axis: Point3;
  up: Point3;
  across: Point3;
  /** Alternates the hook corner between consecutive stations (C 25.7.2.3.1, practice). */
  hookOrientation: 'a' | 'b';
  /** Maximum nominal coarse-aggregate size, mm — §25.7.2.1(a) clear-spacing term. */
  maxAggregateSizeMm: number;
  /**
   * Table 9.7.6.2.2 across-width limit, m.
   *
   * Passed in because it decides whether an interior leg may be snapped to a bar position: both
   * that limit and §25.3.5(d) are mandatory, and when they conflict the spacing limit governs.
   */
  acrossMax?: number;
}

function add(p: Point3, v: Point3, k: number): Point3 {
  return { x: p.x + v.x * k, y: p.y + v.y * k, z: p.z + v.z * k };
}

/** Section point → global, using the member frame the longitudinal generator uses. */
function sectionPoint(
  input: Pick<StirrupSetInput, 'origin' | 'axis' | 'up' | 'across' | 'station'>,
  acrossOffset: number, upOffset: number,
): Point3 {
  const atStation = add(input.origin, input.axis, input.station);
  return add(add(atStation, input.across, acrossOffset), input.up, upOffset);
}

/**
 * Half-extents of the stirrup CENTRELINE rectangle, m.
 *
 * Cover is to the stirrup's outside, so the centreline sits `cover + d_s/2` from each face.
 * The full across-width span is therefore `b − 2·cover − d_s`, which is exactly
 * `acrossWidthSpan()` in `./transverse-spacing` — the two must agree or the outer legs of the
 * cage would not sit where the spacing rule believes they do.
 */
export function stirrupCentrelineHalfExtents(
  b: number, h: number, cover: number, stirrupDiaMm: number,
): { halfAcross: number; halfUp: number } {
  const inset = cover + stirrupDiaMm / 2000;
  return { halfAcross: Math.max(0, b / 2 - inset), halfUp: Math.max(0, h / 2 - inset) };
}

/**
 * §25.7.1.3 — is a standard hook alone a legal anchorage for this stirrup diameter?
 *
 * (a) covers d_b ≤ 16 mm outright. (b) covers Ø20 and Ø25 with f_yt > 220 MPa but demands an
 * additional embedded length, which this module does not compute. Returning `false` makes the
 * caller declare the case unsupported rather than applying (a) beyond its stated range.
 */
export function hookAnchorageIsSupported(stirrupDiaMm: number): boolean {
  return stirrupDiaMm <= HOOK_ANCHORAGE_MAX_DIA_MM;
}

const REF_ANCHOR = () => clause('cirsoc-201', '2025', '25.7.1.3',
  'anclaje de estribos: gancho normal alrededor de la armadura longitudinal');
const REF_BEND_CONTAINS = () => clause('cirsoc-201', '2025', '25.7.1.2',
  'cada doblez debe contener una barra longitudinal');
const REF_HOOK_TABLE = () => clause('cirsoc-201', '2025', 'Tabla 25.3.2',
  'diámetro mínimo de doblado y geometría del gancho para estribos');
const REF_CROSSTIE = () => clause('cirsoc-201', '2025', '25.3.5',
  'ganchos suplementarios: 135° en un extremo, gancho normal de 90° mínimo en el otro, ' +
  'abrazando las barras longitudinales periféricas');
const REF_CROSSTIE_ALTERNATE = () => clause('cirsoc-201', '2025', '25.3.5(e)',
  'los ganchos de 90° de ganchos suplementarios sucesivos deben quedar alternados');
const REF_AV = () => clause('cirsoc-201', '2025', '22.5.8.5.5',
  'Av incluye las ramas de los ganchos suplementarios dentro de la separación s');

/**
 * The nearest longitudinal bar a bend encloses, or null when it encloses none.
 *
 * "Encloses" is judged by proximity to the corner of the centreline rectangle: a bend of
 * inside radius `r` wraps a bar whose centre lies within roughly `r + d_b/2` of the corner.
 * §25.7.1.2 is a yes/no requirement, so this returns the bar rather than a distance score.
 */
function barAtCorner(
  bars: readonly LongitudinalBarRef[],
  acrossOffset: number, upOffset: number,
  bendCentrelineRadius: number, stirrupDiaMm: number,
  tolerance = 0.002,
): string | null {
  // A bar is contained by a bend when it is SEATED in the corner: nestled against the inside
  // of the bend arc, touching both legs. That is a physical condition, so the reach is the sum
  // of the geometry involved — the bend's centreline radius, the stirrup's own half-diameter,
  // and the bar's half-diameter — plus a small fabrication tolerance.
  //
  // Two looser models were tried and both misreported real cages. Using the bend radius alone
  // failed a 300 mm section whose corner bar legitimately sits ~13 mm diagonally inboard of the
  // leg centreline; a flat 5 mm tolerance failed for the same reason. Neither cage was wrong —
  // the check was.
  let best: { id: string; d: number } | null = null;
  const reachBase = bendCentrelineRadius + stirrupDiaMm / 2000 + tolerance;
  for (const bar of bars) {
    const d = Math.hypot(bar.across - acrossOffset, bar.up - upOffset);
    if (d <= reachBase + bar.diameterMm / 2000 && (best === null || d < best.d)) {
      best = { id: bar.id, d };
    }
  }
  return best?.id ?? null;
}

/**
 * One closed rectangular stirrup as a real bar path.
 *
 * Built as four straight runs joined by four corner arcs, closing with a standard hook. The
 * hook corner alternates with `hookOrientation` so consecutive stirrups stagger their hooks
 * (C 25.7.2.3.1 — practice, not a requirement).
 */
export function buildClosedStirrup(input: StirrupSetInput): TransversePiece {
  const ds = input.stirrupDiaMm;
  const { halfAcross, halfUp } = stirrupCentrelineHalfExtents(input.b, input.h, input.cover, ds);
  const mandrel = minMandrelDiameter(ds, 'transverse');
  const r = centrelineRadius(mandrel.value, ds);
  const hook = standardHook(ds, STIRRUP_HOOK_ANGLE, 'transverse');

  // Corners of the centreline rectangle, in section coordinates.
  // Ordered so the loop runs bottom → right → top → left when `hookOrientation` is 'a', and
  // is mirrored across the section centreline when it is 'b'.
  const s = input.hookOrientation === 'a' ? 1 : -1;
  const corners: Array<[number, number]> = [
    [-halfAcross * s, -halfUp],
    [halfAcross * s, -halfUp],
    [halfAcross * s, halfUp],
    [-halfAcross * s, halfUp],
  ];

  const segments: BarSegment[] = [];
  // Each side is shortened by the arc radius at both ends; the arcs then round the corners.
  for (let i = 0; i < corners.length; i++) {
    const [a0, u0] = corners[i];
    const [a1, u1] = corners[(i + 1) % corners.length];
    const along = { a: Math.sign(a1 - a0), u: Math.sign(u1 - u0) };
    const startTrim = sectionPoint(input, a0 + along.a * r, u0 + along.u * r);
    const endTrim = sectionPoint(input, a1 - along.a * r, u1 - along.u * r);
    segments.push(straightSegment(startTrim, endTrim));
    // Corner arc into the next side.
    const [a2, u2] = corners[(i + 2) % corners.length];
    const next = { a: Math.sign(a2 - a1), u: Math.sign(u2 - u1) };
    const arcEnd = sectionPoint(input, a1 + next.a * r, u1 + next.u * r);
    segments.push(arcSegment(endTrim, arcEnd, r, 90));
  }

  // Closing hook: a standard 135° stirrup hook turning into the section at the last corner.
  const [ha, hu] = corners[0];
  const hookTip = sectionPoint(input, ha - Math.sign(ha || 1) * hook.extension, hu + hook.extension);
  segments.push(straightSegment(sectionPoint(input, ha, hu), hookTip));

  const containment = corners.map(([a, u]) => ({
    at: sectionPoint(input, a, u),
    longitudinalBarId: barAtCorner(input.longitudinalBars, a, u, r, ds),
  }));

  const refs = [
    REF_BEND_CONTAINS(), REF_ANCHOR(), REF_HOOK_TABLE(), ...mandrel.refs, ...hook.refs,
  ];

  return {
    path: {
      id: `${input.zoneId}:stirrup:${input.station.toFixed(4)}`,
      diameterMm: ds,
      role: 'transverse',
      segments,
      startTreatment: { kind: 'hook', hook },
      endTreatment: { kind: 'hook', hook },
      cuttingLength: developedLength(segments),
      ownerElementIds: [input.elementId],
      layerId: `${input.zoneId}:stirrup`,
      source: 'generated',
      locked: false,
      refs,
    },
    shape: 'closedStirrup',
    elementId: input.elementId,
    zoneId: input.zoneId,
    station: input.station,
    legsContributed: 2,
    legOffsets: [-halfAcross, halfAcross],
    cornerContainment: containment,
    hookOrientation: input.hookOrientation,
    refs,
  };
}

/**
 * One crosstie ("gancho suplementario") as a real bar path — §25.3.5.
 *
 * A straight leg across the section depth with, per (b) and (c), a **135° hook at one end and a
 * 90° hook at the other**. Both hooks embrace the peripheral longitudinal bars, per (d).
 *
 * `hookOrientation` swaps which end carries the 90° hook. That is §25.3.5(e) and it is
 * NORMATIVE — "deben quedar con los extremos alternados" for successive crossties embracing the
 * same longitudinal bars. An earlier revision used 135° at BOTH ends and justified alternation
 * from C 25.7.2.3.1's "cuando sea posible", which was wrong twice over: it cited a COLUMN clause
 * for a beam piece, and it downgraded a requirement to a preference.
 */
export function buildCrosstie(
  input: StirrupSetInput, acrossOffset: number, index: number,
): TransversePiece {
  const ds = input.stirrupDiaMm;
  const { halfUp } = stirrupCentrelineHalfExtents(input.b, input.h, input.cover, ds);
  const mandrel = minMandrelDiameter(ds, 'transverse');
  const r = centrelineRadius(mandrel.value, ds);
  const hook135 = standardHook(ds, CROSSTIE_HOOK_ANGLE_135, 'transverse');
  const hook90 = standardHook(ds, CROSSTIE_HOOK_ANGLE_90, 'transverse');

  // §25.3.5(e): which END carries the 90° hook alternates between successive ties.
  const ninetyAtTop = input.hookOrientation === 'b';
  const bottomHook = ninetyAtTop ? hook135 : hook90;
  const topHook = ninetyAtTop ? hook90 : hook135;

  const bottom = sectionPoint(input, acrossOffset, -halfUp);
  const top = sectionPoint(input, acrossOffset, halfUp);

  // Hooks turn along the member axis, opposite ways at the two ends, so the tie grips a
  // peripheral bar on each face (§25.3.5(d)).
  const segments: BarSegment[] = [];
  const bottomTip = add(add(bottom, input.axis, bottomHook.extension), input.up, r);
  segments.push(straightSegment(bottomTip, bottom));
  segments.push(straightSegment(bottom, top));
  const topTip = add(add(top, input.axis, -topHook.extension), input.up, -r);
  segments.push(straightSegment(top, topTip));

  const containment = [
    { at: bottom, longitudinalBarId: barAtCorner(input.longitudinalBars, acrossOffset, -halfUp, r, ds) },
    { at: top, longitudinalBarId: barAtCorner(input.longitudinalBars, acrossOffset, halfUp, r, ds) },
  ];

  const refs = [
    REF_CROSSTIE(), REF_CROSSTIE_ALTERNATE(), REF_AV(), REF_HOOK_TABLE(),
    ...mandrel.refs, ...hook135.refs, ...hook90.refs,
  ];

  return {
    path: {
      id: `${input.zoneId}:crosstie${index}:${input.station.toFixed(4)}`,
      diameterMm: ds,
      role: 'transverse',
      segments,
      startTreatment: { kind: 'hook', hook: bottomHook },
      endTreatment: { kind: 'hook', hook: topHook },
      cuttingLength: developedLength(segments),
      ownerElementIds: [input.elementId],
      layerId: `${input.zoneId}:crosstie${index}`,
      source: 'generated',
      locked: false,
      refs,
    },
    shape: 'crosstie',
    elementId: input.elementId,
    zoneId: input.zoneId,
    station: input.station,
    legsContributed: 1,
    legOffsets: [acrossOffset],
    cornerContainment: containment,
    hookOrientation: input.hookOrientation,
    refs,
  };
}

export interface StirrupSetResult {
  pieces: TransversePiece[];
  /** Every leg offset across the width, sorted — what the across-width limit is judged on. */
  legOffsets: number[];
  /** Non-empty when a provision could not be applied. */
  unsupported: ClauseRef[];
}

/**
 * One complete stirrup set at one station: the closed perimeter stirrup plus `legs − 2`
 * crossties, with leg positions taken from the authoritative evaluator.
 *
 * A required crosstie is never a numeric third leg: it is a fabricated piece with its own
 * path, hooks, cutting length and mark.
 */
/**
 * Interior leg offsets, snapped to longitudinal bar positions that exist on BOTH faces.
 *
 * §25.3.5(d) requires a crosstie's hooks to embrace the peripheral longitudinal bars, so an
 * interior leg belongs AT a bar, not at an arbitrary fraction of the width. Candidates are the
 * across-offsets that carry a bar near the top face and near the bottom face alike; the chooser
 * picks the `legs − 2` of them whose positions come closest to an even division, which keeps the
 * across-width gaps as uniform as the real bar layout allows.
 *
 * When no shared candidate exists the even division is returned unchanged. That leg will fail the
 * §25.7.1.2 containment check, which is the honest outcome: the section cannot host the crosstie
 * the table requires, and the caller reports it rather than drawing a tie that grips nothing.
 */
export function chooseInteriorLegOffsets(
  bars: readonly LongitudinalBarRef[],
  halfAcross: number,
  legs: number,
  evenDivision: readonly number[],
  acrossMax: number,
  tolerance = 0.006,
): { offsets: number[]; snapped: boolean } {
  const wanted = Math.max(0, legs - 2);
  const target = evenDivision.slice(1, evenDivision.length - 1);
  if (wanted === 0) return { offsets: [], snapped: true };

  // Shared candidates: an across-offset carrying a bar BOTH above and below the centreline, so a
  // crosstie there can embrace a peripheral bar at each end (§25.3.5(d)).
  const upper = bars.filter((b) => b.up > 0);
  const lower = bars.filter((b) => b.up <= 0);
  const shared = [...new Set(lower.map((b) => +b.across.toFixed(6)))]
    .filter((a) => Math.abs(a) < halfAcross - 1e-9)
    .filter((a) => upper.some((u) => Math.abs(u.across - a) <= tolerance))
    .sort((x, y) => x - y);

  const worstGap = (interior: readonly number[]): number => {
    const all = [-halfAcross, ...interior, halfAcross];
    let w = 0;
    for (let i = 1; i < all.length; i++) w = Math.max(w, all[i] - all[i - 1]);
    return w;
  };

  // Best subset of shared candidates of the required size, by smallest worst gap. `wanted` is 1
  // or 2 in practice and the candidate list is a handful of bars, so exhaustive is fine and
  // deterministic — which matters more here than cleverness.
  let best: number[] | null = null;
  const pick = (start: number, chosen: number[]) => {
    if (chosen.length === wanted) {
      if (best === null || worstGap(chosen) < worstGap(best)) best = [...chosen];
      return;
    }
    for (let i = start; i < shared.length; i++) pick(i + 1, [...chosen, shared[i]]);
  };
  pick(0, []);

  // Table 9.7.6.2.2's across-width limit and §25.3.5(d) are BOTH "debe". A snapped set that
  // breaks the spacing limit is not a compromise worth making — measured: snapping a third leg to
  // the nearest shared bar on a 6Ø12 mat put it 12 mm from the corner leg and left a 230 mm gap
  // against a 200 mm limit. So spacing wins, the even division is used, and §25.7.1.2 then
  // reports that the leg grips only one face. Both facts reach the engineer.
  if (best !== null && worstGap(best) <= acrossMax + LENGTH_EPS) {
    return { offsets: [...best].sort((x, y) => x - y), snapped: true };
  }
  return { offsets: [...target], snapped: false };
}

export function buildStirrupSet(input: StirrupSetInput): StirrupSetResult {
  const unsupported: ClauseRef[] = [];
  if (!hookAnchorageIsSupported(input.stirrupDiaMm)) {
    // §25.7.1.3(b) needs an embedment length this module does not compute. Refuse rather
    // than apply (a) outside the diameter range it states.
    unsupported.push(clause('cirsoc-201', '2025', '25.7.1.3(b)',
      'anclaje de estribos Ø20-25 con fyt > 220 MPa requiere longitud empotrada adicional'));
    return { pieces: [], legOffsets: [], unsupported };
  }

  const legs = Math.max(2, Math.floor(input.legs));
  const even = legOffsetsAcross(legs, input.b, input.cover, input.stirrupDiaMm);
  const { halfAcross } = stirrupCentrelineHalfExtents(
    input.b, input.h, input.cover, input.stirrupDiaMm);

  // Interior legs SNAP to real longitudinal bar positions.
  //
  // §25.3.5(d): a crosstie's hooks "deben abrazar las barras longitudinales periféricas". A leg
  // at a mathematically even division grips nothing when no bar happens to sit there — measured
  // on the row-2 fixture, whose 6Ø12 bottom mat has no centreline bar, so an equally-divided
  // third leg embraced air. Equal division is the fallback, not the rule.
  const chosen = chooseInteriorLegOffsets(
    input.longitudinalBars, halfAcross, legs, even, // No limit supplied means DO NOT SNAP. Snapping without knowing the across-width limit can
    // place a leg that breaks it, which is how a third leg once landed 12 mm from the corner.
    input.acrossMax ?? 0);
  const interior = chosen.offsets;

  const offsets = [-halfAcross, ...interior, halfAcross];
  const pieces: TransversePiece[] = [buildClosedStirrup(input)];
  for (let i = 0; i < interior.length; i++) {
    pieces.push(buildCrosstie(input, interior[i], i + 1));
  }
  return { pieces, legOffsets: offsets, unsupported };
}

// ─── Station sequence ────────────────────────────────────────────

export interface StationSequenceInput {
  from: number;
  to: number;
  spacing: number;
  /** True when another zone starts exactly at `to`, so the boundary bar belongs to it. */
  nextZoneStartsAtEnd: boolean;
}

/**
 * Stations for one zone, m from the member's i end.
 *
 * §25.7.1.1 requires anchorage at both ends and a depth extent of `d`; it prescribes **no**
 * longitudinal offset for the first stirrup. The "first stirrup at s/2 from the support face"
 * rule of common practice has no clause behind it, so it is not applied — stations run from
 * the zone boundary at the spacing the table allows, which invents nothing.
 *
 * The boundary bar is emitted by the FIRST of two adjacent zones only, so a shared boundary
 * does not produce two bars at one point. That is a fabrication error, not a tight detail.
 */
export function stirrupStations(input: StationSequenceInput): number[] {
  const { from, to, spacing } = input;
  if (!(spacing > 0) || !(to > from)) return [];
  const out: number[] = [];
  const span = to - from;
  const n = Math.floor(span / spacing + 1e-9);
  for (let k = 0; k <= n; k++) {
    const x = from + k * spacing;
    if (x > to + 1e-9) break;
    // Skip the closing boundary when the next zone owns it.
    if (input.nextZoneStartsAtEnd && Math.abs(x - to) < 1e-9) continue;
    out.push(+x.toFixed(6));
  }
  // The zone must be covered to its end: if the last station falls short by more than a
  // rounding error, the end is stirruped too, because leaving the tail bare would be an
  // uncovered length rather than a wider spacing.
  const last = out[out.length - 1];
  if (!input.nextZoneStartsAtEnd && (last === undefined || to - last > 1e-6)) {
    out.push(+to.toFixed(6));
  }
  return out;
}

// ─── §25.7.2.3(b) unbraced-bar check ────────────────────────────

export interface UnbracedBarReport {
  ok: boolean;
  /** Clear limit actually applied, m — the lesser of 15·d_be and 150 mm. */
  limit: number;
  /** Bars further than the limit from a braced bar. */
  offenders: Array<{ id: string; clearToNearestBraced: number }>;
  refs: ClauseRef[];
}

/**
 * §25.7.2.3(b) — "Ninguna barra que no esté arriostrada lateralmente puede estar separada
 * más de 15·d_be o 150 mm libres de una barra arriostrada."
 *
 * A bar is braced when a leg of the cage reaches it, which after `buildStirrupSet` means its
 * across-offset coincides with a leg offset. The limit is the LESSER of the two terms, and it
 * is a CLEAR distance, so the two bar radii come off the centre-to-centre distance.
 */
export function unbracedBarReport(
  bars: readonly LongitudinalBarRef[],
  legOffsets: readonly number[],
  stirrupDiaMm: number,
  tolerance = 0.002,
): UnbracedBarReport {
  const limit = Math.min(15 * stirrupDiaMm / 1000, 0.150);
  // A leg braces a bar when the two are in contact. That is a PHYSICAL condition, so the
  // reach is derived from the two radii — the leg centreline sits d_s/2 from its inner face
  // and the bar centre d_b/2 from its own surface — plus a small fabrication tolerance.
  // A bare 5 mm tolerance was used here first and mis-reported an ordinary 300 mm cage as
  // unbraced, because a corner bar's centre is legitimately (d_s + d_b)/2 inside the leg.
  const isBraced = (bar: LongitudinalBarRef) =>
    legOffsets.some((o) => Math.abs(o - bar.across)
      <= (stirrupDiaMm + bar.diameterMm) / 2000 + tolerance);

  const braced = bars.filter(isBraced);
  const offenders: UnbracedBarReport['offenders'] = [];
  for (const bar of bars) {
    if (isBraced(bar)) continue;
    let nearest = Number.POSITIVE_INFINITY;
    for (const b of braced) {
      const centre = Math.hypot(b.across - bar.across, b.up - bar.up);
      const clear = centre - (b.diameterMm + bar.diameterMm) / 2000;
      nearest = Math.min(nearest, clear);
    }
    if (!(nearest <= limit)) offenders.push({ id: bar.id, clearToNearestBraced: nearest });
  }
  return { ok: offenders.length === 0, limit, offenders, refs: [
    clause('cirsoc-201', '2025', '25.7.2.3(b)',
      'barra no arriostrada a no más de 15 dbe o 150 mm libres de una barra arriostrada'),
  ] };
}

/**
 * §25.7.1.2 — every bend must contain a longitudinal bar.
 *
 * Returns the bends that contain none. A non-empty result is a DEFECT: the cage has a corner
 * gripping nothing, which is exactly what the clause forbids.
 */
export function bendsWithoutLongitudinalBar(
  pieces: readonly TransversePiece[],
): Array<{ pieceId: string; at: Point3 }> {
  const out: Array<{ pieceId: string; at: Point3 }> = [];
  for (const p of pieces) {
    for (const c of p.cornerContainment) {
      if (c.longitudinalBarId === null) out.push({ pieceId: p.path.id, at: c.at });
    }
  }
  return out;
}

/**
 * Total legs a set provides across the width, for comparison against `requiredLegs`.
 *
 * Counted from the fabricated pieces, not from the number that was requested — the point of
 * materialising the cage is that the count becomes an observation rather than an intention.
 */
export function legsProvided(pieces: readonly TransversePiece[]): number {
  return pieces.reduce((n, p) => n + p.legsContributed, 0);
}

/** True when the fabricated set satisfies both columns of the table it was built from. */
export function setSatisfiesLimits(
  pieces: readonly TransversePiece[],
  limits: TransverseSpacingLimits,
  spacingAlong: number,
): { ok: boolean; alongOk: boolean; acrossOk: boolean; worstAcrossGap: number } {
  const offsets = [...new Set(pieces.flatMap((p) => p.legOffsets))].sort((a, b) => a - b);
  let worst = 0;
  for (let i = 1; i < offsets.length; i++) worst = Math.max(worst, offsets[i] - offsets[i - 1]);
  const alongOk = spacingAlong <= limits.alongMax + 1e-9;
  const acrossOk = offsets.length >= 2 && worst <= limits.acrossMax + 1e-9;
  return { ok: alongOk && acrossOk, alongOk, acrossOk, worstAcrossGap: worst };
}
