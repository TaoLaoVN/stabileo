/**
 * The detailing pipeline: from verified members to a coordinated, constructible floor.
 *
 * This is the orchestrator that turns the individual engines into a workflow:
 *
 *   1. group members into beam lines and column stacks
 *   2. generate physical bars for each member from its envelope
 *   3. coordinate the choices along each line so neighbours agree
 *   4. coordinate the joints so perpendicular beams get distinct layers
 *   5. detect collisions across the whole assembly
 *   6. attempt a bounded repair on what collides
 *   7. assign marks, evaluate the earned state, and record what could not be resolved
 *
 * ── Repair, and its limits ─────────────────────────────────────
 *
 * Step 6 is a bounded ladder, not a solver: try the next-larger layer separation, then
 * the next-smaller bar of equivalent area, then give up. Each rung is re-verified. What
 * cannot be cleared is returned as an unresolved conflict attached to its joint — the
 * rest of the floor still produces drawings, because losing a whole floor's output to
 * one clash in one corner helps nobody.
 *
 * Pure: no store, no runes. The caller owns persistence.
 */

import type { BarPath } from '../../codes/cirsoc201/bar-geometry';
import { minClearSpacingFor } from '../../codes/cirsoc201/spacing';
import { worstMaturity, type Maturity } from '../../codes/maturity';
import type { ClauseRef, RegulationEdition } from '../../codes/regulation';
import {
  assignMarks, evaluateState, type DetailingAssembly, type JointRecord,
  type UnsupportedCondition,
} from './assembly';
import {
  DEFAULT_TOLERANCES, detectCollisions, type BarConflict, type CollisionTolerances,
} from './collision';
import { coordinateJoint, type IncidentBeamAtJoint, type JointCoordination } from './generate-column';

// ─── Inputs ──────────────────────────────────────────────────────

export interface MemberBars {
  elementId: number;
  bars: BarPath[];
  /** Unsupported conditions the generator reported for this member. */
  unsupported: string[];
  /** Maturity of the calculations behind this member's bars. */
  maturity: Maturity;
  /** Clauses applied. */
  refs: ClauseRef[];
  /** Generator trace. */
  trace: string[];
}

export interface JointInput {
  id: string;
  nodeId: number;
  beams: IncidentBeamAtJoint[];
  columnAbove: boolean;
  columnB: number;
  columnH: number;
  elementIds: number[];
  /** Maturity of the joint-shear result, when one was computed. */
  jointShearMaturity?: Maturity;
  jointShearKey?: string;
}

export interface FloorCoordinationInput {
  assemblyId: string;
  label: string;
  labelKey?: string;
  labelParams?: Record<string, string | number>;
  kind: DetailingAssembly['kind'];
  elementIds: number[];
  members: MemberBars[];
  joints: JointInput[];
  edition: RegulationEdition;
  verifierId: string;
  demandRevision: number;
  /** Previous revision, so regeneration increments rather than resets. */
  previousRevision?: number;
  cover: number;
  tieDia: number;
  maxAggregateSizeMm: number;
  /** True when every member passed its own code checks. */
  membersVerified: boolean;
  /** True when the line coordinator returned COORDINATED. */
  coordinated: boolean;
  /** Bars the user pinned; these survive regeneration untouched. */
  lockedBars?: BarPath[];
  tolerances?: CollisionTolerances;
  coordinationTrace?: string[];
  assumptions?: string[];
}

// ─── Repair ──────────────────────────────────────────────────────

export interface RepairAttempt {
  rung: string;
  cleared: number;
  remaining: number;
}

export interface RepairResult {
  bars: BarPath[];
  conflicts: BarConflict[];
  attempts: RepairAttempt[];
  trace: string[];
}

/**
 * Bounded repair ladder.
 *
 * Rung 1 — nudge non-locked bars in a clashing pair apart along the section's minor
 *          axis, by the shortfall plus a margin, and re-test.
 * Rung 2 — same, with a larger margin.
 * Give up — the remaining conflicts are returned honestly.
 *
 * A locked bar is never moved: the user pinned it, and silently relocating pinned work
 * is the fastest way to lose their trust. When both bars in a pair are locked the
 * conflict is unresolvable by definition and is reported as such.
 */
export function repairConflicts(
  bars: readonly BarPath[],
  requiredClearFor: (a: BarPath, b: BarPath) => number,
  tolerances: CollisionTolerances = DEFAULT_TOLERANCES,
): RepairResult {
  const attempts: RepairAttempt[] = [];
  const trace: string[] = [];
  let working = bars.map((b) => ({ ...b, segments: b.segments.map((s) => ({ ...s })) }));

  let result = detectCollisions(working, tolerances, requiredClearFor);
  const initial = result.conflicts.length;
  if (initial === 0) {
    return { bars: working, conflicts: [], attempts, trace: ['Sin conflictos.'] };
  }
  trace.push(`${initial} conflicto(s) detectado(s); se intenta la escalera de reparación.`);

  const byId = new Map(working.map((b) => [b.id, b]));

  for (const [rung, margin] of [['separación mínima', 0.002], ['separación ampliada', 0.006]] as const) {
    const before = result.conflicts.length;
    for (const c of result.conflicts) {
      const a = byId.get(c.barA);
      const b = byId.get(c.barB);
      if (!a || !b) continue;
      if (a.locked && b.locked) continue;
      // Move whichever is not locked; if neither is, move the second for determinism.
      const movable = a.locked ? b : b.locked ? a : b;
      const shift = c.shortfall + margin;
      // Push along y, the section's minor plan axis — the direction with the most room
      // in a rectangular cage.
      for (const seg of movable.segments) {
        seg.start = { ...seg.start, y: seg.start.y + shift };
        seg.end = { ...seg.end, y: seg.end.y + shift };
      }
    }
    working = [...byId.values()];
    result = detectCollisions(working, tolerances, requiredClearFor);
    attempts.push({ rung, cleared: before - result.conflicts.length, remaining: result.conflicts.length });
    trace.push(
      `Rung "${rung}": ${before - result.conflicts.length} resuelto(s), ` +
      `${result.conflicts.length} pendiente(s).`);
    if (result.conflicts.length === 0) break;
  }

  if (result.conflicts.length > 0) {
    trace.push(
      `${result.conflicts.length} conflicto(s) no resueltos tras la escalera acotada. Se ` +
      'informan como tales; el resto de la planta sigue produciendo documentación.');
  }

  return { bars: working, conflicts: result.conflicts, attempts, trace };
}

// ─── The pipeline ────────────────────────────────────────────────

export interface FloorCoordinationResult {
  assembly: DetailingAssembly;
  jointCoordination: JointCoordination[];
  repair: RepairResult;
  /** Everything the pipeline decided, in order. */
  trace: string[];
}

/**
 * Run the whole pipeline for one assembly.
 *
 * Never throws on a bad member: a member with no bars contributes an unsupported
 * condition and the rest of the assembly proceeds.
 */
export function coordinateFloor(input: FloorCoordinationInput): FloorCoordinationResult {
  const trace: string[] = [...(input.coordinationTrace ?? [])];
  const unsupported: UnsupportedCondition[] = [];
  const refs: ClauseRef[] = [];
  const assumptions = [...(input.assumptions ?? [])];

  // ── 1–2. Collect generated bars, keeping locked ones ──
  const locked = input.lockedBars ?? [];
  const lockedIds = new Set(locked.map((b) => b.id));
  const generated: BarPath[] = [];

  for (const m of input.members) {
    if (m.bars.length === 0) {
      unsupported.push({
        key: 'memberNoBars',
        scope: { elementIds: [m.elementId] },
        message: `El elemento ${m.elementId} no produjo barras físicas.`,
        refs: m.refs,
      });
    }
    for (const b of m.bars) {
      // A locked bar wins over its regenerated replacement, always.
      if (!lockedIds.has(b.id)) generated.push(b);
    }
    for (const u of m.unsupported) {
      unsupported.push({
        key: 'generation',
        scope: { elementIds: [m.elementId] },
        message: u,
        refs: m.refs,
      });
    }
    refs.push(...m.refs);
    trace.push(...m.trace);
  }

  const allBars = [...locked, ...generated];
  if (locked.length > 0) {
    trace.push(`${locked.length} barra(s) fijada(s) por el usuario se conservan sin modificar.`);
  }

  // ── 4. Joints ──
  const jointCoordination: JointCoordination[] = [];
  const jointRecords: JointRecord[] = [];
  const maturities: Maturity[] = input.members.map((m) => m.maturity);

  for (const j of input.joints) {
    const co = coordinateJoint({
      beams: j.beams, columnAbove: j.columnAbove,
      columnB: j.columnB, columnH: j.columnH,
      cover: input.cover, tieDia: input.tieDia, edition: input.edition,
    });
    jointCoordination.push(co);
    trace.push(...co.trace);
    refs.push(...co.refs);
    for (const u of co.unsupported) {
      unsupported.push({
        key: 'jointCoordination', scope: { jointIds: [j.id] }, message: u, refs: co.refs,
      });
    }
    if (j.jointShearMaturity) maturities.push(j.jointShearMaturity);

    jointRecords.push({
      id: j.id, nodeId: j.nodeId, elementIds: j.elementIds,
      kind: co.kind, beamCount: co.beamCount,
      beamLayers: co.layers.map((l) => ({ elementId: l.elementId, layer: l.layer })),
      jointShearKey: j.jointShearKey,
      maturity: j.jointShearMaturity ?? 'UNSUPPORTED',
      unresolved: [],
    });
  }

  // ── 5–6. Collisions and repair ──
  const requiredClearFor = (a: BarPath, b: BarPath) => minClearSpacingFor(
    input.edition,
    a.role === 'transverse' || b.role === 'transverse' ? 'beam' : 'column',
    {
      barDiameterMm: Math.max(a.diameterMm, b.diameterMm),
      maxAggregateSizeMm: input.maxAggregateSizeMm,
    },
  ).minClear;

  const repair = repairConflicts(allBars, requiredClearFor, input.tolerances);
  trace.push(...repair.trace);

  // Route unresolved conflicts to their joint where one matches, so the UI can navigate.
  const jointByElement = new Map<number, JointRecord>();
  for (const jr of jointRecords) for (const id of jr.elementIds) jointByElement.set(id, jr);
  for (const c of repair.conflicts) {
    const jr = c.elementIds.map((id) => jointByElement.get(id)).find(Boolean);
    if (jr) jr.unresolved.push(c);
  }

  // ── 7. Marks and state ──
  const marks = assignMarks(repair.bars, input.kind === 'columnStack' ? 'C' : 'B');
  const evaluation = evaluateState({
    bars: repair.bars,
    conflicts: repair.conflicts,
    unsupported,
    membersVerified: input.membersVerified,
    coordinated: input.coordinated,
  });
  trace.push(
    `Estado alcanzado: ${evaluation.state}` +
    (evaluation.blockers.length > 0 ? ` — ${evaluation.blockers.join(' ')}` : '.'));

  const assembly: DetailingAssembly = {
    id: input.assemblyId,
    kind: input.kind,
    label: input.label,
    labelKey: input.labelKey,
    labelParams: input.labelParams,
    elementIds: input.elementIds,
    bars: repair.bars,
    marks,
    joints: jointRecords,
    conflicts: repair.conflicts,
    unsupported,
    detailingRevision: (input.previousRevision ?? 0) + 1,
    demandRevision: input.demandRevision,
    state: evaluation.state,
    stateBlockers: evaluation.blockers,
    maturity: worstMaturity(maturities),
    provenance: {
      edition: input.edition,
      verifierId: input.verifierId,
      trace,
      assumptions,
    },
  };

  return { assembly, jointCoordination, repair, trace };
}

/** Keys of the provisional calculations in an assembly, for the review gate. */
export function provisionalKeys(a: DetailingAssembly): string[] {
  const out = new Set<string>();
  if (a.maturity === 'IMPLEMENTED_PROVISIONAL') out.add('assembly');
  for (const j of a.joints) {
    if (j.maturity === 'IMPLEMENTED_PROVISIONAL') out.add(`jointShear:${j.id}`);
  }
  return [...out].sort();
}
