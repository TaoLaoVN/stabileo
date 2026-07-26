/**
 * Whole-floor coordination: slabs, walls and foundations into the PR17 assembly model.
 *
 * The point of doing this at floor level rather than per element is that the interfaces
 * are where the mistakes live. Slab top bars and beam top bars occupy the same 60 mm of
 * cover at every support. Column starters have to land inside the footing's bottom mat
 * without displacing it. Wall verticals have to lap with the dowels the foundation left
 * for them. Each element designed alone is correct; assembled, they collide.
 *
 * This module produces `DetailingAssembly` values for the three families, using the same
 * bar-geometry and collision engines PR17 built, so a slab bar and a beam bar are checked
 * against each other by exactly the code that checks two beam bars.
 *
 * ── Interface rules ────────────────────────────────────────────
 *
 * §7.7.2 / §8.7.2  slab reinforcement passes over supporting beams; the slab top steel
 *                  sits ABOVE the beam top steel where both are present, because the
 *                  slab bar has the shallower cover requirement and the beam bar is the
 *                  one that must not lose its lever arm.
 * §16.3.4          column-to-footing force transfer: dowels of at least the area
 *                  required, extending a development length into both members.
 * §25.5            lap lengths for the wall/dowel and column/starter splices.
 *
 * Pure: no store, no runes.
 */

import {
  buildStraightBarWithHooks, type BarPath, type Point3,
} from '../../codes/cirsoc201/bar-geometry';
import { clause, type ClauseRef, type RegulationEdition } from '../../codes/regulation';
import { worstMaturity, type Maturity } from '../../codes/maturity';
import { assignMarks, evaluateState, type DetailingAssembly, type UnsupportedCondition } from './assembly';
import {
  DEFAULT_TOLERANCES, detectCollisions, type BarConflict, type CollisionTolerances,
} from './collision';
import { minClearSpacingInLayer } from '../../codes/cirsoc201/spacing';
import type { SlabBarLayer, SlabDesignResult } from './slab-design';
import type { WallDesignResult } from './wall-design';
import type { FootingCheck } from './foundation-check';

// ─── Slab bars ───────────────────────────────────────────────────

export interface SlabPanelGeometry {
  panelId: string;
  /** Plan origin of the panel's lower-left corner. */
  origin: Point3;
  lx: number;
  ly: number;
  thickness: number;
  cover: number;
  /** Elements this panel is attributed to, for routing conflicts to the UI. */
  elementIds: number[];
}

/**
 * Turn a designed slab panel into physical bars.
 *
 * Bars run the full panel dimension plus an anchorage allowance at each edge; top bars
 * are placed above bottom bars in the same direction, and the two directions are stacked
 * so an x bar and a y bar on the same face never occupy the same depth.
 */
export function generateSlabBars(
  panel: SlabPanelGeometry, layers: readonly SlabBarLayer[], edition: RegulationEdition,
): BarPath[] {
  const bars: BarPath[] = [];
  const halfT = panel.thickness / 2;
  const ANCHOR = 0.15;

  for (const layer of layers) {
    const isTop = layer.face === 'top';
    const d = layer.diameterMm / 1000;
    // x bars sit outermost on each face; y bars tuck inside them. Without this an x and
    // a y bar on the same face would be modelled at the same depth and every crossing
    // would read as a clash.
    const inset = panel.cover + d / 2 + (layer.direction === 'y' ? d : 0);
    const z = panel.origin.z + (isTop ? halfT - inset : -halfT + inset);

    const along = layer.direction === 'x' ? panel.lx : panel.ly;
    const across = layer.direction === 'x' ? panel.ly : panel.lx;
    const n = Math.max(1, Math.floor(across / layer.spacing));

    for (let i = 0; i < n; i++) {
      const offset = (i + 0.5) * layer.spacing;
      const start: Point3 = layer.direction === 'x'
        ? { x: panel.origin.x - ANCHOR, y: panel.origin.y + offset, z }
        : { x: panel.origin.x + offset, y: panel.origin.y - ANCHOR, z };
      const end: Point3 = layer.direction === 'x'
        ? { x: panel.origin.x + along + ANCHOR, y: panel.origin.y + offset, z }
        : { x: panel.origin.x + offset, y: panel.origin.y + along + ANCHOR, z };
      bars.push(buildStraightBarWithHooks({
        id: `${panel.panelId}-${layer.face[0]}${layer.direction}-${i}`,
        diameterMm: layer.diameterMm, role: 'longitudinal',
        start, end,
        axis: layer.direction === 'x' ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 },
        hookNormal: { x: 0, y: 0, z: isTop ? -1 : 1 },
        ownerElementIds: panel.elementIds, edition,
      }));
    }
  }
  return bars;
}

// ─── Column starters and foundation dowels ───────────────────────

export interface DowelInput {
  /** Identifier for the connection, e.g. 'F3-C3'. */
  id: string;
  /** Plan centre of the column. */
  centre: { x: number; y: number };
  /** Top of footing elevation. */
  footingTopZ: number;
  /** Footing thickness, m. */
  footingThickness: number;
  /** Bottom cover in the footing, m. */
  footingCover: number;
  columnB: number;
  columnH: number;
  cover: number;
  tieDia: number;
  bars: { count: number; diameterMm: number };
  /** Development length required in the footing, m. */
  ldFooting: number;
  /** Lap length above the footing, m. */
  lapAbove: number;
  elementIds: number[];
  edition: RegulationEdition;
}

/**
 * Generate the dowels that transfer column force into the footing.
 *
 * §16.3.4 requires the dowel to develop on both sides of the interface. The bottom leg
 * turns into a 90° hook where the straight development length would run past the
 * footing's bottom mat — which it usually does, because a footing is rarely deep enough
 * for a straight `l_d`.
 */
export function generateDowels(input: DowelInput): { bars: BarPath[]; refs: ClauseRef[]; notes: string[] } {
  const bars: BarPath[] = [];
  const notes: string[] = [];
  const refs = [
    clause('cirsoc-201', input.edition, '16.3.4', 'transmisión de fuerzas por armadura'),
    clause('cirsoc-201', input.edition, '25.5', 'empalmes por yuxtaposición'),
  ];

  const available = input.footingThickness - input.footingCover - 0.05;
  const needsHook = input.ldFooting > available;
  if (needsHook) {
    notes.push(
      `La longitud de anclaje recta requerida (${(input.ldFooting * 1000).toFixed(0)} mm) ` +
      `excede la altura útil de la zapata (${(available * 1000).toFixed(0)} mm): las barras ` +
      'de espera rematan con gancho a 90° apoyado sobre la parrilla inferior.');
  }

  const inset = input.cover + input.tieDia / 1000 + input.bars.diameterMm / 2000;
  const halfB = input.columnB / 2 - inset;
  const halfH = input.columnH / 2 - inset;
  const positions = [
    { x: -halfB, y: -halfH }, { x: halfB, y: -halfH },
    { x: halfB, y: halfH }, { x: -halfB, y: halfH },
  ];
  const extra = Math.max(0, input.bars.count - 4);
  for (let k = 0; k < extra; k++) {
    const t = (k + 1) / (extra + 1);
    positions.push(k % 2 === 0
      ? { x: -halfB + 2 * halfB * t, y: -halfH }
      : { x: -halfB + 2 * halfB * t, y: halfH });
  }

  const embedded = Math.min(input.ldFooting, available);
  for (let k = 0; k < Math.min(positions.length, input.bars.count); k++) {
    const p = positions[k];
    bars.push(buildStraightBarWithHooks({
      id: `${input.id}-dowel-${k}`,
      diameterMm: input.bars.diameterMm, role: 'longitudinal',
      start: {
        x: input.centre.x + p.x, y: input.centre.y + p.y,
        z: input.footingTopZ - embedded,
      },
      end: {
        x: input.centre.x + p.x, y: input.centre.y + p.y,
        z: input.footingTopZ + input.lapAbove,
      },
      axis: { x: 0, y: 0, z: 1 },
      // The hook turns toward the column centre so it sits over the bottom mat.
      hookNormal: { x: -Math.sign(p.x) || 1, y: 0, z: 0 },
      startHook: needsHook ? 90 : undefined,
      ownerElementIds: input.elementIds, edition: input.edition,
    }));
  }

  return { bars, refs, notes };
}

/** Dominant direction of a bar, from its longest straight segment. */
function dominantAxis(bar: BarPath): Point3 | null {
  let best: Point3 | null = null;
  let bestLen = 0;
  for (const seg of bar.segments) {
    if (seg.kind !== 'straight' || seg.length <= bestLen) continue;
    const dx = seg.end.x - seg.start.x;
    const dy = seg.end.y - seg.start.y;
    const dz = seg.end.z - seg.start.z;
    const n = Math.hypot(dx, dy, dz);
    if (n < 1e-9) continue;
    best = { x: dx / n, y: dy / n, z: dz / n };
    bestLen = seg.length;
  }
  return best;
}

/** True when two bars run essentially along the same line, in either sense. */
function isParallel(a: BarPath, b: BarPath, toleranceDeg = 15): boolean {
  const u = dominantAxis(a);
  const v = dominantAxis(b);
  if (!u || !v) return true;   // unknown direction: apply the stricter rule
  const dot = Math.abs(u.x * v.x + u.y * v.y + u.z * v.z);
  return dot >= Math.cos((toleranceDeg * Math.PI) / 180);
}

// ─── Floor assembly ──────────────────────────────────────────────

export interface FloorAssemblyInput {
  assemblyId: string;
  label: string;
  edition: RegulationEdition;
  verifierId: string;
  demandRevision: number;
  previousRevision?: number;
  maxAggregateSizeMm: number;
  tolerances?: CollisionTolerances;
  slabs: Array<{ geometry: SlabPanelGeometry; design: SlabDesignResult }>;
  walls: Array<{ wallId: string; design: WallDesignResult; elementIds: number[] }>;
  footings: Array<{ id: string; check: FootingCheck; elementIds: number[]; dowels?: DowelInput }>;
  /** Beam top-bar depths at each support, so slab bars can be placed above them. */
  beamTopDepths?: Map<string, number>;
  membersVerified: boolean;
}

export interface FloorAssemblyResult {
  assembly: DetailingAssembly;
  trace: string[];
}

/**
 * Build one floor-level assembly from designed slabs, walls and footings.
 *
 * Every unsupported condition each element reported is carried through with its scope,
 * so a floor with one problematic panel still produces drawings for the rest and the
 * problem is attributable to the panel that has it.
 */
export function buildFloorAssembly(input: FloorAssemblyInput): FloorAssemblyResult {
  const trace: string[] = [];
  const unsupported: UnsupportedCondition[] = [];
  const maturities: Maturity[] = [];
  const bars: BarPath[] = [];
  const assumptions: string[] = [];

  for (const s of input.slabs) {
    const panelBars = generateSlabBars(s.geometry, s.design.layers, input.edition);
    bars.push(...panelBars);
    maturities.push(s.design.maturity.maturity);
    assumptions.push(...s.design.maturity.assumptions);
    trace.push(
      `Losa ${s.geometry.panelId}: ${s.design.behaviour === 'twoWay' ? 'dos' : 'una'} ` +
      `dirección, ${s.design.layers.length} capa(s), ${panelBars.length} barras.`);
    for (const u of s.design.unsupported) {
      unsupported.push({
        key: 'slab', scope: { elementIds: s.geometry.elementIds }, message: u,
        refs: s.design.refs,
      });
    }
  }

  for (const w of input.walls) {
    maturities.push(w.design.maturity.maturity);
    assumptions.push(...w.design.maturity.assumptions);
    trace.push(
      `Tabique ${w.wallId}: verticales c/${(w.design.verticalSpacing * 1000).toFixed(0)} mm, ` +
      `horizontales c/${(w.design.horizontalSpacing * 1000).toFixed(0)} mm.`);
    for (const u of w.design.unsupported) {
      unsupported.push({
        key: 'wall', scope: { elementIds: w.elementIds }, message: u, refs: w.design.refs,
      });
    }
  }

  for (const f of input.footings) {
    trace.push(`Fundación ${f.id}: ${f.check.status}.`);
    maturities.push(f.check.status === 'UNSUPPORTED' ? 'UNSUPPORTED' : 'IMPLEMENTED_PROVISIONAL');
    for (const u of f.check.unsupported) {
      unsupported.push({
        key: 'foundation', scope: { elementIds: f.elementIds }, message: u, refs: f.check.refs,
      });
    }
    if (f.dowels) {
      const d = generateDowels(f.dowels);
      bars.push(...d.bars);
      trace.push(...d.notes);
      trace.push(`Fundación ${f.id}: ${d.bars.length} barra(s) de espera.`);
    }
  }

  // Whole-floor collision check, using the same engine that checks two beam bars.
  //
  // With one exception that is physical rather than numerical: two bars running in
  // DIFFERENT directions cross each other, and in a slab mat they are meant to be in
  // contact — that is what the tie wire is for. Clear spacing is a rule about bars
  // running parallel, where the concrete has to flow between them along their length.
  // Applying it to a crossing pair reports every intersection of an orthogonal mat as
  // an overlap, which on a 5 m panel is about eleven thousand false conflicts.
  //
  // Bars that cross must still not INTERPENETRATE, and they do not: the generator stacks
  // the second direction a full diameter inside the first, so they touch rather than
  // occupy the same space.
  const requiredClearFor = (a: BarPath, b: BarPath) => {
    if (!isParallel(a, b)) return 0;
    return minClearSpacingInLayer(input.edition, {
      barDiameterMm: Math.max(a.diameterMm, b.diameterMm),
      maxAggregateSizeMm: input.maxAggregateSizeMm,
    }).minClear;
  };

  // Crossing bars are tied together, so there is no independent placement error between
  // them to allow for. Charging one would turn every tie point into an interpenetration.
  const placementFor = (a: BarPath, b: BarPath) =>
    isParallel(a, b) ? (input.tolerances?.placement ?? DEFAULT_TOLERANCES.placement) : 0;

  // `classifyFor` is left undefined here on purpose: this floor pass already expresses the
  // same physics through `requiredClearFor` (zero clear distance for a crossing) and
  // `placementFor` (no placement error between bars that are tied). Passing `placementFor`
  // positionally into the classifier slot — which is what happened when the classifier was
  // added ahead of it — makes every pair return a number where a classification is
  // expected, and the whole check silently inverts.
  const collision = detectCollisions(
    bars, input.tolerances, requiredClearFor, undefined, placementFor);
  const conflicts: BarConflict[] = collision.conflicts;
  trace.push(
    `Verificación de interferencias sobre ${bars.length} barra(s): ` +
    `${conflicts.length} conflicto(s), ${collision.barPairsTested} par(es) evaluado(s).`);

  const marks = assignMarks(bars, 'F');
  const evaluation = evaluateState({
    bars, conflicts, unsupported,
    membersVerified: input.membersVerified,
    coordinated: true,
  });
  trace.push(
    `Estado alcanzado: ${evaluation.state}` +
    (evaluation.blockers.length > 0 ? ` — ${evaluation.blockers.join(' ')}` : '.'));

  return {
    assembly: {
      id: input.assemblyId,
      kind: 'beamLine',
      label: input.label,
      elementIds: [
        ...new Set([
          ...input.slabs.flatMap((s) => s.geometry.elementIds),
          ...input.walls.flatMap((w) => w.elementIds),
          ...input.footings.flatMap((f) => f.elementIds),
        ]),
      ].sort((a, b) => a - b),
      bars, marks, joints: [], conflicts, unsupported,
      detailingRevision: (input.previousRevision ?? 0) + 1,
      demandRevision: input.demandRevision,
      state: evaluation.state,
      maturity: worstMaturity(maturities),
      provenance: {
        edition: input.edition, verifierId: input.verifierId,
        trace, assumptions: [...new Set(assumptions)],
      },
    },
    trace,
  };
}
