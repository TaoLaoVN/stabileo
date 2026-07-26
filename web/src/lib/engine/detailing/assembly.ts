/**
 * The persisted detailing assembly — what a coordinated floor actually IS.
 *
 * PR15 persisted reinforcement as counts and diameters on each element. That is a
 * per-member description and it cannot express the things coordination produces: a bar
 * that spans three members, a lap that belongs to a junction rather than to either
 * member, a conflict between two members' cages, or the fact that the user pinned one
 * span by hand.
 *
 * A `DetailingAssembly` is the unit of coordination: one continuous beam line or one
 * column stack, with its bars, joints, conflicts, provenance and revision. Assemblies
 * are persisted with the model and travel through .ded, tabs, URL sharing and autosave,
 * because a coordinated floor that has to be regenerated on every open is not a
 * deliverable.
 *
 * ── Invalidation ───────────────────────────────────────────────
 *
 * `detailingRevision` is bumped per assembly, not globally. Editing one beam line must
 * not mark an untouched line on the far side of the floor stale — that is the same class
 * of over-invalidation PR15 was written to repair, one level up.
 *
 * A locked bar path is a hard constraint that survives regeneration. Regeneration that
 * silently discards manual work is the single fastest way to lose a user's trust.
 *
 * Pure: no store, no runes.
 */

import type { BarPath } from '../../codes/cirsoc201/bar-geometry';
import type { ClauseRef, RegulationEdition } from '../../codes/regulation';
import type { Maturity } from '../../codes/maturity';
import type { BarConflict } from './collision';

export const DETAILING_SCHEMA_VERSION = 1;

export type AssemblyKind = 'beamLine' | 'columnStack';

/**
 * Review states, in order. Each is a strictly stronger claim than the last.
 *
 * VERIFIED       every member passes its code checks in isolation
 * COORDINATED    the coordinator produced a consistent set across the assembly
 * CONSTRUCTIBLE  physical bars fit: no collisions, no cover breaches, laps resolve
 * REVIEWED       a named engineer recorded their review of a specific revision
 * ISSUED         released for construction by that engineer
 *
 * REVIEWED and ISSUED are records of a human decision. Nothing in the app may set them,
 * and no state implies the software performed a legal approval.
 */
export const REVIEW_STATES = [
  'DRAFT', 'VERIFIED', 'COORDINATED', 'CONSTRUCTIBLE', 'REVIEWED', 'ISSUED',
] as const;
export type ReviewState = (typeof REVIEW_STATES)[number];

export function reviewRank(s: ReviewState): number {
  return REVIEW_STATES.indexOf(s);
}

/** A human decision, recorded. Never produced by the app on its own. */
export interface ReviewRecord {
  /** Free text: the person who reviewed it. The app does not authenticate this. */
  engineer: string;
  /** ISO timestamp supplied by the caller — this module never reads the clock. */
  at: string;
  /** The assembly revision that was reviewed. A later revision invalidates the record. */
  revision: number;
  state: 'REVIEWED' | 'ISSUED';
  notes?: string;
  /**
   * True when the reviewer explicitly acknowledged the provisional calculations listed
   * in `acknowledgedProvisional`. Required before an assembly carrying provisional work
   * can reach REVIEWED.
   */
  provisionalAcknowledged: boolean;
  /** Which provisional calculations the reviewer accepted, by key. */
  acknowledgedProvisional: string[];
}

/** A bar mark: the schedule row a set of identical bars shares. */
export interface BarMark {
  /** Mark label, e.g. 'B12'. Deterministic — see `assignMarks`. */
  mark: string;
  diameterMm: number;
  /** Cutting length, m. */
  cuttingLength: number;
  quantity: number;
  /** Shape code describing the bend pattern, e.g. 'straight', 'L90', 'U', 'crank'. */
  shape: string;
  /** Total mass for this mark, kg. */
  massKg: number;
  /** Bar path ids sharing this mark. */
  barIds: string[];
}

/** A junction between two members in the assembly, or between assemblies. */
export interface JointRecord {
  id: string;
  /** Node the joint sits at. */
  nodeId: number;
  /** Elements meeting here. */
  elementIds: number[];
  kind: 'interior' | 'exterior' | 'corner' | 'roof';
  /** How many beams frame in, in plan. */
  beamCount: number;
  /** Layer allocated to each incident beam, so perpendicular beams do not collide. */
  beamLayers: Array<{ elementId: number; layer: number }>;
  /** Joint-shear result key, when one was computed. */
  jointShearKey?: string;
  maturity: Maturity;
  /** Conflicts local to this joint that the resolver could not clear. */
  unresolved: BarConflict[];
}

export interface UnsupportedCondition {
  /** Stable key, matching a CapabilityKey where one applies. */
  key: string;
  /** Element or joint it applies to. */
  scope: { elementIds?: number[]; jointIds?: string[] };
  /** Shown verbatim to the user and printed on the drawing. */
  message: string;
  refs: ClauseRef[];
}

export interface AssemblyProvenance {
  /** Edition every rule in this assembly was resolved against. */
  edition: RegulationEdition;
  /** Verifier identity that produced the member verdicts. */
  verifierId: string;
  /** Coordination cost, for the explainability trail. */
  coordinationCost?: number;
  /** The coordinator's decision trace. */
  trace: string[];
  /** Assumptions carried by any calculation in the assembly. */
  assumptions: string[];
}

export interface DetailingAssembly {
  id: string;
  kind: AssemblyKind;
  /** Human label, e.g. 'Eje B — Nivel +3,40'. */
  label: string;
  /** Members in order along the line or up the stack. */
  elementIds: number[];
  /** Physical bars. A bar spanning two members appears once, owned by both. */
  bars: BarPath[];
  marks: BarMark[];
  joints: JointRecord[];
  conflicts: BarConflict[];
  unsupported: UnsupportedCondition[];
  /**
   * Bumped whenever this assembly is regenerated. Per-assembly, so editing one line does
   * not mark an untouched line stale.
   */
  detailingRevision: number;
  /** Demand revision the bars were generated against. Mismatch means stale. */
  demandRevision: number;
  state: ReviewState;
  review?: ReviewRecord;
  /** Worst maturity across every calculation in the assembly. */
  maturity: Maturity;
  provenance: AssemblyProvenance;
}

// ─── Marks ───────────────────────────────────────────────────────

/** Round a length to the nearest 10 mm — the granularity a schedule is cut to. */
function roundCut(m: number): number {
  return Math.round(m * 100) / 100;
}

/**
 * Describe a bar's bend pattern as a shape code.
 *
 * Two bars share a mark only when they are the same bar: same diameter, same cut length,
 * same shape. Marking two different shapes as one is how a bundle arrives on site with
 * the wrong bars in it.
 */
export function shapeCode(bar: BarPath): string {
  const arcs = bar.segments.filter((s) => s.kind === 'arc').length;
  const start = bar.startTreatment.kind === 'hook'
    ? `H${bar.startTreatment.hook.angle}` : '';
  const end = bar.endTreatment.kind === 'hook'
    ? `H${bar.endTreatment.hook.angle}` : '';
  if (arcs === 0) return 'straight';
  if (start && end) return `U${start}${end}`;
  if (start || end) return `L${start}${end}`;
  return `bent${arcs}`;
}

/**
 * Assign bar marks deterministically.
 *
 * Grouped by (diameter, rounded cut length, shape) and then sorted so the same input
 * always yields the same labels — a golden drawing test is worthless if the marks
 * shuffle between runs.
 */
export function assignMarks(bars: readonly BarPath[], prefix = 'B'): BarMark[] {
  const groups = new Map<string, BarPath[]>();
  for (const bar of bars) {
    const key = `${bar.diameterMm}|${roundCut(bar.cuttingLength).toFixed(2)}|${shapeCode(bar)}`;
    const g = groups.get(key);
    if (g) g.push(bar); else groups.set(key, [bar]);
  }

  const sorted = [...groups.entries()].sort(([a], [b]) => {
    const [da, la, sa] = a.split('|');
    const [db, lb, sb] = b.split('|');
    return Number(da) - Number(db)
      || Number(la) - Number(lb)
      || sa.localeCompare(sb);
  });

  return sorted.map(([key, list], i) => {
    const [dia, len, shape] = key.split('|');
    const diameterMm = Number(dia);
    const cuttingLength = Number(len);
    const area = Math.PI * (diameterMm / 2000) ** 2;
    return {
      mark: `${prefix}${i + 1}`,
      diameterMm,
      cuttingLength,
      quantity: list.length,
      shape,
      massKg: area * cuttingLength * 7850 * list.length,
      barIds: list.map((b) => b.id).sort(),
    };
  });
}

// ─── State transitions ───────────────────────────────────────────

export interface StateEvaluation {
  state: ReviewState;
  /** Why the assembly did not reach a higher state. Empty when it reached the top. */
  blockers: string[];
}

/**
 * Compute the state an assembly has EARNED from its contents.
 *
 * Deliberately cannot return REVIEWED or ISSUED: those are human records, and a function
 * that could award them would be the software signing off on itself. They are applied
 * separately by `applyReview`.
 */
export function evaluateState(a: {
  bars: readonly BarPath[];
  conflicts: readonly BarConflict[];
  unsupported: readonly UnsupportedCondition[];
  /** True when every member in the assembly passed its own code checks. */
  membersVerified: boolean;
  /** True when the coordinator returned a coordinated result. */
  coordinated: boolean;
}): StateEvaluation {
  const blockers: string[] = [];

  if (!a.membersVerified) {
    blockers.push('Hay elementos que no superan su verificación individual.');
    return { state: 'DRAFT', blockers };
  }
  if (a.unsupported.length > 0) {
    blockers.push(
      `${a.unsupported.length} condición(es) no soportada(s): ` +
      a.unsupported.map((u) => u.key).join(', ') + '.');
  }
  if (!a.coordinated) {
    blockers.push('La coordinación no produjo un conjunto consistente.');
    return { state: 'VERIFIED', blockers };
  }
  if (a.bars.length === 0) {
    blockers.push('No se generaron barras físicas.');
    return { state: 'VERIFIED', blockers };
  }

  const blocking = a.conflicts.filter((c) => c.severity !== 'marginal');
  if (blocking.length > 0) {
    blockers.push(`${blocking.length} conflicto(s) físico(s) sin resolver.`);
    return { state: 'COORDINATED', blockers };
  }
  if (a.unsupported.length > 0) {
    // Unsupported conditions gate constructibility even when the bars fit: a cage that
    // fits but was never checked for something is not constructible, it is unchecked.
    return { state: 'COORDINATED', blockers };
  }

  return { state: 'CONSTRUCTIBLE', blockers: [] };
}

export interface ReviewAttempt {
  ok: boolean;
  assembly?: DetailingAssembly;
  /** Why the review was refused. */
  reason?: string;
}

/**
 * Record an engineer's review of a specific revision.
 *
 * Refuses when the assembly has not reached CONSTRUCTIBLE, and refuses when it carries
 * provisional calculations the reviewer has not explicitly acknowledged. The second
 * check is what keeps `IMPLEMENTED_PROVISIONAL` honest: a provisional result may be
 * accepted, but only deliberately.
 */
export function applyReview(
  assembly: DetailingAssembly,
  record: Omit<ReviewRecord, 'revision'>,
  provisionalKeys: readonly string[] = [],
): ReviewAttempt {
  if (reviewRank(assembly.state) < reviewRank('CONSTRUCTIBLE')) {
    return {
      ok: false,
      reason: `El conjunto está en estado ${assembly.state}; sólo puede revisarse a ` +
              'partir de CONSTRUCTIBLE.',
    };
  }
  if (!record.engineer.trim()) {
    return { ok: false, reason: 'Debe indicarse el profesional que revisa.' };
  }

  const outstanding = provisionalKeys.filter((k) => !record.acknowledgedProvisional.includes(k));
  if (outstanding.length > 0) {
    return {
      ok: false,
      reason:
        'Hay cálculos provisorios sin aceptación expresa: ' + outstanding.join(', ') +
        '. Un cálculo provisorio puede aceptarse, pero debe hacerse deliberadamente.',
    };
  }
  if (provisionalKeys.length > 0 && !record.provisionalAcknowledged) {
    return { ok: false, reason: 'Falta la aceptación expresa de los cálculos provisorios.' };
  }

  return {
    ok: true,
    assembly: {
      ...assembly,
      state: record.state,
      review: { ...record, revision: assembly.detailingRevision },
    },
  };
}

/**
 * True when a review no longer applies because the assembly moved on.
 *
 * A drawing in this state carries the SUPERSEDED watermark.
 */
export function isReviewStale(a: DetailingAssembly): boolean {
  return a.review !== undefined && a.review.revision !== a.detailingRevision;
}

/** True when the bars were generated against demands that have since changed. */
export function isDemandStale(a: DetailingAssembly, currentDemandRevision: number): boolean {
  return a.demandRevision !== currentDemandRevision;
}

// ─── Persistence ─────────────────────────────────────────────────

export interface DetailingStore {
  version: number;
  assemblies: DetailingAssembly[];
}

export function emptyDetailingStore(): DetailingStore {
  return { version: DETAILING_SCHEMA_VERSION, assemblies: [] };
}

export interface DetailingMigration {
  store: DetailingStore;
  notices: Array<{ key: string; params?: Record<string, string | number> }>;
}

/**
 * Load a persisted detailing store, migrating older shapes forward.
 *
 * Unknown or corrupt payloads degrade to an empty store rather than throwing: losing the
 * detailing is recoverable by regenerating, whereas failing to open the project is not.
 * The notice makes the loss visible instead of silent.
 */
export function migrateDetailingStore(raw: unknown): DetailingMigration {
  const notices: DetailingMigration['notices'] = [];

  if (raw === null || raw === undefined) {
    return { store: emptyDetailingStore(), notices };
  }
  if (typeof raw !== 'object') {
    return { store: emptyDetailingStore(), notices: [{ key: 'detailing.migration.corrupt' }] };
  }

  const src = raw as Partial<DetailingStore>;
  if (!Array.isArray(src.assemblies)) {
    return { store: emptyDetailingStore(), notices: [{ key: 'detailing.migration.corrupt' }] };
  }

  const assemblies: DetailingAssembly[] = [];
  let dropped = 0;
  for (const a of src.assemblies) {
    if (!a || typeof a !== 'object') { dropped++; continue; }
    const cand = a as Partial<DetailingAssembly>;
    if (typeof cand.id !== 'string' || !Array.isArray(cand.elementIds)) { dropped++; continue; }
    assemblies.push({
      id: cand.id,
      kind: cand.kind === 'columnStack' ? 'columnStack' : 'beamLine',
      label: typeof cand.label === 'string' ? cand.label : cand.id,
      elementIds: cand.elementIds.filter((x): x is number => typeof x === 'number'),
      bars: Array.isArray(cand.bars) ? cand.bars : [],
      marks: Array.isArray(cand.marks) ? cand.marks : [],
      joints: Array.isArray(cand.joints) ? cand.joints : [],
      conflicts: Array.isArray(cand.conflicts) ? cand.conflicts : [],
      unsupported: Array.isArray(cand.unsupported) ? cand.unsupported : [],
      detailingRevision: typeof cand.detailingRevision === 'number' ? cand.detailingRevision : 0,
      demandRevision: typeof cand.demandRevision === 'number' ? cand.demandRevision : -1,
      state: REVIEW_STATES.includes(cand.state as ReviewState) ? cand.state as ReviewState : 'DRAFT',
      review: cand.review,
      maturity: cand.maturity ?? 'UNSUPPORTED',
      provenance: cand.provenance ?? {
        edition: '2025', verifierId: 'unknown', trace: [], assumptions: [],
      },
    });
  }

  if (dropped > 0) notices.push({ key: 'detailing.migration.dropped', params: { count: dropped } });
  if (typeof src.version === 'number' && src.version < DETAILING_SCHEMA_VERSION) {
    notices.push({
      key: 'detailing.migration.upgraded',
      params: { from: src.version, to: DETAILING_SCHEMA_VERSION },
    });
  }

  return { store: { version: DETAILING_SCHEMA_VERSION, assemblies }, notices };
}

/**
 * Invalidate only the assemblies touched by an element change.
 *
 * The whole reason `detailingRevision` is per-assembly. `changedElements` is typically
 * one member; every assembly that does NOT contain it keeps its revision, its review and
 * its CONSTRUCTIBLE status.
 */
export function invalidateAffected(
  store: DetailingStore, changedElements: Iterable<number>,
): { store: DetailingStore; invalidated: string[] } {
  const changed = new Set(changedElements);
  const invalidated: string[] = [];
  const assemblies = store.assemblies.map((a) => {
    if (!a.elementIds.some((id) => changed.has(id))) return a;
    invalidated.push(a.id);
    return {
      ...a,
      detailingRevision: a.detailingRevision + 1,
      // The earned state drops back; a human review record is KEPT but becomes stale,
      // so the drawing shows SUPERSEDED rather than losing the audit trail.
      state: reviewRank(a.state) > reviewRank('VERIFIED') ? 'VERIFIED' as ReviewState : a.state,
    };
  });
  return { store: { ...store, assemblies }, invalidated };
}

/** Bars the user pinned. Regeneration must treat these as hard constraints. */
export function lockedBars(a: DetailingAssembly): BarPath[] {
  return a.bars.filter((b) => b.locked);
}
