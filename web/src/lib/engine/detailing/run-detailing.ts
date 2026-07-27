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
import { minClearSpacingColumn } from '../../codes/cirsoc201/spacing';
import { coordinateFloor, type FloorCoordinationResult, type JointInput, type MemberBars } from './coordinate-floor';
import type { DetailingAssembly } from './assembly';
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
      layoutSearch: {
        outcome: 'CONSTRUCTIBLE', envelope: 'beamsAndColumns',
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
    const out: Array<{ diameterMm: number; x: number; y: number }> = [];
    for (const mb of memberBarsById.values()) {
      if (input.contexts.get(mb.elementId)?.elementType !== 'column') continue;
      for (const bar of mb.bars) {
        const p = bar.segments[0]?.start;
        if (!p) continue;
        if (Math.hypot(p.x - n.x, p.y - n.y) > 1.0) continue;
        const zs = bar.segments.flatMap((sg) => [sg.start.z, sg.end.z]);
        if (Math.min(...zs) > Z(n) + 0.02 || Math.max(...zs) < Z(n) - 0.02) continue;
        out.push({ diameterMm: bar.diameterMm, x: p.x, y: p.y });
      }
    }
    return out;
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
      beamDepthAtTop,
      roofTermination: true,
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
    result: CoordinationResult;
  } {
    const placement = DEFAULT_TOLERANCES.placement;
    const members: MemberVariable[] = [];
    const perBeam = new Map<number, { dia: number; count: number; t: { x: number; y: number } }>();

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

      const domain = generateLayoutCandidates({
        count, diameterMm: dia, clearWidth, edition: input.edition,
        maxAggregateSizeMm: input.maxAggregateSizeMm, memberKind: 'beam',
        placementTolerance: placement,
        lockedAcross: lockedAcross.length > 0 ? lockedAcross : undefined,
      });
      if (domain.length === 0) continue;

      perBeam.set(id, { dia, count, t });
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

    const result = coordinate({ members, joints });
    const slots = new Map<number, number[]>();
    for (const [id, layout] of result.assignment) {
      slots.set(id, layout.slots.map((sl) => sl.across));
    }
    return { slots, result };
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
      d: ctx.section.h - ctx.material.cover - ctx.material.stirrupDia / 1000,
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
      nodePositionOf: (id) => {
        const n = input.nodes.get(id);
        return n ? { x: n.x, y: n.y, z: Z(n) } : undefined;
      },
    });
    assemblies.push(result.assembly);
    coordination.push(result);
  }

  return {
    assemblies, readiness, coordination, skipped,
    layoutSearch: layoutChoice.result,
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
