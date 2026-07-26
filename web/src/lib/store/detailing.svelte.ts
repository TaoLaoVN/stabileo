/**
 * Detailing workflow store.
 *
 * Owns the coordinated assemblies, the selection, and the review actions. Everything it
 * computes comes from the pure engines in `lib/engine/detailing/`; this layer only holds
 * state and routes user intent, so the whole pipeline stays testable without a DOM.
 *
 * Assemblies live on the model (so they persist); this store is a view over them plus
 * the transient UI state that should NOT persist — which assembly is selected, which
 * conflict the user is stepping through, whether the sheet preview is open.
 */

import { modelStore } from './model.svelte';
import {
  applyReview, emptyDetailingStore, invalidateAffected, isDemandStale, isReviewStale,
  type DetailingAssembly, type DetailingStore, type ReviewRecord,
} from '../engine/detailing/assembly';
import { provisionalKeys } from '../engine/detailing/coordinate-floor';
import type { BarConflict } from '../engine/detailing/collision';
import {
  ELEVATION_X, buildSchedule, buildTitleBlock, drawElevation, drawSection, sheetToSvg,
  type Sheet,
} from '../engine/detailing/drawings';
import { clause } from '../codes/regulation';

export type SheetSelection = 'elevation' | 'section';

function createDetailingStore() {
  let selectedId = $state<string | null>(null);
  let conflictIndex = $state(0);
  let sheetKind = $state<SheetSelection>('elevation');
  let sectionAt = $state(0);
  let lastError = $state<string | null>(null);
  let reviewOpen = $state(false);

  const store = $derived<DetailingStore>(modelStore.model.detailing ?? emptyDetailingStore());
  const assemblies = $derived(store.assemblies);
  const selected = $derived<DetailingAssembly | null>(
    assemblies.find((a) => a.id === selectedId) ?? assemblies[0] ?? null,
  );

  const conflicts = $derived<BarConflict[]>(
    (selected?.conflicts ?? []).filter((c) => c.severity !== 'marginal'),
  );

  function write(next: DetailingStore): void {
    modelStore.model.detailing = next;
  }

  function replace(assembly: DetailingAssembly): void {
    write({
      ...store,
      assemblies: store.assemblies.map((a) => (a.id === assembly.id ? assembly : a)),
    });
  }

  return {
    get assemblies() { return assemblies; },
    get selected() { return selected; },
    get selectedId() { return selected?.id ?? null; },
    get conflicts() { return conflicts; },
    get conflictIndex() { return conflictIndex; },
    get currentConflict(): BarConflict | null { return conflicts[conflictIndex] ?? null; },
    get sheetKind() { return sheetKind; },
    get sectionAt() { return sectionAt; },
    get lastError() { return lastError; },
    get reviewOpen() { return reviewOpen; },

    /** Provisional calculations in the selected assembly that need acknowledgement. */
    get provisional(): string[] {
      return selected ? provisionalKeys(selected) : [];
    },

    /** True when the selected assembly's review no longer matches its revision. */
    get superseded(): boolean {
      return selected ? isReviewStale(selected) : false;
    },

    /** True when the bars were generated against demands that have since moved. */
    staleFor(demandRevision: number): boolean {
      return selected ? isDemandStale(selected, demandRevision) : false;
    },

    select(id: string): void {
      selectedId = id;
      conflictIndex = 0;
      lastError = null;
    },

    setSheetKind(k: SheetSelection): void { sheetKind = k; },
    setSectionAt(x: number): void { sectionAt = x; },

    nextConflict(): void {
      if (conflicts.length === 0) return;
      conflictIndex = (conflictIndex + 1) % conflicts.length;
    },
    prevConflict(): void {
      if (conflicts.length === 0) return;
      conflictIndex = (conflictIndex - 1 + conflicts.length) % conflicts.length;
    },

    openReview(): void { reviewOpen = true; lastError = null; },
    closeReview(): void { reviewOpen = false; },

    /** Replace the whole set — used after a regeneration run. */
    setAssemblies(next: DetailingAssembly[]): void {
      write({ ...store, assemblies: next });
      if (!next.some((a) => a.id === selectedId)) selectedId = next[0]?.id ?? null;
    },

    /** Targeted invalidation after an element edit. */
    invalidate(changedElements: Iterable<number>): string[] {
      const r = invalidateAffected(store, changedElements);
      write(r.store);
      return r.invalidated;
    },

    /** Pin or unpin a bar; a pinned bar is a hard constraint on regeneration. */
    toggleLock(barId: string): void {
      if (!selected) return;
      replace({
        ...selected,
        bars: selected.bars.map((b) => (b.id === barId ? { ...b, locked: !b.locked } : b)),
      });
    },

    /**
     * Record an engineer's review. Refuses for the reasons the engine states — below
     * CONSTRUCTIBLE, no named engineer, or unacknowledged provisional work.
     */
    review(record: Omit<ReviewRecord, 'revision'>): boolean {
      if (!selected) return false;
      const r = applyReview(selected, record, provisionalKeys(selected));
      if (!r.ok || !r.assembly) {
        lastError = r.reason ?? 'No se pudo registrar la revisión.';
        return false;
      }
      replace(r.assembly);
      lastError = null;
      reviewOpen = false;
      return true;
    },

    /** The sheet for the current selection, or null when nothing is selected. */
    get sheet(): Sheet | null {
      if (!selected) return null;
      const clauses = [clause('cirsoc-201', selected.provenance.edition, '9.7.3'),
        clause('cirsoc-201', selected.provenance.edition, '25.2')];
      if (sheetKind === 'section') {
        return drawSection({
          assembly: selected, atX: sectionAt,
          outline: [
            { x: -0.15, y: -0.30 }, { x: 0.15, y: -0.30 },
            { x: 0.15, y: 0.30 }, { x: -0.15, y: 0.30 },
          ],
          projection: ELEVATION_X, clauses,
          sheetNumber: `${selected.id}-S`, title: `${selected.label} — sección`,
        });
      }
      return drawElevation({
        assembly: selected,
        outlines: [],
        projection: ELEVATION_X, clauses,
        sheetNumber: `${selected.id}-E`, title: `${selected.label} — elevación`,
      });
    },

    get sheetSvg(): string | null {
      const s = this.sheet;
      return s ? sheetToSvg(s) : null;
    },

    get schedule() {
      if (!selected) return null;
      return buildSchedule(selected.marks, 12,
        selected.unsupported.map((u) => `${u.key}: ${u.message}`));
    },

    get titleBlock() {
      if (!selected) return null;
      return buildTitleBlock({
        sheetNumber: `${selected.id}-P`, title: `${selected.label} — planilla`,
        assembly: selected,
        clauses: [clause('cirsoc-201', selected.provenance.edition, '25.2')],
      });
    },

    clear(): void {
      write(emptyDetailingStore());
      selectedId = null;
      conflictIndex = 0;
      lastError = null;
    },
  };
}

export const detailingStore = createDetailingStore();
