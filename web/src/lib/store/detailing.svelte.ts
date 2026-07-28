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
import { rebarHash } from '../engine/design/rebar-hash';
import { getDesignCode } from '../engine/design/code-adapter';
import {
  runDesignFeedbackLoop, type DesignFeedbackLoopResult,
} from '../engine/detailing/design-feedback-loop';
import {
  buildDocumentModel, supersede,
  type CertificateEntry, type DocumentModel,
} from '../engine/detailing/document-model';
import { regulationsStore } from './regulations.svelte';
import { resultsStore } from './results.svelte';
import {
  floorDesignReadiness, runFloorDesign,
  type FloorDesignReadiness, type FloorShell, type FloorShellStress,
  type RunFloorDesignResult,
} from '../engine/detailing/run-floor-design';
import { DEFAULT_COVER, DEFAULT_REBAR_FY } from '../engine/design/member-context';
import {
  runFootingDesign,
  type CaseReaction, type CombinationReaction, type FootingColumn,
  type NodeReactions, type RunFootingDesignResult,
} from '../engine/detailing/run-footing-design';
import type { ProvidedReinforcement } from './model.svelte';
import type { EngineMessage } from '../codes/message';
// A store is a locale boundary — `model.svelte.ts` translates here too. The combination
// name is a plain string because a user-given combination name is not translatable; only
// the synthetic "active result set" stand-in needs a locale.
import { t } from '../i18n';
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

/**
 * The project's additional bar-spacing margin, m.
 *
 * The LARGEST stated margin across the concretes in use governs, which is the conservative
 * reading when a model mixes mixes — the same rule the aggregate size follows. Zero when no
 * concrete states one, and zero introduces no allowance anywhere: it is not a small
 * default, it is the absence of one.
 */
function resolveSpacingMargin(): number {
  let max = 0;
  for (const m of modelStore.model.materials.values()) {
    const v = (m as { spacingMarginMm?: number | null }).spacingMarginMm;
    if (typeof v === 'number' && v > max) max = v;
  }
  return max / 1000;
}

/**
 * Distributed wall bar diameter, mm.
 *
 * §11.6.1's relaxed ratios are available only to Ø16 and smaller, and Ø12 is what a
 * distributed curtain is normally drawn with. It is a starting size the design then checks,
 * not a result: `designWall` reports the ratios and spacings that follow from it.
 */
const DEFAULT_WALL_BAR_DIA_MM = 12;

/**
 * Bottom-mat bar diameter for a footing, mm.
 *
 * Same posture as the wall curtain above: a starting size that sets the effective depth,
 * which the check then reports on — not a designed result. Ø16 is the ordinary bottom mat for
 * a pad footing. The assumption is stated per footing
 * (`footing.assumption.averageMatDepth`), so a reader can see what `d` came from.
 */
const DEFAULT_FOOTING_BAR_DIA_MM = 16;

/** Every shell in the model — quads and plates alike are shells and both are designed. */
function collectShells(): FloorShell[] {
  const out: FloorShell[] = [];
  for (const q of modelStore.model.quads.values()) {
    out.push({ id: q.id, nodes: q.nodes, materialId: q.materialId, thickness: q.thickness });
  }
  for (const p of modelStore.model.plates.values()) {
    out.push({ id: p.id, nodes: p.nodes, materialId: p.materialId, thickness: p.thickness });
  }
  // Sorted so the run is deterministic regardless of Map insertion order.
  return out.sort((a, b) => a.id - b.id);
}

/** Shell stresses from the active result set, quads and plates in one list. */
function collectStresses(): FloorShellStress[] {
  const r = resultsStore.results3D;
  if (!r) return [];
  return [...(r.quadStresses ?? []), ...(r.plateStresses ?? [])]
    .map((s) => ({
      elementId: s.elementId,
      sigmaXx: s.sigmaXx, sigmaYy: s.sigmaYy, tauXy: s.tauXy,
      mx: s.mx, my: s.my, mxy: s.mxy,
    }))
    .sort((a, b) => a.elementId - b.elementId);
}

/**
 * Support reactions per footing node — per combination, and per case for the service sum.
 *
 * A footing's demand is a REACTION, not a shell stress, so this is a different collector
 * from `collectStresses` with a different result source: `perCombo3D` for the strength
 * combinations and `perCase3D` for the unit-factor service sum.
 *
 * Only nodes that actually carry a footing are collected. Building the map for every
 * support would walk every combination's whole reaction list for nodes nobody asked about.
 */
function collectFootingReactions(): Map<number, NodeReactions> {
  const out = new Map<number, NodeReactions>();
  const wanted = new Set([...modelStore.model.footings.values()].map((f) => f.nodeId));
  if (wanted.size === 0) return out;

  const caseTypeOf = new Map(modelStore.model.loadCases.map((c) => [c.id, c.type ?? 'D']));
  const comboNameOf = new Map(modelStore.model.combinations.map((c) => [c.id, c.name]));

  const factored = new Map<number, CombinationReaction[]>();
  for (const [comboId, res] of resultsStore.perCombo3D) {
    for (const r of res.reactions ?? []) {
      if (!wanted.has(r.nodeId)) continue;
      const list = factored.get(r.nodeId) ?? [];
      list.push({
        combinationId: comboId,
        combinationName: comboNameOf.get(comboId) ?? `Combinación ${comboId}`,
        fz: r.fz, mx: r.mx, my: r.my,
      });
      factored.set(r.nodeId, list);
    }
  }

  const cases = new Map<number, CaseReaction[]>();
  for (const [caseId, res] of resultsStore.perCase3D) {
    for (const r of res.reactions ?? []) {
      if (!wanted.has(r.nodeId)) continue;
      const list = cases.get(r.nodeId) ?? [];
      list.push({
        caseId,
        caseType: caseTypeOf.get(caseId) ?? 'D',
        fz: r.fz, mx: r.mx, my: r.my,
      });
      cases.set(r.nodeId, list);
    }
  }

  // With no combinations solved, the single active result set is the only reaction there is.
  // It is offered as ONE combination named for what it is, rather than silently treated as a
  // factored envelope it may not be.
  if (factored.size === 0) {
    for (const r of resultsStore.results3D?.reactions ?? []) {
      if (!wanted.has(r.nodeId)) continue;
      factored.set(r.nodeId, [{
        combinationId: 0,
        combinationName: t('detailing.footingRun.activeResultSet'),
        fz: r.fz, mx: r.mx, my: r.my,
      }]);
    }
  }

  for (const nodeId of wanted) {
    const f = factored.get(nodeId);
    if (!f || f.length === 0) continue;
    // Sorted so the governing pick and the reported name cannot depend on Map order.
    const sorted = [...f].sort((a, b) => a.combinationId - b.combinationId);
    const c = cases.get(nodeId);
    out.set(nodeId, {
      factored: sorted,
      ...(c && c.length > 0
        ? { cases: [...c].sort((a, b) => a.caseId - b.caseId) }
        : {}),
    });
  }
  return out;
}

/**
 * The starter set a column's accepted reinforcement calls for.
 *
 * A column may be stored in either of two shapes: the structured `column` form (corner and
 * face bars per edge) or the legacy grouped `longitudinal`. Both are read, because a project
 * verified before the structured form existed still has columns to found.
 *
 * A single representative diameter is returned with the total count, because `DowelInput`
 * takes one `{ count, diameterMm }` pair. When corner and face diameters differ the LARGER
 * is used: it sets the longer development length, and a starter shorter than the bar it laps
 * with is the failure that matters.
 */
function columnBarSet(
  accepted: ProvidedReinforcement | undefined,
): { count: number; diameterMm: number } | undefined {
  const c = accepted?.column;
  if (c) {
    const count = 4 + c.nBottom + c.nTop + c.nLeft + c.nRight;
    const diameterMm = Math.max(c.cornerDia, c.faceDia);
    return count > 0 && diameterMm > 0 ? { count, diameterMm } : undefined;
  }
  const l = accepted?.longitudinal;
  if (l && l.count > 0 && l.diameter > 0) {
    return { count: l.count, diameterMm: l.diameter };
  }
  return undefined;
}

/**
 * Column geometry for each footing that names one.
 *
 * The section's `b`/`h` give the punching perimeter; the reinforcement the verifier already
 * chose for that column gives the dowels, so the starters match the bars they lap with
 * rather than a nominal set invented here.
 */
function collectFootingColumns(): Map<number, FootingColumn> {
  const out = new Map<number, FootingColumn>();
  for (const f of modelStore.model.footings.values()) {
    if (f.columnElementId === undefined || out.has(f.columnElementId)) continue;
    const el = modelStore.model.elements.get(f.columnElementId);
    if (!el) continue;
    const sec = modelStore.model.sections.get(el.sectionId);
    if (!sec?.b || !sec?.h) continue;
    // The starters must lap with the bars the verifier ACCEPTED for that column, so they are
    // read from the design outcome rather than invented here. `accepted` is present only for
    // a VERIFIED outcome, which is the right gate: starters lapping into steel that was
    // never accepted would be detailing a column that does not exist yet.
    const accepted = verificationStore.outcomeFor(f.columnElementId)?.accepted;
    const bars = columnBarSet(accepted);
    const tie = accepted?.stirrups?.diameter;
    out.set(f.columnElementId, {
      elementId: f.columnElementId,
      b: sec.b, h: sec.h,
      ...(bars ? { bars } : {}),
      ...(tie ? { tieDiaMm: tie } : {}),
    });
  }
  return out;
}

/**
 * Factored area load per shell, kPa, enveloped over the project's combinations.
 *
 * The `surface3d` loads carry a case id, and a combination states a factor per case, so
 * the factored load is `max over combinations of Σ factor·q` — a real envelope built from
 * the project's own combinations rather than a nominal figure.
 *
 * With no combinations defined the unfactored sum is used, and `designSlabPanel` receives
 * a demand that is honestly service-level. That is visible: the shear memo prints the `qu`
 * it was given.
 */
function factoredAreaLoads(): Map<number, number> {
  const byCase = new Map<number, Map<number, number>>();
  for (const load of modelStore.model.loads) {
    if (load.type !== 'surface3d') continue;
    const { quadId, q, caseId } = load.data;
    const key = caseId ?? 0;
    const per = byCase.get(quadId) ?? new Map<number, number>();
    per.set(key, (per.get(key) ?? 0) + q);
    byCase.set(quadId, per);
  }

  const combos = modelStore.model.combinations;
  const out = new Map<number, number>();
  for (const [quadId, per] of byCase) {
    if (combos.length === 0) {
      out.set(quadId, [...per.values()].reduce((s, v) => s + v, 0));
      continue;
    }
    let worst = 0;
    for (const combo of combos) {
      let total = 0;
      for (const { caseId, factor } of combo.factors) total += factor * (per.get(caseId) ?? 0);
      if (total > worst) worst = total;
    }
    out.set(quadId, worst);
  }
  return out;
}

/**
 * Concrete and steel properties for the shell families.
 *
 * Resolved exactly the way `member-context.ts` resolves them for frames, so the two paths
 * cannot disagree about the same project: f'c is the concrete `Material.fy` field — the
 * app's established convention for a concrete material — and the reinforcement fy and the
 * cover are the shared defaults. The MINIMUM f'c across the concretes in use governs,
 * which is the conservative reading when a model mixes mixes.
 */
function resolveConcreteProperties(): { fc: number; fy: number; cover: number } {
  let fc = Infinity;
  for (const m of modelStore.model.materials.values()) {
    const v = (m as { fy?: number }).fy;
    if (typeof v === 'number' && v > 0) fc = Math.min(fc, v);
  }
  return {
    fc: Number.isFinite(fc) ? fc : 0,
    fy: DEFAULT_REBAR_FY,
    cover: DEFAULT_COVER,
  };
}

/**
 * Members whose reinforcement the engineer pinned.
 *
 * Derived from the bars actually locked rather than kept as a second list: a locked bar's
 * `ownerElementIds` is what says whose steel it is, and any member owning one may not have
 * its reinforcement replaced by the repair loop.
 */
function lockedMemberIds(): ReadonlySet<number> {
  const out = new Set<number>();
  for (const a of modelStore.model.detailing?.assemblies ?? []) {
    for (const b of a.bars) {
      if (!b.locked) continue;
      for (const id of b.ownerElementIds ?? []) out.add(id);
    }
  }
  return out;
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
  let lastFloorRun = $state<RunFloorDesignResult | null>(null);
  let lastFootingRun = $state<RunFootingDesignResult | null>(null);
  let currentDocument = $state<DocumentModel | null>(null);
  let supersededDocs = $state<DocumentModel[]>([]);
  /** Monotonic per project. Bumped on supersession, never reused. */
  let documentRevision = $state(1);
  /**
   * The last design–detailing feedback loop: its outcome, iterations and full trace.
   *
   * Kept so the UI and the report can state what the repair actually did — which members
   * were re-sized, at what geometry, and where a repair was refused because a bar is pinned
   * or the section is the limit. Null when no adapter could enumerate candidates.
   */
  let lastFeedbackLoop = $state<DesignFeedbackLoopResult | null>(null);

  const store = $derived<DetailingStore>(modelStore.model.detailing ?? emptyDetailingStore());
  const assemblies = $derived(store.assemblies);
  const selected = $derived<DetailingAssembly | null>(
    assemblies.find((a) => a.id === selectedId) ?? assemblies[0] ?? null,
  );

  const conflicts = $derived<BarConflict[]>(
    (selected?.conflicts ?? []).filter((c) => c.severity !== 'marginal'),
  );

  /**
   * Anything that changes what a document describes retires it.
   *
   * Loads, analysis, reinforcement, detailing geometry, the spacing margin, review, and
   * regulation settings all reach here. Non-destructive: the old revision keeps its number
   * and content and moves to the superseded list. A stale document must never remain
   * current, because "current" is exactly the claim a builder relies on.
   */
  function retireDocument(): void {
    if (!currentDocument) return;
    documentRevision += 1;
    supersededDocs = [...supersededDocs, supersede(currentDocument, documentRevision)];
    currentDocument = null;
  }

  function write(next: DetailingStore): void {
    modelStore.model.detailing = next;
  }

  /**
   * Persist reinforcement the feedback loop replaced, and republish the outcomes.
   *
   * Both halves are required. Writing the bars without the outcomes would leave the design
   * table certifying steel the model no longer has; publishing the outcomes without the bars
   * would draw a cage the reinforcement panel disagrees with. The repaired outcomes carry a
   * `finalGeometryCertificate`, so what is published is a claim about the geometry that
   * exists rather than the nominal one it was originally sized against.
   */
  function publishRepairedReinforcement(
    next: ReadonlyMap<number, MemberDesignOutcome>,
    before: ReadonlyMap<number, MemberDesignOutcome>,
  ): void {
    const repaired = [...next.values()].filter((o) => {
      const prev = before.get(o.elementId)?.accepted;
      return o.outcome === 'VERIFIED' && o.accepted && prev
        && rebarHash(o.accepted) !== rebarHash(prev);
    });
    if (repaired.length === 0) return;
    modelStore.reinforcementTransaction((api) => {
      for (const o of repaired) api.setReinforcement(o.elementId, o.accepted!);
    });
    const prev = verificationStore.runSummary;
    if (prev) {
      verificationStore.setDesignOutcomes({
        ...prev,
        outcomes: new Map([...prev.outcomes, ...repaired.map(
          (o) => [o.elementId, o] as const)]),
      });
    }
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
    /** The last feedback loop's outcome and trace. Null when no repair pass could run. */
    get lastFeedbackLoop() { return lastFeedbackLoop; },

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
        /**
         * One full detailing pass for a given reinforcement assignment.
         *
         * Factored out because the feedback loop needs to run it more than once: coordination
         * moves steel, re-verification at the geometry that results can fail, and the repair
         * has to be coordinated and re-verified in turn.
         */
        const detail = (outcomes: ReadonlyMap<number, MemberDesignOutcome>) => runDetailing({
          contexts: verificationStore.contexts,
          outcomes,
          nodes: modelStore.nodes as never,
          elements: modelStore.elements as never,
          edition: currentConcreteEdition(),
          verifierId: opts.verifierId ?? '',
          demandRevision: verificationStore.demandRevision,
          previousRevision: maxRevision(store.assemblies),
          maxAggregateSizeMm: resolveAggregate(),
          spacingMargin: resolveSpacingMargin(),
          /**
           * The production command ALWAYS supplies the authoritative verifier.
           *
           * Constructibility requires every member to have been rechecked at its final
           * effective depth. A run without a verifier leaves that condition unmet and the
           * assessment NOT_ESTABLISHED — correct as a default, and unacceptable as the
           * behaviour of the real command.
           *
           * The reinforcement checked is the ASSIGNMENT'S, not the model's: mid-loop they
           * differ, and checking the model's would re-verify the steel the repair is trying
           * to replace.
           */
          reverify: (elementId, loss) => verificationStore.reverifyAtFinalDepth(
            elementId, loss, outcomes.get(elementId)?.accepted),
          lockedBars: store.assemblies.flatMap((a) => a.bars.filter((b) => b.locked)),
          bentUp: bentUpPolicy(),
        });

        // Detailing used to take its EDITION from Project Regulations and its ADAPTER from
        // the toolbar dropdown, so a member could be verified against one edition's clauses
        // and detailed under the other's. One source now.
        const concreteCode = regulationsStore.concreteDesignCode();
        const adapter = concreteCode ? getDesignCode(concreteCode) : undefined;
        const initial = designOutcomeMap();
        /**
         * Close the design–detailing loop.
         *
         * Without an adapter there is no candidate enumeration to feed back into, so the
         * single pass is all that is honestly available — and it still re-verifies, it just
         * cannot repair what it finds.
         */
        const loop = adapter
          ? runDesignFeedbackLoop({
            adapter,
            contexts: verificationStore.contexts,
            outcomes: initial,
            detail,
            lockedMembers: lockedMemberIds(),
          })
          : null;
        const result = loop ? loop.result : detail(initial);
        lastFeedbackLoop = loop;
        // A repair is not real until the model carries it. Persisting AFTER the loop means a
        // proposal that failed re-verification never reached the engineer's model at all.
        if (loop && loop.iterations.some((i) => i.changed.length > 0)) {
          publishRepairedReinforcement(loop.outcomes, initial);
        }
        lastRun = result;
        // Regeneration produces new geometry, so any document describing the old geometry
        // stops being current. This is the commonest supersession trigger by far and it
        // does not go through setAssemblies, which is why it is retired here explicitly.
        retireDocument();
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

    /**
     * Can the floor workflow run, and if not, exactly why? Cheap; designs nothing.
     */
    get floorReadiness(): FloorDesignReadiness {
      return floorDesignReadiness({
        shells: collectShells(),
        stresses: collectStresses(),
        footings: [...modelStore.model.footings.values()],
      });
    },

    /**
     * THE production entry point for slabs and walls.
     *
     * The counterpart of `generate()` for the families PR18 added. Before this existed,
     * `designSlabPanel`, `designWall` and `buildFloorAssembly` had no caller outside their
     * unit tests, so no user action could reach any of them.
     *
     * Floor assemblies are `DetailingAssembly` values, so everything already built on top
     * of that type — selection, conflict navigation, the review gate, the document, the
     * DXF and the XLSX — receives them without a parallel pipeline.
     */
    generateFloors(opts: { verifierId?: string } = {}): RunFloorDesignResult | null {
      generating = true;
      lastError = null;
      try {
        const props = resolveConcreteProperties();
        // Footings are checked FIRST, so their entries can join the level assemblies the
        // shell pass builds. Their demand is a support reaction and their level is their
        // founding elevation, so neither comes from the shell loop.
        const footingRun = runFootingDesign({
          footings: [...modelStore.model.footings.values()],
          geotechnical: modelStore.model.geotechnical,
          nodes: modelStore.model.nodes as never,
          columns: collectFootingColumns(),
          reactions: collectFootingReactions(),
          fc: props.fc,
          fy: props.fy,
          edition: currentConcreteEdition(),
          barDiameterMm: DEFAULT_FOOTING_BAR_DIA_MM,
        });
        lastFootingRun = footingRun;
        const result = runFloorDesign({
          nodes: modelStore.model.nodes as never,
          shells: collectShells(),
          stresses: collectStresses(),
          factoredAreaLoad: factoredAreaLoads(),
          fc: props.fc,
          fy: props.fy,
          cover: props.cover,
          maxAggregateSizeMm: resolveAggregate(),
          wallBarDiameterMm: DEFAULT_WALL_BAR_DIA_MM,
          edition: currentConcreteEdition(),
          verifierId: opts.verifierId ?? '',
          demandRevision: verificationStore.demandRevision,
          previousRevision: maxRevision(store.assemblies),
          seismicRequired: regulationsStore.binding('seismic').adapterId !== null,
          footingsByLevel: footingRun.entriesByLevel,
          // Shell design does not go through the frame verifier, so its members have not
          // been rechecked at a final effective depth. Claiming otherwise would satisfy
          // two constructibility conditions that nothing measured.
          membersVerified: false,
        });
        lastFloorRun = result;
        // New geometry retires the document describing the old geometry, exactly as a
        // beam regeneration does.
        retireDocument();
        // Floor assemblies are ADDED to the beam/column ones rather than replacing them:
        // a floor has both, and a user who details beams and then slabs must not lose the
        // beams. Re-running replaces only the floor assemblies it owns.
        //
        // Read from the PERSISTED store, not from the `store` derived. A `$derived` does
        // not recompute inside the synchronous call that wrote it, so merging against it
        // would drop whatever the previous write in the same tick had added — and here the
        // thing dropped would be the user's beam assemblies.
        const current = modelStore.model.detailing ?? emptyDetailingStore();
        const kept = current.assemblies.filter((a) => !a.id.startsWith('FLOOR-'));
        const merged = [...kept, ...result.assemblies];
        write({ ...current, assemblies: merged });
        if (!merged.some((a) => a.id === selectedId)) {
          selectedId = merged[0]?.id ?? null;
        }
        // Downstream of reinforcement, like beam detailing: loads, analysis and design are
        // preserved, detailing and the document are invalidated, no solve is required.
        regulationsStore.noteChange('reinforcementEdit');
        return result;
      } catch (e) {
        lastError = String(e instanceof Error ? e.message : e);
        return null;
      } finally {
        generating = false;
      }
    },

    /** The last floor run, for the panel that reports what it could not design. */
    get lastFloorRun(): RunFloorDesignResult | null { return lastFloorRun; },

    /**
     * The last footing run, for the panel that reports what could not be checked and why.
     *
     * Separate from `lastFloorRun` because the two answer different questions: a shell is
     * unsupported for reasons about its geometry and its stresses, a footing for reasons
     * about its soil, its reaction and its column.
     */
    get lastFootingRun(): RunFootingDesignResult | null { return lastFootingRun; },

    /** Footings that could not be checked, with the reason — the gate, as data for the UI. */
    get footingsNotVerified(): Array<{ name: string; reasons: EngineMessage[] }> {
      return (lastFootingRun?.outcomes ?? [])
        .filter((o) => o.check === null)
        .map((o) => ({ name: o.name, reasons: o.unsupported }));
    },

    /** Replace the whole set — used after a regeneration run. */
    setAssemblies(next: DetailingAssembly[]): void {
      // New geometry: whatever the old document drew is no longer what exists.
      retireDocument();
      write({ ...store, assemblies: next });
      if (!next.some((a) => a.id === selectedId)) selectedId = next[0]?.id ?? null;
    },

    /** Targeted invalidation after an element edit. */
    invalidate(changedElements: Iterable<number>): string[] {
      retireDocument();
      const r = invalidateAffected(store, changedElements);
      write(r.store);
      return r.invalidated;
    },

    /** Pin or unpin a bar; a pinned bar is a hard constraint on regeneration. */
    toggleLock(barId: string): void {
      retireDocument();
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
      // A review changes the readiness a document may claim, so the previous one is no
      // longer current — even though the geometry is unchanged.
      retireDocument();
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

    /**
     * Build the DocumentModel from the CURRENT coordinated state.
     *
     * The single production caller. Everything the three exports print comes from the
     * object this returns, so a report, a drawing set and a schedule of the same floor
     * cannot disagree about the revision, the conflicts or the steel.
     *
     * Returns null when there is no coordinated detailing. That is not an error and must
     * not be papered over with the legacy per-member reinforcement: the pre-coordination
     * arrangement is a different thing from a coordinated cage, and showing one while
     * labelling it the other is the failure this whole workflow exists to prevent.
     */
    buildDocument(opts: { author: string; at: string }): DocumentModel | null {
      if (store.assemblies.length === 0) return null;
      const laps = lastRun?.lapping.laps ?? [];
      const certificates: CertificateEntry[] = [];
      for (const a of store.assemblies) {
        for (const id of a.elementIds) {
          const reinf = verificationStore.reinforcementFor(id);
          const result = verificationStore.providedFor(id);
          const current = reinf ? rebarHash(reinf) : '';
          const certified = verificationStore.certifiedHashFor(id);
          certificates.push({
            elementId: id,
            certifiedHash: certified,
            currentHash: current,
            // Empty on either side means the question was never answered, which is not a
            // match. Silence is not agreement.
            matches: certified !== '' && current !== '' && certified === current,
            verifierId: a.provenance.verifierId,
            status: result?.overallStatus === 'ok' ? 'ok'
              : result?.overallStatus === 'warn' ? 'warn'
                : result?.overallStatus === 'fail' ? 'fail' : 'notRun',
          });
        }
      }
      const doc = buildDocumentModel({
        seriesId: 'detailing',
        revision: {
          number: documentRevision,
          at: opts.at,
          author: opts.author,
          detailingRevision: maxRevision(store.assemblies),
          demandRevision: verificationStore.demandRevision,
        },
        regulations: [{ id: 'cirsoc-201', edition: currentConcreteEdition() }],
        assemblies: store.assemblies,
        laps,
        certificates,
      });
      currentDocument = doc;
      return doc;
    },

    /** The document built by the last `buildDocument`, if any. */
    get document(): DocumentModel | null { return currentDocument; },

    /** Documents kept for the record after a later revision replaced them. */
    get supersededDocuments(): DocumentModel[] { return supersededDocs; },

    /**
     * Retire the current document.
     *
     * Called whenever anything the document depends on changes — loads, analysis,
     * reinforcement, detailing geometry, the spacing margin, review, or regulation
     * settings. Non-destructive: the old revision keeps its number and content and moves
     * to the superseded list, because a project that cannot show what it previously issued
     * cannot answer the only question that matters after something goes wrong.
     */
    supersedeDocuments(): void { retireDocument(); },

    clear(): void {
      write(emptyDetailingStore());
      selectedId = null;
      conflictIndex = 0;
      lastError = null;
    },
  };
}

export const detailingStore = createDetailingStore();
