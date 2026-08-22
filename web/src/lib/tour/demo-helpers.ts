/**
 * demo-helpers.ts — the moves every guided demo makes.
 *
 * # Why these are shared rather than repeated
 *
 * Seven demos load an example, press solve, wait for a result and point at a
 * ribbon command. Written out seven times, those four things drift: one demo
 * clears the 3D results and another forgets, one waits for the solve and
 * another races it. They are the same act each time, so they are written once.
 *
 * # Anchors
 *
 * A step points at a CSS selector. The ribbon's commands already carry stable
 * `data-testid` attributes — the e2e suite drives the app by them — so the
 * demos use those rather than a second set of attributes that would have to be
 * kept in step with the first. Where a region has no stable hook of its own it
 * gets a `data-tour`, and those are listed in `ANCHORS` below so a reader can
 * see the whole surface a demo may point at without grepping the markup.
 */

import { modelStore, resultsStore, uiStore } from '../store';

/** Every anchor the demos rely on. One list, so a rename has one place to look. */
export const ANCHORS = {
  ribbonCommand: (id: string) => `[data-testid="rb-cmd-${id}"]`,
  settings: '[data-testid="rb-settings"]',
  pointerMode: '[data-testid="pointer-mode"]',
  /** The right-hand panel a ribbon command opens. Already carries a testid. */
  rightPanel: '[data-testid="basic-panel"]',
  viewport: '.viewport-container',
} as const;

/**
 * Load an example and frame it.
 *
 * The zoom is deferred by a frame because the viewport measures the model to
 * fit it, and at the moment the store changes there is nothing laid out yet.
 */
export async function loadExample(id: string): Promise<void> {
  await modelStore.loadExample(id);
  resultsStore.clear();
  resultsStore.clear3D();
  setTimeout(() => window.dispatchEvent(new Event('stabileo-zoom-to-fit')), 50);
}

/** Solve, the way every other caller does — through the app's own event. */
export function solve(): void {
  window.dispatchEvent(new Event('stabileo-solve'));
}

/** Whether the model on screen has been solved, in whichever mode it is in. */
export function hasResults(): boolean {
  return uiStore.analysisMode === '3d'
    ? resultsStore.results3D !== null
    : resultsStore.results !== null;
}

/** Put the app in a dimension. Loading a 3D example already does this; this is for the rest. */
export function setDimension(d: '2d' | '3d'): void {
  uiStore.analysisMode = d;
  setTimeout(() => window.dispatchEvent(new Event('stabileo-zoom-to-fit')), 80);
}

/**
 * Start from nothing.
 *
 * The modelling demo builds a beam from an empty canvas, and starting on
 * whatever the user had open would make its first instruction — "place a
 * node" — land on top of an existing structure.
 */
export function clearModel(): void {
  modelStore.clear();
  resultsStore.clear();
  resultsStore.clear3D();
}

/** Arm a drawing tool, as the ribbon command would. */
export function armTool(tool: 'node' | 'element' | 'support' | 'load' | 'select' | 'pan'): void {
  uiStore.currentTool = tool;
}

/** Counts the demos wait on, so a step can require "two nodes exist". */
export const count = {
  nodes: () => modelStore.nodes.size,
  elements: () => modelStore.elements.size,
  supports: () => modelStore.supports.size,
  loads: () => modelStore.loads.length,
};
