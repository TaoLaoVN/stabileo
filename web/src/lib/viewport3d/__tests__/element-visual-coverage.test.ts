/**
 * Every element on screen gets reached, whichever way it is drawn.
 *
 * # The defect
 *
 * `ctx.elementGroups` is a PARTIAL registry, by design: in wireframe render
 * mode a plain member is a segment of one batched `LineSegments2` and is given
 * no group of its own. Only members needing extra geometry — a section
 * extrusion, a hinge glyph — get one.
 *
 * Four flat colour maps and the verification labels iterated that map. In
 * wireframe, which is what Basic 3D opens in, they therefore reached almost
 * nothing: axial-as-member-colour left a 633-member industrial shed entirely
 * white. Nothing threw; the loop simply had nothing to loop over.
 *
 * The lesson generalises past this bug: a map that is *usually* complete is the
 * worst kind of data structure to iterate, because it works in every case
 * anyone tries by hand.
 */

import { describe, it, expect } from 'vitest';
import { forEachElementVisual } from '../results-sync';

/** Just enough context: the two registries the helper walks. */
function ctxWith(batchedIds: number[], groupIds: number[]) {
  const elementGroups = new Map<number, unknown>();
  for (const id of groupIds) elementGroups.set(id, { id, isGroup: true });
  return {
    elementsBatched: { ids: () => batchedIds },
    elementGroups,
  } as never;
}

const visit = (ctx: never) => {
  const seen: Array<{ id: number; hasGroup: boolean }> = [];
  forEachElementVisual(ctx, (id, group) => seen.push({ id, hasGroup: !!group }));
  return seen;
};

describe('wireframe: many members, few groups', () => {
  it('reaches every member even when none has a group', () => {
    // The reported case, in miniature: all members batched, no groups at all.
    const seen = visit(ctxWith([1, 2, 3, 4, 5], []));
    expect(seen.map((s) => s.id)).toEqual([1, 2, 3, 4, 5]);
    expect(seen.every((s) => !s.hasGroup)).toBe(true);
  });

  it('hands the group over for the few members that have one', () => {
    const seen = visit(ctxWith([1, 2, 3], [2]));
    expect(seen.find((s) => s.id === 2)!.hasGroup).toBe(true);
    expect(seen.find((s) => s.id === 1)!.hasGroup).toBe(false);
  });

  it('visits each member exactly once', () => {
    const seen = visit(ctxWith([1, 2, 3], [1, 2, 3]));
    expect(seen).toHaveLength(3);
    expect(new Set(seen.map((s) => s.id)).size).toBe(3);
  });
});

describe('solid mode: every member has a group', () => {
  it('reaches them all, with their groups', () => {
    const seen = visit(ctxWith([7, 8], [7, 8]));
    expect(seen.map((s) => s.id).sort()).toEqual([7, 8]);
    expect(seen.every((s) => s.hasGroup)).toBe(true);
  });
});

describe('the registries disagreeing', () => {
  it('still reaches a group with no batched segment', () => {
    // Should not happen, but if it does the member is on screen and still has
    // to be coloured — dropping it would be the same class of bug again.
    const seen = visit(ctxWith([1], [1, 99]));
    expect(seen.map((s) => s.id).sort((a, b) => a - b)).toEqual([1, 99]);
    expect(seen.find((s) => s.id === 99)!.hasGroup).toBe(true);
  });

  it('handles an empty model without throwing', () => {
    expect(visit(ctxWith([], []))).toEqual([]);
  });
});
