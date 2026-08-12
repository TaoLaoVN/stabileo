/**
 * view-mode.ts — editing and reading results are two modes, never both.
 *
 * # The state this prevents
 *
 * The app can arm a drawing tool and show a diagram at the same time, and when
 * it does the interface claims something false: that you are placing nodes ON a
 * moment diagram. Nothing crashes; the ribbon simply lights a construction
 * command and a result command together, and the canvas shows a structure you
 * are apparently editing and a field you are apparently reading.
 *
 * They are different jobs. You build the model, you solve it, you read what
 * came out — and going back to building means the answer no longer describes
 * what is on screen.
 *
 * # Why this lives in a module rather than in a store
 *
 * The rule couples two stores: choosing a diagram must disarm a tool, and
 * arming a tool must clear the diagram. Putting it inside either one makes them
 * import each other. Putting it in the components that trigger it — which is
 * where it started — means every new entry point has to remember, and the
 * results toolbar did not: its diagram buttons wrote `diagramType` directly and
 * left whatever tool was armed exactly where it was.
 *
 * So the transitions are functions, both stores are imported here, and a caller
 * expresses INTENT ("show me this diagram") rather than performing two writes
 * and hoping they stay in step.
 */

import { uiStore } from './ui.svelte';
import { resultsStore } from './results.svelte';
import type { DiagramType } from './results.svelte';

/** Tools that build the model, as opposed to selecting or panning. */
export const EDIT_TOOLS = ['node', 'element', 'support', 'load'] as const;

function isEditing(): boolean {
  return (EDIT_TOOLS as readonly string[]).includes(uiStore.currentTool);
}

/**
 * Show a diagram, leaving editing.
 *
 * Falls back to Select rather than to nothing: reading a result still needs a
 * pointer that can pick a member, and dropping the tool entirely would leave
 * the canvas inert.
 */
export function showDiagram(type: DiagramType): void {
  resultsStore.diagramType = type;
  if (type !== 'none' && isEditing()) uiStore.currentTool = 'select';
}

/**
 * Arm a build tool, putting the diagram away.
 *
 * Drawing on top of a result is the same contradiction seen from the other
 * side — and worse in practice, because the diagram is drawn over the members
 * you are trying to click.
 */
export function armTool(tool: string): void {
  uiStore.currentTool = tool as never;
  if ((EDIT_TOOLS as readonly string[]).includes(tool) && resultsStore.diagramType !== 'none') {
    resultsStore.diagramType = 'none';
  }
}

/** Whether a result is currently on screen. */
export function isShowingResult(): boolean {
  return resultsStore.diagramType !== 'none';
}
