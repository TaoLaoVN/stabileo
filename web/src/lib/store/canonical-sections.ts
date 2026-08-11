/**
 * Canonical section state management for the model store.
 *
 * Extracted from model.svelte.ts to keep the store focused on model data.
 * This module owns the lifecycle of the `canonical` cache on Section:
 * creation, update, migration, and the async refresh that runs once the WASM
 * engine is ready.
 */

import type { Section } from './model.svelte';
import { resolveSectionState } from '../section/state';
import { restoreSections } from '../section/migration';

/** Resolve canonical state for a section being created. */
export function resolveOnCreate(sec: Section): Section {
  return { ...sec, canonical: resolveSectionState(sec, { torsion: true }) };
}

/** Resolve canonical state for a section being updated. */
export function resolveOnUpdate(sec: Section): Section {
  return { ...sec, canonical: resolveSectionState(sec, { torsion: true }) };
}

/**
 * Re-resolve canonical state for every section in the map.
 *
 * The engine initialises asynchronously, so at app start — and for a model
 * loaded before the WASM module is ready — `resolveSectionState` can only
 * report properties-only. Nothing would ever revisit that decision, leaving
 * otherwise fine catalogue profiles permanently without geometry.
 *
 * This runs once the engine is ready, and is a no-op for sections whose
 * resolved digest matches the stored one. It never invalidates results:
 * refreshing geometry is not a model edit.
 *
 * Returns the updated map, or null if nothing changed.
 */
export function refreshCanonicalSections(
  sections: Map<number, Section>,
): Map<number, Section> | null {
  let changed = false;
  const m = new Map(sections);
  for (const [id, sec] of m) {
    const next = resolveSectionState(sec, { torsion: true });
    const before = sec.canonical;
    const sameKind = before?.kind === next.kind;
    const sameDigest =
      before?.kind === 'geometry-backed' && next.kind === 'geometry-backed'
        ? before.digest === next.digest
        : sameKind;
    if (!sameDigest) {
      m.set(id, { ...sec, canonical: next });
      changed = true;
    }
  }
  return changed ? m : null;
}

/** Restore sections from a snapshot, re-deriving canonical state. */
export function restoreCanonicalSections(
  sections: Map<number, Section>,
): Map<number, Section> {
  return restoreSections(sections).sections;
}

/** Resolve the default section's canonical state for a fresh model. */
export function resolveDefaultSection(defaultSection: Section): Section {
  return {
    ...defaultSection,
    canonical: resolveSectionState({ ...defaultSection }, { torsion: true }),
  };
}
