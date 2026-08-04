/**
 * Isolated spread footings — productizing a solver capability that was never reachable.
 *
 * ── What was already there ─────────────────────────────────────
 *
 * The WASM engine exports `check_spread_footings`, and `wasm-solver.ts` wraps it as
 * `checkSpreadFootings`. The only caller in the entire codebase is
 * `ProVerificationTab.svelte`, which is dead code — the PRO panel routes the design tab
 * to `ProRcWorkflowTab`, so that component never mounts. A real solver capability has
 * been sitting unreachable.
 *
 * ── What this adds ─────────────────────────────────────────────
 *
 * An app-side footing check that a user can actually reach, assembled from outputs the
 * solver already produces:
 *
 *   * bearing pressure and eccentricity, from the support reaction (`reactions`), which
 *     is exactly the column load delivered to the footing;
 *   * two-way (punching) shear, from the punching engine, whose demand is the same
 *     support reaction less the soil pressure inside the critical perimeter — a genuine
 *     equilibrium free body, not an approximation;
 *   * one-way (beam) shear at d from the column face;
 *   * flexure at the column face.
 *
 * ── What is deliberately NOT here ──────────────────────────────
 *
 * Combined and strip footings, mats and rafts, piles and pile caps, settlement, and
 * soil-structure interaction beyond a linear bearing distribution. Each returns an
 * explicit unsupported outcome. A footing module that quietly treats a two-column
 * combined base as two isolated ones would be producing a wrong answer that looks right.
 *
 * Pure: no store, no runes. Forces kN, moments kN·m, lengths m, pressures kPa.
 */

import { clause, type ClauseRef } from '../../codes/regulation';
import {
  PHI_SHEAR, checkPunchingShear, sizeEffectFactor, sqrtFcCapped,
  type ColumnPosition, type PunchingCheck,
} from './punching-shear';

const R_FOUND = clause('cirsoc-201', '2025', '13.2', 'generalidades de fundaciones');
const R_ONEWAY = clause('cirsoc-201', '2025', '22.5', 'resistencia a corte en una dirección');
const R_FLEX = clause('cirsoc-201', '2025', '13.2.7', 'sección crítica para momento en zapatas');
const R_SOIL = clause('cirsoc-201', '2025', '13.3.1', 'zapatas superficiales');

export type FootingKind = 'isolated' | 'combined' | 'strip' | 'mat' | 'pileCap';

export interface FootingInput {
  kind: FootingKind;
  /** Plan dimensions, m. */
  B: number;
  L: number;
  /** Overall thickness, m. */
  thickness: number;
  /** Effective depth, m. */
  d: number;
  columnB: number;
  columnH: number;
  fc: number;
  /** Allowable bearing pressure, kPa. Service-level. */
  allowableBearing: number;
  /** Axial load from the column, kN (service level for bearing). */
  serviceAxial: number;
  /** Factored axial load, kN, for strength checks. */
  factoredAxial: number;
  /** Service moments about the two plan axes, kN·m. */
  serviceMomentB?: number;
  serviceMomentL?: number;
  /**
   * FACTORED moments about the two plan axes, kN·m, from the governing strength
   * combination. Used for the one-way-shear strip integral and the column-face
   * flexure demand. The punching deduction is unaffected for a centred column:
   * the bilinear pressure averages to Nu/A over the centred enclosed area.
   */
  factoredMomentB?: number;
  factoredMomentL?: number;
  position?: ColumnPosition;
}

export type CheckStatus = 'OK' | 'FAIL' | 'UNSUPPORTED';

export interface BearingResult {
  status: CheckStatus;
  /** Maximum bearing pressure, kPa. */
  qMax: number;
  qMin: number;
  /** Eccentricity along B and L, m. */
  eB: number;
  eL: number;
  /** True when the resultant falls outside the middle third and the base partially lifts. */
  uplift: boolean;
  utilization: number;
  memo: string[];
  refs: ClauseRef[];
  unsupportedReason?: string;
}

/**
 * Linear bearing-pressure distribution with biaxial eccentricity.
 *
 * When the resultant leaves the kern the base lifts off and the linear distribution is
 * no longer valid. The correct treatment is a reduced effective bearing area, and this
 * module does NOT implement it — it reports UNSUPPORTED. Reporting a linear q_max for a
 * partially uplifted base under-states the real peak pressure, which is the wrong
 * direction to be wrong in.
 */
export function checkBearing(f: FootingInput): BearingResult {
  const N = f.serviceAxial;
  const A = f.B * f.L;
  const memo: string[] = [];
  const refs = [R_SOIL];

  if (!(A > 0) || !(N > 0)) {
    return {
      status: 'UNSUPPORTED', qMax: 0, qMin: 0, eB: 0, eL: 0, uplift: false, utilization: 0,
      memo, refs,
      unsupportedReason: 'Dimensiones o carga de servicio no válidas para la verificación de tensiones.',
    };
  }

  const eB = (f.serviceMomentB ?? 0) / N;
  const eL = (f.serviceMomentL ?? 0) / N;
  const outsideKern = Math.abs(eB) > f.B / 6 || Math.abs(eL) > f.L / 6;

  const q0 = N / A;
  const qMax = q0 * (1 + 6 * Math.abs(eB) / f.B + 6 * Math.abs(eL) / f.L);
  const qMin = q0 * (1 - 6 * Math.abs(eB) / f.B - 6 * Math.abs(eL) / f.L);

  memo.push(
    `N = ${N.toFixed(1)} kN sobre ${f.B.toFixed(2)} × ${f.L.toFixed(2)} m; ` +
    `eB = ${eB.toFixed(3)} m, eL = ${eL.toFixed(3)} m.`,
    `qmax = ${qMax.toFixed(1)} kPa, qmin = ${qMin.toFixed(1)} kPa contra ` +
    `qadm = ${f.allowableBearing.toFixed(1)} kPa.`);

  if (outsideKern) {
    return {
      status: 'UNSUPPORTED', qMax, qMin, eB, eL, uplift: true,
      utilization: qMax / f.allowableBearing,
      memo: [...memo,
        'La resultante cae fuera del núcleo central: la base se despega parcialmente y la ' +
        'distribución lineal deja de ser válida. El área efectiva reducida no está ' +
        'implementada; informar qmax lineal subestimaría la presión real. NO VERIFICADO.'],
      refs,
      unsupportedReason: 'Resultante fuera del núcleo central (despegue parcial de la base).',
    };
  }

  return {
    status: qMax <= f.allowableBearing ? 'OK' : 'FAIL',
    qMax, qMin, eB, eL, uplift: false,
    utilization: qMax / f.allowableBearing,
    memo, refs,
  };
}

export interface OneWayShearResult {
  status: CheckStatus;
  /** Factored shear at the critical section, kN. */
  Vu: number;
  /** φV_c, kN. */
  phiVc: number;
  utilization: number;
  memo: string[];
  refs: ClauseRef[];
}

/**
 * One-way shear at d from the column face, per §22.5.
 *
 * The critical strip is the part of the base beyond that section; the demand is the net
 * upward soil pressure acting on it.
 */
export function checkOneWayShear(f: FootingInput, qFactored: number): OneWayShearResult {
  // Cantilever measured from the column face, less d.
  const a = (f.B - f.columnB) / 2 - f.d;
  const memo: string[] = [];

  if (a <= 0) {
    return {
      status: 'OK', Vu: 0, phiVc: Infinity, utilization: 0,
      memo: ['La sección crítica a d de la cara cae fuera de la zapata: el corte en una ' +
             'dirección no gobierna.'],
      refs: [R_ONEWAY],
    };
  }

  // Factored moment makes the pressure trapezoidal: integrate the strip between the
  // critical section and the HEAVY edge exactly (linear pressure), instead of the
  // uniform Nu/A — which under-states the strip average on the loaded side. The
  // other axis's moment averages out over the strip's full width.
  const eB = Math.abs(f.factoredMomentB ?? 0) / Math.max(f.factoredAxial, 1e-12);
  const k = 6 * eB / f.B;
  const xSec = f.B - a;
  const qSec = qFactored * (1 + k * (2 * xSec / f.B - 1));
  const qEdge = qFactored * (1 + k);
  const Vu = (qSec + qEdge) / 2 * a * f.L;
  const lambdaS = sizeEffectFactor(f.d);
  // §22.5.5.1 row (c) for Av < Av,min (footings carry no shear reinforcement):
  // Vc = 0,66·λs·λ·(ρw)^⅓·√f'c·bw·d. ρw is floored at the minimum (0,0018) —
  // footing flexural steel is designed after this check, so the minimum is the
  // only honest value here, and it is the conservative floor. The previous
  // 0,17 form is row (a) — for members WITH minimum shear reinforcement — and
  // is ~2× the (c) value, NOT conservative as the old comment claimed.
  const RHO_W_MIN = 0.0018;
  const Vc = 0.66 * lambdaS * Math.cbrt(RHO_W_MIN) * sqrtFcCapped(f.fc) * f.L * f.d * 1000;
  const phiVc = PHI_SHEAR * Vc;

  memo.push(
    `Corte en una dirección a d de la cara: a = ${a.toFixed(3)} m, ` +
    (eB > 1e-9
      ? `presión trapezoidal por momento factorizado (eB = ${eB.toFixed(3)} m): ` +
        `Vu = (q_sección ${qSec.toFixed(1)} + q_borde ${qEdge.toFixed(1)}) / 2 × ${a.toFixed(3)} × ` +
        `${f.L.toFixed(2)} = ${Vu.toFixed(1)} kN.`
      : `Vu = ${qFactored.toFixed(1)} × ${a.toFixed(3)} × ${f.L.toFixed(2)} = ${Vu.toFixed(1)} kN.`),
    `φVc = 0,75 × ${(0.66 * Math.cbrt(RHO_W_MIN)).toFixed(4)} × ${lambdaS.toFixed(3)} × √${f.fc} × ${f.L.toFixed(2)} × ` +
    `${f.d.toFixed(3)} = ${phiVc.toFixed(1)} kN.`);

  return {
    status: Vu <= phiVc ? 'OK' : 'FAIL',
    Vu, phiVc, utilization: phiVc > 0 ? Vu / phiVc : Infinity,
    memo, refs: [R_ONEWAY],
  };
}

export interface FootingCheck {
  status: CheckStatus;
  bearing: BearingResult;
  oneWayShear: OneWayShearResult | null;
  punching: PunchingCheck | null;
  /** Factored moment at the column face, kN·m. */
  Mu: number;
  /** Worst utilization across every check that produced one. */
  worstUtilization: number;
  memo: string[];
  refs: ClauseRef[];
  unsupported: string[];
}

/**
 * Complete isolated-footing check.
 *
 * `status` is UNSUPPORTED whenever ANY constituent check is unsupported. A footing
 * whose punching could not be verified is not a verified footing, and rolling that up
 * as OK because bearing and flexure passed is exactly the false-completeness failure
 * the capability model exists to prevent.
 */
export function checkFooting(f: FootingInput): FootingCheck {
  const unsupported: string[] = [];
  const memo: string[] = [];
  const refs: ClauseRef[] = [R_FOUND];

  if (f.kind !== 'isolated') {
    const label: Record<FootingKind, string> = {
      isolated: '', combined: 'Zapatas combinadas', strip: 'Zapatas corridas',
      mat: 'Plateas', pileCap: 'Cabezales de pilotes',
    };
    return {
      status: 'UNSUPPORTED',
      bearing: {
        status: 'UNSUPPORTED', qMax: 0, qMin: 0, eB: 0, eL: 0, uplift: false,
        utilization: 0, memo: [], refs: [],
      },
      oneWayShear: null, punching: null, Mu: 0, worstUtilization: 0,
      memo: [`${label[f.kind]} no están implementadas. Tratarlas como zapatas aisladas ` +
             'daría un resultado incorrecto con apariencia de correcto.'],
      refs,
      unsupported: [`${label[f.kind]} no implementadas.`],
    };
  }

  const bearing = checkBearing(f);
  memo.push(...bearing.memo);
  if (bearing.status === 'UNSUPPORTED' && bearing.unsupportedReason) {
    unsupported.push(bearing.unsupportedReason);
  }

  // Factored net upward pressure for strength checks. With a factored moment the
  // resultant leaves the kern when |e| > B/6 (or L/6): the base lifts and the linear
  // distribution under-states the peak — same refusal as the service bearing path.
  const A = f.B * f.L;
  const qFactored = A > 0 ? f.factoredAxial / A : 0;
  const fEB = Math.abs(f.factoredMomentB ?? 0) / Math.max(f.factoredAxial, 1e-12);
  const fEL = Math.abs(f.factoredMomentL ?? 0) / Math.max(f.factoredAxial, 1e-12);
  const factoredUplift = fEB > f.B / 6 || fEL > f.L / 6;
  if (factoredUplift) {
    unsupported.push(
      `Con la combinación de resistencia gobernante la resultante cae fuera del núcleo ` +
      `(eB = ${fEB.toFixed(3)} m, eL = ${fEL.toFixed(3)} m): la distribución lineal no vale ` +
      'y las verificaciones de resistencia no se emiten.');
  }

  const oneWayShear = factoredUplift ? null : checkOneWayShear(f, qFactored);
  if (oneWayShear) memo.push(...oneWayShear.memo);

  const punching = factoredUplift ? null : checkPunchingShear({
    fc: f.fc, columnB: f.columnB, columnH: f.columnH, d: f.d,
    position: f.position ?? 'interior',
    demand: {
      supportReaction: f.factoredAxial,
      // At a footing the soil pushes UP inside the critical perimeter, and that part of
      // the load never crosses the critical section. Same equilibrium argument as at a
      // slab-column joint, opposite sign convention. For a CENTRED column the bilinear
      // pressure from any factored moment averages to exactly Nu/A over the centred
      // enclosed area, so the uniform value is exact here even with moment.
      loadInsidePerimeter: qFactored,
    },
  });
  if (punching) {
    memo.push(...punching.memo);
    if (punching.status === 'UNSUPPORTED' && punching.unsupportedReason) {
      unsupported.push(punching.unsupportedReason);
    }
    refs.push(...punching.refs);
  }

  // Flexure at the column face, §13.2.7 — the cantilever integral with the trapezoidal
  // pressure (exact for a linear distribution: Mu = L·c²·(2·q_face + q_edge)/6).
  const cantilever = (f.B - f.columnB) / 2;
  let Mu = 0;
  if (!factoredUplift) {
    const xFace = f.B - cantilever;
    const kB = 6 * fEB / f.B;
    const qFace = qFactored * (1 + kB * (2 * xFace / f.B - 1));
    const qEdge = qFactored * (1 + kB);
    Mu = f.L * cantilever * cantilever * (2 * qFace + qEdge) / 6;
  }
  memo.push(
    `Momento en la cara de la columna (13.2.7): Mu = ${Mu.toFixed(1)} kN·m` +
    (fEB > 1e-9 ? ` (presión trapezoidal, eB = ${fEB.toFixed(3)} m). ` : ' (presión uniforme). ') +
    'La armadura de flexión se dimensiona con el verificador de secciones.');
  refs.push(R_FLEX, R_ONEWAY);

  const utils = [bearing.utilization, oneWayShear?.utilization, punching?.utilization]
    .filter((u): u is number => typeof u === 'number' && Number.isFinite(u) && u > 0);
  const worstUtilization = utils.length > 0 ? Math.max(...utils) : 0;

  const anyUnsupported = unsupported.length > 0;
  const anyFail = bearing.status === 'FAIL' || oneWayShear?.status === 'FAIL'
    || punching?.status === 'FAIL';

  return {
    status: anyUnsupported ? 'UNSUPPORTED' : anyFail ? 'FAIL' : 'OK',
    bearing, oneWayShear, punching, Mu, worstUtilization,
    memo, refs, unsupported,
  };
}
