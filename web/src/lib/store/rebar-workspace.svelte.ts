/**
 * The 3-D workspace's own state: what is open, what is selected, what is shown.
 *
 * ── Why a store and not component state ────────────────────────────
 *
 * The workspace is an overlay, and an overlay that is `{#if open}` unmounts when it closes.
 * Component state would therefore reset every time the user stepped back to the model to
 * check something — losing the layers they had turned off, the member they were looking at,
 * and the section they had cut. That is the opposite of "step out and come back".
 *
 * The MODEL is never touched by any of this. Nothing here writes to `modelStore`; opening and
 * closing the workspace is a view operation and the project is identical either side of it.
 *
 * ── Why the selection history is a stack ───────────────────────────
 *
 * Inspecting a cage is a walk: this column, then the footing under it, then back. A single
 * "previous" slot handles one step and then lies about the one before. A bounded stack
 * handles the walk and cannot grow without limit.
 */

import type { SceneSolidKind } from '../engine/detailing/scene-model';
import type { ElementStatus } from '../engine/detailing/element-status';

/** What the user has selected, however they selected it. */
export interface WorkspaceSelection {
  barId?: string;
  solidId?: string;
  /** The members involved. A bar continuous over a support names both. */
  elementIds: number[];
}

/** A section plane through the model. */
export interface WorkspaceSection {
  axis: 'x' | 'y' | 'z';
  /** Position along the axis, in model coordinates (m). */
  at: number;
  flip: boolean;
}

/** Every concrete family, in the order the layer switches present them. */
export const SOLID_KINDS: readonly SceneSolidKind[] = [
  'column', 'beam', 'slab', 'wall', 'footing', 'pedestal',
];

/** How deep the "go back" stack goes. */
const HISTORY_LIMIT = 20;

/**
 * Whether two selections point at the same thing.
 *
 * Exported so the rule is testable on its own: it is the whole reason the history works, and
 * it failed silently the first time by comparing only fields that are usually undefined.
 */
export function sameSelection(
  a: WorkspaceSelection | null, b: WorkspaceSelection | null,
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.barId === b.barId
    && a.solidId === b.solidId
    && a.elementIds.length === b.elementIds.length
    && a.elementIds.every((id, i) => id === b.elementIds[i]);
}

function createRebarWorkspace() {
  let open = $state(false);
  let selection = $state<WorkspaceSelection | null>(null);
  let history = $state<WorkspaceSelection[]>([]);

  // ── Layers ──────────────────────────────────────────────────
  let hiddenKinds = $state<SceneSolidKind[]>([]);
  let showBars = $state(true);
  let showConcrete = $state(true);
  let showConflicts = $state(true);
  let hideUnreinforced = $state(false);
  let diameterScale = $state(1);
  let concreteOpacity = $state(1);

  // ── Status filter ───────────────────────────────────────────
  let statusFilter = $state<ElementStatus[]>([]);
  /** Members the user has isolated. Empty means no isolation, which is not the same as none. */
  let isolated = $state<number[]>([]);

  // ── Section ─────────────────────────────────────────────────
  let section = $state<WorkspaceSection | null>(null);

  /**
   * A monotonic request to point the camera at a member.
   *
   * A nonce rather than a plain id, because focusing the SAME member twice is a real
   * gesture — the user has orbited away and wants to come back — and an id that has not
   * changed would not re-trigger the effect that performs it.
   */
  let focusRequest = $state<{ elementId: number; nonce: number } | null>(null);
  let nonce = 0;

  return {
    get open() { return open; },
    get selection() { return selection; },
    get history() { return history; },
    get canGoBack() { return history.length > 0; },

    get hiddenKinds() { return hiddenKinds; },
    get showBars() { return showBars; },
    set showBars(v: boolean) { showBars = v; },
    get showConcrete() { return showConcrete; },
    set showConcrete(v: boolean) { showConcrete = v; },
    get showConflicts() { return showConflicts; },
    set showConflicts(v: boolean) { showConflicts = v; },
    get hideUnreinforced() { return hideUnreinforced; },
    set hideUnreinforced(v: boolean) { hideUnreinforced = v; },
    get diameterScale() { return diameterScale; },
    set diameterScale(v: number) { diameterScale = v; },
    get concreteOpacity() { return concreteOpacity; },
    set concreteOpacity(v: number) { concreteOpacity = v; },
    get statusFilter() { return statusFilter; },
    get isolated() { return isolated; },
    get section() { return section; },
    get focusRequest() { return focusRequest; },

    /** The kinds to DRAW, which is what the scene filter wants. */
    visibleKinds(): SceneSolidKind[] {
      return SOLID_KINDS.filter((k) => !hiddenKinds.includes(k));
    },

    openWorkspace() { open = true; },
    /**
     * Close, keeping everything else.
     *
     * The user is stepping out to look at the model, not abandoning the inspection. Resetting
     * the layers and the selection here would make "check something and come back" cost the
     * whole setup every time.
     */
    close() { open = false; },

    toggleKind(kind: SceneSolidKind) {
      hiddenKinds = hiddenKinds.includes(kind)
        ? hiddenKinds.filter((k) => k !== kind)
        : [...hiddenKinds, kind];
    },

    toggleStatus(s: ElementStatus) {
      statusFilter = statusFilter.includes(s)
        ? statusFilter.filter((x) => x !== s)
        : [...statusFilter, s];
    },
    clearStatusFilter() { statusFilter = []; },

    isolate(elementIds: number[]) { isolated = [...elementIds]; },
    clearIsolation() { isolated = []; },

    setSection(next: WorkspaceSection | null) { section = next; },

    /**
     * Select something, remembering what was selected before.
     *
     * The previous selection goes on the stack only when it exists and differs, so clicking
     * the same member twice does not fill the history with itself.
     */
    select(next: WorkspaceSelection | null) {
      /**
       * Identity includes the MEMBERS, not only the bar and solid ids.
       *
       * Selecting from the member list produces a selection with neither a `barId` nor a
       * `solidId` — just the element. Comparing on those two alone made every list selection
       * identical to every other (`undefined === undefined` twice), so nothing was ever
       * pushed and "go back" never appeared. The bug is invisible when clicking in the
       * viewport, where bar ids differ, and total when clicking in the list.
       */
      if (selection && !sameSelection(selection, next)) {
        history = [...history, selection].slice(-HISTORY_LIMIT);
      }
      selection = next;
    },

    /** Step back to the previous selection, and point the camera at it. */
    goBack(): WorkspaceSelection | null {
      const prev = history[history.length - 1];
      if (!prev) return null;
      history = history.slice(0, -1);
      selection = prev;
      if (prev.elementIds.length > 0) {
        nonce += 1;
        focusRequest = { elementId: prev.elementIds[0], nonce };
      }
      return prev;
    },

    /** Ask the viewport to centre on a member. */
    focus(elementId: number) {
      nonce += 1;
      focusRequest = { elementId, nonce };
    },

    /**
     * Select a member from the list AND point the camera at it.
     *
     * One action because they are one intention. A list that selects without moving the
     * camera makes the user hunt for what they just clicked in a cage of thousands of bars.
     */
    selectAndFocus(elementId: number) {
      this.select({ elementIds: [elementId] });
      this.focus(elementId);
    },

    /** Full reset. Used when the document changes under the workspace. */
    reset() {
      selection = null;
      history = [];
      isolated = [];
      statusFilter = [];
      section = null;
      focusRequest = null;
    },
  };
}

export const rebarWorkspace = createRebarWorkspace();
