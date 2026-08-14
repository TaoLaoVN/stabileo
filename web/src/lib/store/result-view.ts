/**
 * result-view.ts — WHICH quantity is on screen, and HOW it is drawn.
 *
 * # Two questions that had become one
 *
 * `diagramType` answers both at once. `'axial'` means the axial force drawn as
 * a diagram; `'axialColor'` means the same quantity drawn as member colour;
 * `'colorMap'` means some quantity — named separately in `colorMapKind` — drawn
 * as a heat map. Three encodings for two independent facts.
 *
 * That worked while member colour existed only for axial. It stops working the
 * moment every quantity can be shown three ways, because every reader of
 * `diagramType` then has to know all the encodings to answer "what is the user
 * actually looking at" — the ribbon needs it to light the right command, the
 * results panel needs it to offer the right choices, and each was deriving it
 * separately.
 *
 * So the pair is read and written through here. Nothing else needs to know
 * that member colour is spelled `axialColor` while a heat map is spelled
 * `colorMap` plus a second field.
 *
 * # Why not just add a field
 *
 * Because `diagramType` is what the viewports switch on, what the store
 * persists, and what a saved model carries. A parallel field would be a second
 * source of truth for the same question and would drift from it — which is the
 * defect this codebase has already paid for more than once.
 */

import { resultsStore } from './results.svelte';
import { showDiagram } from './view-mode';

/** A quantity a member carries, as the ribbon names it. */
export type ResultQuantity =
  | 'axial' | 'moment' | 'shear'                      // 2D
  | 'momentY' | 'momentZ' | 'shearY' | 'shearZ' | 'torsion';  // 3D

/** How that quantity is being drawn. */
export type Representation = 'diagram' | 'memberColour' | 'colourMap';

/**
 * Member colour is red/blue by SIGN — tension or compression — which only
 * means something for a quantity that has a structural sign convention a
 * reader recognises at a glance. That is axial force; a moment's sign is a
 * convention about which fibre is in tension, and painting a beam red for
 * "hogging" would invite exactly the wrong reading.
 */
const SIGNED_QUANTITIES: ReadonlySet<ResultQuantity> = new Set(['axial']);

/** Every representation available for a quantity, in the order they are offered. */
export function representationsFor(q: ResultQuantity): Representation[] {
  return SIGNED_QUANTITIES.has(q)
    ? ['diagram', 'memberColour', 'colourMap']
    : ['diagram', 'colourMap'];
}

/**
 * The quantity currently on screen, or null when what is shown is not one —
 * the deformed shape, a mode shape, a stress-ratio map, nothing at all.
 */
export function activeQuantity(): ResultQuantity | null {
  const dt = resultsStore.diagramType;
  if (dt === 'axialColor') return 'axial';
  if (dt === 'colorMap') {
    const kind = resultsStore.colorMapKind;
    return isQuantity(kind) ? kind : null;
  }
  return isQuantity(dt) ? dt : null;
}

/** How the active quantity is drawn, or null when none is active. */
export function activeRepresentation(): Representation | null {
  const dt = resultsStore.diagramType;
  if (dt === 'axialColor') return 'memberColour';
  if (dt === 'colorMap') return isQuantity(resultsStore.colorMapKind) ? 'colourMap' : null;
  return isQuantity(dt) ? 'diagram' : null;
}

/**
 * Show a quantity in a given representation.
 *
 * Routed through `showDiagram` rather than assigning `diagramType`, so picking
 * a result still disarms an editing tool — the rule that keeps "you are
 * drawing on a moment diagram" from being claimed by the interface.
 */
export function showQuantityAs(q: ResultQuantity, how: Representation): void {
  if (how === 'colourMap') {
    resultsStore.colorMapKind = q as never;
    showDiagram('colorMap' as never);
    return;
  }
  if (how === 'memberColour' && SIGNED_QUANTITIES.has(q)) {
    showDiagram('axialColor' as never);
    return;
  }
  showDiagram(q as never);
}

/**
 * Whether a `diagramType`/`colorMapKind` value names one of the quantities.
 *
 * `colorMapKind` also carries `stressRatio`, `vonMises` and the shell contours,
 * which are derived measures rather than internal forces: they are chosen
 * elsewhere, have their own scales, and must not appear in a per-quantity
 * selector.
 */
function isQuantity(v: string): v is ResultQuantity {
  return v === 'axial' || v === 'moment' || v === 'shear'
    || v === 'momentY' || v === 'momentZ'
    || v === 'shearY' || v === 'shearZ' || v === 'torsion';
}

/**
 * Whether the ribbon command for `diagram` should light.
 *
 * A command names a QUANTITY, so it lights whenever that quantity is on
 * screen, in any representation. Without this the ribbon went dark the moment
 * a user switched a diagram to a heat map, as if nothing were being shown.
 */
export function commandShowsQuantity(diagram: string): boolean {
  const active = activeQuantity();
  if (active === null) return false;
  if (diagram === 'axial') return active === 'axial';
  return diagram === active;
}
