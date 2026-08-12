<script lang="ts">
  import { uiStore, modelStore, resultsStore } from '../lib/store';
  import { t } from '../lib/i18n';
  import NodesTable from './tables/NodesTable.svelte';
  import ElementsTable from './tables/ElementsTable.svelte';
  import SupportsTable from './tables/SupportsTable.svelte';
  import LoadsTable from './tables/LoadsTable.svelte';
  import MaterialsTable from './tables/MaterialsTable.svelte';
  import SectionsTable from './tables/SectionsTable.svelte';
  import CombosTable from './tables/CombosTable.svelte';

  type TabId = 'nodes' | 'elements' | 'supports' | 'loads' | 'materials' | 'sections' | 'combos';
  interface Props {
    /**
     * The open tab, BOUND — the ribbon and this table are two views of one
     * selection, so it lives above both rather than in either.
     *
     * It was a one-way `initialTab`, which made the connection asymmetric:
     * pressing Elements on the ribbon moved the table, but moving the table
     * left the ribbon lighting whatever it had lit before. Two controls
     * disagreeing about what is selected is worse than one control.
     */
    activeTab?: TabId;
  }
  let { activeTab = $bindable('nodes') }: Props = $props();

  /**
   * The tool each tab corresponds to.
   *
   * Picking a tab arms its tool, which is what closes the loop: the ribbon
   * lights editing commands by TOOL, so without this a tab change would move
   * the table and leave the ribbon dark. Materials and sections have no tool —
   * they are edited in the table itself — and the ribbon lights those by tab.
   */
  const TAB_TOOL: Partial<Record<TabId, string>> = {
    nodes: 'node', elements: 'element', supports: 'support', loads: 'load',
  };

  function pickTab(tab: TabId) {
    activeTab = tab;
    const tool = TAB_TOOL[tab];
    // Only arm an EDIT tool when one exists. Landing on Materials must not
    // leave the pointer holding whatever tool was armed before, so that case
    // falls back to selection.
    if (tool) uiStore.currentTool = tool as never;
    else if (EDIT_TOOL_IDS.includes(uiStore.currentTool)) uiStore.currentTool = 'select';
  }

  /** Tools that draw, so leaving them for a table means going back to select. */
  const EDIT_TOOL_IDS = ['node', 'element', 'support', 'load'];


  /*
   * A solve going away must not leave the panel on a tab with nothing in it.
   * The tab used to vanish, which moved the user off it as a side effect;
   * greying it means the move has to be explicit.
   */
  $effect(() => {
  });

  function handleKeydown(e: KeyboardEvent) {
    e.stopPropagation();
  }
</script>

<div class="data-table" onkeydown={handleKeydown} role="region">
  <div class="tabs">
    <button class:active={activeTab === 'nodes'} onclick={() => pickTab('nodes')}>
      {t('data.nodes')} ({modelStore.nodes.size})
    </button>
    <button class:active={activeTab === 'elements'} onclick={() => pickTab('elements')}>
      {t('data.elements')} ({modelStore.elements.size})
    </button>
    <button class:active={activeTab === 'supports'} onclick={() => pickTab('supports')}>
      {t('data.supports')} ({modelStore.supports.size})
    </button>
    <button class:active={activeTab === 'loads'} onclick={() => pickTab('loads')}>
      {t('data.loads')} ({modelStore.loads.length})
    </button>
    <button class:active={activeTab === 'materials'} onclick={() => pickTab('materials')}>
      {t('data.materials')} ({modelStore.materials.size})
    </button>
    <button class:active={activeTab === 'sections'} onclick={() => pickTab('sections')}>
      {t('data.sections')} ({modelStore.sections.size})
    </button>
    <button class:active={activeTab === 'combos'} onclick={() => pickTab('combos')}>
      {t('data.combinations')}
    </button>
    <!--
      Results are NOT a tab here.
      
      This panel is the model: geometry, conditions, properties — the things you
      build. Results are what the model produced, and they belong beside the
      controls that choose which result to look at, which live in the results
      toolbar. Having them here also let the ribbon show a construction tool and
      a diagram lit at once, claiming you were editing and reading at the same
      time.
    -->
  </div>

  <div class="table-wrapper">
    {#if activeTab === 'nodes'}
      <NodesTable />
    {:else if activeTab === 'elements'}
      <ElementsTable />
    {:else if activeTab === 'supports'}
      <SupportsTable />
    {:else if activeTab === 'loads'}
      <LoadsTable />
    {:else if activeTab === 'materials'}
      <MaterialsTable />
    {:else if activeTab === 'sections'}
      <SectionsTable />
    {:else if activeTab === 'combos'}
      <CombosTable />
    {/if}
  </div>
</div>

<style>
  .data-table {
    height: 100%;
    display: flex;
    flex-direction: column;
    font-size: 0.8rem;
  }

  .tabs {
    display: flex;
    flex-wrap: wrap;
    gap: 0;
    border-bottom: 1px solid var(--st-hair);
    background: var(--st-bg);
    flex-shrink: 0;
  }

  .tabs button {
    padding: 0.35rem 0.5rem;
    border: none;
    background: transparent;
    color: var(--st-text-3);
    cursor: pointer;
    font-size: 0.7rem;
    border-bottom: 2px solid transparent;
    white-space: nowrap;
  }

  .tabs button:hover {
    color: var(--st-text);
  }

  /*
     Accent, matching the sub-tabs inside Results and every other active control
     in the shell. Turquoise on a blue underline was two colours for one state,
     and turquoise is what this palette uses for a computed VALUE — which is
     what fills the cells directly below these tabs.
  */
  .tabs button.active {
    color: var(--st-accent);
    border-bottom-color: var(--st-accent);
  }

  .tabs button:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .tabs button:disabled:hover { color: var(--st-text-3); }

  .table-wrapper {
    flex: 1;
    overflow: auto;
  }
</style>
