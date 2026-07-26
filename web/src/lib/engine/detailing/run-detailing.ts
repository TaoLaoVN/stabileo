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
    return { assemblies: [], readiness, coordination: [], skipped };
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

  return { assemblies, readiness, coordination, skipped };
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
