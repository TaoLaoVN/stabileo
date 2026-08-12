<script lang="ts">
  import { modelStore, resultsStore } from '../lib/store';
  import { t } from '../lib/i18n';
  import NodesTable from './tables/NodesTable.svelte';
  import ElementsTable from './tables/ElementsTable.svelte';
  import SupportsTable from './tables/SupportsTable.svelte';
  import LoadsTable from './tables/LoadsTable.svelte';
  import MaterialsTable from './tables/MaterialsTable.svelte';
  import SectionsTable from './tables/SectionsTable.svelte';
  import CombosTable from './tables/CombosTable.svelte';
  import ResultsTable from './tables/ResultsTable.svelte';

  type TabId = 'nodes' | 'elements' | 'supports' | 'loads' | 'materials' | 'sections' | 'combos' | 'results';
  interface Props {
    /**
     * Which tab to open on. The ribbon's Properties group points straight at
     * Materials or Sections, so landing on Nodes and making the user find them
     * would defeat the command.
     */
    initialTab?: TabId;
  }
  let { initialTab }: Props = $props();

  let activeTab = $state<TabId>(initialTab ?? 'nodes');

  // A second press of the same ribbon command should return here, so the tab
  // follows the request rather than only the first one.
  $effect(() => { if (initialTab) activeTab = initialTab; });

  const solved = $derived(resultsStore.results != null || resultsStore.results3D != null);

  /*
   * A solve going away must not leave the panel on a tab with nothing in it.
   * The tab used to vanish, which moved the user off it as a side effect;
   * greying it means the move has to be explicit.
   */
  $effect(() => {
    if (!solved && activeTab === 'results') activeTab = 'nodes';
  });

  function handleKeydown(e: KeyboardEvent) {
    e.stopPropagation();
  }
</script>

<div class="data-table" onkeydown={handleKeydown} role="region">
  <div class="tabs">
    <button class:active={activeTab === 'nodes'} onclick={() => activeTab = 'nodes'}>
      {t('data.nodes')} ({modelStore.nodes.size})
    </button>
    <button class:active={activeTab === 'elements'} onclick={() => activeTab = 'elements'}>
      {t('data.elements')} ({modelStore.elements.size})
    </button>
    <button class:active={activeTab === 'supports'} onclick={() => activeTab = 'supports'}>
      {t('data.supports')} ({modelStore.supports.size})
    </button>
    <button class:active={activeTab === 'loads'} onclick={() => activeTab = 'loads'}>
      {t('data.loads')} ({modelStore.loads.length})
    </button>
    <button class:active={activeTab === 'materials'} onclick={() => activeTab = 'materials'}>
      {t('data.materials')} ({modelStore.materials.size})
    </button>
    <button class:active={activeTab === 'sections'} onclick={() => activeTab = 'sections'}>
      {t('data.sections')} ({modelStore.sections.size})
    </button>
    <button class:active={activeTab === 'combos'} onclick={() => activeTab = 'combos'}>
      {t('data.combinations')}
    </button>
    <!--
      Always present, greyed until there is something in it — the same rule the
      ribbon's Results group follows. Appearing only after a solve made the tab
      strip change length under the cursor and gave a new user no clue that the
      panel had a results view at all.
    -->
    <button
      class:active={activeTab === 'results'}
      disabled={!solved}
      title={solved ? undefined : t('ribbon.needsSolve')}
      onclick={() => activeTab = 'results'}
    >
      {t('data.results')}
    </button>
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
    {:else if activeTab === 'results' && solved}
      <ResultsTable />
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
