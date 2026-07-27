/**
 * Beam reinforcement generation — physical bars from a moment envelope.
 *
 * This is the layer the capability matrix has been honestly declaring `generate: false`
 * for. The verifier could rate a curtailment the user supplied; nothing could produce
 * one. This produces one.
 *
 * ── The curtailment rules, verbatim (CIRSOC 201-2025 §9.7.3) ───
 *
 * §9.7.3.2  critical sections for development are the points of maximum stress AND the
 *           points within the span where bent or terminated reinforcement is no longer
 *           required to resist flexure.
 * §9.7.3.3  reinforcement must extend beyond the point where it is no longer required
 *           by **max(d, 12·d_b)**, except at simple supports and free ends of cantilevers.
 * §9.7.3.4  continuing flexural tension reinforcement must have an embedded length not
 *           less than **d** beyond the point where terminated reinforcement is no longer
 *           required.
 * §9.7.3.5  reinforcement must NOT terminate in a tension zone unless (a) V_u ≤ (2/3)V_n
 *           at the cut-off, or (b) for Ø32 and smaller, the continuing bars provide
 *           twice the area required for flexure and V_u ≤ (3/4)V_n, or (c) extra stirrups
 *           are placed over (3/4)d with A_v ≥ 0,41·b_w·s/f_yt and s ≤ d/(8·β_b).
 * §9.7.3.7  tension reinforcement may be anchored by bending it into the web to anchor it
 *           or make it continuous with the reinforcement on the opposite face — the
 *           bent-up bar permission.
 * §9.7.3.8.1 at simple supports, at least ONE THIRD of the maximum positive moment
 *           reinforcement continues into the support at least 150 mm.
 * §9.7.3.8.2 at other supports, at least ONE QUARTER continues at least 150 mm, and if
 *           the beam is part of the lateral-force-resisting system it must be anchored to
 *           develop f_y at the support face.
 *
 * ── Design stance ──────────────────────────────────────────────
 *
 * Cut-offs are generated where the envelope says the steel is no longer needed, then
 * pushed out by the §9.7.3.3 extension, then tested against §9.7.3.5. A cut-off that
 * fails all three of (a), (b), (c) is NOT moved silently to somewhere convenient — the
 * bar is run through instead, which is the conservative and constructible answer, and
 * the decision is recorded in the trace.
 *
 * Pure: no store, no runes. Lengths m, forces kN, moments kN·m.
 */

import {
  buildStraightBarWithHooks, minMandrelDiameter, standardHook,
  type BarPath, type HookAngle, type Point3,
} from '../../codes/cirsoc201/bar-geometry';
import { minClearBetweenLayers, minClearSpacingInLayer } from '../../codes/cirsoc201/spacing';
import { transverseSpacingForDemand } from '../../codes/cirsoc201/transverse-spacing';
import {
  bendsWithoutLongitudinalBar, buildStirrupSet, stirrupStations,
  type LongitudinalBarRef, type TransversePiece,
} from '../../codes/cirsoc201/transverse-cage';
import { DEFAULT_TOLERANCES } from './collision';
import { clause, formatClause, type ClauseRef, type RegulationEdition } from '../../codes/regulation';

// ─── Inputs ──────────────────────────────────────────────────────

export interface MomentStation {
  /** Position along the member, m from the i end. */
  x: number;
  /** Envelope sagging (positive) moment, kN·m. */
  mPos: number;
  /** Envelope hogging (negative) moment magnitude, kN·m, positive number. */
  mNeg: number;
  /** Envelope shear magnitude, kN. */
  v: number;
}

export type SupportKind = 'simple' | 'continuous' | 'free';

export interface BeamGenerationInput {
  elementId: number;
  /** Clear span, m. */
  L: number;
  b: number;
  h: number;
  d: number;
  cover: number;
  stirrupDia: number;
  fc: number;
  fy: number;
  maxAggregateSizeMm: number;
  edition: RegulationEdition;
  /** Envelope, ordered by x, at least 3 stations. */
  stations: MomentStation[];
  /**
   * Vertical offset of this member's longitudinal steel, m, from the joint-layer
   * allocation. Bottom bars rise by it and top bars drop by it; both REDUCE the effective
   * depth, which is why a non-zero value obliges re-verification.
   */
  layerRaise?: number;
  /**
   * Vertical drop of this member's TOP steel, m. Sized independently of `layerRaise`.
   *
   * The two faces are separate problems: top steel crosses the other line's top steel and
   * bottom crosses bottom. One scalar for both over-raises whichever face did not need it,
   * and on the flagship that spent lever arm on clashes that could not happen.
   */
  layerDrop?: number;
  supportI: SupportKind;
  supportJ: SupportKind;
  /** Nominal shear strength at each station, kN — for the §9.7.3.5 tests. */
  vn: number;
  /** Chosen bottom reinforcement (from the coordinator). */
  bottom: { count: number; diameterMm: number };
  /** Chosen top reinforcement at each support. */
  topStart: { count: number; diameterMm: number };
  topEnd: { count: number; diameterMm: number };
  /** True when the beam belongs to the lateral-force-resisting system (§9.7.3.8.2). */
  lateralSystem: boolean;
  /** Development length for a straight bar of diameter d (mm), in m. */
  ld: (diameterMm: number) => number;
  /** Origin of the member in model coordinates, and its unit axis. */
  origin: Point3;
  axis: Point3;
  /** Unit vector pointing "up" in the section (toward the top face). */
  up: Point3;
  /**
   * Transverse positions this beam's bars must occupy, m from the section centreline.
   *
   * Supplied by the caller when the beam has to thread between the column bars at its
   * ends. It has to be decided ONCE, for the whole bar, because a beam spans two joints:
   * moving a straight bar sideways to clear one column moves it at the other end too, so
   * a post-hoc nudge at each joint simply undoes itself. Absent, bars are centred on the
   * section at the code spacing.
   */
  transverseSlots?: readonly number[];
  /**
   * Layer index of each entry in `transverseSlots`, parallel array.
   *
   * Without it the override is unsound. A coordinated candidate may itself be arranged in
   * two layers, so its `across` values REPEAT — bar 0 and bar 4 legitimately share a
   * transverse position because they sit at different depths. Flattening that to a bare
   * list and applying it to a generator layout with a different layer split put two Ø32
   * bars on the same point, which is where 1,090 of the flagship's "same-member overlaps"
   * came from: not a clash between two bars, but one bar drawn twice.
   */
  transverseLayers?: readonly number[];
  /** Bent-up bar policy — see `BentUpPolicy`. */
  bentUp: BentUpPolicy;
}

/**
 * D13c — when bent-up bars may be generated.
 *
 * The rule that matters: absence of seismic load cases is NOT sufficient. A model whose
 * author simply has not added the seismic case yet looks identical to one in a
 * non-seismic jurisdiction, and generating bent-up bars on the strength of that
 * ambiguity would be silently making a seismic decision on the user's behalf.
 *
 * So the project must state it. `seismicDesign` is an explicit tri-state, and
 * `notRequired` carries the recorded assumption text that goes on the drawing.
 */
export interface BentUpPolicy {
  /**
   * 'required'    — seismic design applies; only the 103 Part II adapter may permit bends
   * 'notRequired' — the project states seismic design does not apply in its jurisdiction
   * 'unstated'    — the project has not said. Bent-up bars are NOT generated.
   */
  seismicDesign: 'required' | 'notRequired' | 'unstated';
  /** Project-level opt-out; wins over everything. */
  optOut: boolean;
  /**
   * Supplied only when `seismicDesign === 'required'`: the 103 Part II adapter's verdict
   * on whether a bent-up path is permitted in this member. Absent means not permitted.
   */
  seismicAdapterPermits?: boolean;
  /** Recorded when `notRequired` — printed on the drawing. */
  assumption?: string;
}

export interface BentUpDecision {
  permitted: boolean;
  /** Why, in words the user sees. */
  reason: string;
  refs: ClauseRef[];
}

/** D13c gate. Returns a reason in every branch — an unexplained refusal is not useful. */
export function bentUpPermitted(policy: BentUpPolicy, edition: RegulationEdition): BentUpDecision {
  const ref = edition === '2025'
    ? clause('cirsoc-201', '2025', '9.7.3.7', 'anclaje doblando la armadura dentro del alma')
    : clause('cirsoc-201', '2005', '12.12', 'barras dobladas');

  if (policy.optOut) {
    return { permitted: false, reason: 'El proyecto tiene desactivadas las barras dobladas.', refs: [ref] };
  }
  if (policy.seismicDesign === 'unstated') {
    return {
      permitted: false,
      reason:
        'El proyecto no indica si corresponde diseño sismorresistente. La ausencia de ' +
        'estados de carga sísmicos no alcanza para suponer que no corresponde: un modelo ' +
        'al que todavía no se le cargó el sismo es indistinguible de uno en jurisdicción ' +
        'no sísmica. Se usan barras rectas con armadura de apoyo separada.',
      refs: [ref],
    };
  }
  if (policy.seismicDesign === 'required') {
    if (policy.seismicAdapterPermits === true) {
      return {
        permitted: true,
        reason: 'Proyecto sismorresistente: el adaptador INPRES-CIRSOC 103 Parte II admite ' +
                'el doblado en este elemento.',
        refs: [ref, clause('inpres-cirsoc-103-ii', '2005', '2.1')],
      };
    }
    return {
      permitted: false,
      reason:
        'Proyecto sismorresistente: el detallado de INPRES-CIRSOC 103 Parte II no admite ' +
        '(o no evalúa todavía) barras dobladas en este elemento. Se usan barras rectas ' +
        'con armadura de apoyo separada.',
      refs: [ref, clause('inpres-cirsoc-103-ii', '2005', '2.1')],
    };
  }
  return {
    permitted: true,
    reason:
      'El proyecto declara que no corresponde diseño sismorresistente' +
      (policy.assumption ? ` (${policy.assumption})` : '') + '. Se admiten barras dobladas.',
    refs: [ref],
  };
}

// ─── Cut-off computation ─────────────────────────────────────────

export type CutoffLegality = 'notInTension' | 'lowShear' | 'doubleArea' | 'extraStirrups' | 'illegal';

export interface Cutoff {
  /** Position where the steel is theoretically no longer needed, m. */
  theoretical: number;
  /** Position after the §9.7.3.3 extension, m — where the bar actually stops. */
  actual: number;
  /** Which §9.7.3.5 provision legalises terminating here. */
  legality: CutoffLegality;
  /** Set when `legality === 'extraStirrups'`: the required extra stirrup zone. */
  extraStirrups?: { length: number; maxSpacing: number; minAvOverS: number };
  refs: ClauseRef[];
  note: string;
}

/** Linear interpolation of the envelope at an arbitrary x. */
function momentAt(stations: readonly MomentStation[], x: number, which: 'mPos' | 'mNeg'): number {
  if (stations.length === 0) return 0;
  if (x <= stations[0].x) return stations[0][which];
  const last = stations[stations.length - 1];
  if (x >= last.x) return last[which];
  for (let i = 1; i < stations.length; i++) {
    if (x <= stations[i].x) {
      const a = stations[i - 1];
      const b = stations[i];
      const t = (x - a.x) / (b.x - a.x || 1);
      return a[which] + (b[which] - a[which]) * t;
    }
  }
  return last[which];
}

function shearAt(stations: readonly MomentStation[], x: number): number {
  if (stations.length === 0) return 0;
  let best = stations[0];
  for (const s of stations) if (Math.abs(s.x - x) < Math.abs(best.x - x)) best = s;
  return best.v;
}

/**
 * Where a group of bars is no longer needed to resist flexure.
 *
 * `retainedFraction` is the share of the group that continues past this point, so the
 * remaining capacity is that fraction of the peak. The theoretical cut-off is where the
 * envelope drops to that level.
 */
export function theoreticalCutoff(
  stations: readonly MomentStation[], which: 'mPos' | 'mNeg',
  peak: number, retainedFraction: number, searchFrom: number, searchTo: number,
): number | null {
  const target = peak * retainedFraction;
  const step = Math.max(0.01, Math.abs(searchTo - searchFrom) / 200);
  const dir = searchTo >= searchFrom ? 1 : -1;
  for (let x = searchFrom; dir > 0 ? x <= searchTo : x >= searchTo; x += dir * step) {
    if (momentAt(stations, x, which) <= target) return x;
  }
  return null;
}

/**
 * Apply §9.7.3.3 (extend by max(d, 12·d_b)) and test §9.7.3.5.
 *
 * When no provision of §9.7.3.5 is satisfied the cut-off is declared `illegal` and the
 * caller runs the bar through instead. Moving the cut-off to somewhere convenient would
 * be inventing a design.
 */
export function evaluateCutoff(opts: {
  theoretical: number;
  d: number;
  diameterMm: number;
  stations: readonly MomentStation[];
  vn: number;
  b: number;
  fy: number;
  /** True when the continuing bars provide at least twice the area required here. */
  continuingDoubleArea: boolean;
  /** True when the cut-off point lies in a flexural tension zone. */
  inTensionZone: boolean;
  edition: RegulationEdition;
  towardEnd: boolean;
}): Cutoff {
  const ext = Math.max(opts.d, 12 * opts.diameterMm / 1000);
  const actual = opts.towardEnd ? opts.theoretical + ext : opts.theoretical - ext;
  const c = (id: string, label?: string) => clause('cirsoc-201', opts.edition, id, label);
  const baseRefs = [c('9.7.3.3', 'prolongación más allá del punto de corte')];

  if (!opts.inTensionZone) {
    return {
      theoretical: opts.theoretical, actual, legality: 'notInTension', refs: baseRefs,
      note: `Prolongación max(d, 12db) = ${(ext * 1000).toFixed(0)} mm. El punto de corte ` +
            'no está en zona traccionada, por lo que 9.7.3.5 no restringe la terminación.',
    };
  }

  const vu = shearAt(opts.stations, actual);
  const refs = [...baseRefs, c('9.7.3.5', 'terminación en zona de tracción')];

  if (vu <= (2 / 3) * opts.vn) {
    return {
      theoretical: opts.theoretical, actual, legality: 'lowShear', refs,
      note: `9.7.3.5(a): Vu = ${vu.toFixed(1)} kN ≤ (2/3)Vn = ${((2 / 3) * opts.vn).toFixed(1)} kN.`,
    };
  }
  if (opts.diameterMm <= 32 && opts.continuingDoubleArea && vu <= 0.75 * opts.vn) {
    return {
      theoretical: opts.theoretical, actual, legality: 'doubleArea', refs,
      note: `9.7.3.5(b): Ø${opts.diameterMm} ≤ 32 mm, la armadura que continúa duplica el ` +
            `área requerida y Vu = ${vu.toFixed(1)} kN ≤ (3/4)Vn = ${(0.75 * opts.vn).toFixed(1)} kN.`,
    };
  }

  // (c) — extra stirrups over (3/4)d, Av >= 0.41 bw s / fyt, s <= d/(8 βb).
  // βb is the ratio of the area cut off to the total; with the conservative βb = 1 the
  // spacing limit is d/8, which is the tightest the clause can demand.
  const zone = 0.75 * opts.d;
  const maxSpacing = opts.d / 8;
  const minAvOverS = 0.41 * opts.b / opts.fy;
  return {
    theoretical: opts.theoretical, actual, legality: 'extraStirrups',
    extraStirrups: { length: zone, maxSpacing, minAvOverS },
    refs,
    note:
      `9.7.3.5(c): Vu = ${vu.toFixed(1)} kN excede los límites de (a) y (b), de modo que ` +
      `se exigen estribos adicionales sobre ${(zone * 1000).toFixed(0)} mm con ` +
      `s ≤ ${(maxSpacing * 1000).toFixed(0)} mm y Av/s ≥ ${minAvOverS.toFixed(5)} m²/m ` +
      '(βb adoptado = 1, el caso más exigente).',
  };
}

// ─── Stirrup zones ───────────────────────────────────────────────

export interface StirrupZone {
  from: number;
  to: number;
  diameterMm: number;
  spacing: number;
  legs: number;
  /** Reason this zone exists — 'shear', 'cutoff' (§9.7.3.5(c)) or 'minimum'. */
  reason: 'shear' | 'cutoff' | 'minimum';
  refs: ClauseRef[];
  /**
   * Table 9.7.6.2.2 across-width limit for this zone, m.
   *
   * Carried on the zone, not recomputed downstream: the cage generator, the collision
   * checker, the schedule and the drawing all have to place the legs at the same
   * coordinates, and `legs` alone does not say what limit produced it.
   */
  acrossMax: number;
  /** Which row of Table 9.7.6.2.2 this zone's demand selected. */
  row: 'row1' | 'row2';
}

/**
 * Merge overlapping stirrup requirements into contiguous zones.
 *
 * Where a §9.7.3.5(c) cut-off zone overlaps a shear zone, the TIGHTER spacing wins over
 * the whole overlap. Emitting two overlapping zones with different spacings would be an
 * undrawable, unbuildable instruction.
 */
export function mergeStirrupZones(zones: readonly StirrupZone[], L: number): StirrupZone[] {
  if (zones.length === 0) return [];
  const cuts = new Set<number>([0, L]);
  for (const z of zones) {
    cuts.add(Math.max(0, Math.min(L, z.from)));
    cuts.add(Math.max(0, Math.min(L, z.to)));
  }
  const xs = [...cuts].sort((a, b) => a - b);

  const out: StirrupZone[] = [];
  for (let i = 0; i + 1 < xs.length; i++) {
    const from = xs[i];
    const to = xs[i + 1];
    if (to - from < 1e-9) continue;
    const mid = (from + to) / 2;
    const active = zones.filter((z) => mid >= z.from - 1e-9 && mid <= z.to + 1e-9);
    if (active.length === 0) continue;
    // Tightest spacing wins; ties broken by the largest bar, then by reason for stability.
    const governing = active.reduce((best, z) =>
      z.spacing < best.spacing - 1e-12 ? z
        : z.spacing > best.spacing + 1e-12 ? best
          : z.diameterMm > best.diameterMm ? z : best);
    const prev = out[out.length - 1];
    if (prev && Math.abs(prev.to - from) < 1e-9
      && prev.spacing === governing.spacing && prev.diameterMm === governing.diameterMm
      && prev.legs === governing.legs && prev.reason === governing.reason) {
      prev.to = to;
    } else {
      out.push({ ...governing, from, to });
    }
  }
  return out;
}


// ─── Transverse bar layout ───────────────────────────────────────

/** One bar's position within a face's reinforcement, relative to the member axis. */
export interface BarSlot {
  /** Offset across the section width, m. Positive toward `transverse`. */
  across: number;
  /** Offset from the face, m, positive INTO the section (layer 0 is closest to the face). */
  intoSection: number;
  layer: number;
}

/**
 * Lay a group of bars out across the section, in layers when one row will not hold them.
 *
 * ── Why this exists ────────────────────────────────────────────────
 *
 * Every bar in a group used to be emitted at the SAME point: `for (i = 0; i < count; i++)`
 * with an identical start and end, differing only in the id. Four bottom bars were four
 * coincident bars. On the 408-member flagship that produced 393 same-member overlap
 * conflicts in a single floor assembly — the collision detector correctly reporting that a
 * cage cannot contain four bars in one place, against a generator that had never been asked
 * where the second bar goes.
 *
 * ── Co-designed with the stirrup cage ──────────────────────────────
 *
 * The first version packed each layer at the MINIMUM clear spacing and centred it. That is
 * legal under §25.2.1 but it leaves the outermost bar inboard of the stirrup bend — measured:
 * ±93,3 mm against a corner at ±122 mm for 6Ø12 in a 300 mm web — and §25.7.1.2 requires every
 * bend of a closed stirrup to CONTAIN a longitudinal bar. A centred mat satisfies the spacing
 * clause and violates the restraint clause.
 *
 * So layer 0 is SPREAD to the full available width instead. The outermost bar centre lands at
 * `(clearWidth − d_b)/2`, and since `clearWidth = b − 2·(cover + d_s)` while the leg centreline
 * sits at `b/2 − cover − d_s/2`, the two differ by exactly `(d_s + d_b)/2` — the bar seated
 * against the leg. The bend contains it by construction rather than by luck. Spreading only
 * ever INCREASES clear spacing, so §25.2.1 stays satisfied and more comfortably.
 *
 * Upper layers are NOT spread independently. §25.2.2 requires "las barras de las capas
 * superiores directamente sobre las de las capas inferiores", so an upper layer takes a centred
 * subset of layer 0's positions and every upper bar sits directly above a lower one. Spreading
 * a 2-bar second layer to the full width would put it at the extremes with nothing beneath.
 */
export function layoutBarRow(opts: {
  count: number;
  diameterMm: number;
  /** Section width available between the stirrup legs, m. */
  clearWidth: number;
  /** Minimum clear spacing between bars in a layer, m. */
  minClear: number;
  /** Minimum clear distance between layers, m. */
  layerClear: number;
  /**
   * Additional bar-spacing margin above the regulatory minimum, m.
   *
   * A PROJECT property, zero by default: CIRSOC prescribes no margin between parallel bars
   * beyond §25.2.1/§25.2.3, and adding one silently would present a number with no clause
   * as a requirement. An engineer may raise it to get a more conservative cage.
   */
  placementTolerance?: number;
}): { slots: BarSlot[]; layers: number; perLayer: number; fits: boolean } {
  const { count, clearWidth, layerClear } = opts;
  const tol = opts.placementTolerance ?? 0;
  const minClear = opts.minClear + tol;
  const d = opts.diameterMm / 1000;
  if (count <= 0) return { slots: [], layers: 0, perLayer: 0, fits: true };

  // How many fit in one layer, at least one so a narrow section still produces geometry
  // rather than nothing — the shortfall is reported by `fits`.
  const perLayer = Math.max(1, Math.min(count,
    Math.floor((clearWidth + minClear) / (d + minClear))));
  const layers = Math.ceil(count / perLayer);
  const fits = perLayer * layers >= count && perLayer >= Math.min(count, 2);

  const slots: BarSlot[] = [];
  // Layer 0 spread to the full available width, so its outer bars seat against the stirrup
  // legs and §25.7.1.2's bends contain a bar by construction.
  const inFirst = Math.min(perLayer, count);
  const basePitch = inFirst > 1 ? (clearWidth - d) / (inFirst - 1) : 0;
  const baseAcross = (k: number) => (inFirst > 1 ? -(clearWidth - d) / 2 + k * basePitch : 0);

  let placed = 0;
  for (let layer = 0; layer < layers; layer++) {
    const inThis = Math.min(perLayer, count - placed);
    // §25.2.2: an upper layer sits DIRECTLY ABOVE layer 0's bars, so it takes a centred subset
    // of layer 0's positions rather than a spread of its own.
    const offset = Math.floor((inFirst - inThis) / 2);
    for (let k = 0; k < inThis; k++) {
      slots.push({
        across: layer === 0 ? baseAcross(k) : baseAcross(offset + k),
        intoSection: layer * (d + layerClear),
        layer,
      });
    }
    placed += inThis;
  }
  return { slots, layers, perLayer, fits };
}

/** Unit vector across the section: the member axis rotated into the plane of `up`. */
export function transverseAxis(axis: Point3, up: Point3): Point3 {
  // axis × up, normalised. For a horizontal beam with up = +z this is the in-plan normal,
  // which is exactly the direction bars spread along.
  const c = {
    x: axis.y * up.z - axis.z * up.y,
    y: axis.z * up.x - axis.x * up.z,
    z: axis.x * up.y - axis.y * up.x,
  };
  const L = Math.hypot(c.x, c.y, c.z);
  return L < 1e-9 ? { x: 0, y: 1, z: 0 } : { x: c.x / L, y: c.y / L, z: c.z / L };
}

// ─── Generation ──────────────────────────────────────────────────

export interface GeneratedBeam {
  bars: BarPath[];
  cutoffs: Cutoff[];
  stirrupZones: StirrupZone[];
  /**
   * PHYSICAL transverse reinforcement — every closed stirrup and crosstie as a real bar.
   *
   * `stirrupZones` above is the INSTRUCTION ("Ø8, 3 legs, every 50 mm, 0 → 0,6"); this is the
   * steel. Until it existed nothing transverse had coordinates, so nothing could be
   * collision-checked, marked, scheduled, weighed, cut or drawn — the leg count was verified
   * against Table 9.7.6.2.2 while the bars themselves did not exist.
   */
  transverse: TransversePiece[];
  /**
   * §25.7.1.2 bends that contain no longitudinal bar — a REAL, currently-open defect.
   *
   * Structured rather than folded into `unsupported` on purpose, and the reasoning is worth
   * recording. The clause IS violated: `layoutBarRow` centres each mat at the §25.2.1 clear
   * spacing plus the placement tolerance, so on some members the outermost bottom bar lands
   * ~29 mm inboard of the stirrup corner (measured: bar ±93,3 mm vs corner ±122 mm, 6Ø12 in a
   * 300 mm web) and those bends grip nothing.
   *
   * ALSO routed into `unsupported`, so it BLOCKS constructibility. It was non-blocking for one
   * commit and that was the wrong trade — a known code violation may not stay non-blocking to
   * preserve an old fixture result. The count is kept here as well because "how many bends"
   * is what a reviewer needs to size the fix, and a boolean in `unsupported` does not say.
   */
  transverseFindings: { bendsWithoutBar: number };
  bentUp: BentUpDecision;
  /** Every decision, in order, for the explainability trail. */
  trace: string[];
  refs: ClauseRef[];
  /** Conditions the generator could not satisfy; the caller surfaces these. */
  unsupported: string[];
  /**
   * Layer index per bar id.
   *
   * Emitted rather than inferred: the collision classifier needs it to apply §25.2.2
   * between layers instead of the in-layer rule, and reconstructing it from geometry
   * downstream would be guessing at a decision this function already made.
   */
  barLayers: Record<string, number>;
}

function add(p: Point3, v: Point3, k: number): Point3 {
  return { x: p.x + v.x * k, y: p.y + v.y * k, z: p.z + v.z * k };
}

/** Translate a point by a slot offset vector. */
function shift(p: Point3, o: Point3): Point3 {
  return { x: p.x + o.x, y: p.y + o.y, z: p.z + o.z };
}

/**
 * Generate the physical bar set for one beam.
 *
 * Produces: continuous bottom bars into both supports per §9.7.3.8, curtailed bottom
 * bars where the envelope allows, top bars at each support curtailed into the span, and
 * merged stirrup zones including any §9.7.3.5(c) cut-off zones.
 */
export function generateBeamBars(input: BeamGenerationInput): GeneratedBeam {
  const trace: string[] = [];
  const unsupported: string[] = [];
  const cutoffs: Cutoff[] = [];
  const bars: BarPath[] = [];
  const refs: ClauseRef[] = [];
  const c = (id: string, label?: string) => clause('cirsoc-201', input.edition, id, label);

  const bentUp = bentUpPermitted(input.bentUp, input.edition);
  trace.push(`Barras dobladas: ${bentUp.permitted ? 'admitidas' : 'no admitidas'}. ${bentUp.reason}`);

  const peakPos = Math.max(...input.stations.map((s) => s.mPos), 0);
  const peakNegI = Math.max(input.stations[0]?.mNeg ?? 0, 0);
  const peakNegJ = Math.max(input.stations[input.stations.length - 1]?.mNeg ?? 0, 0);

  // Bar centroid offsets from the member axis.
  const halfH = input.h / 2;
  const barOffset = input.cover + input.stirrupDia / 1000;
  // Joint-layer rank. A line that crosses another must sit above or below it, or their
  // bars occupy the same points in space. The raise belongs to the whole line, so it is
  // applied here once and not nudged at individual joints — see `joint-layers.ts`.
  const raise = Math.max(0, input.layerRaise ?? 0);
  const drop = Math.max(0, input.layerDrop ?? input.layerRaise ?? 0);
  const zBot = -(halfH - barOffset - input.bottom.diameterMm / 2000) + raise;
  const zTop = halfH - barOffset - input.topStart.diameterMm / 2000 - drop;

  const spacing = minClearSpacingInLayer(input.edition, {
    barDiameterMm: input.bottom.diameterMm, maxAggregateSizeMm: input.maxAggregateSizeMm,
  });
  refs.push(...spacing.refs);
  const layerSpacing = minClearBetweenLayers(input.edition);
  refs.push(...layerSpacing.refs);

  // Bars spread across the section between the stirrup legs, and stack inward in layers
  // when the row is full. Without this every bar in a group lands on the same point.
  const across = transverseAxis(input.axis, input.up);
  const clearWidth = Math.max(0.02, input.b - 2 * barOffset);

  /** Place `count` bars of `dia` on a face, returning one offset vector per bar. */
  const barLayers: Record<string, number> = {};

  /**
   * Stable layer identity for a bar. `e184:bottom:0`, `e184:topI:1`.
   *
   * The generator knows which layer it placed each bar in, so it says so instead of leaving
   * every consumer to re-derive it from elevations.
   *
   * Three parts, and each earns its place:
   *
   *   element  a layer belongs to one member.
   *   face     top and bottom are referenced from opposite surfaces and cross different
   *            steel; they are independent problems.
   *   REGION   `topI` and `topJ` are the hogging steel at the two ENDS. They share a face
   *            and a layer index and are different bars in different places, metres apart.
   *            Without the region they shared an id, and the repair ladder — which moves a
   *            layer as a rigid body — moved the far support's bars when it nudged the near
   *            one. Bottom bars have no such split: continuous and curtailed bottom steel
   *            sit in one row at one elevation and genuinely are one layer.
   */
  const layerId = (face: string, layer: number) =>
    `e${input.elementId}:${face}:${layer}`;
  const placeGroup = (count: number, dia: number, faceUpward: boolean) => {
    const layout = layoutBarRow({
      count, diameterMm: dia, clearWidth,
      minClear: spacing.minClear, layerClear: layerSpacing.minClear,
      placementTolerance: DEFAULT_TOLERANCES.placement,
    });
    if (!layout.fits && count > 1) {
      unsupported.push(
        `No entran ${count}Ø${dia} en un ancho libre de ${(clearWidth * 1000).toFixed(0)} mm ` +
        `respetando la separación mínima; se disponen en ${layout.layers} capa(s).`);
    }
    if (layout.layers > 1) {
      trace.push(
        `${count}Ø${dia} dispuestas en ${layout.layers} capa(s) de hasta ` +
        `${layout.perLayer} barra(s) (25.2.2).`);
    }
    // Layer 0 sits at the face; deeper layers move toward the section centre.
    const inward = faceUpward ? -1 : 1;
    // Threading positions win: they were chosen against the real column cage. But they
    // only win as complete slots — position AND layer — because a position without its
    // layer is ambiguous the moment the candidate has more than one.
    const override = input.transverseSlots && input.transverseSlots.length >= count
      ? layout.slots.map((slot, i) => ({
        ...slot,
        across: input.transverseSlots![i],
        layer: input.transverseLayers?.[i] ?? slot.layer,
        intoSection: input.transverseLayers
          ? (input.transverseLayers[i] ?? slot.layer) * (dia / 1000 + layerSpacing.minClear)
          : slot.intoSection,
      }))
      : null;

    // Belt and braces. Two bars of one group may never occupy one point, whatever the
    // candidate said — a coincident pair is not a tight detail, it is a missing bar.
    const distinct = (xs: typeof layout.slots) =>
      new Set(xs.map((x) => `${x.layer}:${Math.round(x.across * 1e5)}`)).size === xs.length;
    const slots = override && distinct(override) ? override : layout.slots;
    if (override && !distinct(override)) {
      unsupported.push(
        `La disposición coordinada de ${count}Ø${dia} repite posiciones; ` +
        `se usa la disposición generada.`);
    }
    return slots.map((slot) => ({
      layer: slot.layer,
      x: across.x * slot.across + input.up.x * slot.intoSection * inward,
      y: across.y * slot.across + input.up.y * slot.intoSection * inward,
      z: across.z * slot.across + input.up.z * slot.intoSection * inward,
    }));
  };

  // ── Bottom bars: continuity into the supports (§9.7.3.8) ──
  const continueFraction = input.supportI === 'simple' || input.supportJ === 'simple' ? 1 / 3 : 1 / 4;
  const continuing = Math.max(2, Math.ceil(input.bottom.count * continueFraction));
  const curtailable = input.bottom.count - continuing;
  refs.push(c(input.supportI === 'simple' ? '9.7.3.8.1' : '9.7.3.8.2',
    'prolongación de la armadura de momento positivo en el apoyo'));
  trace.push(
    `Momento positivo: ${input.bottom.count}Ø${input.bottom.diameterMm}; ` +
    `${continuing} continúan al apoyo (${input.supportI === 'simple' ? '1/3' : '1/4'} mínimo, ` +
    `9.7.3.8), ${curtailable} pueden interrumpirse.`);

  const EMBED = 0.15;  // 150 mm into the support, per §9.7.3.8
  const anchorHook: HookAngle | undefined =
    input.lateralSystem && input.supportI !== 'free' ? 90 : undefined;
  if (anchorHook) {
    trace.push('El elemento integra el sistema resistente a fuerzas laterales: la armadura ' +
      'inferior se ancla para desarrollar fy en la cara del apoyo (9.7.3.8.2).');
    refs.push(...standardHook(input.bottom.diameterMm, 90, 'longitudinal').refs);
  }

  const botSlots = placeGroup(input.bottom.count, input.bottom.diameterMm, false);
  for (let i = 0; i < continuing; i++) {
    const o = botSlots[i] ?? { layer: 0, x: 0, y: 0, z: 0 };
    barLayers[`e${input.elementId}-bot-cont-${i}`] = o.layer;
    bars.push(buildStraightBarWithHooks({
      id: `e${input.elementId}-bot-cont-${i}`,
      layerId: layerId('bottom', o.layer),
      diameterMm: input.bottom.diameterMm, role: 'longitudinal',
      start: shift(add(add(input.origin, input.axis, -EMBED), input.up, zBot), o),
      end: shift(add(add(input.origin, input.axis, input.L + EMBED), input.up, zBot), o),
      axis: input.axis, hookNormal: input.up,
      startHook: anchorHook, endHook: anchorHook,
      ownerElementIds: [input.elementId], edition: input.edition,
    }));
  }

  // ── Curtailed bottom bars ──
  if (curtailable > 0 && peakPos > 0) {
    const retained = continuing / input.bottom.count;
    const midpoint = input.L / 2;
    const xLeft = theoreticalCutoff(input.stations, 'mPos', peakPos, retained, midpoint, 0);
    const xRight = theoreticalCutoff(input.stations, 'mPos', peakPos, retained, midpoint, input.L);

    if (xLeft === null || xRight === null) {
      // NOT an unsupported condition. Running the bottom bars continuous is the correct
      // and conservative outcome when the envelope never drops far enough to curtail —
      // §9.7.3.8 requires continuity into the supports regardless. Reporting it as
      // unsupported held every ordinary beam at COORDINATED and made CONSTRUCTIBLE, and
      // therefore the whole review-and-issue workflow, unreachable in practice.
      trace.push('Sin punto de corte teórico: la armadura inferior se corre completa.');
      for (let i = 0; i < curtailable; i++) {
        const o = botSlots[continuing + i] ?? { layer: 0, x: 0, y: 0, z: 0 };
        barLayers[`e${input.elementId}-bot-run-${i}`] = o.layer;
        bars.push(buildStraightBarWithHooks({
          id: `e${input.elementId}-bot-run-${i}`,
          layerId: layerId('bottom', o.layer),
          diameterMm: input.bottom.diameterMm, role: 'longitudinal',
          start: shift(add(add(input.origin, input.axis, -EMBED), input.up, zBot), o),
          end: shift(add(add(input.origin, input.axis, input.L + EMBED), input.up, zBot), o),
          axis: input.axis, hookNormal: input.up,
          ownerElementIds: [input.elementId], edition: input.edition,
        }));
      }
    } else {
      const cutL = evaluateCutoff({
        theoretical: xLeft, d: input.d, diameterMm: input.bottom.diameterMm,
        stations: input.stations, vn: input.vn, b: input.b, fy: input.fy,
        continuingDoubleArea: retained >= 0.5, inTensionZone: true,
        edition: input.edition, towardEnd: false,
      });
      const cutR = evaluateCutoff({
        theoretical: xRight, d: input.d, diameterMm: input.bottom.diameterMm,
        stations: input.stations, vn: input.vn, b: input.b, fy: input.fy,
        continuingDoubleArea: retained >= 0.5, inTensionZone: true,
        edition: input.edition, towardEnd: true,
      });
      cutoffs.push(cutL, cutR);
      refs.push(...cutL.refs, ...cutR.refs);
      trace.push(`Corte izquierdo en x = ${cutL.actual.toFixed(3)} m. ${cutL.note}`);
      trace.push(`Corte derecho en x = ${cutR.actual.toFixed(3)} m. ${cutR.note}`);

      const from = Math.max(0, cutL.actual);
      const to = Math.min(input.L, cutR.actual);
      for (let i = 0; i < curtailable; i++) {
        const o = botSlots[continuing + i] ?? { layer: 0, x: 0, y: 0, z: 0 };
        barLayers[`e${input.elementId}-bot-cut-${i}`] = o.layer;
        bars.push(buildStraightBarWithHooks({
          id: `e${input.elementId}-bot-cut-${i}`,
          layerId: layerId('bottom', o.layer),
          diameterMm: input.bottom.diameterMm, role: 'longitudinal',
          start: shift(add(add(input.origin, input.axis, from), input.up, zBot), o),
          end: shift(add(add(input.origin, input.axis, to), input.up, zBot), o),
          axis: input.axis, hookNormal: input.up,
          ownerElementIds: [input.elementId], edition: input.edition,
        }));
      }
    }
  }

  // ── Top bars at each support, curtailed into the span ──
  const tops: Array<{ side: 'I' | 'J'; group: { count: number; diameterMm: number }; peak: number }> = [
    { side: 'I', group: input.topStart, peak: peakNegI },
    { side: 'J', group: input.topEnd, peak: peakNegJ },
  ];

  for (const t of tops) {
    if (t.group.count <= 0) continue;
    const atStart = t.side === 'I';
    // §9.7.3.4: continuing tension steel embeds at least d beyond the cut-off point.
    const ldTop = input.ld(t.group.diameterMm);
    const nominal = Math.max(input.L / 4, ldTop + input.d);
    const xCut = theoreticalCutoff(
      input.stations, 'mNeg', Math.max(t.peak, 1e-9), 0.0,
      atStart ? 0 : input.L, atStart ? input.L / 2 : input.L / 2);
    const theoretical = xCut ?? (atStart ? nominal : input.L - nominal);
    const cut = evaluateCutoff({
      theoretical, d: input.d, diameterMm: t.group.diameterMm,
      stations: input.stations, vn: input.vn, b: input.b, fy: input.fy,
      continuingDoubleArea: false, inTensionZone: true,
      edition: input.edition, towardEnd: atStart,
    });
    cutoffs.push(cut);
    refs.push(...cut.refs, c('9.7.3.4', 'longitud embebida de la armadura continua'));
    trace.push(`Armadura superior ${t.side}: corte en x = ${cut.actual.toFixed(3)} m. ${cut.note}`);

    const zTopBar = halfH - barOffset - t.group.diameterMm / 2000 - drop;
    const from = atStart ? -EMBED : Math.min(input.L, cut.actual);
    const to = atStart ? Math.max(0, cut.actual) : input.L + EMBED;
    const topSlots = placeGroup(t.group.count, t.group.diameterMm, true);
    for (let i = 0; i < t.group.count; i++) {
      const o = topSlots[i] ?? { layer: 0, x: 0, y: 0, z: 0 };
      barLayers[`e${input.elementId}-top${t.side}-${i}`] = o.layer;
      bars.push(buildStraightBarWithHooks({
        id: `e${input.elementId}-top${t.side}-${i}`,
        layerId: layerId(`top${t.side}`, o.layer),
        diameterMm: t.group.diameterMm, role: 'longitudinal',
        start: shift(add(add(input.origin, input.axis, from), input.up, zTopBar), o),
        end: shift(add(add(input.origin, input.axis, to), input.up, zTopBar), o),
        axis: input.axis, hookNormal: { x: -input.up.x, y: -input.up.y, z: -input.up.z },
        startHook: atStart && input.supportI === 'simple' ? 90 : undefined,
        endHook: !atStart && input.supportJ === 'simple' ? 90 : undefined,
        ownerElementIds: [input.elementId], edition: input.edition,
      }));
    }
  }

  // ── Stirrup zones ──
  //
  // Every zone's spacing AND leg count now comes from Table 9.7.6.2.2 evaluated at that
  // zone's OWN peak shear, through the one shared evaluator. Previously the span zone was a
  // literal `min(300 mm, d/2)` and the support zones a literal `min(200 mm, d/4)`: the
  // regulation's row-1 and row-2 values pasted in, with no demand deciding which row a zone
  // is actually in, the wrong row-1 cap, and a hardcoded 2 legs that ignored the
  // across-width column entirely. A 300 mm web in row 2 needs three legs.
  //
  // The effective depth used is reduced by any coordination raise or drop, because a limit
  // computed on the nominal depth would be looser than the member the drawing shows.
  const dTable = Math.max(0.05, input.d - Math.max(raise, drop));
  const peakShearIn = (from: number, to: number): number => {
    let peak = 0;
    for (const st of input.stations) {
      if (st.x < from - 1e-9 || st.x > to + 1e-9) continue;
      peak = Math.max(peak, Math.abs(st.v));
    }
    return peak;
  };
  const zoneFor = (
    from: number, to: number, reason: StirrupZone['reason'], refs: ClauseRef[],
  ): StirrupZone => {
    const table = transverseSpacingForDemand(input.edition, {
      Vu: peakShearIn(from, to), bw: input.b, d: dTable, fc: input.fc,
      cover: input.cover, stirrupDiaMm: input.stirrupDia,
    });
    // The table's only gap is prestressing, and a member the table could not be applied to
    // is reported rather than detailed as if it had been checked.
    if (table.unsupported.length > 0) {
      unsupported.push(...table.clauses.map((r) => formatClause(r)));
    }
    return {
      from, to, diameterMm: input.stirrupDia,
      spacing: table.alongMax, legs: table.requiredLegs, reason, refs,
      acrossMax: table.acrossMax, row: table.row,
    };
  };

  const raw: StirrupZone[] = [];
  const supportZone = Math.min(2 * input.h, input.L / 2);
  // §9.6.3 minimum shear reinforcement over the whole span, at the span's own demand.
  raw.push(zoneFor(0, input.L, 'minimum',
    [c('9.6.3', 'armadura mínima de corte'), c('9.7.6.2.2', 'separación máxima de ramas')]));
  // Support zones over 2h at each end, where shear peaks and the row often changes.
  for (const [from, to] of [[0, supportZone], [input.L - supportZone, input.L]] as const) {
    raw.push(zoneFor(from, to, 'shear', [c('9.7.6.2.2', 'separación máxima de ramas')]));
  }
  // §9.7.3.5(c) zones from any cut-off that needed them. §9.7.3.5(c)'s own `d/(8·βb)` limit
  // is ADDITIONAL to Table 9.7.6.2.2, not a replacement for it: whichever is tighter governs
  // the spacing, and the table still decides the leg count.
  for (const cut of cutoffs) {
    if (!cut.extraStirrups) continue;
    const from = Math.max(0, cut.actual - cut.extraStirrups.length);
    const to = Math.min(input.L, cut.actual + cut.extraStirrups.length);
    const zone = zoneFor(from, to, 'cutoff', cut.refs);
    raw.push({ ...zone, spacing: Math.min(zone.spacing, cut.extraStirrups.maxSpacing) });
  }
  const stirrupZones = mergeStirrupZones(raw, input.L);
  trace.push(`${stirrupZones.length} zona(s) de estribos tras fusionar solapes ` +
    '(en cada solape gobierna la separación menor).');

  // ── Materialise the transverse cage ──
  //
  // The zones above are instructions. These are bars. Stations come from the zone geometry and
  // the spacing the table allows; leg positions come from the SAME authoritative evaluator the
  // zone's leg count came from, so the cage cannot sit where the spacing rule does not believe
  // it does.
  const transverse: TransversePiece[] = [];
  const acrossAxis = transverseAxis(input.axis, input.up);
  // Longitudinal bars in SECTION coordinates, for the §25.7.1.2 containment check.
  //
  // Taken from the ACTUAL slot layout this function produced, not from a two-corner
  // approximation. The approximation was tried first and was wrong in a way that matters: a
  // crosstie on the section centreline grips whichever real bar is there, and with only corner
  // bars modelled it appeared to grip nothing — reporting a §25.7.1.2 violation on a cage that
  // satisfies the clause. The generator knows where it put every bar; the check must read that.
  const cageBars: LongitudinalBarRef[] = [];
  const collectFace = (
    group: { count: number; diameterMm: number }, faceUpward: boolean, tag: string,
  ) => {
    const layout = layoutBarRow({
      count: group.count, diameterMm: group.diameterMm, clearWidth,
      minClear: spacing.minClear, layerClear: layerSpacing.minClear,
      placementTolerance: DEFAULT_TOLERANCES.placement,
    });
    const inward = faceUpward ? -1 : 1;
    const faceZ = faceUpward
      ? halfH - barOffset - group.diameterMm / 2000 - drop
      : -(halfH - barOffset - group.diameterMm / 2000) + raise;
    layout.slots.forEach((slot, i) => {
      cageBars.push({
        id: `${tag}-${i}`,
        across: slot.across,
        up: faceZ + inward * slot.intoSection,
        diameterMm: group.diameterMm,
      });
    });
  };
  collectFace(input.bottom, false, 'bot');
  collectFace(input.topStart, true, 'top');

  for (let zi = 0; zi < stirrupZones.length; zi++) {
    const z = stirrupZones[zi];
    const next = stirrupZones[zi + 1];
    const sharesBoundary = next !== undefined && Math.abs(next.from - z.to) < 1e-9;
    const stations = stirrupStations({
      from: z.from, to: z.to, spacing: z.spacing, nextZoneStartsAtEnd: sharesBoundary,
    });
    const zoneId = `e${input.elementId}:${z.reason}:${zi}`;
    for (let si = 0; si < stations.length; si++) {
      const set = buildStirrupSet({
        elementId: input.elementId, zoneId, station: stations[si],
        b: input.b, h: input.h, cover: input.cover, stirrupDiaMm: z.diameterMm,
        legs: z.legs, longitudinalBars: cageBars,
        origin: input.origin, axis: input.axis, up: input.up, across: acrossAxis,
        // C 25.7.2.3.1 — hooks staggered "cuando sea posible". Commentary, a should, so this
        // is practice: alternate every station rather than claim a requirement.
        hookOrientation: si % 2 === 0 ? 'a' : 'b',
        maxAggregateSizeMm: input.maxAggregateSizeMm,
        // Table 9.7.6.2.2's across-width limit for this zone, so the cage can decide whether an
        // interior leg may be snapped to a bar position without breaking the spacing limit.
        acrossMax: z.acrossMax,
      });
      if (set.unsupported.length > 0) {
        unsupported.push(...set.unsupported.map((r) => formatClause(r)));
        continue;
      }
      transverse.push(...set.pieces);
    }
    // NOT checked here: §25.7.2.3(b)'s "no unbraced bar beyond 15·d_be or 150 mm" rule.
    //
    // §25.7.2.3 sits under §25.7.2 "Estribos cerrados de COLUMNAS". Applying it to a beam
    // would be applying a column clause to a member it does not govern — the same
    // cross-scope error as citing one edition's clause for another's rule. Beams are governed
    // by Table 9.7.6.2.2 across the width (already enforced, and it is what sets `z.legs`) and
    // by §25.7.1.2 at the bends. `unbracedBarReport` stays available for the column generator,
    // which is where that clause belongs.
  }
  // §25.7.1.2 — "cada doblez en un estribo cerrado debe contener una barra longitudinal".
  //
  // MEASURED FINDING, surfaced rather than hidden: on the qa-8 and row-2 fixtures the BOTTOM
  // stirrup corners contain no bar. `layoutBarRow` centres each mat and spreads it at the
  // §25.2.1 clear spacing plus the project placement tolerance, which leaves the outermost
  // bottom bar ~29 mm inboard of the stirrup corner (measured: bar at ±93,3 mm, corner at
  // ±122 mm, Ø12 in a 300 mm web). The cage is built correctly and the clause is not
  // satisfied — seating corner bars in the corners is a change to the longitudinal placement
  // policy, which moves every existing bar position, so it is reported here rather than
  // silently patched.
  const looseBends = bendsWithoutLongitudinalBar(transverse);
  if (looseBends.length > 0) {
    // A HARD blocker. §25.7.1.2 is a "debe": every bend of a closed stirrup must contain a
    // longitudinal bar. A cage whose corners grip nothing does not satisfy the clause, so the
    // member may not be reported constructible.
    //
    // This was carried as a non-blocking finding for exactly one commit, to avoid breaking the
    // twelve-condition gate mid-change. That was the wrong trade: a known code violation may
    // not stay non-blocking to preserve an old fixture result. It blocks now, and qa-8 and the
    // row-2 fixture are NOT_ESTABLISHED until the longitudinal layout seats corner bars in the
    // stirrup corners.
    unsupported.push(formatClause(clause('cirsoc-201', '2025', '25.7.1.2',
      'cada doblez del estribo debe contener una barra longitudinal')));
    trace.push(`${looseBends.length} doblez(es) de estribo sin barra longitudinal (25.7.1.2): ` +
      'la disposición longitudinal centra la capa y no lleva barras a las esquinas.');
  }
  trace.push(`${transverse.length} pieza(s) transversales fabricadas ` +
    `(${transverse.filter((p) => p.shape === 'crosstie').length} ganchos suplementarios).`);

  return {
    bars, cutoffs, stirrupZones, transverse,
    transverseFindings: { bendsWithoutBar: looseBends.length },
    bentUp, trace, refs, unsupported, barLayers,
  };
}
