<script lang="ts">
  import { t } from '../../lib/i18n';
  import { uiStore } from '../../lib/store/ui.svelte';
  import ToolSelectOptions from '../floating-tools/ToolSelectOptions.svelte';
  import ToolNodeOptions from '../floating-tools/ToolNodeOptions.svelte';
  import ToolElementOptions from '../floating-tools/ToolElementOptions.svelte';
  import ToolSupportOptions from '../floating-tools/ToolSupportOptions.svelte';
  import ToolLoadOptions from '../floating-tools/ToolLoadOptions.svelte';
  import SelectedEntityPanel from '../floating-tools/SelectedEntityPanel.svelte';
  import ToolbarResults from '../toolbar/ToolbarResults.svelte';
  import ToolbarAdvanced from '../toolbar/ToolbarAdvanced.svelte';
  import ToolbarExamples from '../toolbar/ToolbarExamples.svelte';
  import ToolbarConfig from '../toolbar/ToolbarConfig.svelte';
  import ToolbarProject from '../toolbar/ToolbarProject.svelte';

  /**
   * The right-hand panel: exactly one thing, chosen by what the user did.
   *
   * The first cut of this opened the whole legacy Toolbar on the right — solve,
   * results, advanced, examples, settings and project stacked together — which
   * moved the old left panel across the window without making it any easier to
   * use. Pressing "Examples" should show examples.
   *
   * There are two sources for what belongs here, and they are different in kind:
   *
   *   a COMMAND panel is what the ribbon button named — examples, settings,
   *   project, advanced, results, solve. The user asked for it by name.
   *
   *   a TOOL panel is the options of the armed tool — the node placement mode,
   *   the support type, the load direction. The user did not ask for a panel at
   *   all; they picked a tool that happens to need parameters, so the panel is
   *   a consequence and it follows the tool as it changes.
   *
   * `TOOLS_WITH_OPTIONS` is what "in case it is needed" means concretely: pan
   * is not in it, so arming pan closes the panel rather than opening an empty
   * one.
   */

  type Props = { panel: string; onClose: () => void };
  let { panel, onClose }: Props = $props();

  export const TOOLS_WITH_OPTIONS = ['select', 'node', 'element', 'support', 'load'] as const;

  /** Heading for the panel, so it always says what it is showing. */
  const title = $derived.by(() => {
    if (panel !== 'tool') return t(`ribbon.${panel}`);
    switch (uiStore.currentTool) {
      case 'select': return t('float.select');
      case 'node': return t('float.node');
      case 'element': return t('float.element');
      case 'support': return t('float.support');
      case 'load': return t('float.load');
      default: return t('ribbon.tool');
    }
  });
</script>

<aside class="basic-panel" data-testid="basic-panel" data-panel={panel}>
  <header class="bp-head">
    <span class="bp-title" data-testid="bp-title">{title}</span>
    <button class="bp-close" onclick={onClose} title={t('ribbon.close')} aria-label={t('ribbon.close')}>×</button>
  </header>

  <div class="bp-body">
    {#if panel === 'tool'}
      <!--
        Follows the armed tool. Rendering the options of a tool that is not
        armed would show controls that change nothing.
      -->
      {#if uiStore.currentTool === 'select'}
        <ToolSelectOptions />
        <SelectedEntityPanel />
      {:else if uiStore.currentTool === 'node'}
        <ToolNodeOptions />
      {:else if uiStore.currentTool === 'element'}
        <ToolElementOptions />
      {:else if uiStore.currentTool === 'support'}
        <ToolSupportOptions />
      {:else if uiStore.currentTool === 'load'}
        <ToolLoadOptions />
      {/if}
    {:else if panel === 'results'}
      <ToolbarResults />
    {:else if panel === 'advanced'}
      <ToolbarAdvanced />
    {:else if panel === 'examples'}
      <ToolbarExamples />
    {:else if panel === 'settings'}
      <ToolbarConfig />
    {:else if panel === 'project'}
      <ToolbarProject />
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
