/**
 * Bottom-mat flexural design for an isolated footing — CIRSOC 201-2025 Chapter 13.
 *
 * ── What was here before ───────────────────────────────────────
 *
 * `foundation-check.ts` computed ONE factored moment: the §13.2.7 cantilever integral about
 * the B axis, reported as `FootingCheck.Mu`, with the memo saying "la armadura de flexión se
 * dimensiona con el verificador de secciones". Nothing dimensioned it. The record's flexure
 * outcome was UNSUPPORTED with `footing.record.flexureNoSteel`, which was honest, and the
 * other direction of a two-way mat did not exist at all.
 *
 * This module is the missing design. It produces, per direction and separately:
 *
 *   * the demand, from the same trapezoidal soil-pressure integral the check already uses;
 *   * the steel required by FLEXURAL STRENGTH;
 *   * the steel required by the MINIMUM-reinforcement clause;
 *   * which of the two governs;
 *   * an integer bar count and layout that satisfies every applicable spacing limit;
 *   * the §13.3.3 distribution regions the bars belong in.
 *
 * It does NOT generate bars. No physical mat geometry exists after this runs, and the
 * record's `geometry` stays REQUIRED_NOT_MODELED so a footing with a designed-but-undrawn
 * mat cannot read as a verified footing.
 *
 * ── The verified clause chain ──────────────────────────────────
 *
 * Read off the ENACTED Annex IV of CIRSOC 201-2025 (Resolución 11/2025, InfoLeg 422490),
 * not an ACI summary and not the 2024 draft:
 *
 * §13.3.3.1  the design and detailing of two-way isolated footings shall comply with §13.3.3
 *            AND the applicable provisions of Chapters 7 and 8 — this is what makes every
 *            Chapter 7 rule below applicable to a footing at all.
 * §13.2.6.6  the external moment at any section is found by passing a vertical plane through
 *            the member and taking the moment of the forces on the whole area on one side of
 *            it. That integral, not a coefficient.
 * §13.2.7.1  Table: the critical section for M_u is at the FACE of the column or pedestal.
 * §13.3.1.2  the total depth shall be chosen so the effective depth of the bottom
 *            reinforcement is at least 150 mm.
 * §7.6.1     minimum flexural reinforcement in non-prestressed slabs: A_s,min = 0,0018 A_g.
 *            §8.6.1.1 states the same 0,0018 A_g for two-way slabs, so the two chapters
 *            §13.3.3.1 makes applicable agree and there is nothing to reconcile.
 * §7.7.2.1   the minimum spacing s shall comply with §25.2.
 * §25.2.1    clear distance ≥ max(25 mm, d_b, (4/3) d_agg).
 * §7.7.2.2   for non-prestressed slabs, the spacing of the bonded reinforcement closest to
 *            the tension face shall not exceed the value given in §24.3.
 * §24.3.2    Table 24.3.2 — see `crack-control.ts` for the expression.
 * §7.7.2.3   the maximum spacing of longitudinal deformed reinforcement shall be the LESSER
 *            of 3h and 300 mm. Three hundred, verified verbatim in the enacted text. The
 *            2024 draft's 450 mm is not in it; 450 mm appears in §7.7.2.4, which is the
 *            shrinkage-and-temperature rule and a different requirement.
 * §13.3.3.2  in SQUARE two-way footings the reinforcement shall be distributed uniformly
 *            across the full width in both directions.
 * §13.3.3.3  in RECTANGULAR footings: (a) the long-direction reinforcement is distributed
 *            uniformly across the full width; (b) of the short-direction reinforcement, the
 *            portion γs·A_s is distributed uniformly in a band whose width equals the SHORT
 *            side of the footing, centred on the column or pedestal axis, and the remainder
 *            (1 − γs)·A_s uniformly in the zones outside that band, with
 *
 *                γs = 2 / (β + 1)          (13.3.3.3)
 *
 *            where β is the ratio of the long side to the short side.
 * §13.2.8.1  anchorage of the reinforcement shall comply with Chapter 25; §13.2.8.3 puts the
 *            critical sections for anchorage at the §13.2.7.1 locations. The development
 *            length is reported here for the selected bar; whether the physical bar achieves
 *            it is a question about geometry that does not exist yet, and this module makes
 *            no anchorage claim.
 *
 * ── Two things this module deliberately does not do ────────────
 *
 * It does not use `checkFlexure().AsMin`. That is the BEAM minimum,
 * `max(0,25√f'c/f_y, 1,4/f_y)·b_w·d` from §9.6.1.2, and it is not the clause a footing mat
 * answers to. What it DOES reuse from `checkFlexure` is the rectangular stress block, via the
 * new `AsFlexural` output — the strength requirement on its own. Writing the stress block out
 * again here would make this a second flexural engine.
 *
 * It does not use `seedAreaFor`. That is a candidate-search ordering heuristic; it has no
 * design authority.
 *
 * Pure: no store, no runes. Forces kN, moments kN·m, lengths m, pressures kPa, areas m².
 */

import { clause, type ClauseRef, type RegulationEdition } from '../../codes/regulation';
import { msg, type EngineMessage } from '../../codes/message';
import { minClearSpacingInLayer } from '../../codes/cirsoc201/spacing';
import { crackControlMaxSpacing } from '../../codes/cirsoc201/crack-control';
import { checkFlexure } from '../codes/argentina/cirsoc201';

// ─── Clause references ───────────────────────────────────────────

const R_TWO_WAY = clause('cirsoc-201', '2025', '13.3.3.1',
  'bases aisladas en dos direcciones: rigen además los Capítulos 7 y 8');
const R_MOMENT_PLANE = clause('cirsoc-201', '2025', '13.2.6.6',
  'momento externo en una sección por un plano vertical');
const R_CRITICAL = clause('cirsoc-201', '2025', '13.2.7.1',
  'sección crítica para Mu en la cara de la columna');
const R_MIN_DEPTH = clause('cirsoc-201', '2025', '13.3.1.2',
  'altura útil de la armadura inferior no menor que 150 mm');
const R_STRENGTH = clause('cirsoc-201', '2025', '7.5.1.1',
  'resistencia de cálculo a flexión de la losa: phi Mn no menor que Mu');
const R_AS_MIN = clause('cirsoc-201', '2025', '7.6.1',
  'armadura mínima a flexión en losas no pretensadas, 0,0018 Ag');
const R_AS_MIN_TWO_WAY = clause('cirsoc-201', '2025', '8.6.1.1',
  'armadura mínima a flexión en dos direcciones, 0,0018 Ag');
const R_MIN_SPACING = clause('cirsoc-201', '2025', '7.7.2.1',
  'la separación mínima debe cumplir con el artículo 25.2');
const R_CRACK_ROUTE = clause('cirsoc-201', '2025', '7.7.2.2',
  'la separación de la armadura más cercana a la cara traccionada sigue el artículo 24.3');
const R_MAX_SPACING = clause('cirsoc-201', '2025', '7.7.2.3',
  'separación máxima: el menor entre 3h y 300 mm');
const R_SQUARE = clause('cirsoc-201', '2025', '13.3.3.2',
  'bases cuadradas: armadura uniforme en todo el ancho en ambas direcciones');
const R_RECTANGULAR = clause('cirsoc-201', '2025', '13.3.3.3',
  'bases rectangulares: faja central y zonas exteriores, gamma_s = 2/(beta+1)');
const R_ANCHORAGE = clause('cirsoc-201', '2025', '13.2.8.1',
  'el anclaje de la armadura debe cumplir con el Capítulo 25');

/** §7.6.1 / §8.6.1.1 — minimum flexural reinforcement ratio on the gross area. */
export const FOOTING_AS_MIN_RATIO = 0.0018;

/** §7.7.2.3 — the absolute cap, m. Three hundred millimetres, from the enacted text. */
export const MAX_SPACING_CAP_M = 0.3;

/** §13.3.1.2 — least effective depth for the bottom mat, m. */
export const MIN_BOTTOM_MAT_DEPTH_M = 0.15;

// ─── Types ───────────────────────────────────────────────────────

/**
 * Which of the two mat directions.
 *
 * `X` bars run parallel to B and are distributed across L; `Y` bars run parallel to L and are
 * distributed across B. The pair is deliberately named for the mat, not for the global axes:
 * a footing's B and L are its own local dimensions and a rotated footing is refused upstream.
 */
export type FootingMatAxis = 'X' | 'Y';

export type FootingMatDirectionStatus = 'DESIGNED' | 'DESIGN_FAILED' | 'NOT_EVALUATED';

/** Which requirement set the steel. */
export type FootingAsGovernedBy = 'FLEXURE' | 'MINIMUM';

/** §13.3.3.2 versus §13.3.3.3 — how the direction's steel is spread across its width. */
export type FootingDistribution = 'UNIFORM_FULL_WIDTH' | 'BANDED_SHORT_DIRECTION';

export type FootingRegionKind = 'FULL_WIDTH' | 'CENTRAL_BAND' | 'OUTSIDE_BAND';

/**
 * How the bars sit inside one region.
 *
 * `EDGE_ANCHORED` is the ordinary full-width mat: the outermost bar stands one cover plus one
 * half-diameter in from the formwork, and n bars leave n−1 equal gaps across what is left.
 * That is how a footing schedule is written and how it is hand-checked.
 *
 * `TRIBUTARY_PITCH` is used inside a §13.3.3.3 band. A band boundary is not a formwork edge —
 * there is no cover to take there — so the clause's "distributed uniformly over the band" is
 * a bar per tributary strip of width s, giving s = w/n. It is also the model under which the
 * region's provided area is exactly n·A_b, which is what makes the γs split checkable.
 */
export type FootingLayoutModel = 'EDGE_ANCHORED' | 'TRIBUTARY_PITCH';

export interface FootingMatRegion {
  kind: FootingRegionKind;
  layoutModel: FootingLayoutModel;
  /** Region width along the distribution axis, m. */
  width: number;
  /**
   * Centre of the region measured from the footing CENTROID along the distribution axis, m.
   *
   * Carried numerically now so PR18-B can place physical bars from the engineering result
   * instead of re-deriving the band geometry from the clause a second time.
   */
  centreOffset: number;
  /** True when the region reaches a formwork edge, which is what makes cover apply. */
  touchesEdge: boolean;
  /**
   * Steel §13.3.3.3 ALLOCATED to this region, m² — before any minimum is applied.
   *
   * Kept beside `asRequired` because the clause and the minimum are two different
   * requirements and either can be the larger. On a real footing the minimum usually wins in
   * the outside zones, so a result that reported only `asRequired` would make the γs split
   * unverifiable exactly where it matters: `band/width` over `outside/width` is 2 for every β,
   * and that identity is checkable here and nowhere else.
   */
  distributionShare: number;
  /** Steel the region must provide, m² — `max(distributionShare, §7.6.1 on this region)`. */
  asRequired: number;
  /** Steel the integer bar count actually provides, m². Never below `asRequired`. */
  asProvided: number;
  barCount: number;
  /** Centre-to-centre spacing, m. */
  spacingCentre: number;
  /** Clear spacing between adjacent bars, m. */
  spacingClear: number;
  /**
   * Whether the §13.3.3.3 share or the §7.6.1 minimum ON THIS REGION set `asRequired`.
   *
   * The distribution rule moves steel from the outside zones into the central band, and on a
   * minimum-governed footing the share left outside can fall below 0,0018 A_g for the strip it
   * covers. §7.6.1 is a minimum AREA, so it is applied to the region as well as to the total;
   * the alternative is a mat that satisfies the minimum on average and not where the bars are.
   */
  governedBy: FootingAsGovernedBy | 'DISTRIBUTION';
}

export interface FootingSpacingLimits {
  /** §7.7.2.3 — min(3h, 300 mm), m. */
  generalMax: number;
  /** §24.3.2 via §7.7.2.2, m. */
  crackControlMax: number;
  /** The most restrictive applicable maximum, m. */
  governingMax: number;
  /** Clause number of whichever maximum governed. */
  governingMaxClause: string;
  /** §25.2.1 minimum clear distance, m. */
  minClear: number;
  /** `c_c` used for §24.3.2, m — see the layer-order assumption in `designFootingMat`. */
  crackControlCover: number;
  refs: ClauseRef[];
}

export interface FootingDirectionDesign {
  axis: FootingMatAxis;
  /** Which footing dimension the bars of this direction run parallel to. */
  barsParallelTo: 'B' | 'L';
  /** The dimension they are distributed across, m. */
  distributionWidth: number;
  /** Cantilever from the §13.2.7.1 critical section to the edge, m. */
  cantilever: number;
  /** Factored soil pressure at the critical section and at the heavy edge, kPa. */
  qFace: number;
  qEdge: number;
  /** Factored moment at the critical section, kN·m. */
  Mu: number;
  diameterMm: number;
  /** Flexural effective depth for THIS direction, m: h − cover − d_b/2. */
  d: number;
  /** Steel required by flexural strength, m². */
  asFlexural: number;
  /** Steel required by §7.6.1 over the full distribution width, m². */
  asMinimum: number;
  asGoverning: number;
  governedBy: FootingAsGovernedBy;
  /** Clause that set `asGoverning`. */
  governingClause: string;
  spacing: FootingSpacingLimits;
  distribution: FootingDistribution;
  /** §13.3.3.3's β and γs. Null in the uniform case, where the clause does not apply. */
  beta: number | null;
  gammaS: number | null;
  regions: FootingMatRegion[];
  /** Total steel the layout provides across every region, m². */
  asProvided: number;
  barCount: number;
  /** §13.3.1.2 — false when the flexural effective depth is under 150 mm. */
  meetsMinimumDepth: boolean;
  /** Development length of the selected bar, m, when the caller supplied one. */
  developmentLength: number | null;
  status: FootingMatDirectionStatus;
  /** Why the direction is not DESIGNED. Empty when it is. */
  failures: EngineMessage[];
  steps: string[];
  refs: ClauseRef[];
}

/** PR18-A truthfully models no physical mat, and this type cannot say otherwise. */
export type FootingMatGeometryStatus = 'REQUIRED_NOT_MODELED';
/** No authoritative calculation shows top steel unnecessary, so it is not evaluated. */
export type FootingTopReinforcementStatus = 'NOT_EVALUATED';

export interface FootingMatDesign {
  x: FootingDirectionDesign;
  y: FootingDirectionDesign;
  /**
   * The depth the PUNCHING and one-way-shear checks use, m.
   *
   * Restated here on purpose. It is the AVERAGED two-layer mat depth `h − cover − d_b`, a
   * different convention from either flexural depth above, and that convention is deliberately
   * left alone. Putting the three numbers side by side is the only way a reader can see that
   * the difference is intentional rather than a disagreement.
   */
  punchingD: number;
  /** DESIGNED only when BOTH directions are. */
  status: FootingMatDirectionStatus;
  geometry: FootingMatGeometryStatus;
  topReinforcement: FootingTopReinforcementStatus;
  assumptions: EngineMessage[];
  failures: EngineMessage[];
  refs: ClauseRef[];
}

export interface FootingMatPreferencesInput {
  bottomMatDiameterXmm: number;
  bottomMatDiameterYmm: number;
  bottomMatSpacingPolicy: 'AUTO_CODE_COMPLIANT';
}

export interface FootingMatDesignInput {
  /** Plan dimensions, m. `B` is the X-bar direction, `L` the Y-bar direction. */
  B: number;
  L: number;
  /** Overall thickness, m, and clear cover to the bottom mat, m. */
  thickness: number;
  cover: number;
  /** Column plan dimensions, m — `columnB` along B, `columnH` along L. */
  columnB: number;
  columnH: number;
  /** Plan offset of the footing CENTROID from the column, m, in local axes. */
  eccentricityB: number;
  eccentricityL: number;
  fc: number;
  fy: number;
  /** Factored axial load, kN, and the factored moments of the governing combination. */
  factoredAxial: number;
  /** Moment producing eccentricity ALONG B, kN·m. Same convention as `FootingInput`. */
  factoredMomentB: number;
  factoredMomentL: number;
  maxAggregateSizeMm: number;
  edition: RegulationEdition;
  preferences: FootingMatPreferencesInput;
  /**
   * Development length per bar diameter, m, when the caller has the anchorage authority.
   *
   * Reported, never checked here. §13.2.8 sends anchorage to Chapter 25 and the length is a
   * property of the bar, but whether it FITS is a question about geometry PR18-A does not
   * model, and answering it from a length alone would be a claim about a bar that does not
   * exist.
   */
  developmentLengthFor?: (diameterMm: number) => number;
}

// ─── Geometry helpers ────────────────────────────────────────────

/** Nominal area of one bar, m². */
export function barArea(diameterMm: number): number {
  return Math.PI * (diameterMm / 2000) ** 2;
}

/**
 * Distinct clause references, by what they cite rather than by object identity.
 *
 * `crackControlMaxSpacing` and `minClearSpacingInLayer` build fresh `ClauseRef` objects on
 * every call, so both directions of a mat return §24.3.2 and §25.2.1 as different objects
 * citing the same clause. A `Set` of the objects would keep both and the record would list
 * §24.3.2 twice — the duplicate-reference defect `document-model` already has a test against.
 */
function distinctRefs(refs: readonly ClauseRef[]): ClauseRef[] {
  const seen = new Set<string>();
  const out: ClauseRef[] = [];
  for (const r of refs) {
    const key = `${r.regulation}/${r.edition}/${r.clause}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

/**
 * Flexural effective depth of one mat direction, m.
 *
 * `h − cover − d_b/2` is the depth of THAT direction's bars, exactly. It is not the averaged
 * `h − cover − d_b` the punching check uses: that average stands in for two layers with one
 * number, which is the right compromise for a check that has a single `d`, and the wrong one
 * for a design that resolves the directions separately.
 */
export function footingFlexuralDepth(
  thickness: number, cover: number, diameterMm: number,
): number {
  return Math.max(0, thickness - cover - diameterMm / 2000);
}

// ─── Layout ──────────────────────────────────────────────────────

type LayoutOutcome =
  | {
    ok: true; barCount: number; spacingCentre: number; spacingClear: number;
    asProvided: number;
  }
  | { ok: false; reason: 'noPlaceableWidth' | 'minClear' | 'noMaxSpacing' };

/**
 * Choose an integer bar count for one region.
 *
 * Three requirements, in the order they bind:
 *
 *   1. the count must provide at least the required area — `ceil`, never `round`, because
 *      rounding the last bar away is a real shortfall dressed up as a tolerance;
 *   2. the resulting centre spacing must not exceed the governing maximum, which can force
 *      MORE bars than the area alone asks for and routinely does on a minimum-governed mat;
 *   3. the resulting clear spacing must not fall below §25.2.1, which caps the count from
 *      above. When the floor from (1) and (2) passes that cap there is no admissible layout
 *      at the selected diameter, and this returns a failure instead of quietly changing the
 *      diameter the engineer chose.
 */
function layoutRegion(opts: {
  width: number;
  model: FootingLayoutModel;
  asRequired: number;
  diameterMm: number;
  cover: number;
  maxSpacing: number;
  minClear: number;
}): LayoutOutcome {
  const db = opts.diameterMm / 1000;
  const area = barArea(opts.diameterMm);
  if (!(opts.maxSpacing > 0)) return { ok: false, reason: 'noMaxSpacing' };

  // Pitch a bar count implies, and the count a pitch implies — the two directions of the
  // same relation, which differ between the two layout models by exactly one gap.
  const edgeAnchored = opts.model === 'EDGE_ANCHORED';
  const span = edgeAnchored ? opts.width - 2 * opts.cover - db : opts.width;
  if (!(span > 0)) return { ok: false, reason: 'noPlaceableWidth' };
  const gaps = (n: number) => (edgeAnchored ? n - 1 : n);
  const spacingFor = (n: number) => span / gaps(n);

  // No tolerances anywhere in these three bounds. `ceil` on the area can only ever add a bar
  // the demand did not strictly need, and `floor` on the clear-spacing cap can only ever
  // remove one it did — both errors are in the safe direction, whereas an epsilon that
  // "rounds off" a shortfall is exactly the tolerance this design must not have.
  const nFloor = edgeAnchored ? 2 : 1;
  const nFromArea = Math.max(nFloor, Math.ceil(opts.asRequired / area));
  // Smallest count whose spacing is within the maximum.
  const nFromSpacing = Math.max(nFloor,
    (edgeAnchored ? 1 : 0) + Math.ceil(span / opts.maxSpacing));
  const n = Math.max(nFromArea, nFromSpacing);

  // Largest count the minimum clear distance still admits.
  const pitchFloor = opts.minClear + db;
  const nMax = edgeAnchored
    ? Math.floor(span / pitchFloor) + 1
    : Math.floor(span / pitchFloor);
  if (n > nMax) return { ok: false, reason: 'minClear' };

  const spacingCentre = spacingFor(n);
  return {
    ok: true,
    barCount: n,
    spacingCentre,
    spacingClear: spacingCentre - db,
    asProvided: n * area,
  };
}

// ─── One direction ───────────────────────────────────────────────

interface DirectionGeometry {
  axis: FootingMatAxis;
  barsParallelTo: 'B' | 'L';
  /** Footing dimension the bars span, m — the pressure varies along this one. */
  spanDimension: number;
  /** Column dimension along `spanDimension`, m. */
  columnDimension: number;
  /** Footing dimension the bars are distributed across, m. */
  distributionWidth: number;
  /** Factored moment producing eccentricity along `spanDimension`, kN·m. */
  factoredMoment: number;
  /** Plan offset of the centroid from the column along the DISTRIBUTION axis, m. */
  distributionEccentricity: number;
}

function designDirection(
  input: FootingMatDesignInput, geo: DirectionGeometry, diameterMm: number,
): FootingDirectionDesign {
  const steps: string[] = [];
  const failures: EngineMessage[] = [];
  const refs: ClauseRef[] = [R_TWO_WAY, R_MOMENT_PLANE, R_CRITICAL];

  const { thickness, cover, factoredAxial } = input;
  const W = geo.distributionWidth;
  const S = geo.spanDimension;
  const cantilever = (S - geo.columnDimension) / 2;
  const area = input.B * input.L;
  const qFactored = area > 0 ? factoredAxial / area : 0;

  // The exact trapezoid `checkFooting` integrates, applied independently on this axis. The
  // load eccentricity is the FACTORED moment over the factored axial, and x is measured from
  // the light edge, so `xFace` is the critical section on the HEAVY side — the one that
  // governs. Nothing here invents a pressure: same expression, same sign rule, one axis over.
  const e = Math.abs(geo.factoredMoment) / Math.max(factoredAxial, 1e-12);
  const k = S > 0 ? 6 * e / S : 0;
  const xFace = S - cantilever;
  const qFace = qFactored * (1 + k * (2 * xFace / S - 1));
  const qEdge = qFactored * (1 + k);
  const Mu = cantilever > 0 ? W * cantilever * cantilever * (2 * qFace + qEdge) / 6 : 0;

  const d = footingFlexuralDepth(thickness, cover, diameterMm);

  steps.push(
    `Dirección ${geo.axis}: barras paralelas a ${geo.barsParallelTo}, voladizo ` +
    `${cantilever.toFixed(3)} m desde la cara de la columna (13.2.7.1), repartidas en ` +
    `${W.toFixed(2)} m.`,
    `Presión factorizada ${qFactored.toFixed(1)} kPa` +
    (e > 1e-9
      ? `, trapecio por excentricidad de carga e = ${e.toFixed(3)} m: q_cara ` +
        `${qFace.toFixed(1)}, q_borde ${qEdge.toFixed(1)} kPa.`
      : ' uniforme.'),
    `Mu = ${W.toFixed(2)} × ${cantilever.toFixed(3)}² × (2×${qFace.toFixed(1)} + ` +
    `${qEdge.toFixed(1)})/6 = ${Mu.toFixed(1)} kN·m (13.2.6.6).`,
    `d = ${thickness.toFixed(3)} − ${cover.toFixed(3)} − Ø${diameterMm}/2 = ${d.toFixed(4)} m.`);

  // ── Contact validity ─────────────────────────────────────────
  //
  // Beyond the kern the base lifts and the linear distribution stops being valid. Designing
  // through it would reinforce for a pressure diagram the soil is not delivering, and the
  // linear q under-states the real peak — the wrong direction to be wrong in. Same refusal
  // `checkBearing` and `checkFooting` already make, restated here so this module is safe to
  // call on its own.
  const notEvaluated = (m: EngineMessage): FootingDirectionDesign => ({
    axis: geo.axis, barsParallelTo: geo.barsParallelTo, distributionWidth: W,
    cantilever, qFace, qEdge, Mu, diameterMm, d,
    asFlexural: 0, asMinimum: 0, asGoverning: 0,
    governedBy: 'MINIMUM', governingClause: R_AS_MIN.clause,
    spacing: {
      generalMax: 0, crackControlMax: 0, governingMax: 0, governingMaxClause: R_MAX_SPACING.clause,
      minClear: 0, crackControlCover: 0, refs: [],
    },
    distribution: 'UNIFORM_FULL_WIDTH', beta: null, gammaS: null,
    regions: [], asProvided: 0, barCount: 0,
    meetsMinimumDepth: d >= MIN_BOTTOM_MAT_DEPTH_M,
    developmentLength: null,
    status: 'NOT_EVALUATED', failures: [m], steps, refs,
  });

  if (e > S / 6) {
    return notEvaluated(msg('footing.mat.upliftNotEvaluated', {
      axis: geo.axis, e: +e.toFixed(3), limit: +(S / 6).toFixed(3),
    }));
  }
  if (!(W > 0) || !(cantilever > 0) || !(qFactored > 0)) {
    return notEvaluated(msg('footing.mat.geometryNotEvaluated', { axis: geo.axis }));
  }

  // ── Steel required by flexural strength ──────────────────────
  //
  // The rectangular stress block comes from `checkFlexure`, which is the project's flexural
  // authority, driven with the mat strip as its section: b = the distribution width, h = the
  // footing thickness, no stirrup, and the diameter the engineer selected — so its internal
  // `d` is this direction's flexural depth and not the assumed Ø16 one.
  const flex = checkFlexure(
    { fc: input.fc, fy: input.fy, cover, b: W, h: thickness, stirrupDia: 0 },
    Mu, 0, { barDiameterMm: diameterMm },
  );
  const asFlexural = Math.max(0, flex.AsFlexural) * 1e-4;   // cm² → m²

  // A footing mat is singly reinforced. Compression steel in a pad footing means the section
  // is too thin, and the answer is a thicker footing rather than a top mat resisting a
  // cantilever moment — so this is reported rather than designed around.
  if (flex.isDoublyReinforced) {
    failures.push(msg('footing.mat.needsCompressionSteel', {
      axis: geo.axis, Mu: +Mu.toFixed(1), thickness: +thickness.toFixed(3),
    }));
  }

  // ── Steel required by the minimum ────────────────────────────
  //
  // §7.6.1's own clause, on the gross area of the strip: A_g = distribution width × h.
  // NOT `checkFlexure().AsMin`, which is the beam rule on b·d and answers to §9.6.1.2.
  const asMinimum = FOOTING_AS_MIN_RATIO * W * thickness;
  const governedBy: FootingAsGovernedBy = asFlexural > asMinimum ? 'FLEXURE' : 'MINIMUM';
  const asGoverning = Math.max(asFlexural, asMinimum);
  const governingClause = governedBy === 'FLEXURE' ? R_STRENGTH.clause : R_AS_MIN.clause;
  refs.push(R_STRENGTH, R_AS_MIN, R_AS_MIN_TWO_WAY);
  steps.push(
    `As por resistencia a flexión = ${(asFlexural * 1e4).toFixed(2)} cm²; ` +
    `As mínima 0,0018·Ag = 0,0018 × ${W.toFixed(2)} × ${thickness.toFixed(3)} = ` +
    `${(asMinimum * 1e4).toFixed(2)} cm² (7.6.1). Gobierna ` +
    `${governedBy === 'FLEXURE' ? 'la flexión' : 'la armadura mínima'}: ` +
    `${(asGoverning * 1e4).toFixed(2)} cm².`);

  // ── §13.3.1.2 ────────────────────────────────────────────────
  const meetsMinimumDepth = d >= MIN_BOTTOM_MAT_DEPTH_M;
  refs.push(R_MIN_DEPTH);
  if (!meetsMinimumDepth) {
    failures.push(msg('footing.mat.depthBelowMinimum', {
      axis: geo.axis, d: +d.toFixed(4), min: MIN_BOTTOM_MAT_DEPTH_M,
    }));
  }

  // ── Spacing limits ───────────────────────────────────────────
  const generalMax = Math.min(3 * thickness, MAX_SPACING_CAP_M);
  // `c_c` is the distance from the BAR SURFACE to the tension face, so for the upper of the
  // two bottom layers it is the cover plus the other direction's diameter. Which direction
  // ends up on top is a bar-placement decision PR18-B makes, so both are checked as if they
  // were the upper layer: that is the smaller permitted spacing, and being wrong the other way
  // would permit bars further apart than the clause allows.
  const otherDiameterMm = geo.axis === 'X'
    ? input.preferences.bottomMatDiameterYmm
    : input.preferences.bottomMatDiameterXmm;
  const crackControlCover = cover + otherDiameterMm / 1000;
  const crack = crackControlMaxSpacing(input.edition, {
    fy: input.fy, clearCoverToTensionFace: crackControlCover,
  });
  const clear = minClearSpacingInLayer(input.edition, {
    barDiameterMm: diameterMm, maxAggregateSizeMm: input.maxAggregateSizeMm,
  });
  const governingMax = Math.min(generalMax, crack.maxSpacing);
  const spacing: FootingSpacingLimits = {
    generalMax,
    crackControlMax: crack.maxSpacing,
    governingMax,
    governingMaxClause: crack.maxSpacing < generalMax ? '24.3.2' : R_MAX_SPACING.clause,
    minClear: clear.minClear,
    crackControlCover,
    refs: [R_MAX_SPACING, R_CRACK_ROUTE, ...crack.refs, R_MIN_SPACING, ...clear.refs],
  };
  refs.push(...spacing.refs);
  steps.push(
    `Separación máxima: 7.7.2.3 → menor entre 3h = ${(3 * thickness * 1000).toFixed(0)} mm y ` +
    `300 mm = ${(generalMax * 1000).toFixed(0)} mm; 24.3.2 con cc = ` +
    `${(crackControlCover * 1000).toFixed(0)} mm y fs = ${crack.fs.toFixed(0)} MPa → ` +
    `${(crack.maxSpacing * 1000).toFixed(0)} mm. Gobierna ` +
    `${(governingMax * 1000).toFixed(0)} mm (${spacing.governingMaxClause}).`,
    `Separación libre mínima (25.2.1) = ${(clear.minClear * 1000).toFixed(1)} mm.`);

  // ── Distribution and layout ──────────────────────────────────
  const shortSide = Math.min(input.B, input.L);
  const longSide = Math.max(input.B, input.L);
  // The short-DIRECTION reinforcement is the one whose bars run parallel to the short side,
  // and it is the one §13.3.3.3(b) bands. Its bars are therefore distributed across the LONG
  // side, which is why the band width (the short side) always fits inside the width.
  const isShortDirection = longSide > shortSide && geo.spanDimension === shortSide;
  const distribution: FootingDistribution = isShortDirection
    ? 'BANDED_SHORT_DIRECTION'
    : 'UNIFORM_FULL_WIDTH';

  const beta = isShortDirection ? longSide / shortSide : null;
  const gammaS = beta === null ? null : 2 / (beta + 1);
  refs.push(isShortDirection ? R_RECTANGULAR : R_SQUARE);

  const regions: FootingMatRegion[] = [];
  const addRegion = (
    kind: FootingRegionKind, model: FootingLayoutModel, width: number, centreOffset: number,
    touchesEdge: boolean, share: number, shareGovernedBy: FootingAsGovernedBy | 'DISTRIBUTION',
  ): void => {
    if (!(width > 1e-9)) return;
    // §7.6.1 is a minimum AREA, so it applies to the strip a region covers and not only to
    // the direction's total. Without this the outside zones of a minimum-governed rectangular
    // footing come out below 0,0018 A_g exactly where the band took steel from them.
    const regionMin = FOOTING_AS_MIN_RATIO * width * thickness;
    const asRequired = Math.max(share, regionMin);
    const governed = asRequired > share ? 'MINIMUM' : shareGovernedBy;
    const laid = layoutRegion({
      width, model, asRequired, diameterMm, cover,
      maxSpacing: governingMax, minClear: clear.minClear,
    });
    if (!laid.ok) {
      failures.push(msg('footing.mat.noFeasibleLayout', {
        axis: geo.axis, diameter: diameterMm, region: kind,
        width: +width.toFixed(3), reason: laid.reason,
      }));
      return;
    }
    regions.push({
      kind, layoutModel: model, width, centreOffset, touchesEdge,
      distributionShare: share,
      asRequired, asProvided: laid.asProvided, barCount: laid.barCount,
      spacingCentre: laid.spacingCentre, spacingClear: laid.spacingClear,
      governedBy: governed,
    });
  };

  if (!isShortDirection) {
    // §13.3.3.2, and §13.3.3.3(a) for the long direction of a rectangular footing: uniform
    // across the FULL width. One region, edge to edge.
    addRegion('FULL_WIDTH', 'EDGE_ANCHORED', W, 0, true, asGoverning, governedBy);
    steps.push(
      `Distribución uniforme en todo el ancho ` +
      `(${input.B === input.L ? '13.3.3.2' : '13.3.3.3 (a)'}).`);
  } else {
    // §13.3.3.3(b). The band is as wide as the SHORT side and centred on the COLUMN axis, not
    // on the footing centroid — which are different points on a footing with plan
    // eccentricity, and make the two outside zones unequal.
    const bandWidth = shortSide;
    const columnOffset = -geo.distributionEccentricity;
    const lowerWidth = W / 2 + columnOffset - bandWidth / 2;
    const upperWidth = W / 2 - columnOffset - bandWidth / 2;
    const outsideWidth = lowerWidth + upperWidth;

    if (lowerWidth < -1e-9 || upperWidth < -1e-9) {
      // The prescribed band does not fit inside the footing. Clipping it would be inventing a
      // rule §13.3.3.3 does not state, and spreading the steel uniformly instead would drop
      // the band the clause requires.
      failures.push(msg('footing.mat.bandOutsideFooting', {
        axis: geo.axis, band: +bandWidth.toFixed(3), width: +W.toFixed(3),
        offset: +columnOffset.toFixed(3),
      }));
    } else {
      const g = gammaS as number;
      addRegion('CENTRAL_BAND', 'TRIBUTARY_PITCH', bandWidth, columnOffset, false,
        g * asGoverning, 'DISTRIBUTION');
      // The remainder is uniform over the outside ZONES taken together, so each zone carries
      // it in proportion to its own width. On a centred footing the two are equal; on an
      // eccentric one they are not, and splitting the remainder in half would put the wrong
      // amount on the narrow side.
      for (const [kind, width, centre] of [
        ['OUTSIDE_BAND', lowerWidth, -W / 2 + lowerWidth / 2],
        ['OUTSIDE_BAND', upperWidth, W / 2 - upperWidth / 2],
      ] as Array<[FootingRegionKind, number, number]>) {
        const share = outsideWidth > 1e-9
          ? (1 - g) * asGoverning * (width / outsideWidth)
          : 0;
        addRegion(kind, 'TRIBUTARY_PITCH', width, centre, true, share, 'DISTRIBUTION');
      }
      steps.push(
        `Base rectangular, β = ${longSide.toFixed(2)}/${shortSide.toFixed(2)} = ` +
        `${(beta as number).toFixed(3)} → γs = 2/(β+1) = ${g.toFixed(4)} (13.3.3.3). ` +
        `Faja central de ${bandWidth.toFixed(2)} m centrada en el eje de la columna con ` +
        `${(g * asGoverning * 1e4).toFixed(2)} cm²; fuera de la faja ` +
        `${((1 - g) * asGoverning * 1e4).toFixed(2)} cm² en ${outsideWidth.toFixed(2)} m.`);
    }
  }

  const asProvided = regions.reduce((s, r) => s + r.asProvided, 0);
  const barCount = regions.reduce((s, r) => s + r.barCount, 0);
  for (const r of regions) {
    steps.push(
      `${r.kind}: ${r.barCount} Ø${diameterMm} en ${r.width.toFixed(2)} m, ` +
      `c/${(r.spacingCentre * 1000).toFixed(0)} mm (libre ` +
      `${(r.spacingClear * 1000).toFixed(0)} mm), As = ${(r.asProvided * 1e4).toFixed(2)} ` +
      `contra ${(r.asRequired * 1e4).toFixed(2)} cm² requeridos.`);
  }

  const development = input.developmentLengthFor
    ? input.developmentLengthFor(diameterMm)
    : null;
  if (development !== null) {
    refs.push(R_ANCHORAGE);
    steps.push(
      `Anclaje (13.2.8.1 → Cap. 25): ld = ${development.toFixed(3)} m para Ø${diameterMm}. ` +
      'La geometría física de la barra no está modelada en esta etapa, por lo que no se ' +
      'emite verificación de anclaje.');
  }

  return {
    axis: geo.axis, barsParallelTo: geo.barsParallelTo, distributionWidth: W,
    cantilever, qFace, qEdge, Mu, diameterMm, d,
    asFlexural, asMinimum, asGoverning, governedBy, governingClause,
    spacing, distribution, beta, gammaS, regions, asProvided, barCount,
    meetsMinimumDepth,
    developmentLength: development,
    status: failures.length > 0 ? 'DESIGN_FAILED' : 'DESIGNED',
    failures, steps, refs,
  };
}

// ─── The mat ─────────────────────────────────────────────────────

/**
 * Design both directions of an isolated footing's bottom mat.
 *
 * The two directions are computed INDEPENDENTLY — own cantilever, own distribution width, own
 * pressure trapezoid, own bar diameter and therefore own effective depth. A square footing
 * under a square centred column comes out symmetric because its inputs are symmetric, not
 * because one direction was copied onto the other.
 */
export function designFootingMat(input: FootingMatDesignInput): FootingMatDesign {
  const dX = input.preferences.bottomMatDiameterXmm;
  const dY = input.preferences.bottomMatDiameterYmm;

  const x = designDirection(input, {
    axis: 'X', barsParallelTo: 'B',
    spanDimension: input.B, columnDimension: input.columnB,
    distributionWidth: input.L,
    factoredMoment: input.factoredMomentB,
    distributionEccentricity: input.eccentricityL,
  }, dX);

  const y = designDirection(input, {
    axis: 'Y', barsParallelTo: 'L',
    spanDimension: input.L, columnDimension: input.columnH,
    distributionWidth: input.B,
    factoredMoment: input.factoredMomentL,
    distributionEccentricity: input.eccentricityB,
  }, dY);

  // The averaged two-layer depth the punching and one-way-shear checks keep using. Stated
  // with the mat so the three depths are readable together.
  const punchingD = Math.max(0, input.thickness - input.cover - (dX + dY) / 2000);

  const assumptions: EngineMessage[] = [
    msg('footing.assumption.flexuralDepths', {
      dx: +x.d.toFixed(4), dy: +y.d.toFixed(4), punching: +punchingD.toFixed(4),
      bx: dX, by: dY,
    }),
    msg('footing.assumption.crackControlLayerOrder', {
      ccx: +(x.spacing.crackControlCover * 1000).toFixed(0),
      ccy: +(y.spacing.crackControlCover * 1000).toFixed(0),
    }),
  ];
  // The cantilever is measured symmetrically about the column, which is the convention
  // `checkFooting` integrates and the one this module reuses verbatim. On a footing with plan
  // eccentricity the two real cantilevers differ, and the longer one carries more moment than
  // the symmetric value states. That is a limitation of the shared integral rather than of
  // this design, and it is named rather than left for a reader to discover.
  if (Math.abs(input.eccentricityB) > 1e-9 || Math.abs(input.eccentricityL) > 1e-9) {
    assumptions.push(msg('footing.assumption.symmetricCantilever', {
      eb: +input.eccentricityB.toFixed(3), el: +input.eccentricityL.toFixed(3),
    }));
  }

  const status: FootingMatDirectionStatus =
    x.status === 'NOT_EVALUATED' || y.status === 'NOT_EVALUATED'
      ? 'NOT_EVALUATED'
      : x.status === 'DESIGNED' && y.status === 'DESIGNED'
        ? 'DESIGNED'
        : 'DESIGN_FAILED';

  return {
    x, y, punchingD, status,
    // PR18-A designs the mat and models none of it. Both of these are types with one
    // inhabitant, so no edit to this function can quietly promote either.
    geometry: 'REQUIRED_NOT_MODELED',
    topReinforcement: 'NOT_EVALUATED',
    assumptions,
    failures: [...x.failures, ...y.failures],
    refs: distinctRefs([...x.refs, ...y.refs]),
  };
}
