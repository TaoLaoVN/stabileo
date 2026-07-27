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
import { DEFAULT_TOLERANCES } from './collision';
import { clause, type ClauseRef, type RegulationEdition } from '../../codes/regulation';

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
 * Bars are centred on the section and spread at the code's clear spacing. When the row is
 * full the remainder starts a new layer inward, at the §25.2.2 clear distance between
 * layers, with the layers themselves centred so the group stays symmetric.
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
  let placed = 0;
  for (let layer = 0; layer < layers; layer++) {
    const inThis = Math.min(perLayer, count - placed);
    // Centre each layer on the section: pitch is the code spacing, and a single bar sits
    // on the centreline rather than against a face.
    const pitch = inThis > 1
      ? Math.min(d + minClear, (clearWidth - d) / (inThis - 1))
      : 0;
    const span = pitch * (inThis - 1);
    for (let k = 0; k < inThis; k++) {
      slots.push({
        across: -span / 2 + k * pitch,
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
    refs.push(...standardHook(input.bottom.diameterMm, 90, 'longitudinal', input.edition).refs);
  }

  const botSlots = placeGroup(input.bottom.count, input.bottom.diameterMm, false);
  for (let i = 0; i < continuing; i++) {
    const o = botSlots[i] ?? { layer: 0, x: 0, y: 0, z: 0 };
    barLayers[`e${input.elementId}-bot-cont-${i}`] = o.layer;
    bars.push(buildStraightBarWithHooks({
      id: `e${input.elementId}-bot-cont-${i}`,
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
  const raw: StirrupZone[] = [];
  // §9.6.3 minimum shear reinforcement over the whole span, at d/2.
  raw.push({
    from: 0, to: input.L, diameterMm: input.stirrupDia, spacing: Math.min(0.30, input.d / 2),
    legs: 2, reason: 'minimum',
    refs: [c('9.6.3', 'armadura mínima de corte'), c('9.7.6.2.2', 'separación máxima de estribos')],
  });
  // Support zones: tighter spacing over 2h at each end, where shear peaks.
  const supportZone = Math.min(2 * input.h, input.L / 2);
  for (const [from, to] of [[0, supportZone], [input.L - supportZone, input.L]] as const) {
    raw.push({
      from, to, diameterMm: input.stirrupDia, spacing: Math.min(0.20, input.d / 4),
      legs: 2, reason: 'shear',
      refs: [c('9.7.6.2.2', 'separación máxima de estribos')],
    });
  }
  // §9.7.3.5(c) zones from any cut-off that needed them.
  for (const cut of cutoffs) {
    if (!cut.extraStirrups) continue;
    raw.push({
      from: Math.max(0, cut.actual - cut.extraStirrups.length),
      to: Math.min(input.L, cut.actual + cut.extraStirrups.length),
      diameterMm: input.stirrupDia,
      spacing: cut.extraStirrups.maxSpacing,
      legs: 2, reason: 'cutoff', refs: cut.refs,
    });
  }
  const stirrupZones = mergeStirrupZones(raw, input.L);
  trace.push(`${stirrupZones.length} zona(s) de estribos tras fusionar solapes ` +
    '(en cada solape gobierna la separación menor).');

  return { bars, cutoffs, stirrupZones, bentUp, trace, refs, unsupported, barLayers };
}
