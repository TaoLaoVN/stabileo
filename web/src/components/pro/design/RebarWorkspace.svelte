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
    buildSceneModel, filterScene, summariseScene, type SceneFilter,
  } from '../../../lib/engine/detailing/scene-model';
  import { membersFromModel } from '../../../lib/engine/detailing/member-geometry';
  import {
    reportElementStatus, type DesignOutcomeSummary,
  } from '../../../lib/engine/detailing/element-status';
  import RebarViewport3D from './RebarViewport3D.svelte';
  import RebarStatusPanel from './RebarStatusPanel.svelte';

  let viewport = $state<RebarViewport3D | null>(null);
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
    return { scene: buildSceneModel(doc, { members }), refused };
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
      });
    }
    return m;
  });

  const report = $derived(built ? reportElementStatus(built.scene, outcomes) : null);

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

  const sectionAxis = $derived(rebarWorkspace.section?.axis ?? '');

  function setAxis(axis: string) {
    if (axis === '') { rebarWorkspace.setSection(null); return; }
    const b = built?.scene.bounds;
    const a = axis as 'x' | 'y' | 'z';
    // Start the plane at the middle of the model, which is where a section is useful.
    const at = b ? (b.min[a] + b.max[a]) / 2 : 0;
    rebarWorkspace.setSection({ axis: a, at, flip: false });
  }

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
      <button type="button" onclick={() => viewport?.fitView()}>
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
        <section class="layers">
          <h4>{t('detailing.scene.layers')}</h4>
          {#each SOLID_KINDS as kind (kind)}
            <label>
              <input
                type="checkbox"
                data-testid={`rebar-layer-${kind}`}
                checked={!rebarWorkspace.hiddenKinds.includes(kind)}
                onchange={() => rebarWorkspace.toggleKind(kind)}
              />
              <span>{t(`detailing.scene.kind.${kind}`)}</span>
            </label>
          {/each}
          <hr />
          <label>
            <input
              type="checkbox"
              data-testid="rebar-layer-bars"
              bind:checked={rebarWorkspace.showBars}
            />
            <span>{t('detailing.scene.showBars')}</span>
          </label>
          <label>
            <input type="checkbox" bind:checked={rebarWorkspace.showConcrete} />
            <span>{t('detailing.scene.showConcrete')}</span>
          </label>
          <label>
            <input type="checkbox" bind:checked={rebarWorkspace.showConflicts} />
            <span>{t('detailing.scene.showConflicts')}</span>
          </label>
          <label>
            <input
              type="checkbox"
              data-testid="rebar-hide-unreinforced"
              bind:checked={rebarWorkspace.hideUnreinforced}
            />
            <span>{t('detailing.scene.hideUnreinforced')}</span>
          </label>
          <label class="slider">
            <span>{t('detailing.scene.exaggerate')} ×{rebarWorkspace.diameterScale}</span>
            <input type="range" min="1" max="6" step="1"
                   bind:value={rebarWorkspace.diameterScale} />
          </label>
          <label class="slider">
            <span>{t('detailing.scene.opacity')}</span>
            <input type="range" min="0.2" max="2" step="0.1"
                   data-testid="rebar-opacity"
                   bind:value={rebarWorkspace.concreteOpacity} />
          </label>
        </section>

        <section class="section-cut">
          <h4>{t('detailing.scene.section')}</h4>
          <select
            data-testid="rebar-section-axis"
            value={sectionAxis}
            onchange={(e) => setAxis((e.currentTarget as HTMLSelectElement).value)}
          >
            <option value="">{t('detailing.scene.sectionOff')}</option>
            <option value="x">X</option>
            <option value="y">Y</option>
            <option value="z">Z</option>
          </select>
          {#if rebarWorkspace.section && built?.scene.bounds}
            {@const b = built.scene.bounds}
            {@const ax = rebarWorkspace.section.axis}
            <input
              type="range"
              data-testid="rebar-section-at"
              min={b.min[ax]} max={b.max[ax]}
              step={Math.max(0.01, (b.max[ax] - b.min[ax]) / 200)}
              value={rebarWorkspace.section.at}
              oninput={(e) => rebarWorkspace.setSection({
                ...rebarWorkspace.section!,
                at: Number((e.currentTarget as HTMLInputElement).value),
              })}
            />
            <button
              type="button"
              onclick={() => rebarWorkspace.setSection({
                ...rebarWorkspace.section!, flip: !rebarWorkspace.section!.flip,
              })}
            >{t('detailing.scene.sectionFlip')}</button>
          {/if}
        </section>

        <!-- ── What is actually in the scene, counted ────────────────
             A model can render thousands of bars and still be missing an entire family:
             12 705 bars looked full while every column tie in the building was absent.
             "Lots of bars" and "all the bars" are indistinguishable by eye, so the families
             are counted next to the picture. -->
        {#if summary}
          <section class="tally" data-testid="rebar-tally">
            <h4>{t('detailing.scene.tally.title')}</h4>
            <p class="totals">
              <span>{t('detailing.scene.tally.solids')} <strong>{summary.solidCount}</strong></span>
              <span>{t('detailing.scene.tally.reinforced')}
                <strong>{summary.reinforcedSolidCount}</strong></span>
              <span>{t('detailing.scene.tally.bars')} <strong>{summary.barCount}</strong></span>
            </p>
            <table>
              <tbody>
                {#each summary.byFamily as f (f.family)}
                  <tr data-testid={`rebar-tally-${f.family}`}>
                    <th scope="row">{t(`detailing.scene.kind.${f.family}`)}</th>
                    <td>{f.solids}</td>
                    <td>{f.longitudinal} {t('detailing.scene.tally.long')}</td>
                    <td>{f.transverse} {t('detailing.scene.tally.trans')}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </section>
        {/if}

        {#if report}
          <RebarStatusPanel {report} />
        {/if}
      </aside>

      <main class="stage">
        {#if visible}
          <RebarViewport3D
            bind:this={viewport}
            scene={visible}
            diameterScale={rebarWorkspace.diameterScale}
            showConcrete={rebarWorkspace.showConcrete}
            showConflicts={rebarWorkspace.showConflicts}
            concreteOpacity={rebarWorkspace.concreteOpacity}
            selectedBarId={rebarWorkspace.selection?.barId ?? null}
            section={rebarWorkspace.section}
            height="100%"
            onselect={(pick) => rebarWorkspace.select(pick)}
          />
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
  .stage { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; }
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
