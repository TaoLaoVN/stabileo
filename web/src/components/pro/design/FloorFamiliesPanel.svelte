<script lang="ts">
  /**
   * Slabs, walls and foundations — the commands, and what they could not do.
   *
   * `detailingStore.generateFloors()` existed with no control that reached it, so the slab,
   * wall and footing engines were production-wired and still unreachable by a user. This is
   * that control, plus the per-family view of what came out.
   *
   * Three rules this panel follows:
   *
   *   1. no second regulation selector. The edition comes from Project Regulations, one
   *      disclosure above, and is only DISPLAYED here.
   *   2. no text describing a command that does not exist. Every button below runs.
   *   3. a disabled command explains itself. `floorReadiness` returns structured reasons
   *      and they are rendered, rather than leaving a grey button with no cause.
   *
   * Unsupported conditions are listed verbatim from the two runs, not summarised into a
   * count: "12 conditions" tells a reviewer nothing, and the whole point of an unsupported
   * outcome is that it can be read.
   */
  import { t, tp } from '../../../lib/i18n';
  import { detailingStore } from '../../../lib/store/detailing.svelte';
  import { modelStore } from '../../../lib/store/model.svelte';
  import { regulationsStore } from '../../../lib/store/regulations.svelte';
  import FoundationsPanel from './FoundationsPanel.svelte';

  type Family = 'slabs' | 'walls' | 'foundations';
  let family = $state<Family>('slabs');

  const readiness = $derived(detailingStore.floorReadiness);
  const floorRun = $derived(detailingStore.lastFloorRun);
  const footingRun = $derived(detailingStore.lastFootingRun);
  const footingCount = $derived(modelStore.model.footings.size);

  /** The concrete code the run will use, or why there is none. Read-only here. */
  const concreteCode = $derived(regulationsStore.concreteDesignCode());
  const concreteProblem = $derived(regulationsStore.concreteDesignProblem());

  const slabCount = $derived(floorRun?.slabs.length ?? 0);
  const wallCount = $derived(floorRun?.walls.length ?? 0);
  const checkedFootings = $derived(
    (footingRun?.outcomes ?? []).filter((o) => o.check !== null).length,
  );

  /** Every assumption the last footing run recorded, de-duplicated for display. */
  const footingAssumptions = $derived(
    [...new Map(
      (footingRun?.outcomes ?? [])
        .flatMap((o) => o.assumptions)
        .map((m) => [`${m.key}:${JSON.stringify(m.params ?? {})}`, m]),
    ).values()],
  );
</script>

<div class="floor-families" data-testid="floor-families">
  <header class="commands">
    <!--
      One command, because design and detailing for these families are one production pass:
      `generateFloors()` designs the shells, checks the footings, generates the physical bars
      and coordinates the level assembly. Splitting the button would imply three separately
      reachable stages that do not exist.
    -->
    <button class="primary" data-testid="floor-design-run"
            onclick={() => detailingStore.generateFloors()}
            disabled={!readiness.ready || detailingStore.generating}>
      {detailingStore.generating
        ? t('detailing.floorRun.running')
        : t('detailing.floorRun.designAndDetail')}
    </button>
    <span class="code" data-testid="floor-design-code">
      {#if concreteCode}
        {tp('detailing.floorRun.underCode', { code: concreteCode })}
      {:else if concreteProblem}
        <!-- Not a selector: the reason, and where to fix it. -->
        <span class="warn">{tp(concreteProblem.key, concreteProblem.params ?? {})}</span>
      {/if}
    </span>
  </header>

  {#if !readiness.ready}
    <ul class="prereqs" data-testid="floor-design-prereqs">
      {#each readiness.reasons as r (r.key)}
        <li>{tp(r.key, r.params ?? {})}</li>
      {/each}
    </ul>
  {/if}

  {#if detailingStore.lastError}
    <p class="err" role="alert" data-testid="floor-design-error">{detailingStore.lastError}</p>
  {/if}

  <nav class="families" aria-label={t('detailing.floorRun.families')}>
    {#each [
      { key: 'slabs' as Family, label: t('detailing.floorRun.slabs'), n: slabCount },
      { key: 'walls' as Family, label: t('detailing.floorRun.walls'), n: wallCount },
      { key: 'foundations' as Family, label: t('detailing.floorRun.foundations'), n: footingCount },
    ] as f (f.key)}
      <button role="tab" aria-selected={family === f.key} class:active={family === f.key}
              data-testid={`floor-family-${f.key}`} onclick={() => (family = f.key)}>
        {f.label}<span class="n">{f.n}</span>
      </button>
    {/each}
  </nav>

  {#if family === 'slabs'}
    {@const slabs = floorRun?.slabs ?? []}
    {#if slabs.length === 0}
      <p class="empty" data-testid="floor-slabs-empty">{t('detailing.floorRun.slabsEmpty')}</p>
    {:else}
      <!--
        The columns are the quantities the slab engine actually produces. One-way shear
        utilisation is shown because it is the check that governs thickness; the bar layers
        are the physical result, and the count is what reaches the schedule.
      -->
      <table data-testid="floor-slabs-table">
        <thead>
          <tr>
            <th>{t('detailing.floorRun.element')}</th>
            <th>{t('detailing.floorRun.behaviour')}</th>
            <th>{t('detailing.floorRun.layers')}</th>
            <th>{t('detailing.floorRun.shearUtil')}</th>
            <th>{t('detailing.floorRun.unsupported')}</th>
          </tr>
        </thead>
        <tbody>
          {#each slabs as s (s.panelId)}
            <tr>
              <td>{s.panelId}</td>
              <td>{t(`detailing.floorRun.behaviour.${s.behaviour}`)}</td>
              <td class="num">{s.layers.length}</td>
              <td class="num" class:over={s.shear.utilization > 1}>
                {Number.isFinite(s.shear.utilization) ? s.shear.utilization.toFixed(2) : '∞'}
              </td>
              <td class="num">{s.unsupported.length || '—'}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}
  {:else if family === 'walls'}
    {@const walls = floorRun?.walls ?? []}
    {#if walls.length === 0}
      <p class="empty" data-testid="floor-walls-empty">{t('detailing.floorRun.wallsEmpty')}</p>
    {:else}
      <table data-testid="floor-walls-table">
        <thead>
          <tr>
            <th>{t('detailing.floorRun.element')}</th>
            <th>{t('detailing.floorRun.axialFlexUtil')}</th>
            <th>{t('detailing.floorRun.shearUtil')}</th>
            <th>{t('detailing.floorRun.thickness')}</th>
            <th>{t('detailing.floorRun.unsupported')}</th>
          </tr>
        </thead>
        <tbody>
          {#each walls as w (w.wallId)}
            <tr>
              <td>{w.wallId}</td>
              <td class="num" class:over={w.axialFlexure.utilization > 1}>
                {Number.isFinite(w.axialFlexure.utilization)
                  ? w.axialFlexure.utilization.toFixed(2) : '∞'}
              </td>
              <td class="num" class:over={w.shear.utilization > 1}>
                {Number.isFinite(w.shear.utilization) ? w.shear.utilization.toFixed(2) : '∞'}
                {#if w.shear.atLimit}
                  <!-- Above the §11.5.4.6 ceiling the wall fails by web crushing and more
                       steel does not help. That is a different answer from "add steel". -->
                  <span class="ceiling" title={t('detailing.floorRun.webCrushingHelp')}>
                    {t('detailing.floorRun.webCrushing')}
                  </span>
                {/if}
              </td>
              <td>{w.thicknessOk ? '✓' : t('detailing.floorRun.thicknessThin')}</td>
              <td class="num">{w.unsupported.length || '—'}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}
  {:else}
    <!--
      Geometry belongs to the footing and the ground belongs to the project, so the editor
      for both is embedded here rather than duplicated: this view SUMMARISES the run and
      links to the one editor, it does not keep a second copy of the inputs.
    -->
    <div class="foundation-summary" data-testid="floor-foundations-summary">
      {#if footingRun}
        <p>{tp('detailing.floorRun.footingsChecked', {
          checked: checkedFootings, total: footingRun.outcomes.length,
        })}</p>
        {#if detailingStore.footingsNotVerified.length > 0}
          <ul class="issues" data-testid="floor-footings-not-verified">
            {#each detailingStore.footingsNotVerified as nv (nv.name)}
              <li class="blocking">
                <strong>{nv.name}</strong>
                <ul>
                  {#each nv.reasons as r (r.key)}
                    <li>{tp(r.key, r.params ?? {})}</li>
                  {/each}
                </ul>
              </li>
            {/each}
          </ul>
        {/if}
        {#if footingAssumptions.length > 0}
          <!-- An assumption is not a problem. Listing it with the problems would train the
               reader to dismiss it, so it gets its own section and its own colour. -->
          <details data-testid="floor-footing-assumptions">
            <summary>{tp('detailing.floorRun.assumptions', { n: footingAssumptions.length })}</summary>
            <ul class="assumptions">
              {#each footingAssumptions as a (a.key + JSON.stringify(a.params ?? {}))}
                <li>{tp(a.key, a.params ?? {})}</li>
              {/each}
            </ul>
          </details>
        {/if}
      {/if}
    </div>
    <FoundationsPanel />
  {/if}

  {#if (floorRun?.unsupported.length ?? 0) > 0}
    <details class="unsupported" data-testid="floor-unsupported">
      <summary>{tp('detailing.floorRun.unsupportedCount', {
        n: floorRun!.unsupported.length,
      })}</summary>
      <ul>
        {#each floorRun!.unsupported as u (u.elementId + u.message.key)}
          <li>{tp(u.message.key, u.message.params ?? {})}</li>
        {/each}
      </ul>
    </details>
  {/if}
</div>

<style>
  .floor-families { display: flex; flex-direction: column; gap: 0.6rem; padding: 0.75rem 1rem; font-size: 0.82rem; }
  .commands { display: flex; align-items: center; gap: 0.6rem; flex-wrap: wrap; }
  button { font: inherit; cursor: pointer; }
  button:disabled { cursor: not-allowed; opacity: 0.6; }
  .primary { font-weight: 600; padding: 0.3rem 0.7rem; }
  .code { font-size: 0.75rem; opacity: 0.9; }
  /* An unresolved code is never green. */
  .warn { padding: 0.1rem 0.35rem; border-radius: 3px; background: #7a5b00; color: #fff6dd; }
  .families { display: flex; gap: 0.3rem; border-bottom: 1px solid rgba(128,128,128,0.3); }
  .families button {
    background: none; border: none; border-bottom: 2px solid transparent; color: inherit;
    padding: 0.3rem 0.6rem; display: flex; align-items: center; gap: 0.35rem;
  }
  .families button.active { border-bottom-color: currentColor; font-weight: 600; }
  .n { font-size: 0.7rem; font-weight: 600; padding: 0.05rem 0.3rem; border-radius: 3px; background: rgba(128,128,128,0.3); }
  .empty { opacity: 0.75; font-style: italic; }
  table { border-collapse: collapse; width: 100%; font-size: 0.78rem; }
  th, td { text-align: left; padding: 0.2rem 0.4rem; border-bottom: 1px solid rgba(128,128,128,0.2); }
  .num { text-align: right; font-variant-numeric: tabular-nums; }
  /* Over-utilised is never green. */
  .num.over { color: #ffb4b4; font-weight: 600; }
  .ceiling {
    margin-left: 0.3rem; font-size: 0.68rem; font-weight: 600; padding: 0.05rem 0.3rem;
    border-radius: 3px; background: #5c1a1a; color: #ffe4e4;
  }
  ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.15rem; }
  .prereqs li, .unsupported li, .assumptions li { font-size: 0.75rem; opacity: 0.9; }
  .issues > li { font-size: 0.75rem; padding: 0.2rem 0.4rem; border-radius: 3px; }
  .issues > li.blocking { background: #5c1a1a; color: #ffe4e4; }
  .issues ul { margin-left: 0.6rem; }
  .assumptions li { background: #7a5b00; color: #fff6dd; padding: 0.15rem 0.4rem; border-radius: 3px; }
  .err { color: #ffb4b4; }
  summary { cursor: pointer; font-size: 0.78rem; }
</style>
