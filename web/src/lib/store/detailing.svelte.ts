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
import {
  detailingReadiness, runDetailing,
  type DetailingReadiness, type RunDetailingResult,
} from '../engine/detailing/run-detailing';
import { verificationStore } from './verification.svelte';
import { regulationsStore } from './regulations.svelte';
import type { RegulationEdition } from '../codes/regulation';
import type { MemberDesignOutcome } from '../engine/design/outcome';
import type { BentUpPolicy } from '../engine/detailing/generate-beam';
import { DAGG_ASSUMED_MM } from '../codes/project-code-settings';

export type SheetSelection = 'elevation' | 'section';

/** Design outcomes as a map, which is what the pipeline consumes. */
function designOutcomeMap(): ReadonlyMap<number, MemberDesignOutcome> {
  const out = new Map<number, MemberDesignOutcome>();
  for (const id of verificationStore.contexts.keys()) {
    const o = verificationStore.outcomeFor(id);
    if (o) out.set(id, o);
  }
  return out;
}

/** The concrete edition currently bound to the `concrete` role. */
function currentConcreteEdition(): RegulationEdition {
  const e = regulationsStore.binding('concrete').edition;
  return (e === '2005' ? '2005' : '2025') as RegulationEdition;
}

/**
 * Maximum aggregate size, from the materials.
 *
 * PR16 moved this off the regulation panel and onto the material, where a mix property
 * belongs. The largest value across the concretes in use governs the bar spacing, which is
 * the conservative reading when a model mixes mixes.
 */
function resolveAggregate(): number {
  let max = 0;
  for (const m of modelStore.model.materials.values()) {
    const d = (m as { maxAggregateSizeMm?: number | null }).maxAggregateSizeMm;
    if (typeof d === 'number' && d > max) max = d;
  }
  return max > 0 ? max : DAGG_ASSUMED_MM;
}

/** Highest revision among existing assemblies, so a regeneration increments. */
function maxRevision(assemblies: readonly DetailingAssembly[]): number {
  let r = 0;
  for (const a of assemblies) r = Math.max(r, a.detailingRevision ?? 0);
  return r;
}

/**
 * The project's bent-up bar policy.
 *
 * `unstated` until the seismic role says otherwise, and no bent-up bar is generated under
 * `unstated`. PR19 supplies the seismic verdict; until then the conservative reading holds.
 */
function bentUpPolicy(): BentUpPolicy {
  const optOut = modelStore.model.detailingBentUpOptOut === true;
  const seismicBound = regulationsStore.bound('seismic');
  return {
    seismicDesign: seismicBound ? 'required' : 'unstated',
    optOut,
  };
}

function createDetailingStore() {
  let selectedId = $state<string | null>(null);
  let conflictIndex = $state(0);
  let sheetKind = $state<SheetSelection>('elevation');
  let sectionAt = $state(0);
  let lastError = $state<string | null>(null);
  let reviewOpen = $state(false);
  let generating = $state(false);
  /**
   * Project policy: run detailing automatically after a successful design.
   *
   * On by default, because a user who has just verified a floor wants its bars. Opt-out
   * exists because regenerating is not free on a large model and some users detail once,
   * at the end. Persisted with the model, not with the browser: it is a project decision.
   */
  let lastRun = $state<RunDetailingResult | null>(null);

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

    get generating() { return generating; },
    get lastRun() { return lastRun; },

    /**
     * Are the prerequisites for detailing satisfied, and if not, exactly which?
     *
     * Drives the enabled/disabled state of the Generate command and the text beside it.
     * Cheap: it inspects outcomes, it does not generate anything.
     */
    get readiness(): DetailingReadiness {
      return detailingReadiness({
        contexts: verificationStore.contexts,
        outcomes: designOutcomeMap(),
      });
    },

    get autoGenerate() { return modelStore.model.detailingAuto !== false; },
    setAutoGenerate(on: boolean): void { modelStore.model.detailingAuto = on; },

    /**
     * THE production entry point: verified design → coordinated assemblies → model.
     *
     * This is the call the forensic audit found missing. Everything downstream —
     * persistence, revision invalidation, review, drawings, exports — hangs off the
     * assemblies it writes.
     */
    generate(opts: { verifierId?: string } = {}): RunDetailingResult | null {
      generating = true;
      lastError = null;
      try {
        const result = runDetailing({
          contexts: verificationStore.contexts,
          outcomes: designOutcomeMap(),
          nodes: modelStore.nodes as never,
          elements: modelStore.elements as never,
          edition: currentConcreteEdition(),
          verifierId: opts.verifierId ?? '',
          demandRevision: verificationStore.demandRevision,
          previousRevision: maxRevision(store.assemblies),
          maxAggregateSizeMm: resolveAggregate(),
          lockedBars: store.assemblies.flatMap((a) => a.bars.filter((b) => b.locked)),
          bentUp: bentUpPolicy(),
        });
        lastRun = result;
        write({ ...store, assemblies: result.assemblies });
        if (!result.assemblies.some((a) => a.id === selectedId)) {
          selectedId = result.assemblies[0]?.id ?? null;
        }
        // Detailing is downstream of reinforcement. Nothing upstream moved, so the graph
        // preserves the loads, the analysis and the design, and invalidates only the
        // detailing and the document — no solve is required.
        regulationsStore.noteChange('reinforcementEdit');
        return result;
      } catch (e) {
        lastError = String(e instanceof Error ? e.message : e);
        return null;
      } finally {
        generating = false;
      }
    },

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
