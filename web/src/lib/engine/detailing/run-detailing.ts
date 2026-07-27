/**
 * The production path from verified design to coordinated detailing assemblies.
 *
 * ── The gap this closes ────────────────────────────────────────────
 *
 * PR17 shipped `generateBeamBars`, `generateColumnStack`, `coordinateJoint`,
 * `detectCollisions` and `coordinateFloor`, all unit-tested, and `detailingStore` with a
 * `setAssemblies` method. The forensic audit found that `setAssemblies` had ZERO callers
 * and `coordinateFloor` had none outside its own tests: the only thing that ever wrote
 * `model.detailing` was a Playwright hook. Every green test described machinery nothing
 * reached.
 *
 * This module is the missing adapter. It takes what the RC design run already produces —
 * member contexts and verified outcomes — and drives the real chain:
 *
 *   verified members
 *     → beam bar paths (curtailment, laps, bent-up policy, stirrup zones)
 *     → column stacks (transitions, splices, ties)
 *     → perpendicular joint coordination
 *     → collision detection and bounded repair
 *     → coordinateFloor
 *     → DetailingAssembly[]
 *
 * The store then persists it and the revision graph invalidates it. Nothing here touches
 * the solver, and nothing here is a hook.
 *
 * ── Honesty rules ──────────────────────────────────────────────────
 *
 * A member that is not VERIFIED never contributes bars. Detailing an unverified member
 * would produce a drawing of reinforcement that has not been shown to work, which is worse
 * than producing no drawing. Such members are reported as prerequisites, by id and count,
 * so the UI can say exactly what is missing rather than "run design first".
 *
 * Pure: no store, no runes. The store command supplies the data and consumes the result.
 */

import type { RegulationEdition } from '../../codes/regulation';
import { anchorageFunctions } from '../../codes/cirsoc201/anchorage';
import type { BarPath, Point3 } from '../../codes/cirsoc201/bar-geometry';
import type { MemberContext } from '../design/member-context';
import type { MemberDesignOutcome } from '../design/outcome';
import {
  generateBeamBars, type BentUpPolicy, type MomentStation, type SupportKind,
} from './generate-beam';
import { generateColumnStack, type ColumnLift, type IncidentBeamAtJoint } from './generate-column';
import { candidateClears, generateLayoutCandidates, type KeepOut } from './candidates';
import {
  cageKeepOuts, generateColumnCandidates, type ColumnLayoutCandidate,
} from './column-candidates';
import {
  coordinate, type CoordinationResult, type JointConstraint, type MemberVariable,
} from './coordination-search';
import { DEFAULT_TOLERANCES } from './collision';
import { planSplice, transitionExists } from './splice';
import { classifyPair } from './classify';
import { detectCollisions } from './collision';
import { assessConstructibility } from './constructibility';
import { envelopeIsComplete } from './coordination-search';
import { materialiseLaps, lapIndex, lapBetween, type PlannedTransition, type LapInterval } from './lap-materialize';
import type { EngineMessage } from '../../codes/message';
import {
  allocateLayers, depthAfterRaise,
  type LayerAllocation, type LineCrossing, type LineForLayering,
} from './joint-layers';
import { prescribedTolerances } from '../../codes/cirsoc201/placement';
import { deriveDevelopment } from '../../codes/cirsoc201/anchorage';
import { minClearSpacingColumn } from '../../codes/cirsoc201/spacing';
import { coordinateFloor, type FloorCoordinationResult, type JointInput, type MemberBars } from './coordinate-floor';
import { evaluateState, reviewRank, type DetailingAssembly } from './assembly';
import { deriveMaturity } from '../../codes/maturity';

// ─── Inputs ──────────────────────────────────────────────────────

export interface DetailingModelNode {
  id: number;
  x: number;
  y: number;
  z?: number;
}

export interface DetailingModelElement {
  id: number;
  nodeI: number;
  nodeJ: number;
}

export interface RunDetailingInput {
  contexts: ReadonlyMap<number, MemberContext>;
  /** Design outcomes keyed by element id. Only VERIFIED members are detailed. */
  outcomes: ReadonlyMap<number, MemberDesignOutcome>;
  nodes: ReadonlyMap<number, DetailingModelNode>;
  elements: ReadonlyMap<number, DetailingModelElement>;
  edition: RegulationEdition;
  /** Who is accountable for the result. */
  verifierId: string;
  demandRevision: number;
  /** Revision of the previous assemblies, so regeneration increments. */
  previousRevision?: number;
  maxAggregateSizeMm: number;
  /**
   * Project's additional bar-spacing margin above the regulatory minimum, m.
   *
   * Zero by default. CIRSOC's minimum IS the construction requirement; this is a project
   * decision and is never presented as a code one.
   */
  spacingMargin?: number;
  /**
   * Authoritative re-verification of one member at its FINAL geometry.
   *
   * Moving steel changes the effective depth, and a certificate issued against the
   * pre-coordination arrangement describes geometry that no longer exists. `depthLoss` is
   * how much lever arm the member lost: the joint-layer raise plus the unfavourable
   * §26.6.2.1 tolerance. The caller supplies the verifier so this module stays free of the
   * design layer; when it is absent NOTHING is reverified and the constructibility gate
   * says so rather than assuming a pass.
   */
  reverify?: (
    elementId: number,
    depthLoss: { bottomRaise: number; topLower: number; depthTolerance: number },
  ) => 'ok' | 'warn' | 'fail';
  /** Bars the user pinned; they survive regeneration untouched. */
  lockedBars?: BarPath[];
  /**
   * Project bent-up (cranked) bar policy.
   *
   * Passed through to the generator unchanged. Defaults to the most conservative reading:
   * seismic design unstated and no opt-out recorded, under which no bent-up bar is
   * generated. The app must not adopt a fabrication decision on the user's behalf.
   */
  bentUp?: BentUpPolicy;
  /** Members whose bars belong to the lateral-force-resisting system. */
  lateralSystem?: ReadonlySet<number>;
}

// ─── Prerequisites ───────────────────────────────────────────────

export type PrerequisiteKind =
  | 'noMembers'
  | 'unverifiedMembers'
  | 'noReinforcement'
  | 'noStations'
  | 'orientationSuspect';

export interface Prerequisite {
  kind: PrerequisiteKind;
  /** i18n key for the message. */
  key: string;
  /** Members responsible. Empty for `noMembers`. */
  elementIds: number[];
  count: number;
}

export interface DetailingReadiness {
  ready: boolean;
  /** Element ids that WILL be detailed. */
  detailable: number[];
  /** Exactly what is missing, with counts, so the UI never says "run design first". */
  prerequisites: Prerequisite[];
}

/**
 * Can detailing run, and if not, precisely why?
 *
 * Computed separately from the run so a disabled button can explain itself without doing
 * the work. The empty state this replaces said "coordinate a floor to see assemblies here",
 * which was an instruction the user had no control to follow.
 */
export function detailingReadiness(input: {
  contexts: ReadonlyMap<number, MemberContext>;
  outcomes: ReadonlyMap<number, MemberDesignOutcome>;
}): DetailingReadiness {
  const prerequisites: Prerequisite[] = [];
  const detailable: number[] = [];
  const unverified: number[] = [];
  const noReinforcement: number[] = [];
  const noStations: number[] = [];
  const suspect: number[] = [];

  for (const [id, ctx] of input.contexts) {
    if (ctx.elementType === 'wall') continue;   // PR18 owns walls.
    const outcome = input.outcomes.get(id);
    if (!outcome || outcome.outcome !== 'VERIFIED') { unverified.push(id); continue; }
    if (!outcome.accepted) { noReinforcement.push(id); continue; }
    if (ctx.elementType === 'beam' && !ctx.stations) { noStations.push(id); continue; }
    if (ctx.orientationSuspect) { suspect.push(id); continue; }
    detailable.push(id);
  }

  const add = (kind: PrerequisiteKind, key: string, ids: number[]) => {
    if (ids.length === 0) return;
    prerequisites.push({ kind, key, elementIds: ids.sort((a, b) => a - b), count: ids.length });
  };

  if (input.contexts.size === 0) {
    prerequisites.push({
      kind: 'noMembers', key: 'detailing.prereq.noMembers', elementIds: [], count: 0,
    });
  }
  add('unverifiedMembers', 'detailing.prereq.unverified', unverified);
  add('noReinforcement', 'detailing.prereq.noReinforcement', noReinforcement);
  add('noStations', 'detailing.prereq.noStations', noStations);
  add('orientationSuspect', 'detailing.prereq.orientationSuspect', suspect);

  return {
    ready: detailable.length > 0,
    detailable: detailable.sort((a, b) => a - b),
    prerequisites,
  };
}

// ─── Geometry helpers ────────────────────────────────────────────

const Z = (n: DetailingModelNode) => n.z ?? 0;

function unit(a: Point3, b: Point3): Point3 {
  const d = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
  const L = Math.hypot(d.x, d.y, d.z) || 1;
  return { x: d.x / L, y: d.y / L, z: d.z / L };
}

function nodePoint(n: DetailingModelNode): Point3 {
  return { x: n.x, y: n.y, z: Z(n) };
}

/** The lift whose elevation range contains a bar's start, for un-owned splice bars. */
function nearestLiftTo(bar: BarPath, lifts: readonly ColumnLift[]): number {
  const z = bar.segments[0]?.start.z ?? 0;
  let best = lifts[0];
  let bestGap = Infinity;
  for (const l of lifts) {
    const gap = z < l.baseZ ? l.baseZ - z : z > l.topZ ? z - l.topZ : 0;
    if (gap < bestGap) { bestGap = gap; best = l; }
  }
  return best.elementId;
}

/** True for a member close enough to vertical to be a column lift. */
function isColumnLike(i: DetailingModelNode, j: DetailingModelNode): boolean {
  const dz = Math.abs(Z(j) - Z(i));
  const L = Math.hypot(j.x - i.x, j.y - i.y, dz) || 1;
  return dz / L > 0.7;
}

/**
 * Envelope stations for a beam, from the per-combo station forces.
 *
 * The generators need sagging, hogging and shear envelopes at each x. Taking the max over
 * combos at each station is exactly what "envelope" means, and it is what the curtailment
 * rules in §9.7.3 are written against.
 */
function envelopeStations(ctx: MemberContext): MomentStation[] {
  const sr = ctx.stations;
  if (!sr || sr.comboResults.length === 0) return [];
  const byX = new Map<number, MomentStation>();
  for (const combo of sr.comboResults) {
    for (const st of combo.stations) {
      const key = Math.round(st.x * 1e6) / 1e6;
      const cur = byX.get(key) ?? { x: key, mPos: 0, mNeg: 0, v: 0 };
      // Local-y bending is the strong axis for a horizontal member under gravity.
      const m = st.my;
      cur.mPos = Math.max(cur.mPos, m > 0 ? m : 0);
      cur.mNeg = Math.max(cur.mNeg, m < 0 ? -m : 0);
      cur.v = Math.max(cur.v, Math.abs(st.vz), Math.abs(st.vy));
      byX.set(key, cur);
    }
  }
  return [...byX.values()].sort((a, b) => a.x - b.x);
}

/** How many frame members meet at a node — 1 means a simple support, more is continuity. */
function supportKindAt(
  nodeId: number, self: number, elements: ReadonlyMap<number, DetailingModelElement>,
): SupportKind {
  let others = 0;
  for (const el of elements.values()) {
    if (el.id === self) continue;
    if (el.nodeI === nodeId || el.nodeJ === nodeId) others++;
  }
  if (others === 0) return 'free';
  return others >= 2 ? 'continuous' : 'simple';
}

function beamGroups(accepted: NonNullable<MemberDesignOutcome['accepted']>): {
  bottom: { count: number; diameterMm: number };
  topStart: { count: number; diameterMm: number };
  topEnd: { count: number; diameterMm: number };
} | null {
  const g = (x?: { count: number; diameter: number }) =>
    x && x.count > 0 ? { count: x.count, diameterMm: x.diameter } : null;
  const r = accepted.regions;
  const bottom = g(r?.bottomSpan) ?? g(accepted.bottom);
  const topStart = g(r?.topStart) ?? g(accepted.top);
  const topEnd = g(r?.topEnd) ?? g(accepted.top);
  if (!bottom || !topStart || !topEnd) return null;
  return { bottom, topStart, topEnd };
}

function columnBars(accepted: NonNullable<MemberDesignOutcome['accepted']>):
  { count: number; diameterMm: number } | null {
  const c = accepted.column;
  if (c && 'totalBars' in c && typeof (c as { totalBars?: number }).totalBars === 'number') {
    const t = c as unknown as { totalBars: number; diameter?: number; barDiameter?: number };
    const d = t.diameter ?? t.barDiameter;
    if (t.totalBars > 0 && d) return { count: t.totalBars, diameterMm: d };
  }
  const l = accepted.longitudinal;
  if (l && l.count > 0) return { count: l.count, diameterMm: l.diameter };
  return null;
}

// ─── The run ─────────────────────────────────────────────────────

export interface RunDetailingResult {
  assemblies: DetailingAssembly[];
  readiness: DetailingReadiness;
  /** Per-assembly coordination detail, for the inspection panels. */
  coordination: FloorCoordinationResult[];
  /** Members skipped, with the reason, so nothing disappears silently. */
  skipped: Array<{ elementId: number; key: string }>;
  /**
   * The global layout search: outcome, statistics and infeasible joints.
   *
   * Reported rather than folded into a pass/fail, because "no assignment exists"
   * (DETAILING_INADEQUATE) and "we ran out of budget" (SEARCH_EXHAUSTED) demand different
   * responses from the engineer and must never be conflated.
   */
  layoutSearch: CoordinationResult;
  /**
   * What the splice schedules actually BUILT.
   *
   * Separate from `layoutSearch` on purpose. The search reports whether a legal assignment
   * exists; this reports whether the steel was placed. A run with an ASSIGNMENT_FOUND outcome
   * and zero laps and zero fusions has coordinated nothing, and that combination has to be
   * visible rather than inferable.
   */
  /**
   * The crossing graph and the layer allocation it produced. Present once beams have been
   * coordinated; the inspection surfaces and the conflict diagnosis both read it.
   */
  layering?: {
    lineOfMember: Map<number, string>;
    crossings: LineCrossing[];
    lineMax: Map<string, number>;
    relations: Array<{ a: number; b: number; jointId: string; relation: string;
      lineA?: string; lineB?: string }>;
    byLine: Map<string, { rank: number; bottomRaise: number; topLower: number }>;
    unresolved: Array<{ jointId: string; a: string; b: string }>;
    ranks: number;
  };
  lapping: {
    /** Physical laps built, each with its interval, class and clause provenance. */
    laps: LapInterval[];
    /** Pairs that were the same bar all along and are now one BarPath. */
    fused: number;
    /** Transitions the search closed but the geometry could not build, with the reason. */
    unmaterialised: Array<{ jointId: string; reason: EngineMessage }>;
  };
}

/**
 * Generate and coordinate detailing for every verified member, grouped into one assembly
 * per storey level.
 *
 * Grouping by level is what "coordinate the floor" means physically: bars clash with the
 * bars they share a pour with, and a column stack spans levels but is coordinated at each
 * joint it passes through.
 */
export function runDetailing(input: RunDetailingInput): RunDetailingResult {
  const readiness = detailingReadiness(input);
  const skipped: Array<{ elementId: number; key: string }> = [];
  if (!readiness.ready) {
    return {
      assemblies: [], readiness, coordination: [], skipped,
      lapping: { laps: [], fused: 0, unmaterialised: [] },
      layoutSearch: {
        outcome: 'ASSIGNMENT_FOUND', envelope: 'beamsAndColumns',
        evidence: {
          completeBeamEnvelope: true, completeColumnEnvelope: true,
          allJointArrangementsIncluded: true, noUnsupportedRule: true,
          exhaustive: true, limitingConstraints: [], recommendations: [],
        },
        assignment: new Map(), infeasibleJoints: [],
        emptiedDomains: [],
        stats: {
          candidatesGenerated: 0, domainsRemovedByPropagation: 0, dpStates: 0,
          dpTransitions: 0, branchNodes: 0, compatibilityChecks: 0,
          compatibilityCacheHits: 0, truncated: false,
        },
      },
    };
  }

  const detailable = new Set(readiness.detailable);
  const beams: number[] = [];
  const columns: number[] = [];
  for (const id of detailable) {
    const ctx = input.contexts.get(id)!;
    (ctx.elementType === 'column' ? columns : beams).push(id);
  }

  // ── Column stacks: columns sharing a plan position, ordered bottom to top ──
  const stacks = new Map<string, ColumnLift[]>();
  for (const id of columns) {
    const ctx = input.contexts.get(id)!;
    const el = input.elements.get(id);
    const accepted = input.outcomes.get(id)?.accepted;
    const bars = accepted ? columnBars(accepted) : null;
    if (!el || !bars) { skipped.push({ elementId: id, key: 'detailing.skip.noColumnBars' }); continue; }
    const nI = input.nodes.get(el.nodeI);
    const nJ = input.nodes.get(el.nodeJ);
    if (!nI || !nJ || !isColumnLike(nI, nJ)) {
      skipped.push({ elementId: id, key: 'detailing.skip.notVertical' });
      continue;
    }
    const [lo, hi] = Z(nI) <= Z(nJ) ? [nI, nJ] : [nJ, nI];
    // Plan position to the millimetre: a column that shifts less than that is the same stack.
    const key = `${Math.round(lo.x * 1000)}:${Math.round(lo.y * 1000)}`;
    const list = stacks.get(key) ?? [];
    list.push({
      elementId: id, baseZ: Z(lo), topZ: Z(hi),
      b: ctx.section.b, h: ctx.section.h,
      centre: { x: lo.x, y: lo.y },
      bars, tieDia: ctx.material.stirrupDia, cover: ctx.material.cover,
    });
    stacks.set(key, list);
  }

  const memberBarsById = new Map<number, MemberBars>();

  /**
   * Lap lookup for the classifier, installed once `materialiseLaps` has run.
   *
   * Undefined before materialisation, deliberately: a splice schedule that has not been
   * built is a claim about what could be done, and treating it as a lap would excuse
   * clashes between bars that are still two separate, unconnected pieces of steel.
   */
  let lapLookup: ((aId: string, bId: string) => 'contact' | 'nonContact' | undefined)
    | undefined;

  /** Joint-layer allocation, filled in by `coordinateBeamLayouts`. */
  let layerAllocation: LayerAllocation | undefined;
  /**
   * What the layer allocator saw, kept for diagnosis.
   *
   * Two failure modes are indistinguishable from the outcome alone: a crossing the graph
   * never received, and a crossing it received and could not colour. Reporting the graph
   * itself is what separates them.
   */
  let layerDiagnostics: {
    lineOfMember: Map<number, string>;
    crossings: LineCrossing[];
    lineMax: Map<string, number>;
    relations: Array<{ a: number; b: number; jointId: string; relation: string;
      lineA?: string; lineB?: string }>;
  } | undefined;
  /** Vertical raise per member, m, from that allocation. Zero for rank 0. */
  const layerRaiseOf = new Map<number, number>();
  /** Drop per member for the TOP face, m. Sized separately from the bottom. */
  const layerDropOf = new Map<number, number>();

  /**
   * Conditions the run could not represent, as structured messages.
   *
   * Reaches the constructibility gate's `unsupportedRules`, so an unrepresentable condition
   * withholds the claim instead of being absent from it.
   */
  const unsupportedRun: Array<{ key: string; params: Record<string, unknown> }> = [];

  /**
   * Does a column's top lift need tension development at the roof?
   *
   * §25.4.1.2 forbids anchoring a compression bar with a hook, so this decides whether one
   * may be used at all.
   *
   * Tension arises two ways and both are checked. A combination may put the whole section
   * in net tension — the demand set names that case explicitly. Or the axial force may be
   * compressive while the moment is large enough to open tension on one face: the
   * uncracked-section extreme fibre, σ = N/A − M·c/I, going negative. The second is the
   * common case in a frame column and is invisible if only the axial category is read.
   */
  function topLiftNeedsTension(lifts: readonly ColumnLift[]): boolean {
    const top = lifts[lifts.length - 1];
    if (!top) return false;
    const ctx = input.contexts.get(top.elementId);
    const demands = (ctx as { demands?: { demands?: Array<{
      category: string; absValue: number; forces?: { n?: number; my?: number; mz?: number };
    }> } } | undefined)?.demands?.demands;
    if (!demands || demands.length === 0) {
      // No demand data is not evidence of compression. Anchor for tension, which is the
      // safe direction when the question cannot be answered.
      return true;
    }
    if (demands.some((d) => d.category === 'N_tension' && d.absValue > 1e-6)) return true;

    const b = top.b;
    const h = top.h;
    const area = b * h;
    if (area <= 0) return true;
    for (const d of demands) {
      const f = d.forces;
      if (!f) continue;
      // Compression is negative in the solver's convention, so N/A is negative for a
      // compressed column and the moment term has to overcome it.
      const n = f.n ?? 0;
      const my = Math.abs(f.my ?? 0);
      const mz = Math.abs(f.mz ?? 0);
      const sigma = n / area
        - mz / (b * h * h / 6)
        - my / (h * b * b / 6);
      if (sigma > 1e-6) return true;
    }
    return false;
  }

  /** The project's additional bar-spacing margin, m. Zero unless the project stated one. */
  const spacingMargin = Math.max(0, input.spacingMargin ?? 0);

  /** The same classification the authoritative pass uses, for the robustness re-check. */
  const classifyForRun = (a: BarPath, b: BarPath, surface: number) => classifyPair(a, b, {
    edition: input.edition,
    maxAggregateSizeMm: input.maxAggregateSizeMm,
    memberKindOf: (id) => input.contexts.get(id)?.elementType,
    layerOf: (barId) => barLayers.get(barId),
    isLapPair: (x, y) => lapLookup?.(x, y),
  }, surface);
  /** Layer index per bar, reported by the generators, for the §25.2.2 classification. */
  const barLayers = new Map<string, number>();

  /**
   * Column bars whose line passes through a node's plan position and elevation.
   *
   * Read from the bars the column generator actually produced, not recomputed: threading
   * must dodge the real cage, and a second derivation of "where the column bars are" is a
   * second thing that can disagree with the drawing.
   */
  function columnBarsNear(n: DetailingModelNode) {
    const found: Array<{ id: string; diameterMm: number; x: number; y: number }> = [];
    for (const mb of memberBarsById.values()) {
      if (input.contexts.get(mb.elementId)?.elementType !== 'column') continue;
      for (const bar of mb.bars) {
        const p = bar.segments[0]?.start;
        if (!p) continue;
        if (Math.hypot(p.x - n.x, p.y - n.y) > 1.0) continue;
        // The bar must physically span this elevation to obstruct anything here.
        const zs = bar.segments.flatMap((sg) => [sg.start.z, sg.end.z]);
        if (Math.min(...zs) > Z(n) + 0.02 || Math.max(...zs) < Z(n) - 0.02) continue;
        found.push({ id: bar.id, diameterMm: bar.diameterMm, x: p.x, y: p.y });
      }
    }

    // ── Deduplicate by PHYSICAL POSITION, not by owning member ──
    //
    // Every node between two lifts is spanned by the lift below (whose bars run up into the
    // lap) and the lift above. Counting both gives two obstacles where the steel is one
    // continuous bar passing through the joint, or two bars lapping side by side that
    // occupy one corridor between them.
    //
    // A beam threading the cage cares about occupied SPACE, so bars sharing a plan position
    // to the millimetre are one obstacle, taking the larger diameter. Where a transition
    // genuinely moves a bar, the two positions differ and both are kept — which is correct,
    // because at a transition there really are two bars to miss.
    const byPosition = new Map<string, { diameterMm: number; x: number; y: number }>();
    for (const b of found) {
      const key = `${Math.round(b.x * 1000)}:${Math.round(b.y * 1000)}`;
      const seen = byPosition.get(key);
      if (!seen || b.diameterMm > seen.diameterMm) {
        byPosition.set(key, { diameterMm: b.diameterMm, x: b.x, y: b.y });
      }
    }
    return [...byPosition.values()].sort((a, b) => a.x - b.x || a.y - b.y);
  }


  /**
   * Cage arrangement chosen per stack, and the resulting bar plan offsets.
   *
   * Chosen before the column bars are generated, because the arrangement IS the bar
   * positions. Holding the cage fixed and asking the beams to cope was measured and does
   * not work: with evenly spread face bars the free channels on the flagship are ~29 mm and
   * a Ø32 beam bar cannot pass, so the search declared 244 beam domains empty for a reason
   * that was the column's to fix.
   *
   * The widest-channel arrangement is preferred, which is what a detailer does when the
   * beam steel is large, and it is legal because it packs the face bars at the §25.2.3
   * minimum rather than at an invented offset.
   */
  const cageFor = new Map<string, ColumnLayoutCandidate>();
  /** The ordinary drawing — what is actually built, until an alternative earns its place. */
  const conventionalCage = new Map<string, ColumnLayoutCandidate>();
  /** Which arrangement the scoring WOULD choose, reported as evidence. */
  const cageChoiceRationale = new Map<string, string>();
  for (const [stackId, liftsRaw] of stacks) {
    const first = liftsRaw[0];
    const cands = generateColumnCandidates({
      count: first.bars.count, diameterMm: first.bars.diameterMm,
      b: first.b, h: first.h, cover: first.cover, tieDiaMm: first.tieDia,
      edition: input.edition, maxAggregateSizeMm: input.maxAggregateSizeMm,
      placementTolerance: DEFAULT_TOLERANCES.placement,
    });
    if (cands.length === 0) continue;

    // Score each cage against the beams that actually frame into this stack, rather than
    // taking the widest channel and hoping. Widest-channel-first was measured: it opened
    // beam domains (244 emptied → 125) and RAISED total conflicts 2,579 → 3,090, because
    // packing the face bars tight to the corners buys plan width for the beams and spends
    // it on column-to-column and column-to-beam clearance elsewhere. A cage is only better
    // if the beams meeting it end up better off.
    const incident = beams.filter((bid) => {
      const bel = input.elements.get(bid);
      if (!bel) return false;
      return liftsRaw.some((lift) => [bel.nodeI, bel.nodeJ].some((nid) => {
        const n = input.nodes.get(nid);
        return n !== undefined
          && Math.hypot(n.x - lift.centre.x, n.y - lift.centre.y) < 0.6
          && (Math.abs(Z(n) - lift.topZ) < 0.05 || Math.abs(Z(n) - lift.baseZ) < 0.05);
      }));
    });

    // Prefer the CONVENTIONAL cage, and depart from it only where the departure is
    // necessary. Measured: choosing the widest channel everywhere unblocks beam threading
    // (244 emptied domains → 125) and still ends up WORSE overall, 2,579 → 3,090 conflicts,
    // because packing the face bars to the corners spends in column-to-column and
    // column-to-beam clearance what it buys in plan width. So the criterion is not "which
    // cage helps most" but "does the ordinary cage leave a beam with NO legal layout at
    // all" — an unusual detail is worth its cost only where it is the difference between
    // possible and impossible.
    let best = cands.find((c) => c.arrangement === 'even') ?? cands[0];
    let bestScore = -Infinity;
    for (const cage of cands) {
      let stranded = 0;
      for (const bid of incident) {
        const bctx = input.contexts.get(bid);
        const bel = input.elements.get(bid);
        const accepted = input.outcomes.get(bid)?.accepted;
        const groups = accepted ? beamGroups(accepted) : null;
        if (!bctx || !bel || !groups) continue;
        const nI = input.nodes.get(bel.nodeI);
        const nJ = input.nodes.get(bel.nodeJ);
        if (!nI || !nJ) continue;
        const dx = nJ.x - nI.x, dy = nJ.y - nI.y;
        const L = Math.hypot(dx, dy) || 1;
        const t = { x: dy / L, y: -dx / L };
        const dia = Math.max(groups.bottom.diameterMm, groups.topStart.diameterMm);
        const count = Math.max(groups.bottom.count, groups.topStart.count, groups.topEnd.count);
        const clearWidth = Math.max(0.02,
          bctx.section.b - 2 * (bctx.material.cover + bctx.material.stirrupDia / 1000));
        const keep = cageKeepOuts(cage, dia, t, DEFAULT_TOLERANCES.placement);
        const domain = generateLayoutCandidates({
          count, diameterMm: dia, clearWidth, edition: input.edition,
          maxAggregateSizeMm: input.maxAggregateSizeMm, memberKind: 'beam',
          placementTolerance: DEFAULT_TOLERANCES.placement,
        });
        if (!domain.some((c) => candidateClears(c, dia, keep).ok)) stranded++;
      }
      // Fewest stranded beams wins. Ties go to the conventional arrangement, then to fewer
      // crossties — a cage needing extra restraint steel is a worse drawing at equal
      // benefit — then to the stable id so the choice cannot depend on iteration order.
      const conventional = cage.arrangement === 'even' ? 1 : 0;
      const score = -stranded * 1000 + conventional * 100 - cage.crossties.length;
      if (score > bestScore || (score === bestScore && cage.id < best.id)) {
        bestScore = score;
        best = cage;
      }
    }
    // NOT SHIPPED YET, and the measurements say why.
    //
    // The scoring below is real and its answer is recorded, but no arrangement from this
    // module is applied to the drawing, because every variant measured WORSE than the
    // generator's existing cage while the beam search still fails:
    //
    //   existing cage, beams unresolved            2,579 conflicts
    //   clustered everywhere                       3,090   (+20%)
    //   clustered only where beams are stranded    3,090   (chosen everywhere anyway)
    //   this module's 'even', extras on 4 faces    2,921   (+13%)
    //
    // The cause is not that the cages are bad. It is that with the search unresolved NO
    // beam layout is applied at all, so a cage is only ever measured against default
    // centred beams — and a tighter cage then simply scores worse. Clustering unblocks
    // beam threading properly (244 stranded domains → 125); it cannot show its benefit
    // until the assignment it enables is actually used.
    //
    // So the arrangement is chosen, scored and reported as evidence, and adoption waits on
    // the search closing. Shipping a measured regression because the reasoning behind it
    // is sound would be the same mistake as the two threading heuristics before it.
    cageChoiceRationale.set(stackId, best.arrangement);
    conventionalCage.set(stackId, cands.find((c) => c.arrangement === 'even') ?? cands[0]);
  }

  for (const [stackId, liftsRaw] of stacks) {
    const first = liftsRaw[0];
    const ctx = input.contexts.get(first.elementId);
    if (!ctx) continue;
    const cands = generateColumnCandidates({
      count: first.bars.count, diameterMm: first.bars.diameterMm,
      b: first.b, h: first.h, cover: first.cover, tieDiaMm: first.tieDia,
      edition: input.edition, maxAggregateSizeMm: input.maxAggregateSizeMm,
      placementTolerance: DEFAULT_TOLERANCES.placement,
    });
    if (cands.length > 0) cageFor.set(stackId, cands[0]);
  }

  for (const [stackId, liftsRaw] of stacks) {
    const lifts = [...liftsRaw].sort((a, b) => a.baseZ - b.baseZ);
    const first = input.contexts.get(lifts[0].elementId)!;
    const anchor = anchorageFunctions({
      fy: first.material.fy, fc: first.material.fc,
      // Column bars are vertical, so the top-bar factor does not apply; spacing in a tied
      // column with the code's own tie requirements satisfies the favourable row.
      favourableSpacing: true, psiT: 1.0,
      maxAggregateSizeMm: input.maxAggregateSizeMm as never,
      edition: input.edition,
    } as never);

    // Beam depth at the joint above each lift, for the splice-free zone.
    const beamDepthAtTop = new Map<number, number>();
    lifts.forEach((lift, i) => {
      let depth = 0;
      for (const bId of beams) {
        const bEl = input.elements.get(bId);
        const bCtx = input.contexts.get(bId);
        if (!bEl || !bCtx) continue;
        for (const nid of [bEl.nodeI, bEl.nodeJ]) {
          const n = input.nodes.get(nid);
          if (!n) continue;
          if (Math.abs(Z(n) - lift.topZ) < 0.05
            && Math.hypot(n.x - lift.centre.x, n.y - lift.centre.y) < 0.6) {
            depth = Math.max(depth, bCtx.section.h);
          }
        }
      }
      if (depth > 0) beamDepthAtTop.set(i, depth);
    });

    const gen = generateColumnStack({
      stackId, lifts,
      fc: first.material.fc, fy: first.material.fy,
      maxAggregateSizeMm: input.maxAggregateSizeMm,
      edition: input.edition,
      lapSplice: anchor.lapSplice,
      // The cage from `column-candidates`, which distributes the non-corner bars around
      // ALL FOUR faces and validates §25.2.3 before returning.
      //
      // The generator's own fallback crams every extra bar onto the two ±y faces. For the
      // flagship's 24Ø12 and 28Ø12 columns that is 20-plus bars on two faces at roughly
      // 8 mm clear, against the 40 mm the article requires — an illegal cage, drawn without
      // complaint, which then blocked every beam framing into that joint. It is the reason
      // 120 beams were reported impossible to thread.
      barPositions: conventionalCage.get(stackId)?.slots.map((sl) => ({ x: sl.dx, y: sl.dy })),
      beamDepthAtTop,
      // ── §25.4.1.2: a hook anchors tension, never compression ──
      //
      // This was hardcoded `true`, so every roof column bar got a 90° hook whatever it
      // carried. On a compression-only column the clause does not merely make the hook
      // unnecessary, it FORBIDS using one for anchorage — and the 12db horizontal
      // extension it produced ran straight through the beam's top mat at every roof joint.
      //
      // The question the clause asks is whether the bar needs TENSION development. Two
      // ways it can: net axial tension in some combination, or an eccentricity large
      // enough to open tension on a face. Both are checked; either one calls for a hook.
      roofTermination: topLiftNeedsTension(lifts),
    });

    // ── Attribute each bar to the lift that owns it ──
    //
    // The stack is generated as a unit because splices, transitions and the splice-free
    // zone through each joint only make sense across lifts. But an ASSEMBLY is per member:
    // filing the whole stack under its lowest lift left every other lift owned by nothing,
    // which is how 140 verified columns vanished from the UI, the schedule and the
    // drawings while the run still reported success.
    const byOwner = new Map<number, BarPath[]>();
    for (const bar of gen.bars) {
      // A bar with no owner (a splice bar spanning a transition) is filed with the lift it
      // starts in, so it is drawn and scheduled exactly once.
      const owners = bar.ownerElementIds.length > 0
        ? bar.ownerElementIds
        : [nearestLiftTo(bar, lifts)];
      const owner = owners[0];
      byOwner.set(owner, [...(byOwner.get(owner) ?? []), bar]);
    }

    const stackRefs = [...gen.refs, ...anchor.refs];
    const stackMaturity = deriveMaturity({
      implemented: true, refs: stackRefs, benchmarks: [],
    }).maturity;

    for (const lift of lifts) {
      const bars = byOwner.get(lift.elementId) ?? [];
      memberBarsById.set(lift.elementId, {
        elementId: lift.elementId,
        bars,
        // Stack-level conditions are reported once, on the lowest lift, so a single
        // unsupported condition does not multiply by the number of storeys.
        unsupported: lift.elementId === lifts[0].elementId ? gen.unsupported : [],
        maturity: stackMaturity,
        refs: stackRefs,
        trace: lift.elementId === lifts[0].elementId ? gen.trace : [],
      });
      if (bars.length === 0) {
        skipped.push({ elementId: lift.elementId, key: 'detailing.skip.liftProducedNoBars' });
      }
    }
  }

  /**
   * Choose every beam's transverse arrangement GLOBALLY, before any bar is generated.
   *
   * Two per-joint heuristics were built and measured before this and both made the
   * flagship worse, for the same structural reason: a beam spans two joints, so its
   * transverse position is one decision that has to hold at both ends, and fixing one end
   * at a time makes each fix undo the last.
   *
   * So the decision is taken once, for every beam at once, by the coordination search:
   * each beam gets a domain of complete legal layouts, each joint contributes the column
   * cage its beams must thread past, and the search finds an assignment satisfying all of
   * them together — or reports which of the four honest outcomes applies.
   */
  function coordinateBeamLayouts(): {
    slots: Map<number, number[]>;
    /** Layer index per slot, parallel to `slots`. */
    slotLayers: Map<number, number[]>;
    result: CoordinationResult;
    /** The joints the assignment closed, ready for `materialiseLaps`. */
    transitions: PlannedTransition[];
  } {
    const placement = DEFAULT_TOLERANCES.placement;
    const members: MemberVariable[] = [];
    const perBeam = new Map<number, {
      dia: number; count: number; t: { x: number; y: number };
      botDia: number; topDia: number;
    }>();

    for (const id of beams) {
      const ctx = input.contexts.get(id);
      const el = input.elements.get(id);
      const accepted = input.outcomes.get(id)?.accepted;
      const groups = accepted ? beamGroups(accepted) : null;
      if (!ctx || !el || !groups) continue;
      const nI = input.nodes.get(el.nodeI);
      const nJ = input.nodes.get(el.nodeJ);
      if (!nI || !nJ) continue;

      const dx = nJ.x - nI.x, dy = nJ.y - nI.y;
      const L = Math.hypot(dx, dy) || 1;
      // Must match `transverseAxis(axis, up)` in the generator, which is axis × up.
      const t = { x: dy / L, y: -dx / L };

      // The widest group governs: one arrangement serves the whole member.
      const count = Math.max(groups.bottom.count, groups.topStart.count, groups.topEnd.count);
      const dia = Math.max(
        groups.bottom.diameterMm, groups.topStart.diameterMm, groups.topEnd.diameterMm);
      const clearWidth = Math.max(0.02,
        ctx.section.b - 2 * (ctx.material.cover + ctx.material.stirrupDia / 1000));

      const lockedAcross = (input.lockedBars ?? [])
        .filter((b) => b.ownerElementIds.includes(id))
        .map((b) => {
          const p = b.segments[0]?.start;
          if (!p) return null;
          return (p.x - nI.x) * t.x + (p.y - nI.y) * t.y;
        })
        .filter((x): x is number => x !== null);

      // The UNION of both ends' cages. A straight bar holds one transverse position along
      // its whole length, so the arrangement has to clear every joint it passes through —
      // and the generator needs to see them all to offer a channel-aware alternative.
      const endObstacles: KeepOut[] = [];
      for (const n of [nI, nJ]) {
        for (const c of columnBarsNear(n)) {
          endObstacles.push({
            at: (c.x - n.x) * t.x + (c.y - n.y) * t.y,
            halfWidth: c.diameterMm / 2000 + placement,
          });
        }
      }

      const domain = generateLayoutCandidates({
        count, diameterMm: dia, clearWidth, edition: input.edition,
        maxAggregateSizeMm: input.maxAggregateSizeMm, memberKind: 'beam',
        placementTolerance: placement,
        lockedAcross: lockedAcross.length > 0 ? lockedAcross : undefined,
        obstacles: endObstacles.length > 0 ? endObstacles : undefined,
      });
      if (domain.length === 0) continue;

      perBeam.set(id, {
        dia, count, t,
        botDia: groups.bottom.diameterMm,
        topDia: Math.max(groups.topStart.diameterMm, groups.topEnd.diameterMm),
      });
      members.push({ elementId: id, domain, diameterMm: dia, neighbours: [] });
    }

    // Joints: one per node where beams meet, carrying the column cage as keep-outs.
    const byNode = new Map<number, number[]>();
    for (const id of perBeam.keys()) {
      const el = input.elements.get(id)!;
      for (const nid of [el.nodeI, el.nodeJ]) {
        byNode.set(nid, [...(byNode.get(nid) ?? []), id]);
      }
    }

    const joints: JointConstraint[] = [];
    for (const [nodeId, ids] of [...byNode.entries()].sort((a, b) => a[0] - b[0])) {
      const n = input.nodes.get(nodeId);
      if (!n) continue;
      const cage = columnBarsNear(n);
      if (cage.length === 0 && ids.length < 2) continue;

      const keepOutsFor = new Map<number, KeepOut[]>();
      for (const id of ids) {
        const info = perBeam.get(id)!;
        // A beam bar CROSSES a column bar; it does not run alongside it. §25.2.3 governs
        // the spacing between a column's own longitudinals, and the classifier that judges
        // the finished cage requires zero clear distance for a crossing — crossing bars are
        // tied in contact. Demanding 40 mm here made the search stricter than the check it
        // feeds, and declared infeasible what the checker would have passed.
        //
        // What a crossing genuinely needs is not to INTERPENETRATE, with the placement
        // tolerance as the guard.
        keepOutsFor.set(id, cage.map((c) => ({
          at: (c.x - n.x) * info.t.x + (c.y - n.y) * info.t.y,
          halfWidth: c.diameterMm / 2000 + placement,
        })));
      }
      joints.push({
        jointId: `n${nodeId}`,
        elementIds: [...ids].sort((a, b) => a - b),
        keepOutsFor,
        // Is a code-legal splice available between two collinear layouts? §25.5.1.2's
        // contact lap is the ordinary answer and needs no plan separation at all.
        transitionExists: (aId, aLayout, bId, bLayout) => {
          const ia = perBeam.get(aId);
          const ib = perBeam.get(bId);
          if (!ia || !ib) return false;
          const ctxA = input.contexts.get(aId);
          if (!ctxA) return false;
          const dev = deriveDevelopment({
            diameterMm: Math.max(ia.dia, ib.dia),
            fy: ctxA.material.fy, fc: ctxA.material.fc,
            favourableSpacing: true, edition: input.edition,
          });
          return transitionExists(
            aLayout.slots.map((sl) => sl.across),
            bLayout.slots.map((sl) => sl.across),
            Math.max(ia.dia, ib.dia), dev,
            {
              // Provided/required at a support is routinely ≥ 2 for the continuing steel,
              // but the conservative default is Class B and it is what is assumed here.
              areaRatio: 1.0,
              // A lap at a support reaches into BOTH adjacent spans, so the room available
              // is half of each, not half of one. Counting only the near span refused a
              // legal lap on any member whose own half-length was shorter than the lap —
              // which on the flagship was the single remaining stranded beam.
              availableLength: (ctxA.L + (input.contexts.get(bId)?.L ?? ctxA.L)) / 2,
              edition: input.edition,
              maxAggregateSizeMm: input.maxAggregateSizeMm,
            });
        },
        relation: (a, b) => {
          const ta = perBeam.get(a)?.t;
          const tb = perBeam.get(b)?.t;
          if (!ta || !tb) return 'independent';
          // Same plan axis: the two beams continue through this support as one run, so
          // their bars must line up. Different axis: the layer allocation stacks them.
          return Math.abs(ta.x * tb.x + ta.y * tb.y) > 0.7 ? 'collinear' : 'crossing';
        },
      });
    }

    // ── Identify beam LINES so the exact chain DP can run ──
    //
    // The DP was dead code: `dpStates` read 0 on every flagship run because no member
    // ever carried a lineId, so every collinear constraint fell through to propagation and
    // backtracking. Propagation can only remove a candidate that has no compatible partner;
    // it cannot search for the combination that works. Fifty of the fifty-nine remaining
    // stranded members survive their own joints and are removed by a NEIGHBOUR — which is
    // precisely the case a chain DP solves exactly and arc consistency cannot.
    //
    // A line is a maximal run of beams that meet end to end on the same plan axis. Members
    // are unioned across shared nodes when their axes agree, then ordered along the line.
    const parent = new Map<number, number>();
    const find = (x: number): number => {
      const p = parent.get(x);
      if (p === undefined || p === x) return x;
      const r = find(p);
      parent.set(x, r);
      return r;
    };
    const union = (a: number, b: number) => { parent.set(find(a), find(b)); };
    for (const m of members) parent.set(m.elementId, m.elementId);

    for (const j of joints) {
      for (const a of j.elementIds) {
        for (const b of j.elementIds) {
          if (a >= b) continue;
          if (j.relation(a, b) === 'collinear') union(a, b);
        }
      }
    }

    const lineMembers = new Map<number, number[]>();
    for (const m of members) {
      const root = find(m.elementId);
      lineMembers.set(root, [...(lineMembers.get(root) ?? []), m.elementId]);
    }

    /**
     * Every member's plan axis, for the line-identity invariant below.
     */
    const axisOf = (id: number): { x: number; y: number } | undefined => {
      const t = perBeam.get(id)?.t;
      // perBeam.t is the TRANSVERSE axis; the line runs perpendicular to it.
      return t ? { x: -t.y, y: t.x } : undefined;
    };

    /**
     * Canonical name for a line: its lowest member id, zero-padded.
     *
     * NOT the union-find root, which is whichever member happened to win the last union
     * and therefore depends on the order the members arrived in. That was fine while the
     * id was only a DP grouping key, and became a determinism bug the moment the joint
     * layer allocator started sorting by it — the same floor supplied in a different
     * order got a different rank assignment and therefore different physical geometry.
     */
    const lineName = (ids: readonly number[]): string =>
      `line-${String(Math.min(...ids)).padStart(6, '0')}`;
    for (const [root, ids] of lineMembers) {
      if (ids.length < 2) continue;   // a lone beam is not a chain; leave it to the search
      // Order along the line by the midpoint's projection on the line's own axis, so
      // consecutive DP states really are adjacent members.
      const dir = perBeam.get(ids[0])!.t;
      const along = { x: -dir.y, y: dir.x };
      const keyed = ids.map((id) => {
        const el = input.elements.get(id)!;
        const a = input.nodes.get(el.nodeI)!;
        const b = input.nodes.get(el.nodeJ)!;
        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        return { id, s: mx * along.x + my * along.y };
      }).sort((p, q) => p.s - q.s || p.id - q.id);

      keyed.forEach((k, i) => {
        const m = members.find((x) => x.elementId === k.id);
        if (m) { m.lineId = lineName(ids); m.lineIndex = i; }
      });
    }

    // ── Orthogonal layer allocation, before the search ──
    //
    // Two beams meeting a column from different directions put their bottom steel at the
    // same distance from the soffit, so the bars occupy the same points in space. That was
    // 6,136 of the flagship's 7,246 prohibited overlaps — not a spacing shortfall (§25.2
    // governs PARALLEL bars and says nothing about crossings) but centrelines passing
    // through one another, which nothing makes buildable.
    //
    // The rank is a property of the LINE, decided once for the floor. A bar that changes
    // elevation between joints is not a detail, it is a bar that moves in mid-air.
    /**
     * A line id is a claim: these members are one continuous, collinear physical run.
     *
     * It is checked rather than trusted. Union-find will happily merge two perpendicular
     * members if any single relation call mislabels them, and the id would then be used to
     * decide bar elevations for both — silently, because a wrong grouping looks exactly
     * like a right one from the outside. Everything downstream of the crossing graph rests
     * on this claim, so it is verified where it is made.
     */
    const lineViolations: Array<{ lineId: string; a: number; b: number; dot: number }> = [];
    for (const [root, ids] of lineMembers) {
      if (ids.length < 2) continue;
      for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {
          const da = axisOf(ids[i]);
          const db = axisOf(ids[j]);
          if (!da || !db) continue;
          const dot = Math.abs(da.x * db.x + da.y * db.y);
          // The same 0.7 the relation test uses. Below it the two are not collinear and
          // must not be sharing a line.
          if (dot <= 0.7) {
            lineViolations.push({ lineId: lineName(ids), a: ids[i], b: ids[j], dot });
          }
        }
      }
    }
    for (const v of lineViolations) {
      unsupportedRun.push({
        key: 'detailing.line.notCollinear',
        params: { line: v.lineId, a: v.a, b: v.b, dot: Math.round(v.dot * 100) / 100 },
      });
    }

    const linesForLayering: LineForLayering[] = [];
    for (const [root, ids] of lineMembers) {
      const dir = perBeam.get(ids[0])?.t;
      if (!dir) continue;
      linesForLayering.push({
        lineId: lineName(ids),
        elementIds: ids,
        // perBeam.t is the transverse axis; the line runs perpendicular to it.
        direction: { x: -dir.y, y: dir.x },
        maxBarMm: Math.max(...ids.map((id) => perBeam.get(id)?.dia ?? 0), 0),
        maxBottomMm: Math.max(...ids.map((id) => perBeam.get(id)?.botDia ?? 0), 0),
        maxTopMm: Math.max(...ids.map((id) => perBeam.get(id)?.topDia ?? 0), 0),
      });
    }
    const lineOfMember = new Map<number, string>();
    for (const l of linesForLayering) for (const id of l.elementIds) lineOfMember.set(id, l.lineId);

    const crossings: LineCrossing[] = [];
    const seenCrossing = new Set<string>();
    for (const j of joints) {
      for (const a of j.elementIds) {
        for (const b of j.elementIds) {
          if (a >= b || j.relation(a, b) !== 'crossing') continue;
          const la = lineOfMember.get(a);
          const lb = lineOfMember.get(b);
          if (!la || !lb || la === lb) continue;
          const key = `${j.jointId}|${la < lb ? la : lb}|${la < lb ? lb : la}`;
          if (seenCrossing.has(key)) continue;
          seenCrossing.add(key);
          crossings.push({ a: la, b: lb, jointId: j.jointId });
        }
      }
    }
    layerDiagnostics = {
      lineOfMember: new Map(lineOfMember),
      crossings: [...crossings],
      lineMax: new Map(linesForLayering.map((l) => [l.lineId, l.maxBarMm])),
      // Every pair the joint graph SAW and how it judged it, so a missing crossing edge
      // can be told apart from one that was seen and skipped.
      relations: (() => {
        const out: Array<{ a: number; b: number; jointId: string; relation: string;
          lineA?: string; lineB?: string }> = [];
        for (const j of joints) {
          for (const a of j.elementIds) {
            for (const b of j.elementIds) {
              if (a >= b) continue;
              out.push({
                a, b, jointId: j.jointId, relation: j.relation(a, b),
                lineA: lineOfMember.get(a), lineB: lineOfMember.get(b),
              });
            }
          }
        }
        return out;
      })(),
    };
    layerAllocation = allocateLayers({
      lines: linesForLayering, crossings,
      edition: input.edition,
      extraMargin: input.spacingMargin ?? 0,
    });
    for (const [id, lineId] of lineOfMember) {
      const la = layerAllocation.byLine.get(lineId);
      if (la) {
        layerRaiseOf.set(id, la.bottomRaise);
        layerDropOf.set(id, la.topLower);
      }
    }

    const result = coordinate({ members, joints });
    const slots = new Map<number, number[]>();
    // The layer travels with the position. A candidate arranged in two layers repeats its
    // `across` values by design, and a bare list of them is ambiguous.
    const slotLayers = new Map<number, number[]>();
    for (const [id, layout] of result.assignment) {
      slots.set(id, layout.slots.map((sl) => sl.across));
      slotLayers.set(id, layout.slots.map((sl) => sl.layer ?? 0));
    }

    // ── Plan the physical transition at every joint the assignment closed ──
    //
    // The search only ever asked whether a legal splice EXISTS. That is the right question
    // for arc consistency and the wrong one to stop at: an existence proof does not extend
    // a bar. Here the same clause path is walked again for the assignment that actually
    // won, and this time the schedule is kept — lap length, class, stagger and the
    // longitudinal interval each pair occupies — so `materialiseLaps` can build the steel.
    const transitions: PlannedTransition[] = [];
    for (const [, ids] of lineMembers) {
      if (ids.length < 2) continue;
      const ordered = [...ids].sort((a, b) => {
        const ma = members.find((x) => x.elementId === a);
        const mb = members.find((x) => x.elementId === b);
        return (ma?.lineIndex ?? 0) - (mb?.lineIndex ?? 0);
      });
      for (let i = 0; i + 1 < ordered.length; i++) {
        const aId = ordered[i];
        const bId = ordered[i + 1];
        const la = result.assignment.get(aId);
        const lb = result.assignment.get(bId);
        const ia = perBeam.get(aId);
        const ib = perBeam.get(bId);
        const ctxA = input.contexts.get(aId);
        const ctxB = input.contexts.get(bId);
        if (!la || !lb || !ia || !ib || !ctxA || !ctxB) continue;

        // The shared node IS the joint. Two members on a line that do not share one are
        // not adjacent, whatever their ordering says.
        const ea = input.elements.get(aId);
        const eb = input.elements.get(bId);
        if (!ea || !eb) continue;
        const shared = [ea.nodeI, ea.nodeJ].find((n) => n === eb.nodeI || n === eb.nodeJ);
        if (shared === undefined) continue;
        const jn = input.nodes.get(shared);
        if (!jn) continue;

        const dev = deriveDevelopment({
          diameterMm: Math.max(ia.dia, ib.dia),
          fy: ctxA.material.fy, fc: ctxA.material.fc,
          favourableSpacing: true, edition: input.edition,
        });
        const attempt = planSplice({
          from: la.slots.map((sl) => sl.across),
          to: lb.slots.map((sl) => sl.across),
          diameterMm: Math.max(ia.dia, ib.dia),
          development: dev,
          areaRatio: 1.0,
          groups: 1,
          availableLength: (ctxA.L + ctxB.L) / 2,
          edition: input.edition,
          maxAggregateSizeMm: input.maxAggregateSizeMm,
        });
        if (!attempt.ok || !attempt.schedule) continue;

        // Axis points from the `from` member toward the `to` member, which is the
        // direction the continuing bar travels.
        const bMid = (() => {
          const p = input.nodes.get(eb.nodeI);
          const q = input.nodes.get(eb.nodeJ);
          return p && q ? { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 } : { x: jn.x, y: jn.y };
        })();
        const raw = { x: bMid.x - jn.x, y: bMid.y - jn.y };
        const rl = Math.hypot(raw.x, raw.y) || 1;
        transitions.push({
          jointId: `n${shared}`,
          fromElementId: aId,
          toElementId: bId,
          jointPoint: { x: jn.x, y: jn.y, z: Z(jn) },
          axis: { x: raw.x / rl, y: raw.y / rl, z: 0 },
          across: { x: ia.t.x, y: ia.t.y, z: 0 },
          schedule: attempt.schedule,
        });
      }
    }

    return { slots, slotLayers, result, transitions };
  }

  const layoutChoice = coordinateBeamLayouts();

  // ── Beams ──
  for (const id of beams) {
    const ctx = input.contexts.get(id)!;
    const el = input.elements.get(id);
    const accepted = input.outcomes.get(id)?.accepted;
    const groups = accepted ? beamGroups(accepted) : null;
    if (!el || !groups) { skipped.push({ elementId: id, key: 'detailing.skip.noBeamBars' }); continue; }
    const nI = input.nodes.get(el.nodeI);
    const nJ = input.nodes.get(el.nodeJ);
    if (!nI || !nJ) { skipped.push({ elementId: id, key: 'detailing.skip.missingNode' }); continue; }

    const stations = envelopeStations(ctx);
    if (stations.length < 3) { skipped.push({ elementId: id, key: 'detailing.skip.tooFewStations' }); continue; }

    const anchor = anchorageFunctions({
      fy: ctx.material.fy, fc: ctx.material.fc,
      favourableSpacing: true,
      // §25.4.2.5: top bars with more than 300 mm of concrete cast below take ψt = 1,3.
      psiT: ctx.section.h > 0.3 ? 1.3 : 1.0,
      edition: input.edition,
    } as never);

    const gen = generateBeamBars({
      elementId: id,
      L: ctx.L, b: ctx.section.b, h: ctx.section.h,
      // Raising the steel costs lever arm. The generator must size stirrup zones and
      // curtailment against the depth the bars ACTUALLY have, not the one they were
      // designed with — see the re-verification pass below.
      d: depthAfterRaise(
        ctx.section.h - ctx.material.cover - ctx.material.stirrupDia / 1000,
        layerRaiseOf.get(id) ?? 0),
      cover: ctx.material.cover, stirrupDia: ctx.material.stirrupDia,
      fc: ctx.material.fc, fy: ctx.material.fy,
      maxAggregateSizeMm: input.maxAggregateSizeMm,
      edition: input.edition,
      stations,
      supportI: supportKindAt(el.nodeI, id, input.elements),
      supportJ: supportKindAt(el.nodeJ, id, input.elements),
      vn: Math.max(...stations.map((s) => s.v), 1),
      bottom: groups.bottom, topStart: groups.topStart, topEnd: groups.topEnd,
      lateralSystem: input.lateralSystem?.has(id) ?? false,
      ld: anchor.ld,
      origin: nodePoint(nI),
      axis: unit(nodePoint(nI), nodePoint(nJ)),
      up: { x: 0, y: 0, z: 1 },
      transverseSlots: layoutChoice.slots.get(id),
      transverseLayers: layoutChoice.slotLayers.get(id),
      layerRaise: layerRaiseOf.get(id) ?? 0,
      layerDrop: layerDropOf.get(id) ?? 0,
      bentUp: input.bentUp ?? { seismicDesign: 'unstated', optOut: false },
    } as never);

    for (const [barId, layer] of Object.entries(gen.barLayers)) barLayers.set(barId, layer);
    memberBarsById.set(id, {
      elementId: id,
      bars: gen.bars,
      unsupported: gen.unsupported,
      maturity: deriveMaturity({
        implemented: true, refs: [...gen.refs, ...anchor.refs], benchmarks: [],
      }).maturity,
      refs: [...gen.refs, ...anchor.refs],
      trace: gen.trace,
    });
  }

  // ── Materialise the laps: schedules become steel ──
  //
  // Until this runs, the "coordinated" floor is two members meeting end to end with a
  // compatibility claim between them. Nothing is continuous, nothing is lapped, and the
  // collision engine sees two independent bar sets sharing a joint with no reason to be
  // there. Every conflict count taken before this point was measured on that state.
  const materialised = materialiseLaps({
    barsByMember: new Map([...memberBarsById].map(([id, mb]) => [id, mb.bars])),
    transitions: layoutChoice.transitions,
  });
  for (const [id, bars] of materialised.barsByMember) {
    const mb = memberBarsById.get(id);
    if (mb) mb.bars = bars;
  }
  const laps = lapIndex(materialised.laps);
  lapLookup = (aId: string, bId: string) => {
    const lap = lapBetween(laps, aId, bId);
    return lap ? (lap.kind === 'contactLap' ? 'contact' : 'nonContact') : undefined;
  };

  // ── Authoritative re-verification at the FINAL geometry ──
  //
  // The layer allocation moved steel, and lever arm is what flexure is made of. A rank-1
  // line on Ø16 bars loses 16 mm of d, and on a shallow member that is the difference
  // between passing and not. On top of that sits Table 26.6.2.1(a)'s unfavourable
  // tolerance on d, which is a real prescribed number and applies whether or not anything
  // moved.
  //
  // Without a verifier nothing is reverified and `reverifiedMembers` stays at zero. That
  // is the honest reading: the check was not run, so the claim is not available.
  /**
   * One explicit record per applicable element. Silence is a failing invariant.
   *
   * `noBars` is not the same as `fail`: a member the generator produced no physical steel
   * for has nothing to reverify, and reporting that as a verification failure would send
   * an engineer looking at the wrong thing. It is still not a pass.
   */
  const reverification = new Map<number, 'ok' | 'warn' | 'fail' | 'noBars' | 'noVerifier'>();
  if (input.reverify) {
    for (const [id, ctx] of input.contexts) {
      // Every applicable element gets a record, including one with no generated bars.
      // Skipping those silently is how the gate came to count `elementIds.length` as
      // applicable while only ever reverifying the subset that had geometry.
      if (!memberBarsById.has(id)) {
        reverification.set(id, 'noBars');
        continue;
      }
      const nominalD = ctx.section.h - ctx.material.cover - ctx.material.stirrupDia / 1000;
      const tol = prescribedTolerances(nominalD, ctx.material.cover, input.edition);
      // Each face carries its OWN movement.
      //
      // Passing the worse of the two to both was a conservative simplification, and on this
      // fixture it was conservative enough to matter: beams 7 and 8 came out at ratio 1,031
      // — three per cent over — by being charged the top face's drop on the bottom face as
      // well. The two are tracked separately upstream and there is no reason to merge them.
      // Table 26.6.2.1(a)'s tolerance applies to both, because it applies to d itself.
      reverification.set(id, input.reverify(id, {
        bottomRaise: layerRaiseOf.get(id) ?? 0,
        topLower: layerDropOf.get(id) ?? 0,
        depthTolerance: tol.depth,
      }));
    }
  }
  const reverifiedOk = [...reverification.values()]
    .filter((v) => v === 'ok' || v === 'warn').length;
  const reverifyFailures = [...reverification.entries()]
    .filter(([, v]) => v === 'fail').map(([id]) => id);

  // ── Group into one assembly per level, and coordinate each ──
  const levelOf = (id: number): number => {
    const el = input.elements.get(id);
    if (!el) return 0;
    const a = input.nodes.get(el.nodeI);
    const b = input.nodes.get(el.nodeJ);
    // A beam sits at its own level; a column stack is filed at the level it starts from.
    return Math.round(Math.max(Z(a ?? { id: 0, x: 0, y: 0 }), Z(b ?? { id: 0, x: 0, y: 0 })) * 100) / 100;
  };

  const byLevel = new Map<number, MemberBars[]>();
  for (const [id, mb] of memberBarsById) {
    const lvl = levelOf(id);
    const list = byLevel.get(lvl) ?? [];
    list.push(mb);
    byLevel.set(lvl, list);
  }

  /**
   * Plan offsets of the column bars at each level, taken from the bars the generator
   * actually produced rather than recomputed. Threading has to dodge the real cage.
   */
  const columnBarsAtLevel = (level: number, centre: { x: number; y: number }) => {
    const out: Array<{ id: string; diameterMm: number; dx: number; dy: number }> = [];
    for (const mb of memberBarsById.values()) {
      const ctx = input.contexts.get(mb.elementId);
      if (ctx?.elementType !== 'column') continue;
      for (const bar of mb.bars) {
        const zs = bar.segments.flatMap((sg) => [sg.start.z, sg.end.z]);
        // The bar must actually pass through this level to obstruct it.
        if (Math.min(...zs) > level + 0.02 || Math.max(...zs) < level - 0.02) continue;
        const p = bar.segments[0]?.start;
        if (!p) continue;
        const dx = p.x - centre.x;
        const dy = p.y - centre.y;
        if (Math.hypot(dx, dy) > 1.5) continue;   // a different column line
        out.push({ id: bar.id, diameterMm: bar.diameterMm, dx, dy });
      }
    }
    return out.sort((a, b) => a.id.localeCompare(b.id));
  };

  /** Owning members per bar id, for attributing materialised geometry to an assembly. */
  const barOwner = new Map<string, number[]>();
  for (const mb of memberBarsById.values()) {
    for (const b of mb.bars) barOwner.set(b.id, b.ownerElementIds);
  }

  /**
   * Prohibited physical overlaps touching these members.
   *
   * Filled in after each assembly is coordinated — an assembly's own conflict list is the
   * authoritative count, and guessing it ahead of time is how a gate ends up measuring
   * something other than what it claims.
   */
  const prohibitedByElement = new Map<number, number>();
  const prohibitedFor = (ids: readonly number[]): number =>
    ids.reduce((n, id) => n + (prohibitedByElement.get(id) ?? 0), 0);

  /** Spacing assessments that failed, across the run. Zero until the gate is wired. */
  const spacingFailures = { codeLegal: 0, placementRobust: 0 };

  const assemblies: DetailingAssembly[] = [];
  const coordination: FloorCoordinationResult[] = [];

  for (const [level, members] of [...byLevel.entries()].sort((a, b) => a[0] - b[0])) {
    const elementIds = members.map((m) => m.elementId).sort((a, b) => a - b);
    const joints = buildJoints(level, beams, columns, input);

    const result = coordinateFloor({
      assemblyId: `level-${level.toFixed(2)}`,
      // The label is data, not prose: the UI renders `detailing.assembly.level` with it.
      label: level.toFixed(2),
      labelKey: 'detailing.assembly.level',
      labelParams: { level: level.toFixed(2) },
      kind: 'beamLine',
      elementIds,
      members,
      joints,
      edition: input.edition,
      verifierId: input.verifierId,
      demandRevision: input.demandRevision,
      previousRevision: input.previousRevision,
      cover: members.length > 0
        ? (input.contexts.get(members[0].elementId)?.material.cover ?? 0.025) : 0.025,
      tieDia: members.length > 0
        ? (input.contexts.get(members[0].elementId)?.material.stirrupDia ?? 8) : 8,
      maxAggregateSizeMm: input.maxAggregateSizeMm,
      membersVerified: true,
      coordinated: true,
      lockedBars: input.lockedBars,
      // Without this the joint coordinator's layer allocation is recorded and never
      // applied, and every pair of beams meeting at a column overlaps.
      jointVolumes: joints.map((j) => {
        const n = input.nodes.get(j.nodeId)!;
        const cctx = input.contexts.get(j.elementIds[0]);
        return {
          id: j.id, nodeId: j.nodeId,
          centre: { x: n.x, y: n.y, z: Z(n) },
          columnB: j.columnB, columnH: j.columnH,
          cover: cctx?.material.cover ?? 0.025,
          tieDia: cctx?.material.stirrupDia ?? 8,
          columnBars: columnBarsAtLevel(Z(n), { x: n.x, y: n.y }),
          beams: j.beams.map((b) => ({
            elementId: b.elementId,
            direction: b.direction,
            depth: b.depth,
            width: input.contexts.get(b.elementId)?.section.b ?? 0.2,
          })),
        };
      }),
      memberKindOf: (id) => input.contexts.get(id)?.elementType,
      layerOf: (barId) => barLayers.get(barId),
      // Materialised laps are a detail, not a defect. Before materialisation this is
      // undefined and every pair is judged by plain clear spacing, which is correct.
      isLapPair: (a, b) => lapLookup?.(a, b),
      nodePositionOf: (id) => {
        const n = input.nodes.get(id);
        return n ? { x: n.x, y: n.y, z: Z(n) } : undefined;
      },
    });
    // ── The twelve conditions, measured on what coordination ACTUALLY produced ──
    //
    // Second pass on purpose. The conflict count is an output of coordination, so a gate
    // evaluated before it runs is a gate measuring zero conflicts on every model — which
    // is precisely the shape of the defect being fixed here.
    const prohibited = result.assembly.conflicts
      .filter((c) => c.pairClass === 'prohibitedOverlap').length;
    const assessment = assessConstructibility({
      // "Complete envelope" here means: no applicable member of this assembly was left
      // out of the search.
      //
      // NOT the beamLayoutsOnly/beamsAndColumns distinction. That qualifier bounds
      // NEGATIVE verdicts — you may not call detailing INADEQUATE on the strength of a
      // partial search, because the unsearched part might have contained the answer. It
      // does not bound a positive one: a clash-free, fully reverified, placement-robust
      // cage is buildable no matter how narrow the search that found it was. A narrower
      // search succeeding is better news, not worse.
      //
      // What genuinely would invalidate a positive claim is a member that never entered
      // the search at all, because then the cage being judged is not the whole cage.
      completeEnvelope: !skipped.some((sk) => elementIds.includes(sk.elementId))
        && elementIds.every((e) => memberBarsById.has(e)),
      searchTruncated: layoutChoice.result.stats.truncated,
      applicableMembers: elementIds.length,
      assignedMembers: elementIds.filter((e) =>
        layoutChoice.slots.has(e) || input.contexts.get(e)?.elementType !== 'beam').length,
      selectedTransitions: layoutChoice.transitions
        .filter((t) => elementIds.includes(t.fromElementId)).length,
      materialisedTransitions: layoutChoice.transitions
        .filter((t) => elementIds.includes(t.fromElementId)).length
        - materialised.unmaterialised
          .filter((u) => layoutChoice.transitions
            .some((t) => t.jointId === u.jointId && elementIds.includes(t.fromElementId)))
          .length,
      unmaterialisedTransitions: materialised.unmaterialised
        .filter((u) => layoutChoice.transitions
          .some((t) => t.jointId === u.jointId && elementIds.includes(t.fromElementId)))
        .length,
      prohibitedConflicts: prohibited,
      reverifiedMembers: elementIds.filter((e) => {
        const v = reverification.get(e);
        return v === 'ok' || v === 'warn';
      }).length,
      // A certificate describes the geometry it was checked against.
      //
      // The first version of this refused any member whose steel had moved, on the grounds
      // that its certificate described a cage that no longer existed. That was right before
      // re-verification existed and wrong after: `reverify(id, depthLoss)` re-runs the
      // authoritative verifier at the member's FINAL effective depth — the joint-layer
      // movement plus Table 26.6.2.1(a)'s unfavourable tolerance — so a member that passes
      // it has a certificate for the geometry that is actually there.
      //
      // What still does not match is a member that was never rechecked, or was rechecked
      // and failed. Both are counted as mismatches, and a member with no verifier call at
      // all is a mismatch rather than a silent pass.
      certificateHashMatches: elementIds.filter((e) => {
        const v = reverification.get(e);
        return v === 'ok' || v === 'warn';
      }).length,
      spacingNotCodeLegal: result.assembly.conflicts
        .filter((c) => c.pairClass === 'sameLayerSpacing'
          || c.pairClass === 'betweenLayerSpacing' || c.pairClass === 'crossMemberSpacing')
        .length,
      // Placement robustness: does the cage still comply once every bar is allowed to sit
      // at the unfavourable end of the project's margin?
      //
      // At the default zero margin the question is IDENTICAL to code legality — there is
      // no allowance to erode — so the answer is the code-legal count and no second pass
      // is run. A positive margin is a real, separate question and gets a real, separate
      // measurement: the same authoritative collision check with every requirement raised
      // by the margin.
      spacingNotPlacementRobust: spacingMargin <= 0
        ? 0
        : detectCollisions(
          result.assembly.bars,
          DEFAULT_TOLERANCES,
          undefined,
          (a, b, surface) => {
            const base = classifyForRun(a, b, surface);
            // Contact classes have no minimum to raise. A lap is meant to touch and a
            // stirrup is meant to grip; adding a margin to zero would report the detail.
            return base.requiredClear <= 0
              ? base
              : { ...base, requiredClear: base.requiredClear + spacingMargin };
          },
        ).conflicts.filter((c) => c.severity !== 'marginal').length,
      unsupportedRules: result.assembly.unsupported.length + unsupportedRun.length,
      staleAssemblies: 0,
    });
    const gated = evaluateState({
      bars: result.assembly.bars,
      conflicts: result.assembly.conflicts,
      unsupported: result.assembly.unsupported,
      membersVerified: true,
      coordinated: true,
      constructibility: assessment,
    });
    // The coordinator's own state is the ceiling set by the conditions the gate does not
    // cover — members failing their individual checks, coordination not converging, no
    // bars at all. Below COORDINATED those decide and the gate has nothing to add. At or
    // above it, the twelve conditions decide.
    assemblies.push({
      ...result.assembly,
      state: reviewRank(result.assembly.state) < reviewRank('COORDINATED')
        ? result.assembly.state
        : gated.state,
      // The coordinator evaluated the ladder before the gate existed for this assembly,
      // so its blockers still say "not assessed". Replacing them keeps a single account of
      // why the state is what it is; two disagreeing lists is worse than none.
      stateBlockers: reviewRank(result.assembly.state) < reviewRank('COORDINATED')
        ? result.assembly.stateBlockers
        : gated.blockers,
      constructibility: assessment,
    });
    coordination.push(result);
  }

  return {
    assemblies, readiness, coordination, skipped,
    layoutSearch: layoutChoice.result,
    layering: layerDiagnostics ? {
      ...layerDiagnostics,
      byLine: layerAllocation?.byLine ?? new Map(),
      unresolved: layerAllocation?.unresolved ?? [],
      ranks: layerAllocation?.ranks ?? 1,
    } : undefined,
    lapping: {
      laps: materialised.laps,
      fused: materialised.fused.length,
      unmaterialised: materialised.unmaterialised,
    },
  };
}

/** Beam-column joints at one level, with the incident beams in plan. */
function buildJoints(
  level: number, beams: number[], columns: number[], input: RunDetailingInput,
): JointInput[] {
  const joints: JointInput[] = [];
  for (const cid of columns) {
    const cEl = input.elements.get(cid);
    const cCtx = input.contexts.get(cid);
    if (!cEl || !cCtx) continue;
    const nI = input.nodes.get(cEl.nodeI);
    const nJ = input.nodes.get(cEl.nodeJ);
    if (!nI || !nJ) continue;
    const top = Z(nI) >= Z(nJ) ? nI : nJ;
    if (Math.abs(Z(top) - level) > 0.05) continue;

    const incident: IncidentBeamAtJoint[] = [];
    const elementIds = [cid];
    for (const bid of beams) {
      const bEl = input.elements.get(bid);
      const bCtx = input.contexts.get(bid);
      if (!bEl || !bCtx) continue;
      const bI = input.nodes.get(bEl.nodeI);
      const bJ = input.nodes.get(bEl.nodeJ);
      if (!bI || !bJ) continue;
      const at = bEl.nodeI === top.id ? bI : bEl.nodeJ === top.id ? bJ : null;
      if (!at) continue;
      const far = bEl.nodeI === top.id ? bJ : bI;
      const dx = far.x - at.x, dy = far.y - at.y;
      const L = Math.hypot(dx, dy) || 1;
      const accepted = input.outcomes.get(bid)?.accepted;
      const g = accepted ? beamGroups(accepted) : null;
      incident.push({
        elementId: bid,
        direction: { x: dx / L, y: dy / L },
        depth: bCtx.section.h,
        topDiameterMm: g?.topStart.diameterMm ?? 16,
        continuous: supportKindAt(top.id, bid, input.elements) === 'continuous',
      });
      elementIds.push(bid);
    }
    if (incident.length === 0) continue;

    // A column continues above when another column-like member starts at this node.
    let columnAbove = false;
    for (const other of columns) {
      if (other === cid) continue;
      const oEl = input.elements.get(other);
      if (!oEl) continue;
      const a = input.nodes.get(oEl.nodeI);
      const b = input.nodes.get(oEl.nodeJ);
      if (!a || !b || !isColumnLike(a, b)) continue;
      const base = Z(a) <= Z(b) ? a : b;
      if (base.id === top.id) { columnAbove = true; break; }
    }

    joints.push({
      id: `joint-${top.id}`,
      nodeId: top.id,
      beams: incident,
      columnAbove,
      columnB: cCtx.section.b,
      columnH: cCtx.section.h,
      elementIds: [...new Set(elementIds)].sort((a, b) => a - b),
    });
  }
  return joints;
}
