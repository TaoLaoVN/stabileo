<script lang="ts">
  /**
   * Coordinated detailing workflow.
   *
   * Assembly list on the left, sheet preview and schedule on the right, review panel
   * below. Three things this UI exists to make impossible to miss:
   *
   *   1. the review state an assembly has EARNED, and what is blocking the next one;
   *   2. that a provisional calculation is provisional, before anyone signs it off;
   *   3. that software approval is not professional sign-off.
   *
   * Nothing here can set REVIEWED or ISSUED on its own — the engine refuses, and the
   * refusal reason is shown verbatim rather than being turned into a disabled button
   * with no explanation.
   */
  import { t, tp } from '../../../lib/i18n';
  import { detailingStore } from '../../../lib/store/detailing.svelte';
  import { REVIEW_STATES, reviewRank } from '../../../lib/engine/detailing/assembly';
  import { maturityLabelKey } from '../../../lib/codes/maturity';

  let engineer = $state('');
  let notes = $state('');
  let acknowledged = $state<string[]>([]);

  const selected = $derived(detailingStore.selected);
  const provisional = $derived(detailingStore.provisional);
  const allAcknowledged = $derived(provisional.every((k) => acknowledged.includes(k)));

  function toggleAck(key: string) {
    acknowledged = acknowledged.includes(key)
      ? acknowledged.filter((k) => k !== key)
      : [...acknowledged, key];
  }

  function submitReview(state: 'REVIEWED' | 'ISSUED') {
    detailingStore.review({
      engineer,
      // The store never reads the clock itself; the timestamp comes from the action.
      at: new Date().toISOString(),
      state,
      notes: notes.trim() || undefined,
      provisionalAcknowledged: provisional.length === 0 || allAcknowledged,
      acknowledgedProvisional: acknowledged,
    });
  }

  function severityLabel(s: string): string {
    return s === 'overlap' ? t('detailing.conflict.overlap') : t('detailing.conflict.clearance');
  }
</script>

<div class="detailing" data-testid="detailing-workflow">
  <aside class="assemblies" aria-label={t('detailing.assemblies')}>
    <h4>{t('detailing.assemblies')}</h4>
    {#if detailingStore.assemblies.length === 0}
      <!--
        The empty state used to read "run the detailing pipeline from the design tab",
        which described a control that did not exist. It is now the control itself, plus
        the exact prerequisites when it cannot run.
      -->
      <div class="empty" data-testid="detailing-empty">
        <p>{t('detailing.emptyTitle')}</p>
        <button class="generate" data-testid="detailing-empty-generate"
                onclick={() => detailingStore.generate()}
                disabled={!detailingStore.readiness.ready || detailingStore.generating}>
          {detailingStore.generating
            ? t('detailing.cmd.generating') : t('detailing.cmd.generate')}
        </button>
        {#if !detailingStore.readiness.ready}
          <ul class="prereqs" data-testid="detailing-empty-prereqs">
            {#each detailingStore.readiness.prerequisites as p (p.key)}
              <li>{tp(p.key, { n: p.count, ids: p.elementIds.slice(0, 6).join(', ') })}</li>
            {/each}
          </ul>
        {/if}
        {#if detailingStore.lastError}
          <p class="err" role="alert" data-testid="detailing-error">{detailingStore.lastError}</p>
        {/if}
      </div>
    {:else}
      <ul role="listbox" aria-label={t('detailing.assemblies')}>
        {#each detailingStore.assemblies as a (a.id)}
          <li>
            <button
              role="option"
              aria-selected={a.id === detailingStore.selectedId}
              class:selected={a.id === detailingStore.selectedId}
              data-testid={`assembly-${a.id}`}
              onclick={() => detailingStore.select(a.id)}
            >
              <span class="label">{a.labelKey ? tp(a.labelKey, a.labelParams ?? {}) : a.label}</span>
              <span class="state state-{a.state.toLowerCase()}">{t(`detailing.state.${a.state}`)}</span>
              {#if a.maturity !== 'VALIDATED'}
                <span class="maturity">{t(maturityLabelKey(a.maturity))}</span>
              {/if}
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  </aside>

  <section class="detail" aria-live="polite">
    {#if !selected}
      <p class="empty">{t('detailing.selectOne')}</p>
    {:else}
      <header>
        <h4>{selected.label}</h4>
        <div class="badges">
          <span class="state state-{selected.state.toLowerCase()}" data-testid="assembly-state">
            {t(`detailing.state.${selected.state}`)}
          </span>
          <span class="rev">{tp('detailing.revision', { n: selected.detailingRevision })}</span>
          {#if selected.maturity !== 'VALIDATED'}
            <span class="maturity" data-testid="assembly-maturity">
              {t(maturityLabelKey(selected.maturity))}
            </span>
          {/if}
          {#if detailingStore.superseded}
            <span class="superseded" data-testid="assembly-superseded">{t('detailing.superseded')}</span>
          {/if}
        </div>
      </header>

      <!-- Progress through the review states, with what is blocking the next one. -->
      <ol class="progress" aria-label={t('detailing.progress')}>
        {#each REVIEW_STATES.slice(1) as s (s)}
          <li
            class:done={reviewRank(selected.state) >= reviewRank(s)}
            aria-current={selected.state === s ? 'step' : undefined}
          >{t(`detailing.state.${s}`)}</li>
        {/each}
      </ol>

      {#if selected.unsupported.length > 0}
        <div class="notice warning" data-testid="unsupported-list">
          <strong>{t('detailing.unsupported')}</strong>
          <ul>
            {#each selected.unsupported as u, i (i)}
              <li>{u.message}</li>
            {/each}
          </ul>
        </div>
      {/if}

      <nav class="conflicts" aria-label={t('detailing.conflicts')}>
        {#if detailingStore.conflicts.length === 0}
          <p class="ok" data-testid="no-conflicts">{t('detailing.noConflicts')}</p>
        {:else}
          {@const c = detailingStore.currentConflict}
          <div class="conflict-nav">
            <button onclick={() => detailingStore.prevConflict()} aria-label={t('detailing.prevConflict')}>‹</button>
            <span data-testid="conflict-counter">
              {tp('detailing.conflictOf', {
                i: detailingStore.conflictIndex + 1, n: detailingStore.conflicts.length,
              })}
            </span>
            <button onclick={() => detailingStore.nextConflict()} aria-label={t('detailing.nextConflict')}>›</button>
          </div>
          {#if c}
            <p class="notice error" data-testid="conflict-detail">
              {severityLabel(c.severity)} — {c.barA} / {c.barB}:
              {(c.clearance * 1000).toFixed(0)} mm / {(c.required * 1000).toFixed(0)} mm
            </p>
          {/if}
        {/if}
      </nav>

      <div class="sheet-controls">
        <fieldset>
          <legend>{t('detailing.sheet')}</legend>
          <label>
            <input
              type="radio" name="sheetKind" value="elevation"
              checked={detailingStore.sheetKind === 'elevation'}
              onchange={() => detailingStore.setSheetKind('elevation')}
            />
            {t('detailing.sheet.elevation')}
          </label>
          <label>
            <input
              type="radio" name="sheetKind" value="section"
              checked={detailingStore.sheetKind === 'section'}
              onchange={() => detailingStore.setSheetKind('section')}
            />
            {t('detailing.sheet.section')}
          </label>
        </fieldset>
      </div>

      {#if detailingStore.sheetSvg}
        <!-- eslint-disable-next-line svelte/no-at-html-tags -- generated by sheetToSvg, all text escaped -->
        <div class="sheet" data-testid="sheet-preview">{@html detailingStore.sheetSvg}</div>
      {/if}

      {#if detailingStore.schedule}
        {@const s = detailingStore.schedule}
        <table class="schedule" data-testid="schedule">
          <caption>{t('detailing.schedule')}</caption>
          <thead>
            <tr>
              <th scope="col">{t('detailing.mark')}</th>
              <th scope="col">Ø</th>
              <th scope="col">{t('detailing.shape')}</th>
              <th scope="col">{t('detailing.qty')}</th>
              <th scope="col">{t('detailing.cutLength')}</th>
              <th scope="col">{t('detailing.mass')}</th>
            </tr>
          </thead>
          <tbody>
            {#each s.rows as r (r.mark)}
              <tr>
                <td>{r.mark}</td><td>{r.diameterMm}</td><td>{r.shape}</td>
                <td>{r.quantity}</td><td>{r.cuttingLengthM.toFixed(2)}</td>
                <td>{r.massKg.toFixed(1)}</td>
              </tr>
            {/each}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row" colspan="3">{t('detailing.total')}</th>
              <td>{s.totals.quantity}</td>
              <td>{s.totals.totalLengthM.toFixed(1)}</td>
              <td data-testid="schedule-mass">{s.totals.massKg.toFixed(1)}</td>
            </tr>
          </tfoot>
        </table>
      {/if}

      <section class="review" aria-labelledby="review-title">
        <h5 id="review-title">{t('detailing.review')}</h5>
        <p class="disclaimer">{t('detailing.notLegalSignoff')}</p>

        {#if selected.review}
          <p class="reviewed" data-testid="review-record">
            {tp('detailing.reviewedBy', {
              engineer: selected.review.engineer,
              at: selected.review.at,
              revision: selected.review.revision,
            })}
          </p>
        {/if}

        {#if provisional.length > 0}
          <div class="notice warning" data-testid="provisional-ack">
            <strong>{t('detailing.provisionalPresent')}</strong>
            {#each provisional as key (key)}
              <label class="ack">
                <input
                  type="checkbox"
                  data-testid={`ack-${key}`}
                  checked={acknowledged.includes(key)}
                  onchange={() => toggleAck(key)}
                />
                {tp('detailing.acknowledge', { key })}
              </label>
            {/each}
          </div>
        {/if}

        <label class="field">
          {t('detailing.engineer')}
          <input type="text" data-testid="review-engineer" bind:value={engineer} />
        </label>
        <label class="field">
          {t('detailing.notes')}
          <textarea data-testid="review-notes" bind:value={notes} rows="2"></textarea>
        </label>

        <div class="actions">
          <button data-testid="review-submit" onclick={() => submitReview('REVIEWED')}>
            {t('detailing.recordReview')}
          </button>
          <button
            data-testid="issue-submit"
            disabled={reviewRank(selected.state) < reviewRank('REVIEWED')}
            onclick={() => submitReview('ISSUED')}
          >
            {t('detailing.issue')}
          </button>
        </div>

        {#if detailingStore.lastError}
          <p class="notice error" role="alert" data-testid="review-error">{detailingStore.lastError}</p>
        {/if}
      </section>
    {/if}
  </section>
</div>

<style>
  .detailing { display: grid; grid-template-columns: minmax(12rem, 18rem) 1fr; gap: 1rem; padding: 0.75rem; font-size: 0.85rem; height: 100%; overflow: auto; }
  h4 { margin: 0 0 0.4rem; font-size: 0.9rem; }
  h5 { margin: 0 0 0.3rem; font-size: 0.85rem; }
  .empty { opacity: 0.7; }
  ul { list-style: none; margin: 0; padding: 0; }
  .assemblies button { width: 100%; text-align: left; padding: 0.4rem 0.5rem; display: flex; flex-wrap: wrap; gap: 0.35rem; align-items: center; background: none; border: 1px solid transparent; border-radius: 4px; color: inherit; cursor: pointer; }
  .assemblies button.selected { border-color: currentColor; background: rgba(128,128,128,0.14); }
  .assemblies button:focus-visible { outline: 2px solid currentColor; outline-offset: 1px; }
  .label { flex: 1; }
  header { display: flex; flex-wrap: wrap; gap: 0.5rem; align-items: baseline; }
  .badges { display: flex; gap: 0.35rem; flex-wrap: wrap; }
  .state, .maturity, .rev, .superseded { font-size: 0.7rem; font-weight: 600; padding: 0.1rem 0.4rem; border-radius: 3px; }
  .state { background: rgba(128,128,128,0.25); }
  .state-constructible, .state-reviewed, .state-issued { background: #14532d; color: #dcfce7; }
  /* Provisional, stale and superseded are never green. */
  .maturity { background: #7a5b00; color: #fff6dd; }
  .superseded { background: #7a1f1f; color: #ffe3e3; }
  .progress { list-style: none; display: flex; flex-wrap: wrap; gap: 0.3rem; margin: 0.5rem 0; padding: 0; }
  .progress li { font-size: 0.7rem; padding: 0.15rem 0.45rem; border-radius: 3px; background: rgba(128,128,128,0.18); opacity: 0.6; }
  .progress li.done { opacity: 1; background: rgba(20,83,45,0.5); }
  .progress li[aria-current='step'] { outline: 1px solid currentColor; }
  .notice { margin: 0.4rem 0; padding: 0.4rem 0.55rem; border-radius: 4px; line-height: 1.35; }
  .notice.warning { background: #7a5b00; color: #fff6dd; }
  .notice.error { background: #7a1f1f; color: #ffe3e3; }
  .ok { color: #6ee7b7; }
  .conflict-nav { display: flex; align-items: center; gap: 0.5rem; }
  .conflict-nav button { min-width: 1.8rem; }
  fieldset { border: 1px solid rgba(128,128,128,0.35); border-radius: 4px; padding: 0.3rem 0.5rem; }
  legend { font-size: 0.75rem; padding: 0 0.3rem; }
  .sheet { margin: 0.5rem 0; overflow-x: auto; background: #fff; border-radius: 4px; }
  .sheet :global(svg) { max-width: 100%; height: auto; }
  table.schedule { width: 100%; border-collapse: collapse; margin: 0.5rem 0; }
  caption { text-align: left; font-weight: 600; padding-bottom: 0.25rem; }
  th, td { border: 1px solid rgba(128,128,128,0.3); padding: 0.2rem 0.4rem; text-align: right; }
  th[scope='col'], td:first-child, td:nth-child(3) { text-align: left; }
  .review { margin-top: 0.75rem; border-top: 1px solid rgba(128,128,128,0.3); padding-top: 0.6rem; }
  .disclaimer { font-size: 0.75rem; opacity: 0.8; margin: 0 0 0.4rem; }
  .field { display: block; margin: 0.35rem 0; }
  .field input, .field textarea { display: block; width: 100%; max-width: 28rem; padding: 0.25rem 0.4rem; }
  .ack { display: block; margin: 0.2rem 0; }
  .actions { display: flex; gap: 0.5rem; margin-top: 0.5rem; }
  @media (max-width: 800px) { .detailing { grid-template-columns: 1fr; } }
</style>
