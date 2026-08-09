<script lang="ts">
  import { t } from '../../lib/i18n';
  import ToolbarResults from '../toolbar/ToolbarResults.svelte';
  import ToolbarAdvanced from '../toolbar/ToolbarAdvanced.svelte';
  import ToolbarExamples from '../toolbar/ToolbarExamples.svelte';
  import ToolbarConfig from '../toolbar/ToolbarConfig.svelte';
  import ToolbarProject from '../toolbar/ToolbarProject.svelte';
  import DataTable from '../DataTable.svelte';
  import StepWizard from '../dsm/StepWizard.svelte';
  import { dsmStepsStore } from '../../lib/store/dsmSteps.svelte';

  /**
   * The right-hand panel: one thing, named by the command that opened it.
   *
   * It holds only what genuinely needs area and outlives a single tool —
   * results, advanced analysis, examples, project, settings. Tool options do
   * NOT come here: they were tried here and fought the panel, because they are
   * written as horizontal strips and because putting a tool's settings at the
   * far right disconnects them from the button at the top that summoned them.
   * They live in the contextual bar under the ribbon instead.
   */

  type Props = { panel: string; onClose: () => void };
  let { panel, onClose }: Props = $props();

  /** Heading, so the panel always says what it is showing. */
  const title = $derived(t(`ribbon.${panel}`));
</script>

<aside class="basic-panel" data-testid="basic-panel" data-panel={panel}>
  <header class="bp-head">
    <span class="bp-title" data-testid="bp-title">{title}</span>
    <button class="bp-close" onclick={onClose} title={t('ribbon.close')} aria-label={t('ribbon.close')}>×</button>
  </header>

  <div class="bp-body">
    {#if panel === 'results'}
      <ToolbarResults hideDiagrams />
    {:else if panel === 'advanced'}
      <ToolbarAdvanced />
    {:else if panel === 'examples'}
      <ToolbarExamples />
    {:else if panel === 'settings'}
      <ToolbarConfig />
    {:else if panel === 'project'}
      <ToolbarProject />
    {:else if panel === 'data'}
      <!--
        Model data and the step-by-step wizard used to live in a SECOND right
        sidebar with its own toggle, so opening one while the other was up gave
        two stacked panels on the same edge. One panel, one edge.
      -->
      {#if dsmStepsStore.isOpen}
        <StepWizard />
      {:else}
        <DataTable />
      {/if}
    {/if}
  </div>
</aside>

<style>
  .basic-panel {
    width: 300px;
    flex: none;
    display: flex;
    flex-direction: column;
    background: var(--st-surface);
    border-left: 1px solid var(--st-hair);
    font-family: var(--st-sans);
  }

  .bp-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.55rem 0.75rem;
    border-bottom: 1px solid var(--st-hair);
    flex: none;
  }

  .bp-title {
    font-family: var(--st-mono);
    font-size: 0.68rem;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--st-text-2);
  }

  .bp-close {
    background: none;
    border: none;
    color: var(--st-text-2);
    font-size: 1.2rem;
    line-height: 1;
    padding: 0.1rem 0.4rem;
    cursor: pointer;
    border-radius: var(--st-radius);
  }

  .bp-close:hover { background: var(--st-surface-3); color: var(--st-text); }

  .bp-body {
    flex: 1;
    overflow-y: auto;
    padding: 0.65rem;
  }
</style>
