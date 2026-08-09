<script lang="ts">
  /**
   * The model's status, as a thing you can act on.
   *
   * ── Why counts alone are not enough ────────────────────────────────
   *
   * "117 unsupported" tells a reviewer there is a problem and nothing about where. The number
   * has to be a way IN: click the state, get the members in it, click a member, the camera
   * goes there. Everything below exists to make that path two clicks long.
   *
   * ── Nothing here can hide a bad state ──────────────────────────────
   *
   * Every state present in the model has a row, always, including the ones with zero members
   * — no, especially not: a state with no members has no row, because a zero row is noise.
   * But a state WITH members can never be collapsed away or folded into a catch-all. FAILED,
   * UNSUPPORTED, REFUSED, DESIGNED_NOT_MODELLED and NOT_EVALUATED each keep their own row and
   * their own count, because each has a different remedy.
   */
  import { t, tp } from '../../../lib/i18n';
  import { rebarWorkspace } from '../../../lib/store/rebar-workspace.svelte';
  import {
    ELEMENT_STATUS_ORDER, type ElementStatus, type ElementStatusReport,
  } from '../../../lib/engine/detailing/element-status';

  interface Props {
    report: ElementStatusReport;
    /**
     * Why each member is in the state it is, keyed by member.
     *
     * The state NAME is not an explanation. "UNSUPPORTED" on 117 beams told a reviewer that
     * something was wrong and nothing about what, when the design had already produced a
     * sentence naming the axis and the ratio behind it. Passed in rather than read here so
     * this component stays free of stores.
     */
    reasons?: ReadonlyMap<number, string>;
  }
  const { report, reasons }: Props = $props();

  const filtered = $derived.by(() => {
    const f = rebarWorkspace.statusFilter;
    return f.length === 0
      ? report.entries
      : report.entries.filter((e) => f.includes(e.status));
  });

  const selectedIds = $derived(new Set(rebarWorkspace.selection?.elementIds ?? []));

  function rowClass(s: ElementStatus): string {
    return `st-${s.toLowerCase().replace(/_/g, '-')}`;
  }
</script>

<section class="status" data-testid="rebar-status-panel">
  <h4>{t('detailing.scene.status.title')}</h4>
  <p class="hint">{t('detailing.scene.statusFilterHint')}</p>

  <ul class="counts" data-testid="rebar-status-counts">
    {#each ELEMENT_STATUS_ORDER as s (s)}
      {#if report.counts[s] > 0}
        <li>
          <button
            type="button"
            class="count-row {rowClass(s)}"
            class:active={rebarWorkspace.statusFilter.includes(s)}
            data-testid={`rebar-status-${s}`}
            aria-pressed={rebarWorkspace.statusFilter.includes(s)}
            onclick={() => rebarWorkspace.toggleStatus(s)}
          >
            <span class="dot"></span>
            <span class="label">{t(`detailing.scene.status.${s}`)}</span>
            <span class="n">{report.counts[s]}</span>
          </button>
        </li>
      {/if}
    {/each}
  </ul>

  {#if rebarWorkspace.statusFilter.length > 0}
    <button type="button" class="link" onclick={() => rebarWorkspace.clearStatusFilter()}>
      {t('detailing.scene.clearIsolation')}
    </button>
  {/if}

  <h5>{t('detailing.scene.elements')} ({filtered.length})</h5>
  {#if filtered.length === 0}
    <p class="hint">{t('detailing.scene.noneOfState')}</p>
  {:else}
    <ul class="elements" data-testid="rebar-element-list">
      {#each filtered as e (e.elementId)}
        <li>
          <button
            type="button"
            class="element {rowClass(e.status)}"
            class:selected={selectedIds.has(e.elementId)}
            data-testid={`rebar-element-${e.elementId}`}
            onclick={() => rebarWorkspace.selectAndFocus(e.elementId)}
          >
            <span class="dot"></span>
            <span class="id">{tp('detailing.scene.solid.member', { id: e.elementId })}</span>
            <span class="st">{t(`detailing.scene.status.${e.status}`)}</span>
          </button>
          {#if reasons?.get(e.elementId) && selectedIds.has(e.elementId)}
            <p class="reason">{reasons.get(e.elementId)}</p>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</section>

<style>
  .status { display: flex; flex-direction: column; gap: 0.45rem; min-height: 0; }
  h4, h5 { margin: 0; font-size: 0.82rem; }
  .hint { margin: 0; font-size: 0.72rem; color: var(--text-muted, #8b93a3); }
  ul { list-style: none; margin: 0; padding: 0; }
  .counts { display: flex; flex-direction: column; gap: 0.15rem; }
  .count-row, .element {
    display: flex; align-items: center; gap: 0.4rem; width: 100%;
    background: transparent; border: 1px solid transparent; border-radius: 4px;
    padding: 0.22rem 0.4rem; cursor: pointer; text-align: left;
    color: inherit; font-size: 0.76rem;
  }
  .count-row:hover, .element:hover { background: rgba(255, 255, 255, 0.06); }
  .count-row.active { border-color: currentColor; }
  .element.selected { background: rgba(255, 212, 0, 0.16); border-color: #ffd400; }
  .label, .id { flex: 1 1 auto; }
  .n, .st { font-variant-numeric: tabular-nums; opacity: 0.85; }
  .dot { width: 0.55rem; height: 0.55rem; border-radius: 50%; flex: 0 0 auto; }
  /* One colour per state, and never two states sharing one. */
  .st-failed .dot { background: #e0444a; }
  .st-unsupported .dot { background: #b06ad6; }
  .st-refused .dot { background: #d4762a; }
  .st-designed-not-modelled .dot { background: #d9c04a; }
  .st-not-evaluated .dot { background: #8b93a3; }
  .st-modelled .dot { background: #4caf72; }
  /**
   * The member list does NOT scroll on its own.
   *
   * It used to, inside a rail that also scrolls. Two nested scrollers meant the browser could
   * bring a row into view within the inner list while the list itself sat below the rail's
   * visible area — the row was "visible, enabled and stable" and still unreachable, which is
   * what happened the moment the tally and the piece breakdown grew the rail above it.
   *
   * One scroller, the rail's, and every row is reachable by scrolling the thing the user is
   * already scrolling.
   */
  .elements { flex: 0 0 auto; }
  .reason {
    margin: 0 0 0.25rem 1.4rem; font-size: 0.7rem;
    color: var(--text-muted, #8b93a3);
  }
  .link {
    background: none; border: none; padding: 0; color: #6fa8ff;
    font-size: 0.74rem; cursor: pointer; text-align: left;
  }
</style>
