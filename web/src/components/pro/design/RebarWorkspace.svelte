<script lang="ts">
  /**
   * The 3-D reinforcement workspace: the whole window, not a corner of it.
   *
   * ── Why this is an overlay at App level ────────────────────────────
   *
   * The viewer was small for a structural reason, not a styling one. It lived at
   * `App → aside.pro-sidebar → ProPanel → ProRcWorkflowTab → DetailingWorkflow →
   * RebarScenePanel → canvas`, and that `aside` takes a fixed pixel width from
   * `uiStore.proPanelWidth`. No amount of width inside it can exceed the sidebar, so
   * inspecting a cage of thousands of bars was being done through a slot a few hundred pixels
   * wide. Widening the sidebar would have traded one cramped surface for another and broken
   * the model view beside it.
   *
   * So the workspace mounts at App level and covers the window. The sidebar keeps the summary
   * and the export; the inspection happens here.
   *
   * ── Why closing does not destroy anything ─────────────────────────
   *
   * All of its state — layers, section, selection, history — lives in `rebarWorkspace`, so
   * the overlay can unmount and come back exactly as it was. And nothing in this file writes
   * to `modelStore`: opening and closing is a view operation, and the project is byte-identical
   * either side of it.
   */
  import { t, tp, i18n } from '../../../lib/i18n';
  import { modelStore } from '../../../lib/store/model.svelte';
  import { verificationStore } from '../../../lib/store/verification.svelte';
  import { detailingStore } from '../../../lib/store/detailing.svelte';
  import { rebarWorkspace, SOLID_KINDS } from '../../../lib/store/rebar-workspace.svelte';
  import {
    filterScene, summariseScene, type SceneFilter,
  } from '../../../lib/engine/detailing/scene-model';
  import { membersFromModel } from '../../../lib/engine/detailing/member-geometry';
  import { cachedSceneModel } from '../../../lib/engine/detailing/scene-cache';
  import {
    reportElementStatus, summariseStatusReasons, type DesignOutcomeSummary,
  } from '../../../lib/engine/detailing/element-status';
  import RebarViewport3D from './RebarViewport3D.svelte';
  import RebarStatusPanel from './RebarStatusPanel.svelte';
  import RebarLayersPanel from './RebarLayersPanel.svelte';
  import { markOpenPhase } from '../../../lib/utils/open-timeline';

  let viewport = $state<RebarViewport3D | null>(null);
  /** True while the viewport's first geometry build is still pending. */
  let building = $state(false);
  /**
   * The rail starts closed on a small screen.
   *
   * There it is a sheet OVER the canvas rather than a column beside it, so opening by default
   * would cover the viewport with a control panel the moment the workspace appears — hiding
   * the thing the user came to look at behind the settings for looking at it.
   */
  let railOpen = $state(
    typeof window === 'undefined' ? true : window.innerWidth > 860);

  const doc = $derived(detailingStore.document);

  /** The full scene, with concrete for every member the model states. */
  const built = $derived.by(() => {
    if (!doc) return null;
    const elementIds = [...modelStore.model.elements.keys()].sort((a, b) => a - b);
    const { members, refused } = membersFromModel({
      elementIds,
      nodes: [...modelStore.model.nodes.values()],
      elements: [...modelStore.model.elements.values()],
      sections: [...modelStore.model.sections.values()],
    });
    /**
       * Cached against the document and the member geometry.
       *
       * Sampling 20 917 bars is the expensive step, and it was repeated on every reactive
       * touch because `membersFromModel` returns a fresh array each call. The cache answers
       * the only question that matters — same document, same members — so a checkbox, a
       * slider or a selection no longer rebuilds the projection.
       */
      const scene = cachedSceneModel(doc, members);
      markOpenPhase('scene');
      return { scene, refused };
  });

  /**
   * The design outcomes, reduced to what the status join needs.
   *
   * Read here rather than inside the scene, because the scene is a projection of the document
   * and a design outcome is not in it. This is the one place the two halves meet.
   */
  const outcomes = $derived.by(() => {
    const m = new Map<number, DesignOutcomeSummary>();
    for (const id of modelStore.model.elements.keys()) {
      const o = verificationStore.outcomeFor(id);
      const v = verificationStore.providedFor(id);
      if (!o && !v) continue;
      m.set(id, {
        outcome: o?.outcome,
        verificationStatus: v?.overallStatus,
        limiting: o?.limiting ?? [],
        reasonKey: o?.reasons?.[0]?.key,
        secondaryRatio: o?.axes?.secondaryRatio,
      });
    }
    return m;
  });

  const report = $derived(built ? reportElementStatus(built.scene, outcomes) : null);

  /**
   * The shared causes behind the states, commonest first.
   *
   * On the 7-storey example 117 of 119 beams land in UNSUPPORTED for ONE reason. Without this
   * the panel reports "UNSUPPORTED 117" and the user has to open members one at a time to
   * discover that — or, worse, concludes the viewer lost their steel. See
   * `summariseStatusReasons` for why the grouping is on the reason KEY.
   */
  const reasonGroups = $derived(report ? summariseStatusReasons(report.entries) : []);

  /**
   * The design's own sentence for each member, translated once.
   *
   * The reason already exists — `design.reason.secondaryAxisUnchecked` carries the axis and
   * the ratio — and was reaching nothing the user could read. A state name is a label; this is
   * the explanation.
   */
  const reasons = $derived.by(() => {
    const m = new Map<number, string>();
    for (const id of modelStore.model.elements.keys()) {
      const r = verificationStore.outcomeFor(id)?.reasons?.[0];
      if (r) m.set(id, tp(r.key, (r.params ?? {}) as Record<string, string | number>));
    }
    return m;
  });

  /** Families with a switch but no members in this model. */
  const emptyKinds = $derived.by(() => {
    if (!built) return [];
    const present = new Set(built.scene.solids.map((x) => x.kind));
    return SOLID_KINDS.filter((k) => !present.has(k));
  });

  /** Transverse pieces by kind, so a hoop is distinguishable from a single-leg crosstie. */
  const pieces = $derived.by(() => {
    if (!visible) return [];
    const m = new Map<string, number>();
    for (const b of visible.bars) {
      if (b.piece === 'longitudinal') continue;
      m.set(b.piece, (m.get(b.piece) ?? 0) + 1);
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  });

  /**
   * The members a status filter admits.
   *
   * Null when no filter is active, which is NOT the same as an empty list: an empty list means
   * "no member matches" and must show nothing, and that distinction is the one a filter UI
   * gets wrong by default.
   */
  const statusElementIds = $derived.by(() => {
    if (!report || rebarWorkspace.statusFilter.length === 0) return null;
    return report.entries
      .filter((e) => rebarWorkspace.statusFilter.includes(e.status))
      .map((e) => e.elementId);
  });

  const filter = $derived.by<SceneFilter>(() => {
    const f: SceneFilter = {};
    const kinds = rebarWorkspace.visibleKinds();
    if (kinds.length !== SOLID_KINDS.length) f.solidKinds = kinds;
    if (!rebarWorkspace.showBars) f.hideBars = true;
    if (rebarWorkspace.hideUnreinforced) f.hideUnreinforced = true;
    // Isolation wins over the status filter: it is the more specific gesture, and the user
    // performed it more recently.
    if (rebarWorkspace.isolated.length > 0) f.elementIds = rebarWorkspace.isolated;
    else if (statusElementIds) f.elementIds = statusElementIds;
    return f;
  });

  const visible = $derived(built ? filterScene(built.scene, filter) : null);
  const summary = $derived(visible ? summariseScene(visible) : null);

  const selectedBar = $derived.by(() => {
    const id = rebarWorkspace.selection?.barId;
    return id && visible ? visible.bars.find((b) => b.barId === id) ?? null : null;
  });

  /**
   * The concrete for the current selection, however it was made.
   *
   * A click in the viewport names a solid directly. A click in the MEMBER LIST names only an
   * element id — and resolving that back to its solid here is what stops the inspector saying
   * "nothing selected" about the member the user just chose from a list of members. Without
   * it, the list selects and focuses correctly and then reports nothing, which reads as the
   * list being broken.
   */
  const selectedSolid = $derived.by(() => {
    if (!visible) return null;
    const sel = rebarWorkspace.selection;
    if (!sel) return null;
    if (sel.solidId) return visible.solids.find((s) => s.id === sel.solidId) ?? null;
    if (sel.barId) return null;
    const id = sel.elementIds[0];
    return id === undefined
      ? null
      : visible.solids.find((s) => s.elementIds.includes(id)) ?? null;
  });

  /** What the inspector reports as the member, even when no solid could be resolved. */
  const selectedElementIds = $derived(
    selectedBar?.elementIds ?? selectedSolid?.elementIds
    ?? rebarWorkspace.selection?.elementIds ?? []);

  const selectedStatus = $derived.by(() => {
    const ids = rebarWorkspace.selection?.elementIds ?? [];
    if (!report || ids.length === 0) return null;
    return report.entries.find((e) => e.elementId === ids[0]) ?? null;
  });

  function fmt(n: number, digits = 2): string {
    return n.toLocaleString(i18n.locale, {
      minimumFractionDigits: digits, maximumFractionDigits: digits,
    });
  }

  // The camera follows the store's focus requests. A nonce drives it, so asking for the same
  // member twice works — which is what "I orbited away, take me back" is.
  let lastNonce = -1;
  /**
   * The member the camera is actually on.
   *
   * Set from the RETURN of `focusElement`, not from the request. A request for a member that
   * has been filtered out cannot be served — the viewport leaves the camera where it is
   * rather than flying to the origin — and recording the request would then claim a move that
   * never happened. It is also the only thing a test can observe about the camera without
   * reaching into Three.js.
   */
  let focusedElement = $state<number | null>(null);
  $effect(() => {
    const req = rebarWorkspace.focusRequest;
    if (!req || req.nonce === lastNonce) return;
    lastNonce = req.nonce;
    if (viewport?.focusElement(req.elementId)) focusedElement = req.elementId;
  });

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') rebarWorkspace.close();
  }

  /**
   * Fold the rail away when the window becomes narrow, and only then.
   *
   * Below the breakpoint the rail stops being a column beside the canvas and becomes a sheet
   * over it, so a window that was wide and is now narrow ends up with the controls covering
   * the model. Reacting to the CROSSING rather than to every resize is what keeps this from
   * fighting a user who deliberately opened the rail on a narrow window.
   */
  let wasWide = typeof window === 'undefined' ? true : window.innerWidth > 860;
  function onResize() {
    const wide = window.innerWidth > 860;
    if (wide !== wasWide) {
      wasWide = wide;
      railOpen = wide;
    }
  }
</script>

<svelte:window onkeydown={onKeydown} onresize={onResize} />

{#if rebarWorkspace.open}
  <div
    class="workspace"
    data-testid="rebar-workspace"
    role="dialog"
    aria-modal="true"
    aria-label={t('detailing.scene.workspace.title')}
  >
    <header class="topbar">
      <button
        class="rail-toggle"
        type="button"
        data-testid="rebar-rail-toggle"
        aria-expanded={railOpen}
        onclick={() => { railOpen = !railOpen; }}
      >☰</button>
      <h2>{t('detailing.scene.workspace.title')}</h2>
      {#if built}
        <span class="badge" data-testid="rebar-workspace-readiness">
          {t(`detailing.doc.readiness.${built.scene.readiness}`)}
        </span>
        <span class="rev">
          {tp('detailing.doc.revision', { n: built.scene.revision })}
        </span>
      {/if}
      {#if summary}
        <span class="sum" data-testid="rebar-workspace-summary">
          {tp('detailing.scene.summary', {
            bars: summary.barCount,
            length: fmt(summary.totalLength),
            mass: fmt(summary.massKg, 1),
          })}
        </span>
      {/if}
      <span class="spacer"></span>
      {#if rebarWorkspace.canGoBack}
        <button
          type="button"
          data-testid="rebar-back"
          onclick={() => rebarWorkspace.goBack()}
        >← {t('detailing.scene.back')}</button>
      {/if}
      <button
        type="button"
        data-testid="rebar-fit-view"
        onclick={() => viewport?.fitView()}
      >
        {t('detailing.scene.reset')}
      </button>
      <button
        class="close"
        type="button"
        data-testid="rebar-workspace-close"
        onclick={() => rebarWorkspace.close()}
      >✕ {t('detailing.scene.workspace.close')}</button>
    </header>

    <div class="body" class:rail-open={railOpen}>
      <aside class="rail" data-testid="rebar-rail" aria-hidden={!railOpen}>
        <RebarLayersPanel {summary} {emptyKinds} {pieces} bounds={built?.scene.bounds ?? null} />

        {#if report}
          <RebarStatusPanel {report} {reasons} {reasonGroups} />
        {/if}
      </aside>

      <main class="stage">
        {#if built}
          <!--
            The WHOLE scene, plus the filter as a separate input.

            The viewport used to be handed `visible` — the filtered scene — and that is what made
            every layer switch cost seconds: a smaller scene has a different signature, and a
            different signature meant re-tubing all 20 917 bars to answer a checkbox. It builds
            once from everything the document contains and switches batches instead.

            `visible` is still computed, because the tally, the inspector and the piece counts are
            all statements about what is ON SCREEN. Filtering arrays of bars is milliseconds;
            rebuilding their geometry was seconds.
          -->
          <RebarViewport3D
            bind:this={viewport}
            scene={built.scene}
            {filter}
            diameterScale={rebarWorkspace.diameterScale}
            showConcrete={rebarWorkspace.showConcrete}
            showConflicts={rebarWorkspace.showConflicts}
            concreteOpacity={rebarWorkspace.concreteOpacity}
            selectedBarId={rebarWorkspace.selection?.barId ?? null}
            section={rebarWorkspace.section}
            height="100%"
            onselect={(pick) => rebarWorkspace.select(pick)}
            onbuildstate={(b) => { building = b; }}
          />
          {#if building}
            <!--
              What the user sees INSTEAD of a frozen window.

              The cage is 20 917 tubes and 39 240 conflict markers once the floors are designed,
              and materialising that on the GPU takes seconds no matter how it is scheduled. What
              is not acceptable is spending those seconds with nothing on screen, which is what
              "the button does not respond" was: the build ran inside `onMount`, before the
              browser's first paint, so the click produced no visible change at all.

              The viewport now paints first and reports that it is still building, so this says
              so. It is a STATEMENT, not a decoration: while it is up, what is behind it is not
              the finished scene and is not presented as one.
            -->
            <div class="building" data-testid="rebar-workspace-building" role="status">
              <span class="spinner" aria-hidden="true"></span>
              <span>{tp('detailing.scene.building', { bars: built.scene.bars.length })}</span>
            </div>
          {/if}
        {:else}
          <p class="empty" data-testid="rebar-workspace-empty">
            {t('detailing.scene.empty')}
          </p>
        {/if}

        <div
          class="inspector"
          data-testid="rebar-inspector"
          data-focused={focusedElement ?? ''}
        >
          {#if selectedBar}
            <dl>
              <dt>{t('detailing.scene.mark')}</dt>
              <dd data-testid="rebar-sel-mark">
                {selectedBar.mark ?? t('detailing.scene.unmarked')}
              </dd>
              <dt>{t('detailing.scene.diameter')}</dt>
              <dd>Ø{selectedBar.diameterMm}</dd>
              <dt>{t('detailing.scene.pieces.title')}</dt>
              <dd data-testid="rebar-sel-piece">
                {t(`detailing.scene.piece.${selectedBar.piece}`)}
              </dd>
              <dt>{t('detailing.scene.cuttingLength')}</dt>
              <dd>{fmt(selectedBar.cuttingLength)} m</dd>
              <dt>{t('detailing.scene.parentElement')}</dt>
              <dd data-testid="rebar-sel-parent">{selectedBar.elementIds.join(', ') || '—'}</dd>
              <dt>{t('detailing.scene.layer')}</dt>
              <dd>{selectedBar.layerId ?? '—'}</dd>
              <dt>{t('detailing.scene.assembly')}</dt>
              <dd>{selectedBar.assemblyId}</dd>
            </dl>
          {:else if selectedElementIds.length > 0}
            <dl>
              <dt>{t('detailing.scene.selectedElement')}</dt>
              <dd data-testid="rebar-sel-parent">{selectedElementIds.join(', ')}</dd>
              {#if selectedSolid}
                <dt>{t('detailing.scene.families')}</dt>
                <dd>{t(`detailing.scene.kind.${selectedSolid.kind}`)}</dd>
              {/if}
            </dl>
          {:else}
            <p class="hint">{t('detailing.scene.noSelection')}</p>
          {/if}

          {#if selectedStatus}
            <p class="sel-status" data-testid="rebar-sel-status">
              {t(`detailing.scene.status.${selectedStatus.status}`)}
              {#if selectedStatus.limiting.length > 0}
                <span class="lim">({selectedStatus.limiting.join(', ')})</span>
              {/if}
            </p>
            {#if reasons.get(selectedStatus.elementId)}
              <p class="sel-reason" data-testid="rebar-sel-reason">
                {t('detailing.scene.reason')}: {reasons.get(selectedStatus.elementId)}
              </p>
            {/if}
            <div class="sel-actions">
              {#if rebarWorkspace.isolated.length > 0}
                <button type="button" data-testid="rebar-clear-isolation"
                        onclick={() => rebarWorkspace.clearIsolation()}>
                  {t('detailing.scene.clearIsolation')}
                </button>
              {:else}
                <button type="button" data-testid="rebar-isolate"
                        onclick={() => rebarWorkspace.isolate(
                          rebarWorkspace.selection?.elementIds ?? [])}>
                  {t('detailing.scene.isolate')}
                </button>
              {/if}
            </div>
          {/if}
        </div>
      </main>
    </div>
  </div>
{/if}

<style>
  .workspace {
    position: fixed;
    inset: 0;
    z-index: 900;
    display: flex;
    flex-direction: column;
    background: #0e1218;
    color: var(--text, #dfe4ec);
  }
  .topbar {
    display: flex; align-items: center; gap: 0.6rem;
    padding: 0.45rem 0.7rem;
    border-bottom: 1px solid #232a35;
    background: #141a23;
    flex: 0 0 auto;
    flex-wrap: wrap;
  }
  .topbar h2 { margin: 0; font-size: 0.95rem; }
  .spacer { flex: 1 1 auto; }
  .badge {
    font-size: 0.7rem; padding: 0.1rem 0.4rem; border-radius: 3px;
    background: rgba(255, 255, 255, 0.1);
  }
  .rev, .sum { font-size: 0.74rem; color: var(--text-muted, #8b93a3); }
  .topbar button {
    font-size: 0.76rem; padding: 0.25rem 0.55rem; cursor: pointer;
    background: #1e2733; color: inherit; border: 1px solid #2c3644; border-radius: 4px;
  }
  .topbar button.close { border-color: #3d4b5e; }
  .rail-toggle { display: none; }

  .body { display: flex; flex: 1 1 auto; min-height: 0; }
  .rail {
    width: 17rem; flex: 0 0 auto; overflow-y: auto;
    border-right: 1px solid #232a35; padding: 0.6rem;
    display: flex; flex-direction: column; gap: 0.7rem;
  }
  .body:not(.rail-open) .rail { display: none; }
  .stage { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; position: relative; }
  /* Over the canvas, not in the layout: appearing must not resize the viewport, because a
     resize reallocates the drawing buffer and that is the cost this is announcing. */
  .building {
    position: absolute; inset: auto 0 1rem 0; margin: 0 auto; width: max-content;
    display: flex; align-items: center; gap: 0.5rem;
    padding: 0.4rem 0.8rem; border-radius: 999px;
    background: var(--st-surface-2, #1b2130); border: 1px solid var(--st-border, #2c3444);
    color: var(--text, #d7dce6); font-size: 0.76rem; pointer-events: none; z-index: 2;
  }
  .spinner {
    width: 0.8rem; height: 0.8rem; border-radius: 50%;
    border: 2px solid var(--st-border, #2c3444); border-top-color: #6fa8ff;
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  @media (prefers-reduced-motion: reduce) { .spinner { animation: none; } }
  .stage :global(.rebar-viewport) { flex: 1 1 auto; border: none; border-radius: 0; }

  h4 { margin: 0 0 0.25rem; font-size: 0.8rem; }
  label {
    display: flex; align-items: center; gap: 0.35rem;
    font-size: 0.76rem; padding: 0.08rem 0; cursor: pointer;
  }
  label.slider { flex-direction: column; align-items: stretch; gap: 0.15rem; }
  hr { border: none; border-top: 1px solid #232a35; margin: 0.35rem 0; }
  select, input[type='range'] { width: 100%; font-size: 0.76rem; }
  .section-cut button {
    font-size: 0.74rem; margin-top: 0.3rem; cursor: pointer;
    background: #1e2733; color: inherit; border: 1px solid #2c3644; border-radius: 4px;
    padding: 0.2rem 0.5rem;
  }

  .empty-families {
    display: flex; flex-direction: column; gap: 0.05rem;
    margin: 0.3rem 0 0; font-size: 0.7rem; color: var(--text-muted, #8b93a3);
  }
  .empty-families .why { opacity: 0.8; margin-top: 0.15rem; }
  label span.empty { opacity: 0.55; }
  label em { font-style: normal; font-size: 0.68rem; opacity: 0.8; }
  .sel-reason { margin: 0.2rem 0 0; font-size: 0.74rem; color: var(--text-muted, #8b93a3); }
  .tally h5 { margin: 0.35rem 0 0.15rem; font-size: 0.75rem; }
  .tally table { width: 100%; border-collapse: collapse; font-size: 0.72rem; }
  .tally th {
    text-align: left; font-weight: 400; color: var(--text-muted, #8b93a3);
    padding: 0.08rem 0;
  }
  .tally td { text-align: right; font-variant-numeric: tabular-nums; padding: 0.08rem 0; }
  .tally .totals {
    display: flex; flex-direction: column; gap: 0.05rem;
    margin: 0 0 0.25rem; font-size: 0.72rem; color: var(--text-muted, #8b93a3);
  }
  .tally .totals strong { color: var(--text, #dfe4ec); float: right; }

  .inspector {
    flex: 0 0 auto; border-top: 1px solid #232a35; padding: 0.45rem 0.7rem;
    background: #141a23; max-height: 12rem; overflow-y: auto;
  }
  .inspector dl {
    display: grid; grid-template-columns: auto 1fr auto 1fr auto 1fr;
    gap: 0.1rem 0.55rem; margin: 0; font-size: 0.76rem;
  }
  .inspector dt { color: var(--text-muted, #8b93a3); }
  .inspector dd { margin: 0; }
  .hint { margin: 0; font-size: 0.76rem; color: var(--text-muted, #8b93a3); }
  .sel-status { margin: 0.3rem 0 0; font-size: 0.78rem; }
  .sel-status .lim { color: var(--text-muted, #8b93a3); }
  .sel-actions { margin-top: 0.3rem; }
  .sel-actions button {
    font-size: 0.74rem; padding: 0.2rem 0.5rem; cursor: pointer;
    background: #1e2733; color: inherit; border: 1px solid #2c3644; border-radius: 4px;
  }
  .empty { padding: 2rem; text-align: center; color: var(--text-muted, #8b93a3); }

  /**
   * Mobile: the rail becomes a sheet over the canvas rather than a column beside it.
   *
   * A 17 rem column on a 390 px screen leaves the viewport unusable, and the viewport is the
   * reason the workspace exists. The rail is one tap away and starts closed.
   */
  @media (max-width: 860px) {
    .rail-toggle { display: inline-block; }
    .topbar h2 { font-size: 0.85rem; }
    .rev, .sum { display: none; }
    .body { position: relative; }
    .rail {
      position: absolute; inset: 0 auto 0 0; z-index: 2;
      width: min(20rem, 88vw);
      background: #141a23;
      box-shadow: 0 0 24px rgba(0, 0, 0, 0.5);
    }
    .inspector dl { grid-template-columns: auto 1fr; }
    .inspector { max-height: 9rem; }
  }
</style>
