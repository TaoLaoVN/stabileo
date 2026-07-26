<script lang="ts">
  /**
   * RC Design Workflow — single entry point for RC design.
   *
   * Verification now appears inline within each expanded element row in the
   * Design tab. The separate RC Verification subtab has been removed.
   *
   * Verification state lives in verificationStore (single source of truth).
   * This component is a thin layout wrapper — no props needed.
   *
   * The regulation settings sit above the design table, collapsed by default, because
   * they are project facts that decide which rules the table below was produced under.
   * They are one disclosure away rather than in a dialog, so a reviewer can always see
   * which edition and which aggregate size a result belongs to.
   */
  import ProDesignTab from './ProDesignTab.svelte';
  import CodeSettingsPanel from './design/CodeSettingsPanel.svelte';
  import { t } from '../../lib/i18n/store.svelte';
  import { modelStore } from '../../lib/store/model.svelte';

  /** An unstated aggregate size is an assumption the reviewer has to see. */
  const needsAttention = $derived(
    modelStore.model.codeSettings?.concrete.maxAggregateSizeMm === null ||
    modelStore.model.codeSettings?.jurisdiction.basis === 'unstated',
  );
</script>

<div class="rc-workflow">
  <details class="code-settings-disclosure" data-testid="code-settings-disclosure">
    <summary>
      {t('codes.title')}
      {#if needsAttention}
        <span class="attention" data-testid="code-settings-attention" aria-label={t('codes.provenance.assumed')}>
          {t('codes.provenance.assumed')}
        </span>
      {/if}
    </summary>
    <CodeSettingsPanel />
  </details>
  <ProDesignTab />
</div>

<style>
  .rc-workflow { display: flex; flex-direction: column; height: 100%; overflow: hidden; }
  .rc-workflow > :global(*:last-child) { flex: 1; overflow: hidden; }
  .code-settings-disclosure { flex: 0 0 auto; border-bottom: 1px solid rgba(128, 128, 128, 0.3); }
  .code-settings-disclosure[open] { max-height: 55vh; overflow: auto; }
  summary {
    cursor: pointer;
    padding: 0.45rem 1rem;
    font-size: 0.85rem;
    font-weight: 500;
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  summary:focus-visible { outline: 2px solid currentColor; outline-offset: -2px; }
  /* Assumed state is never green. */
  .attention {
    font-size: 0.72rem;
    font-weight: 600;
    padding: 0.1rem 0.4rem;
    border-radius: 3px;
    background: #7a5b00;
    color: #fff6dd;
  }
</style>
