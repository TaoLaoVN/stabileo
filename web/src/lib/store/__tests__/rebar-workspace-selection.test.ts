/**
 * Selection identity, which is what makes "go back" work.
 *
 * ── Why this has its own test ──────────────────────────────────────
 *
 * It shipped wrong once, and it failed in the quietest possible way. Identity was compared on
 * `barId` and `solidId` alone, which is correct for a click in the viewport — bar ids differ —
 * and catastrophic for a click in the member list, where BOTH fields are `undefined` on every
 * selection. Two different members therefore compared as the same thing, nothing was ever
 * pushed onto the history, and the "previous" control simply never appeared. No error, no
 * warning: a feature that was present in the code and absent from the screen.
 */

import { describe, expect, it } from 'vitest';
import { sameSelection } from '../rebar-workspace.svelte';

describe('two selections are the same thing only when they are', () => {
  it('tells two MEMBERS apart when neither names a bar or a solid', () => {
    // The list case. Both have undefined barId and solidId; only the member differs.
    expect(sameSelection({ elementIds: [1] }, { elementIds: [2] })).toBe(false);
  });

  it('recognises the same member selected twice', () => {
    expect(sameSelection({ elementIds: [1] }, { elementIds: [1] })).toBe(true);
  });

  it('tells two bars apart', () => {
    expect(sameSelection(
      { barId: 'b1', elementIds: [1] },
      { barId: 'b2', elementIds: [1] },
    )).toBe(false);
  });

  it('tells a bar apart from the member it sits in', () => {
    // Clicking a bar and then clicking its own beam are two different questions, and the
    // second must be able to step back to the first.
    expect(sameSelection(
      { barId: 'b1', elementIds: [1] },
      { solidId: 'member:1', elementIds: [1] },
    )).toBe(false);
  });

  it('distinguishes a continuous bar from a single-member one', () => {
    expect(sameSelection({ elementIds: [1, 2] }, { elementIds: [1] })).toBe(false);
  });

  it('treats order as significant rather than sorting behind the caller’s back', () => {
    // The producer emits owner ids in a stable order; re-sorting here would hide a change in
    // what the selection actually names.
    expect(sameSelection({ elementIds: [1, 2] }, { elementIds: [2, 1] })).toBe(false);
  });

  it('handles null on either side', () => {
    expect(sameSelection(null, null)).toBe(true);
    expect(sameSelection(null, { elementIds: [1] })).toBe(false);
    expect(sameSelection({ elementIds: [1] }, null)).toBe(false);
  });
});
