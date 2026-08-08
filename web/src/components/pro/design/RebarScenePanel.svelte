<script lang="ts">
  /**
   * The 3-D reinforcement view, and the drawings that come out of it.
   *
   * ── The chain this panel is the visible end of ─────────────────────
   *
   * The analysis model produces demands, the design produces bars, coordination produces a
   * cage, and the document assembles all of it into one statement. Everything on this screen
   * is a projection of that statement: the picture, the counts, the identity of the bar you
   * clicked, and the sheets the export writes. Nothing here recomputes anything.
   *
   * That is why the export button says "what is visible" rather than "everything". A user who
   * has narrowed the view to one footing and presses export should get that footing's sheets,
   * and the scope is stated in words before they press it — because a drawing set whose extent
   * you have to infer from the filenames is a drawing set nobody trusts.
   *
   * ── Why concrete gaps are shown rather than filled ─────────────────
   *
   * `membersFromModel` refuses to invent a section for a member that states no b×h. Those
   * members are named here, with the reason. A plausible box nobody specified is worse than a
   * visible hole, because only the hole prompts the question.
   */
  import { t, tp, i18n } from '../../../lib/i18n';
  import { te } from '../../../lib/i18n/engine-text';
  import { modelStore } from '../../../lib/store/model.svelte';
  import { verificationStore } from '../../../lib/store/verification.svelte';
  import {
    buildSceneModel, filterScene, summariseScene,
    type SceneFilter, type SceneModel,
  } from '../../../lib/engine/detailing/scene-model';
  import { membersFromModel } from '../../../lib/engine/detailing/member-geometry';
  import { renderDrawings } from '../../../lib/engine/detailing/document-render';
  import type { DocumentModel } from '../../../lib/engine/detailing/document-model';
  import type { BarRole } from '../../../lib/codes/cirsoc201/bar-geometry';
  import type { FloorFamily } from '../../../lib/engine/detailing/family-record';
  import RebarViewport3D from './RebarViewport3D.svelte';

  interface Props {
    /** The document to project. Null when nothing has been coordinated yet. */
    doc: DocumentModel | null;
    /** How the panel hands a finished file back to the workflow that owns downloads. */
    ondownload: (name: string, type: string, content: string) => void;
  }

  const { doc, ondownload }: Props = $props();

  let showConcrete = $state(true);
  let showConflicts = $state(true);
  let conflictedOnly = $state(false);
  // Off by default: a member the app could not design is the most important thing here.
  let hideUnreinforced = $state(false);
  let diameterScale = $state(1);
  let selectedBarId = $state<string | null>(null);
  let hiddenAssemblies = $state<string[]>([]);
  let hiddenRoles = $state<BarRole[]>([]);
  let hiddenFamilies = $state<FloorFamily[]>([]);
  let viewport = $state<RebarViewport3D | null>(null);

  /**
   * The full scene, with the member concrete the analysis model states.
   *
   * The element list is the union of what the document's assemblies claim, so a member with
   * no steel on it is still asked for — and still reported when it cannot be built.
   */
  const built = $derived.by(() => {
    if (!doc) return null;
    /**
     * EVERY member in the model, not only the ones an assembly claims.
     *
     * Asking for the assemblies' members was the bug: a member whose design was refused
     * carries no steel, joins no assembly, and was therefore never asked for — so the view
     * that was supposed to show the user their structure quietly showed them 22 of its 26
     * members instead, with no gap where the other four should have been.
     *
     * Widening the request is the whole fix on this side. `membersFromModel` still refuses to
     * invent a section, and `buildSceneModel` now marks which of the members it drew have no
     * reinforcement in them.
     */
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
   * Why each unreinforced member has no steel, read from its design outcome.
   *
   * The scene states the fact and stops there, because it reads only the document and a
   * design outcome is not in it. Joining the two HERE keeps that separation intact and still
   * answers the only question the user will actually have, which is not "which members have
   * no steel" but "why not".
   */
  const unreinforced = $derived.by(() => {
    const s = visible;
    if (!s) return [];
    return s.unreinforcedMembers.map((id) => {
      const o = verificationStore.outcomeFor(id);
      return {
        id,
        outcome: o?.outcome ?? null,
        reason: o?.reasons?.[0] ?? null,
        limiting: o?.limiting ?? [],
      };
    });
  });

  /**
   * The filter, expressed as what is SHOWN.
   *
   * The UI tracks what the user has hidden, because that is what a checkbox toggles, but the
   * scene filter is defined in terms of what is kept — and the distinction between an absent
   * axis and an empty one is load-bearing. Deselecting every role must show nothing, not
   * everything, so an axis is only omitted when nothing on it is hidden.
   */
  const filter = $derived.by<SceneFilter>(() => {
    const s = built?.scene;
    if (!s) return {};
    const f: SceneFilter = {};
    if (hiddenAssemblies.length > 0) {
      f.assemblyIds = s.facets.assemblies
        .map((a) => a.id).filter((id) => !hiddenAssemblies.includes(id));
    }
    if (hiddenRoles.length > 0) {
      f.roles = s.facets.roles.filter((r) => !hiddenRoles.includes(r));
    }
    if (hiddenFamilies.length > 0) {
      f.families = s.facets.families.filter((x) => !hiddenFamilies.includes(x));
    }
    if (conflictedOnly) f.conflictedOnly = true;
    if (hideUnreinforced) f.hideUnreinforced = true;
    return f;
  });

  const visible = $derived.by<SceneModel | null>(() =>
    built ? filterScene(built.scene, filter) : null);

  const summary = $derived(visible ? summariseScene(visible) : null);

  const selected = $derived(
    selectedBarId && visible
      ? visible.bars.find((b) => b.barId === selectedBarId) ?? null
      : null);

  /** The assemblies still on screen — the scope any export from here will have. */
  const visibleAssemblyIds = $derived(
    visible ? [...new Set(visible.bars.map((b) => b.assemblyId))].sort() : []);

  function toggle<T>(list: T[], value: T): T[] {
    return list.includes(value) ? list.filter((x) => x !== value) : [...list, value];
  }

  function fmt(n: number, digits = 2): string {
    return n.toLocaleString(i18n.locale, {
      minimumFractionDigits: digits, maximumFractionDigits: digits,
    });
  }

  /**
   * Export the sheets for exactly the assemblies on screen.
   *
   * `renderDrawings` takes a document, so the document handed to it is a narrowed COPY — same
   * revision, same readiness, same clause list, fewer assemblies. Narrowing here rather than
   * filtering the sheets afterwards means the title blocks, the sheet numbering and the
   * conflict notes are all built for the set being issued, instead of being inherited from a
   * larger set the recipient never sees.
   */
  function exportVisible() {
    if (!doc || visibleAssemblyIds.length === 0) return;
    const scoped: DocumentModel = {
      ...doc,
      assemblies: doc.assemblies.filter((a) => visibleAssemblyIds.includes(a.id)),
      openConflicts: doc.openConflicts
        .filter((c) => visibleAssemblyIds.includes(c.assemblyId)),
    };
    const set = renderDrawings(scoped, {
      locale: i18n.locale, projectName: t('detailing.doc.project'),
    });
    ondownload(
      `detailing-rev${doc.revision.number}-3d.dxf`, 'application/dxf', set.dxf);
  }
</script>

<section class="rebar-scene" data-testid="rebar-scene">
  <header>
    <h4>{t('detailing.scene.title')}</h4>
    {#if built}
      <p class="sub">
        {tp('detailing.scene.subtitle', {
          revision: built.scene.revision,
          readiness: t(`detailing.doc.readiness.${built.scene.readiness}`),
        })}
      </p>
    {/if}
  </header>

  {#if !built || built.scene.bars.length === 0}
    <p class="empty" data-testid="rebar-empty">{t('detailing.scene.empty')}</p>
  {:else}
    <div class="controls">
      <fieldset>
        <legend>{t('detailing.scene.assemblies')}</legend>
        {#each built.scene.facets.assemblies as a (a.id)}
          <label>
            <input
              type="checkbox"
              checked={!hiddenAssemblies.includes(a.id)}
              onchange={() => { hiddenAssemblies = toggle(hiddenAssemblies, a.id); }}
            />
            <span>{te(a.label)} ({a.barCount})</span>
          </label>
        {/each}
      </fieldset>

      <fieldset>
        <legend>{t('detailing.scene.roles')}</legend>
        {#each built.scene.facets.roles as r (r)}
          <label>
            <input
              type="checkbox"
              checked={!hiddenRoles.includes(r)}
              onchange={() => { hiddenRoles = toggle(hiddenRoles, r); }}
            />
            <span class="swatch {r}"></span>
            <span>{t(`detailing.scene.role.${r}`)}</span>
          </label>
        {/each}
      </fieldset>

      {#if built.scene.facets.families.length > 0}
        <fieldset>
          <legend>{t('detailing.scene.families')}</legend>
          {#each built.scene.facets.families as f (f)}
            <label>
              <input
                type="checkbox"
                checked={!hiddenFamilies.includes(f)}
                onchange={() => { hiddenFamilies = toggle(hiddenFamilies, f); }}
              />
              <span>{t(`detailing.scene.family.${f}`)}</span>
            </label>
          {/each}
        </fieldset>
      {/if}

      <fieldset>
        <legend>{t('detailing.scene.filters')}</legend>
        <label>
          <input type="checkbox" bind:checked={showConcrete} />
          <span>{t('detailing.scene.showConcrete')}</span>
        </label>
        <label>
          <input type="checkbox" bind:checked={showConflicts} />
          <span>{t('detailing.scene.showConflicts')}</span>
        </label>
        <label>
          <input type="checkbox" bind:checked={conflictedOnly} />
          <span>{t('detailing.scene.conflictedOnly')}</span>
        </label>
        <label>
          <input type="checkbox" bind:checked={hideUnreinforced} />
          <span class="swatch unreinforced"></span>
          <span>{t('detailing.scene.hideUnreinforced')}</span>
        </label>
        <label class="slider">
          <span>{t('detailing.scene.exaggerate')} ×{diameterScale}</span>
          <input type="range" min="1" max="6" step="1" bind:value={diameterScale} />
        </label>
        <button type="button" onclick={() => viewport?.fitView()}>
          {t('detailing.scene.reset')}
        </button>
      </fieldset>
    </div>

    {#if visible}
      <RebarViewport3D
        bind:this={viewport}
        scene={visible}
        {diameterScale}
        {showConcrete}
        {showConflicts}
        {selectedBarId}
        onselect={(id) => { selectedBarId = id; }}
      />
    {/if}

    {#if summary}
      <p class="summary" data-testid="rebar-summary">
        {tp('detailing.scene.summary', {
          bars: summary.barCount,
          length: fmt(summary.totalLength),
          mass: fmt(summary.massKg, 1),
        })}
        {#if summary.conflictedBars > 0}
          <strong class="warn">
            · {tp('detailing.scene.conflictedCount', { n: summary.conflictedBars })}
          </strong>
        {/if}
      </p>
    {/if}

    <div class="detail" data-testid="rebar-detail">
      {#if selected}
        <h5>{t('detailing.scene.selected')}</h5>
        <dl>
          <dt>{t('detailing.scene.mark')}</dt>
          <dd>{selected.mark ?? t('detailing.scene.unmarked')}</dd>
          <dt>{t('detailing.scene.diameter')}</dt>
          <dd>Ø{selected.diameterMm}</dd>
          <dt>{t('detailing.scene.cuttingLength')}</dt>
          <dd>{fmt(selected.cuttingLength)} m</dd>
          <dt>{t('detailing.scene.members')}</dt>
          <dd>{selected.elementIds.join(', ') || '—'}</dd>
          <dt>{t('detailing.scene.layer')}</dt>
          <dd>{selected.layerId ?? '—'}</dd>
          <dt>{t('detailing.scene.assembly')}</dt>
          <dd>{selected.assemblyId}</dd>
        </dl>
      {:else}
        <p class="hint">{t('detailing.scene.selectHint')}</p>
      {/if}
    </div>

    <!-- ── Members the app could not reinforce ──────────────────────
         Named with the reason, and drawn in the viewport rather than omitted from it. -->
    {#if unreinforced.length > 0}
      <div class="unreinforced" data-testid="rebar-unreinforced">
        <h5>
          {tp('detailing.scene.unreinforcedCount', { n: unreinforced.length })}
        </h5>
        <ul>
          {#each unreinforced as u (u.id)}
            <li>
              <strong>{tp('detailing.scene.solid.member', { id: u.id })}</strong>
              {#if u.outcome}
                <em>{t(`detailing.scene.outcome.${u.outcome}`)}</em>
              {/if}
              {#if u.reason}
                <span class="why">{tp(u.reason.key, u.reason.params ?? {})}</span>
              {/if}
            </li>
          {/each}
        </ul>
      </div>
    {/if}

    {#if built.refused.length > 0}
      <p class="note" data-testid="rebar-unresolved">
        {tp('detailing.scene.unresolved', {
          n: built.refused.length,
          ids: built.refused.map((r) => r.elementId).join(', '),
        })}
        <span class="why">{t('detailing.scene.unresolvedWhy')}</span>
      </p>
    {/if}

    <div class="export">
      <button
        type="button"
        onclick={exportVisible}
        data-testid="rebar-export"
        disabled={visibleAssemblyIds.length === 0}
      >
        {t('detailing.scene.exportVisible')}
      </button>
      <span class="scope" data-testid="rebar-scope">
        {#if visibleAssemblyIds.length === 0}
          {t('detailing.scene.exportNothing')}
        {:else}
          {tp('detailing.scene.exportScope', {
            n: visibleAssemblyIds.length, ids: visibleAssemblyIds.join(', '),
          })}
        {/if}
      </span>
    </div>
  {/if}
</section>

<style>
  .rebar-scene { display: flex; flex-direction: column; gap: 0.6rem; }
  header h4 { margin: 0; font-size: 0.95rem; }
  .sub, .hint, .note, .empty {
    margin: 0; font-size: 0.78rem; color: var(--text-muted, #8b93a3);
  }
  .controls { display: flex; flex-wrap: wrap; gap: 0.75rem; }
  fieldset {
    border: 1px solid var(--border, #2a2f3a);
    border-radius: 5px;
    padding: 0.4rem 0.6rem;
    margin: 0;
    min-width: 9rem;
  }
  legend { font-size: 0.72rem; color: var(--text-muted, #8b93a3); padding: 0 0.25rem; }
  label {
    display: flex; align-items: center; gap: 0.35rem;
    font-size: 0.78rem; padding: 0.1rem 0; cursor: pointer;
  }
  label.slider { flex-direction: column; align-items: stretch; gap: 0.2rem; }
  .swatch { width: 0.7rem; height: 0.7rem; border-radius: 2px; display: inline-block; }
  .swatch.longitudinal { background: #3d7dd8; }
  .swatch.transverse { background: #e8913c; }
  .swatch.unreinforced { background: #d4762a; }
  .unreinforced {
    border-left: 3px solid #d4762a;
    padding: 0.3rem 0 0.3rem 0.55rem;
  }
  .unreinforced h5 { margin: 0 0 0.2rem; font-size: 0.8rem; }
  .unreinforced ul { margin: 0; padding-left: 1rem; font-size: 0.76rem; }
  .unreinforced li { margin-bottom: 0.15rem; }
  .unreinforced em {
    font-style: normal;
    color: #d4762a;
    margin-left: 0.3rem;
  }
  .unreinforced .why { display: block; color: var(--text-muted, #8b93a3); }
  .summary { margin: 0; font-size: 0.82rem; }
  .warn { color: #e0444a; }
  .detail dl {
    display: grid; grid-template-columns: auto 1fr;
    gap: 0.15rem 0.6rem; margin: 0.3rem 0 0; font-size: 0.78rem;
  }
  .detail dt { color: var(--text-muted, #8b93a3); }
  .detail dd { margin: 0; }
  .detail h5 { margin: 0; font-size: 0.82rem; }
  .note .why { display: block; opacity: 0.85; }
  .export { display: flex; align-items: center; gap: 0.6rem; flex-wrap: wrap; }
  .export .scope { font-size: 0.74rem; color: var(--text-muted, #8b93a3); }
</style>
