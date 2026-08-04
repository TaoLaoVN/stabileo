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
import {
  MOMENT_ORIENTATIONS, axisPressure, columnOffsetFromCentroid, momentEccentricity,
} from './footing-actions';

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
  /** Steel the region must provide, m². Equal to `distributionShare`: see `addRegion`. */
  asRequired: number;
  /**
   * `0,0018 A_g` evaluated on THIS region's strip, m² — a Stabileo policy figure, not a
   * requirement of the enacted text.
   *
   * §7.6.1 imposes its minimum on the direction's reinforcement and §13.3.3.3 then distributes
   * the total; neither clause, and neither commentary, imposes it again region by region. The
   * number is reported so a detailer who wants that extra conservatism can see it, and an
   * advisory names any region whose provided steel falls under it. It is NOT added to
   * `asRequired`, because a design must not present a house preference as a code requirement.
   */
  policyRegionalMinimum: number;
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
  /**
   * `c_c` used for §24.3.2, m — the CLEAR COVER.
   *
   * §24.3.2 measures it to the bar SURFACE and C 24.3.2 restricts it to the reinforcement
   * closest to the tension face, so this is `cover` and it does not depend on which direction
   * ends up in the lower layer.
   */
  clearCoverToTensionFace: number;
  refs: ClauseRef[];
}

export interface FootingDirectionDesign {
  axis: FootingMatAxis;
  /** Which footing dimension the bars of this direction run parallel to. */
  barsParallelTo: 'B' | 'L';
  /** The dimension they are distributed across, m. */
  distributionWidth: number;
  /**
   * Which of the two column faces governed, in centroid coordinates.
   *
   * Both are evaluated: a footing whose column is offset in plan has two unequal cantilevers,
   * and the longer one is not always the one under the heavier pressure. Null only when the
   * direction was not evaluated.
   */
  governingSide: 'low' | 'high' | null;
  /** Cantilever from the GOVERNING §13.2.7.1 critical section to its edge, m. */
  cantilever: number;
  /** Factored soil pressure at that critical section and at its edge, kPa. */
  qFace: number;
  qEdge: number;
  /** Factored moment at the critical section, kN·m. */
  Mu: number;
  diameterMm: number;
  /**
   * The effective depth this direction is DESIGNED at, m.
   *
   * Equal to `dIfUpperLayer`: PR18-A does not establish which mat sits lower, so both
   * directions take the shallower of the two possibilities. See `FootingMatDesign.layerOrder`.
   */
  d: number;
  /** `h − cover − d_b/2`, m — this direction's depth if it is the LOWER layer. */
  dIfLowerLayer: number;
  /** `h − cover − d_b,other − d_b/2`, m — its depth if it is the UPPER layer. */
  dIfUpperLayer: number;
  /** Which of the two `d` values the design used, and why it is that one. */
  layerRole: 'ENVELOPE_UPPER_LAYER';
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
  /**
   * Observations that do NOT make the design non-compliant.
   *
   * Kept apart from `failures` because they are a different kind of statement: a region under
   * the Stabileo regional-minimum policy is code-compliant, and filing that next to a real
   * failure would train a reader to dismiss both.
   */
  advisories: EngineMessage[];
  steps: string[];
  refs: ClauseRef[];
}

/** PR18-A truthfully models no physical mat, and this type cannot say otherwise. */
export type FootingMatGeometryStatus = 'REQUIRED_NOT_MODELED';
/** No authoritative calculation shows top steel unnecessary, so it is not evaluated. */
export type FootingTopReinforcementStatus = 'NOT_EVALUATED';
/**
 * Which mat sits in the lower layer.
 *
 * NOT_ESTABLISHED for the whole of PR18-A. No clause prescribes it — §13.2.8 and §25.4 govern
 * anchorage, §13.3.3 governs distribution, and neither says which perpendicular mat goes down
 * — so it is a bar-placement decision, and PR18-A places no bars. Both directions are therefore
 * designed at the shallower (upper-layer) depth, which is the conservative envelope; PR18-B can
 * fix the order and recover the deeper direction's capacity.
 */
export type FootingLayerOrderStatus = 'NOT_ESTABLISHED';
/**
 * Anchorage.
 *
 * `developmentLength` reports l_d for the selected bar from the authoritative clause module, and
 * that is a property of the bar. Whether the bar ACHIEVES it — the available length from the
 * §13.2.7.1 critical section, hooks, the §13.2.8.4 cases — is a question about geometry that
 * does not exist yet, so no anchorage verification is claimed at this stage.
 */
export type FootingAnchorageStatus = 'NOT_GEOMETRICALLY_VERIFIED';

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
  /**
   * DESIGNED only when BOTH directions are, and it means exactly one thing: the flexural
   * demand was evaluated and a reinforcement schedule satisfying every governing check was
   * found. It does NOT mean the anchorage was verified, the layer order was resolved, or any
   * physical clash was checked — those are the three statuses immediately below, and each says
   * so on its own.
   */
  status: FootingMatDirectionStatus;
  geometry: FootingMatGeometryStatus;
  topReinforcement: FootingTopReinforcementStatus;
  layerOrder: FootingLayerOrderStatus;
  anchorage: FootingAnchorageStatus;
  assumptions: EngineMessage[];
  failures: EngineMessage[];
  /** Policy observations from both directions. Compliant designs can carry these. */
  advisories: EngineMessage[];
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
 * ── Why the third argument exists ──────────────────────────────
 *
 * Two perpendicular mats cannot occupy one elevation. One direction sits on the cover and the
 * other sits ON TOP of it, so their effective depths differ by a full bar diameter and only
 * one of them is `h − cover − d_b/2`. `barsBelowMm` is the steel stacked underneath this
 * direction: zero for the lower layer, the other direction's diameter for the upper one.
 *
 * The first version of this module used the LOWER-layer depth for both directions while
 * simultaneously using the UPPER-layer cover for both crack-control checks. Each value was
 * defensible on its own and the combination described a footing that cannot be built: the
 * favourable depth of the bottom layer with the penalised cover of the layer above it.
 */
export function footingFlexuralDepth(
  thickness: number, cover: number, diameterMm: number, barsBelowMm = 0,
): number {
  return Math.max(0, thickness - cover - barsBelowMm / 1000 - diameterMm / 2000);
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
  /** Plan offset of the centroid from the column along the SPAN axis, m. */
  spanEccentricity: number;
  /** Plan offset of the centroid from the column along the DISTRIBUTION axis, m. */
  distributionEccentricity: number;
}

/** One candidate critical section: a column face, under one pressure diagram. */
interface FaceDemand {
  /** Which footing edge this cantilever reaches, in centroid coordinates. */
  side: 'low' | 'high';
  cantilever: number;
  qFace: number;
  qEdge: number;
  Mu: number;
  /** Offset of the pressure resultant from the footing centroid, m. */
  resultantOffset: number;
}

/**
 * The governing critical section on one axis.
 *
 * ── What this replaces, and why ────────────────────────────────
 *
 * The first version took ONE cantilever, `(S − columnDimension)/2`, which is the symmetric
 * value. `eccentricityB`/`eccentricityL` are not load eccentricities — `model/footing.ts`
 * defines them as the plan offset of the footing CENTROID from the supported node, and
 * `punchingPosition` already measures each column face to its own footing edge with them. So
 * the column really is off centre, the two cantilevers really are unequal, and the symmetric
 * value UNDER-states the longer one. A note about that is not good enough: it is the side that
 * governs.
 *
 * ── The envelope ───────────────────────────────────────────────
 *
 * Two things move independently, so both faces are evaluated under both:
 *
 *   * the GEOMETRIC offset of the column, whose direction is known;
 *   * the applied moment, whose sign is NOT usable here. The demand arrives as a reaction
 *     moment on global axes and the shared authority already discards its sign
 *     (`Math.abs`), because resolving a reaction-moment sign onto a footing-local axis is
 *     a separate piece of work this module must not guess at.
 *
 * So the moment is applied in both orientations and the worst of the four combinations
 * governs. That is sign-agnostic and cannot under-state the demand; the cost is that a footing
 * is occasionally designed for a diagram the real sign would not produce.
 *
 * The pressure is the same linear distribution the shared authority integrates,
 * `q(u) = q0 (1 + 12 u_R u / S²)`, written about the centroid so an off-centre resultant is
 * expressible at all. At `u = ±S/2` it reduces to `q0 (1 ± 6 e/S)` — the `1 ± k` form
 * `checkFooting` uses — so a centred column reproduces that result exactly.
 */
function governingFace(opts: {
  S: number;
  W: number;
  columnDimension: number;
  /** Column centre measured from the footing centroid along this axis, m. */
  columnOffset: number;
  q0: number;
  /** Load-eccentricity magnitude from the factored moment, m. */
  momentEccentricity: number;
}): {
  governing: FaceDemand | null;
  worstResultantOffset: number;
  kernLimit: number;
  /** True when EITHER orientation puts the resultant outside the kern. */
  anyOrientationLifts: boolean;
} {
  const { S, W, columnDimension, columnOffset, q0, momentEccentricity } = opts;
  const kernLimit = S / 6;
  let governing: FaceDemand | null = null;
  let worstResultantOffset = 0;
  let anyOrientationLifts = false;

  for (const orientation of MOMENT_ORIENTATIONS) {
    const uR = columnOffset + orientation * momentEccentricity;
    if (Math.abs(uR) > Math.abs(worstResultantOffset)) worstResultantOffset = uR;
    // Beyond the kern the base lifts and this distribution stops being valid. Recorded so the
    // caller can refuse: skipping this orientation and designing on the other one would be
    // picking the favourable moment sign by omission, which is the whole thing the sign-agnostic
    // envelope exists to avoid.
    if (Math.abs(uR) > kernLimit) {
      anyOrientationLifts = true;
      continue;
    }
    // The shared authority's field, not a local restatement of it: `foundation-check.ts`
    // integrates this same function, so the mat is reinforced for the pressure the footing
    // was checked against.
    const q = axisPressure(q0, S, uR);

    for (const side of ['low', 'high'] as const) {
      const faceU = side === 'low'
        ? columnOffset - columnDimension / 2
        : columnOffset + columnDimension / 2;
      const edgeU = side === 'low' ? -S / 2 : S / 2;
      const cantilever = side === 'low' ? faceU - edgeU : edgeU - faceU;
      if (!(cantilever > 0)) continue;
      const qFace = q(faceU);
      const qEdge = q(edgeU);
      // Exactly the trapezoid the shared authority integrates, on this side's own cantilever.
      const Mu = W * cantilever * cantilever * (2 * qFace + qEdge) / 6;
      if (governing === null || Mu > governing.Mu) {
        governing = { side, cantilever, qFace, qEdge, Mu, resultantOffset: uR };
      }
    }
  }
  return { governing, worstResultantOffset, kernLimit, anyOrientationLifts };
}

function designDirection(
  input: FootingMatDesignInput, geo: DirectionGeometry, diameterMm: number,
): FootingDirectionDesign {
  const steps: string[] = [];
  const failures: EngineMessage[] = [];
  const advisories: EngineMessage[] = [];
  const refs: ClauseRef[] = [R_TWO_WAY, R_MOMENT_PLANE, R_CRITICAL];

  const { thickness, cover, factoredAxial } = input;
  const W = geo.distributionWidth;
  const S = geo.spanDimension;
  const area = input.B * input.L;
  const qFactored = area > 0 ? factoredAxial / area : 0;

  // The column sits where the model puts it. `eccentricityB`/`eccentricityL` offset the footing
  // CENTROID from the supported node, so the column centre is at MINUS that offset in centroid
  // coordinates — the same reading `punchingPosition` already uses to measure each face to its
  // own edge.
  const columnOffset = columnOffsetFromCentroid(geo.spanEccentricity);
  const momentEcc = momentEccentricity(geo.factoredMoment, factoredAxial);
  const face = governingFace({
    S, W, columnDimension: geo.columnDimension, columnOffset,
    q0: qFactored, momentEccentricity: momentEcc,
  });

  const cantilever = face.governing?.cantilever ?? 0;
  const qFace = face.governing?.qFace ?? 0;
  const qEdge = face.governing?.qEdge ?? 0;
  const Mu = face.governing?.Mu ?? 0;

  // ── The two physical layers ──────────────────────────────────
  //
  // Perpendicular bars cannot share an elevation, so this direction is either the lower layer
  // or the upper one. Which it is, is a bar-placement decision no clause makes and PR18-A does
  // not model — see `FootingMatDesign.layerOrder`. Both depths are computed and the design uses
  // the SHALLOWER (upper-layer) one for both directions: that is the conservative envelope, and
  // it is stated rather than left to be inferred.
  const otherDiameterMm = geo.axis === 'X'
    ? input.preferences.bottomMatDiameterYmm
    : input.preferences.bottomMatDiameterXmm;
  const dIfLowerLayer = footingFlexuralDepth(thickness, cover, diameterMm, 0);
  const dIfUpperLayer = footingFlexuralDepth(thickness, cover, diameterMm, otherDiameterMm);
  const d = dIfUpperLayer;

  steps.push(
    `Dirección ${geo.axis}: barras paralelas a ${geo.barsParallelTo}, repartidas en ` +
    `${W.toFixed(2)} m sobre una luz de ${S.toFixed(2)} m.`,
    `Columna a ${columnOffset.toFixed(3)} m del centroide: voladizos ` +
    `${(S / 2 + columnOffset - geo.columnDimension / 2).toFixed(3)} y ` +
    `${(S / 2 - columnOffset - geo.columnDimension / 2).toFixed(3)} m. ` +
    `Gobierna el lado ${face.governing?.side ?? '—'} con ${cantilever.toFixed(3)} m ` +
    '(13.2.7.1).',
    `Presión factorizada ${qFactored.toFixed(1)} kPa; resultante a ` +
    `${(face.governing?.resultantOffset ?? 0).toFixed(3)} m del centroide ` +
    `(excentricidad de momento ${momentEcc.toFixed(3)} m, envolvente de ambos ` +
    `signos): q_cara ${qFace.toFixed(1)}, q_borde ${qEdge.toFixed(1)} kPa.`,
    `Mu = ${W.toFixed(2)} × ${cantilever.toFixed(3)}² × (2×${qFace.toFixed(1)} + ` +
    `${qEdge.toFixed(1)})/6 = ${Mu.toFixed(1)} kN·m (13.2.6.6).`,
    `Altura útil: capa inferior daría ${dIfLowerLayer.toFixed(4)} m, capa superior ` +
    `${dIfUpperLayer.toFixed(4)} m (Ø${otherDiameterMm} debajo). Se dimensiona con ` +
    `${d.toFixed(4)} m — la envolvente conservadora.`);

  // ── Contact validity ─────────────────────────────────────────
  //
  // Beyond the kern the base lifts and the linear distribution stops being valid. Designing
  // through it would reinforce for a pressure diagram the soil is not delivering, and the
  // linear q under-states the real peak — the wrong direction to be wrong in. Same refusal
  // `checkBearing` and `checkFooting` already make, restated here so this module is safe to
  // call on its own.
  const notEvaluated = (m: EngineMessage): FootingDirectionDesign => ({
    axis: geo.axis, barsParallelTo: geo.barsParallelTo, distributionWidth: W,
    governingSide: face.governing?.side ?? null,
    cantilever, qFace, qEdge, Mu, diameterMm,
    d, dIfLowerLayer, dIfUpperLayer, layerRole: 'ENVELOPE_UPPER_LAYER',
    asFlexural: 0, asMinimum: 0, asGoverning: 0,
    governedBy: 'MINIMUM', governingClause: R_AS_MIN.clause,
    spacing: {
      generalMax: 0, crackControlMax: 0, governingMax: 0, governingMaxClause: R_MAX_SPACING.clause,
      minClear: 0, clearCoverToTensionFace: cover, refs: [],
    },
    distribution: 'UNIFORM_FULL_WIDTH', beta: null, gammaS: null,
    regions: [], asProvided: 0, barCount: 0,
    meetsMinimumDepth: d >= MIN_BOTTOM_MAT_DEPTH_M,
    developmentLength: null,
    status: 'NOT_EVALUATED', failures: [m], advisories: [], steps, refs,
  });

  // The envelope refuses if EITHER moment orientation lifts the base. The sign of the applied
  // moment is not usable here, so a footing that lifts under one of the two possible diagrams
  // is not designed under the other: that would be choosing the favourable sign by omission.
  if (face.anyOrientationLifts || face.governing === null) {
    return notEvaluated(msg('footing.mat.upliftNotEvaluated', {
      axis: geo.axis,
      e: +Math.abs(face.worstResultantOffset).toFixed(3),
      limit: +face.kernLimit.toFixed(3),
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
  //
  // `stirrupDia` carries the OTHER direction's mat. `checkFlexure` computes its own depth as
  // `h − cover − stirrupDia/1000 − d_b/2000`, and in a footing the steel sitting between the
  // cover and this bar is the perpendicular mat, playing exactly the role a stirrup plays in a
  // beam. Passing it makes the depth `checkFlexure` DESIGNS at identical to `d` above.
  //
  // Getting this wrong is not cosmetic and it is not hypothetical: an earlier revision of this
  // module reported the upper-layer `d` while leaving `stirrupDia: 0`, so the reported depth and
  // the designed depth differed by a bar diameter and the steel was under-computed. The φMn
  // closure in `footing-flexure.test.ts` is what caught it — a test that had recomputed the
  // module's own quadratic would have agreed with the mistake.
  const flex = checkFlexure(
    { fc: input.fc, fy: input.fy, cover, b: W, h: thickness, stirrupDia: otherDiameterMm },
    Mu, 0, { barDiameterMm: diameterMm },
  );
  // The two must agree by construction. If a future edit to either expression breaks that, this
  // throws in development instead of silently designing at a depth nobody reported.
  if (Math.abs(flex.d - d) > 1e-9) {
    throw new Error(
      `footing mat: designed depth ${flex.d} disagrees with reported depth ${d}`);
  }
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
  /**
   * `c_c` for §24.3.2 is the CLEAR COVER, and it is order-independent.
   *
   * The enacted clause defines it as "la menor distancia desde la SUPERFICIE de la armadura
   * conformada […] a la cara traccionada", and C 24.3.2 narrows what it applies to: "solamente
   * la armadura de tracción más cercana a la cara traccionada necesita ser considerada para
   * seleccionar el valor de cc". §7.7.2.2 routes the same way — "la armadura adherente más
   * cercana a la cara en tracción".
   *
   * So the clause targets the LOWER layer, whose bar surface sits exactly one clear cover from
   * the tension face. Whichever of the two directions ends up lower, that number is the same
   * `cover`, which is why this needs no layer order.
   *
   * The first version used `cover + d_b,other` here — the upper layer's distance. That is not
   * the cc §24.3.2 defines for the bar it limits, and it happened to be MORE restrictive
   * (215 mm against 255 mm on the reference footing), so the error was conservative rather
   * than unsafe. It was still the wrong number attributed to the clause.
   *
   * The resulting limit is applied to BOTH directions. The lower layer must satisfy it and this
   * stage does not know which direction that is; imposing it on the upper layer as well is an
   * extra requirement the clause does not make of it, in the safe direction.
   */
  const clearCoverToTensionFace = cover;
  const crack = crackControlMaxSpacing(input.edition, {
    fy: input.fy, clearCoverToTensionFace,
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
    clearCoverToTensionFace,
    refs: [R_MAX_SPACING, R_CRACK_ROUTE, ...crack.refs, R_MIN_SPACING, ...clear.refs],
  };
  refs.push(...spacing.refs);
  steps.push(
    `Separación máxima: 7.7.2.3 → menor entre 3h = ${(3 * thickness * 1000).toFixed(0)} mm y ` +
    `300 mm = ${(generalMax * 1000).toFixed(0)} mm; 24.3.2 con cc = recubrimiento libre ` +
    `${(clearCoverToTensionFace * 1000).toFixed(0)} mm (capa más cercana a la cara ` +
    `traccionada) y fs = ${crack.fs.toFixed(0)} MPa → ` +
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
    /**
     * The region gets what the CODE allocates to it, and nothing added on top.
     *
     * The first version took `max(share, 0,0018·A_g,region)` and reported the floor as §7.6.1.
     * That floor is not in the enacted text. §7.6.1 states one requirement — "debe colocarse un
     * área mínima de armadura a flexión, As,min, de 0,0018 Ag" — on the reinforcement of the
     * direction, and §13.3.3.3 then prescribes how "la armadura total" is distributed, with
     * no regional minimum anywhere in either clause or in C 13.3.3.3. Applying 0,0018 A_g again
     * per region is a Stabileo conservative preference, and presenting it as the code's
     * requirement is exactly the kind of claim this module exists not to make.
     *
     * So AUTO_CODE_COMPLIANT follows the code: total minimum, then the γs distribution. The
     * policy value is still COMPUTED and reported, as an advisory identified as policy, because
     * a detailer may well want it — but it does not silently become the delivered design.
     */
    const asRequired = share;
    const policyRegionalMinimum = FOOTING_AS_MIN_RATIO * width * thickness;
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
    // Reported against what the layout actually PROVIDES, not against the requirement: the
    // integer bar count routinely clears a floor the share alone would not, and an advisory
    // about steel that is already there would be noise.
    if (laid.asProvided < policyRegionalMinimum) {
      advisories.push(msg('footing.mat.regionBelowPolicyMinimum', {
        axis: geo.axis, region: kind,
        provided: +(laid.asProvided * 1e4).toFixed(2),
        policy: +(policyRegionalMinimum * 1e4).toFixed(2),
      }));
    }
    regions.push({
      kind, layoutModel: model, width, centreOffset, touchesEdge,
      distributionShare: share,
      asRequired, policyRegionalMinimum,
      asProvided: laid.asProvided, barCount: laid.barCount,
      spacingCentre: laid.spacingCentre, spacingClear: laid.spacingClear,
      governedBy: shareGovernedBy,
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
    const columnOffset = columnOffsetFromCentroid(geo.distributionEccentricity);
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
    governingSide: face.governing.side,
    cantilever, qFace, qEdge, Mu, diameterMm,
    d, dIfLowerLayer, dIfUpperLayer, layerRole: 'ENVELOPE_UPPER_LAYER',
    asFlexural, asMinimum, asGoverning, governedBy, governingClause,
    spacing, distribution, beta, gammaS, regions, asProvided, barCount,
    meetsMinimumDepth,
    developmentLength: development,
    // A direction with no region is a direction with no layout — `addRegion` records the
    // failure and returns, so an empty region list cannot read as DESIGNED.
    status: failures.length > 0 || regions.length === 0 ? 'DESIGN_FAILED' : 'DESIGNED',
    failures, advisories, steps, refs,
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
    spanEccentricity: input.eccentricityB,
    distributionEccentricity: input.eccentricityL,
  }, dX);

  const y = designDirection(input, {
    axis: 'Y', barsParallelTo: 'L',
    spanDimension: input.L, columnDimension: input.columnH,
    distributionWidth: input.B,
    factoredMoment: input.factoredMomentL,
    spanEccentricity: input.eccentricityL,
    distributionEccentricity: input.eccentricityB,
  }, dY);

  // The averaged two-layer depth the punching and one-way-shear checks keep using — the legacy
  // convention, `h − cover − d_b`, unchanged, with `d_b` the mean of the two selected diameters
  // so a project on the 16/16 default gets the previous number to the bit. It is deliberately
  // NOT recomputed as the exact mean of the two layer depths: that expression depends on which
  // direction is lower, and PR18-A does not establish it. Stated beside the two flexural depths
  // so all three are readable together instead of one standing in for the others.
  const punchingD = Math.max(0, input.thickness - input.cover - (dX + dY) / 2000);

  const assumptions: EngineMessage[] = [
    msg('footing.assumption.flexuralDepths', {
      dx: +x.d.toFixed(4), dy: +y.d.toFixed(4), punching: +punchingD.toFixed(4),
      bx: dX, by: dY,
    }),
    // The layer envelope, stated for every footing rather than only when the diameters differ:
    // the two mats are stacked whatever their diameters are, and the depth being conservative
    // is a property of the design, not of an unusual input.
    msg('footing.assumption.layerEnvelope', {
      lowx: +x.dIfLowerLayer.toFixed(4), upx: +x.dIfUpperLayer.toFixed(4),
      lowy: +y.dIfLowerLayer.toFixed(4), upy: +y.dIfUpperLayer.toFixed(4),
      cc: +(input.cover * 1000).toFixed(0),
    }),
  ];
  // The applied moment's sign is not usable on a footing-local axis, so both orientations are
  // enveloped. Named because it can make a footing carry a diagram the real sign would not
  // produce — conservative, and not free.
  if (Math.abs(input.factoredMomentB) > 1e-9 || Math.abs(input.factoredMomentL) > 1e-9) {
    assumptions.push(msg('footing.assumption.momentOrientationEnvelope', {
      mb: +input.factoredMomentB.toFixed(1), ml: +input.factoredMomentL.toFixed(1),
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
    // PR18-A designs the mat and models none of it. Four types with one inhabitant each, so no
    // edit to this function can quietly promote any of them: the geometry is not modelled, the
    // top steel is not evaluated, the layer order is not established, and the anchorage is not
    // geometrically verified. DESIGNED above means the flexural schedule, and only that.
    geometry: 'REQUIRED_NOT_MODELED',
    topReinforcement: 'NOT_EVALUATED',
    layerOrder: 'NOT_ESTABLISHED',
    anchorage: 'NOT_GEOMETRICALLY_VERIFIED',
    assumptions,
    failures: [...x.failures, ...y.failures],
    advisories: [...x.advisories, ...y.advisories],
    refs: distinctRefs([...x.refs, ...y.refs]),
  };
}
