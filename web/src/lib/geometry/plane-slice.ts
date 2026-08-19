/**
 * plane-slice.ts — taking one frame out of a 3D model.
 *
 * # Why this exists beside the projection
 *
 * Flattening a 3D model onto a plane answers "what does all of this look like
 * from the side", and for a great many structures the answer is a tangle: a
 * warehouse projected onto XZ puts every frame in the building on top of one
 * frame's worth of lines, with the purlins collapsed to points between them.
 * The result solves, and it is not the structure anybody meant.
 *
 * What an engineer usually wants is one frame: the columns and rafters that
 * live on grid line X = 12, drawn on their own. That is a SLICE, not a
 * projection, and it is a different question about the same model.
 *
 * # What a slice takes
 *
 * Everything that LIES IN the chosen plane, within a tolerance. A member that
 * merely crosses the plane — a purlin running perpendicular through it —
 * contributes nothing to a plane frame and is left behind; the caller is told
 * how many, because "eight members were dropped" is the difference between a
 * clean cut and the wrong grid line.
 *
 * The alternative — leaving a node where each crossing member pierces the
 * plane — was considered and rejected: it produces nodes with no member
 * attached to them, which the solver reports as a mechanism rather than as the
 * modelling decision it is.
 *
 * # Why it delegates the hard part
 *
 * Once the subset is chosen, turning it into a 2D model is exactly what
 * `buildSimplified2DModel` already does, correctly and under test: it projects
 * the coordinates, remaps every load and support into the 2D convention, and
 * merges what genuinely coincides. Repeating that here would be a second
 * implementation of the part most likely to be subtly wrong.
 */

import {
  buildSimplified2DModel, type DrawPlane, type SimplifiedResult,
} from './plane-projection';

/**
 * How far off the plane a point may sit and still count as being in it.
 *
 * A millimetre. Coordinates typed by hand land exactly on the grid line, and
 * ones that came from a DXF or an IFC land within a rounding error of it; a
 * tolerance tighter than this rejects the second kind for no reason a user
 * could see, and a looser one starts swallowing a beam 5 cm away that is
 * genuinely part of the next frame.
 */
export const SLICE_TOL = 1e-3;

/** The axis a plane is cut along — the one it does NOT contain. */
export function normalAxis(plane: DrawPlane): 'x' | 'y' | 'z' {
  switch (plane) {
    case 'xy': return 'z';
    case 'xz': return 'y';
    default: return 'x';
  }
}

/** That axis's value for a node. */
export function offsetOf(plane: DrawPlane, n: { x: number; y: number; z?: number }): number {
  switch (plane) {
    case 'xy': return n.z ?? 0;
    case 'xz': return n.y;
    default: return n.x;
  }
}

export interface PlaneOffset {
  /** Distance along the normal axis. */
  value: number;
  /** How many nodes sit there. */
  nodes: number;
  /** How many members lie wholly in that plane — the ones a slice would take. */
  elements: number;
  /**
   * How many supports the cut would bring with it.
   *
   * Reported because it is the single best predictor of whether the resulting
   * model is worth anything: across the shipped 3D library, 30 of the 75
   * possible cuts fail to solve, and 30 of those failures are simply a frame
   * with nothing holding it up — a cut taken at roof level, or along a grid
   * line that never reaches the ground. That is knowable before the cut is
   * made, and a warning beforehand is worth more than the solver's error
   * afterwards.
   */
  supports: number;
  /**
   * How many loads the cut would bring with it.
   *
   * Reported for the same reason `supports` is, and against the opposite
   * failure. A cut with no support fails LOUDLY: the solver refuses and the
   * user is told. A cut with no load fails QUIETLY — the frame solves, every
   * result is zero, and a utilisation map paints it uniformly safe. Across the
   * shipped 3D models, 71 of the 75 cuts on offer discard some load and 16
   * keep members while keeping none at all; `3d-nave-industrial` cut at
   * `xy = 0` keeps eight members and none of its 242 loads.
   *
   * Dropping them is correct — a load on a member the cut did not take has
   * nothing left to act on. Not saying so is what turns a modelling decision
   * into a silent one.
   */
  loads: number;
}

/**
 * The cuts that are actually worth making.
 *
 * Offered rather than left to a blank number field because the useful values
 * are not guessable: they are wherever the model happens to have its grid
 * lines, and a user who mistypes 12.5 for 12 gets an empty slice with nothing
 * to explain why. Sorted, with a count each, so "the frames" and "the two
 * stray nodes at y = 3.2" are told apart at a glance.
 *
 * `elements` counts only members lying WHOLLY in the plane, because that is
 * what the slice will take — an offset with nodes but no members produces an
 * empty frame, and saying so before the cut is cheaper than after.
 */
export function planeOffsets(
  plane: DrawPlane,
  nodes: Iterable<{ id: number; x: number; y: number; z?: number }>,
  elements: Iterable<{ id?: number; nodeI: number; nodeJ: number }>,
  supports: Iterable<{ nodeId: number }> = [],
  loads: Iterable<{ data: Record<string, unknown> }> = [],
  tol = SLICE_TOL,
): PlaneOffset[] {
  const byNode = new Map<number, number>();
  const groups: Array<{ value: number; nodes: number; ids: Set<number> }> = [];

  for (const n of nodes) {
    const o = offsetOf(plane, n);
    byNode.set(n.id, o);
    const g = groups.find((x) => Math.abs(x.value - o) <= tol);
    if (g) { g.nodes++; g.ids.add(n.id); } else {
      groups.push({ value: o, nodes: 1, ids: new Set([n.id]) });
    }
  }

  const counts = new Map<number, number>();
  // Which group each in-plane member belongs to, so a load on it can be counted
  // for the same cut without walking the elements a second time.
  const elementGroup = new Map<number, number>();
  for (const el of elements) {
    const a = byNode.get(el.nodeI);
    const b = byNode.get(el.nodeJ);
    if (a === undefined || b === undefined) continue;
    if (Math.abs(a - b) > tol) continue;   // crosses the plane rather than lying in it
    const g = groups.find((x) => Math.abs(x.value - a) <= tol);
    if (g) {
      counts.set(g.value, (counts.get(g.value) ?? 0) + 1);
      if (el.id !== undefined) elementGroup.set(el.id, g.value);
    }
  }

  const sup = new Map<number, number>();
  for (const s of supports) {
    const o = byNode.get(s.nodeId);
    if (o === undefined) continue;
    const g = groups.find((x) => Math.abs(x.value - o) <= tol);
    if (g) sup.set(g.value, (sup.get(g.value) ?? 0) + 1);
  }

  // Counted by the SAME rule `sliceModelAtPlane` keeps them by, so the number the
  // dialog shows before the cut is the number the cut will honour. A load keyed by
  // neither a node nor a member — a surface load carries `quadId` — belongs to no
  // cut and is counted for none, which is what makes it show up as missing.
  const loadCount = new Map<number, number>();
  for (const l of loads) {
    const d = l.data as { nodeId?: number; elementId?: number };
    let value: number | undefined;
    if (d.nodeId !== undefined) {
      const o = byNode.get(d.nodeId);
      if (o !== undefined) value = groups.find((x) => Math.abs(x.value - o) <= tol)?.value;
    } else if (d.elementId !== undefined) {
      value = elementGroup.get(d.elementId);
    }
    if (value !== undefined) loadCount.set(value, (loadCount.get(value) ?? 0) + 1);
  }

  return groups
    .map((g) => ({
      value: g.value,
      nodes: g.nodes,
      elements: counts.get(g.value) ?? 0,
      supports: sup.get(g.value) ?? 0,
      loads: loadCount.get(g.value) ?? 0,
    }))
    .sort((a, b) => a.value - b.value);
}

export interface SliceStats {
  /** Members left behind because they only crossed the plane. */
  crossingElements: number;
  /** Members left behind because they lie in a different plane entirely. */
  elsewhereElements: number;
  /** Nodes that came through the cut. */
  nodes: number;
  /** Members that came through the cut. */
  elements: number;
  /** Loads that came through the cut. */
  loads: number;
  /**
   * Loads left behind, because what they acted on did not survive the cut.
   *
   * The counterpart of `crossingElements`, and the one that matters more. A cut
   * that loses its supports fails loudly — the solver refuses. A cut that loses
   * its LOAD solves, reports zero everywhere, and reads as a safe structure.
   * Reported so the caller can say so.
   */
  droppedLoads: number;
}

export type SliceResult =
  | { ok: true; model: import('./plane-projection').SimplifiedModel; slice: SliceStats }
  | { ok: false; error: string };

/**
 * Cut the model with a plane and hand back what lies in it, as a 2D model.
 *
 * `error` rather than an empty model when the cut finds nothing: an empty
 * canvas is indistinguishable from a bug, and the caller has enough here to
 * say WHY it was empty — wrong offset, or an offset with nodes but no members
 * joining them.
 */
export function sliceModelAtPlane(
  plane: DrawPlane,
  offset: number,
  nodes: Iterable<{ id: number; x: number; y: number; z?: number }>,
  elements: Iterable<{ id: number; type: string; nodeI: number; nodeJ: number; materialId: number; sectionId: number; releaseI?: { my: boolean; mz: boolean; t: boolean }; releaseJ?: { my: boolean; mz: boolean; t: boolean } }>,
  supports: Iterable<{ id: number; nodeId: number; type: string; [k: string]: unknown }>,
  loads: Iterable<{ type: string; data: Record<string, unknown> }>,
  materials: Map<number, unknown>,
  sections: Map<number, unknown>,
  tol = SLICE_TOL,
): SliceResult {
  const nodeArr = [...nodes];
  const elemArr = [...elements];

  const inPlane = new Set<number>();
  for (const n of nodeArr) {
    if (Math.abs(offsetOf(plane, n) - offset) <= tol) inPlane.add(n.id);
  }

  const keptElements: typeof elemArr = [];
  let crossing = 0;
  let elsewhere = 0;
  for (const el of elemArr) {
    const i = inPlane.has(el.nodeI);
    const j = inPlane.has(el.nodeJ);
    if (i && j) keptElements.push(el);
    // One end in the plane and one out is a member PIERCING it. Both ends out
    // is a member that belongs to some other frame — a different situation,
    // reported separately, because the first is a modelling judgement the user
    // may want to revisit and the second is simply not part of this cut.
    else if (i || j) crossing++;
    else elsewhere++;
  }

  if (inPlane.size === 0) {
    return { ok: false, error: 'slice.empty' };
  }
  if (keptElements.length === 0) {
    return { ok: false, error: 'slice.noElements' };
  }

  /*
   * Only what the cut keeps is handed on. Supports on nodes that did not
   * survive, and loads on members that did not, would otherwise arrive
   * referring to things the 2D model has never heard of.
   */
  const keptElementIds = new Set(keptElements.map((e) => e.id));
  const keptSupports = [...supports].filter((s) => inPlane.has(s.nodeId));
  const allLoads = [...loads];
  const keptLoads = allLoads.filter((l) => {
    const d = l.data as { nodeId?: number; elementId?: number };
    if (d.nodeId !== undefined) return inPlane.has(d.nodeId);
    if (d.elementId !== undefined) return keptElementIds.has(d.elementId);
    // Keyed by neither: a surface load carries `quadId`, and a quad is not
    // something a plane frame can carry. Dropped, and counted as dropped —
    // silently losing the roof pressure is how a slice comes out looking safe.
    return false;
  });

  const built = buildSimplified2DModel(
    plane,
    nodeArr.filter((n) => inPlane.has(n.id)),
    keptElements,
    keptSupports,
    keptLoads,
    materials as Map<number, never>,
    sections as Map<number, never>,
  );
  if (!built.ok) return built as SimplifiedResult & { ok: false };

  return {
    ok: true,
    model: built.model,
    slice: {
      crossingElements: crossing,
      elsewhereElements: elsewhere,
      nodes: built.model.nodes.size,
      elements: built.model.elements.size,
      // Counted off what the SLICE kept, not off `built.model`: the 2D build can
      // drop a load of its own accord, and folding the two together would report
      // one number for two different decisions.
      loads: keptLoads.length,
      droppedLoads: allLoads.length - keptLoads.length,
    },
  };
}
