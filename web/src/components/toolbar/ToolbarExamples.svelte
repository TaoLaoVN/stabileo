<script lang="ts">
  import { uiStore, modelStore, resultsStore } from '../../lib/store';
  import { t } from '../../lib/i18n';

  let showExamples = $state(false);
  let showExamples3D = $state(false);

  const examples = [
    // Vigas simples
    { id: 'simply-supported', nameKey: 'ex.simply-supported', descKey: 'ex.simply-supported.desc' },
    { id: 'cantilever', nameKey: 'ex.cantilever', descKey: 'ex.cantilever.desc' },
    { id: 'cantilever-point', nameKey: 'ex.cantilever-point', descKey: 'ex.cantilever-point.desc' },
    { id: 'point-loads', nameKey: 'ex.point-loads', descKey: 'ex.point-loads.desc' },
    // Vigas multi-tramo y condiciones especiales
    { id: 'gerber-beam', nameKey: 'ex.gerber-beam', descKey: 'ex.gerber-beam.desc' },
    { id: 'continuous-beam', nameKey: 'ex.continuous-beam', descKey: 'ex.continuous-beam.desc' },
    { id: 'spring-support', nameKey: 'ex.spring-support', descKey: 'ex.spring-support.desc' },
    { id: 'settlement', nameKey: 'ex.settlement', descKey: 'ex.settlement.desc' },
    { id: 'thermal', nameKey: 'ex.thermal', descKey: 'ex.thermal.desc' },
    // Reticulados
    { id: 'truss', nameKey: 'ex.truss', descKey: 'ex.truss.desc' },
    { id: 'warren-truss', nameKey: 'ex.warren-truss', descKey: 'ex.warren-truss.desc' },
    { id: 'howe-truss', nameKey: 'ex.howe-truss', descKey: 'ex.howe-truss.desc' },
    // Arcos y pórticos
    { id: 'three-hinge-arch', nameKey: 'ex.three-hinge-arch', descKey: 'ex.three-hinge-arch.desc' },
    { id: 'portal-frame', nameKey: 'ex.portal-frame', descKey: 'ex.portal-frame.desc' },
    { id: 'two-story-frame', nameKey: 'ex.two-story-frame', descKey: 'ex.two-story-frame.desc' },
    // Puentes y envolventes
    { id: 'bridge-moving-load', nameKey: 'ex.bridge-moving-load', descKey: 'ex.bridge-moving-load.desc' },
    // Edificios con combinaciones CIRSOC
    { id: 'frame-cirsoc-dl', nameKey: 'ex.frame-cirsoc-dl', descKey: 'ex.frame-cirsoc-dl.desc' },
    { id: 'building-3story-dlw', nameKey: 'ex.building-3story-dlw', descKey: 'ex.building-3story-dlw.desc' },
    { id: 'frame-seismic', nameKey: 'ex.frame-seismic', descKey: 'ex.frame-seismic.desc' },
  ] as const;

  // Unified 3D examples — ordered by ascending complexity
  const examples3D: { id: string; nameKey: string; descKey: string }[] = [
    { id: '3d-cantilever-load', nameKey: 'ex.3d-cantilever-load', descKey: 'ex.3d-cantilever-load.desc' },
    { id: '3d-torsion-beam', nameKey: 'ex.3d-torsion-beam', descKey: 'ex.3d-torsion-beam.desc' },
    { id: 'hinged-arch-3d', nameKey: 'ex.hingedArch3D', descKey: 'ex.hingedArch3D.desc' },
    { id: '3d-portal-frame', nameKey: 'ex.3d-portal-frame', descKey: 'ex.3d-portal-frame.desc' },
    { id: 'grid-beams', nameKey: 'ex.gridBeams', descKey: 'ex.gridBeams.desc' },
    { id: '3d-space-truss', nameKey: 'ex.3d-space-truss', descKey: 'ex.3d-space-truss.desc' },
    { id: 'space-frame', nameKey: 'ex.spaceFrame3D', descKey: 'ex.spaceFrame3D.desc' },
    { id: 'tower-3d-2', nameKey: 'ex.tower3D_2', descKey: 'ex.tower3D_2.desc' },
    { id: 'tower-3d-4', nameKey: 'ex.tower3D_4', descKey: 'ex.tower3D_4.desc' },
    { id: '3d-nave-industrial', nameKey: 'ex.3d-nave-industrial', descKey: 'ex.3d-nave-industrial.desc' },
  ];

  // PRO-only examples — curated larger / more realistic workflows
  const examplesPro: { id: string; nameKey: string; descKey: string }[] = [
    { id: '3d-building', nameKey: 'ex.3d-building', descKey: 'ex.3d-building.desc' },
    { id: 'pro-edificio-7p', nameKey: 'ex.pro-edificio-7p', descKey: 'ex.pro-edificio-7p.desc' },
    { id: 'rc-qa-diagnostic', nameKey: 'ex.rc-qa-diagnostic', descKey: 'ex.rc-qa-diagnostic.desc' },
    { id: 'rc-qa-diagnostic-shells', nameKey: 'ex.rc-qa-diagnostic-shells', descKey: 'ex.rc-qa-diagnostic-shells.desc' },
    { id: 'cad-arch-structure-dxf', nameKey: 'ex.cad-arch-structure-dxf', descKey: 'ex.cad-arch-structure-dxf.desc' },
    { id: 'cad-arch-only-dxf', nameKey: 'ex.cad-arch-only-dxf', descKey: 'ex.cad-arch-only-dxf.desc' },
    { id: '3d-nave-industrial', nameKey: 'ex.3d-nave-industrial', descKey: 'ex.3d-nave-industrial.desc' },
    { id: 'cable-stayed-bridge-small', nameKey: 'ex.cableStayedBridge3D', descKey: 'ex.cableStayedBridge3D.desc' },
    { id: 'stadium-canopy', nameKey: 'ex.stadiumCanopy3D', descKey: 'ex.stadiumCanopy3D.desc' },
    { id: 'space-frame', nameKey: 'ex.spaceFrame3D', descKey: 'ex.spaceFrame3D.desc' },
    { id: 'tower-3d-4', nameKey: 'ex.tower3D_4', descKey: 'ex.tower3D_4.desc' },
    { id: 'grid-beams', nameKey: 'ex.gridBeams', descKey: 'ex.gridBeams.desc' },
    { id: '3d-space-truss', nameKey: 'ex.3d-space-truss', descKey: 'ex.3d-space-truss.desc' },
    { id: '3d-portal-frame', nameKey: 'ex.3d-portal-frame', descKey: 'ex.3d-portal-frame.desc' },
    { id: 'hinged-arch-3d', nameKey: 'ex.hingedArch3D', descKey: 'ex.hingedArch3D.desc' },
    { id: 'building-3story-dlw', nameKey: 'ex.building-3story-dlw', descKey: 'ex.building-3story-dlw.desc' },
    { id: 'frame-seismic', nameKey: 'ex.frame-seismic', descKey: 'ex.frame-seismic.desc' },
  ];



  /**
   * `flat` — everything open, no accordions.
   *
   * These sections collapse because they used to be stacked in one narrow left
   * column where five of them competed for the same vertical space. In the
   * ribbon layout only ONE of them is ever mounted, in a panel that already
   * names it and that the user can widen, so a disclosure triangle just hides
   * what they explicitly asked to see.
   */
  let { flat = false }: { flat?: boolean } = $props();
</script>

<!--
  One structure, not five near-identical mode branches.

  The markup carried a separate copy per mode, which is how the 3D list came to
  be gated on `showExamples3D` alone while every other list was gated on
  `flat || show…` — so in the right panel, in 3D, the 3D examples never
  appeared and the user was offered only the 2D ones.

  Both catalogues are now offered in both modes, under their own headings. A 2D
  model opens fine in the 3D viewport, and picking a 3D example from 2D switches
  the viewport with it rather than flattening a space frame into a plane.
-->
{#snippet exampleList(items: { id: string; nameKey: string; descKey: string }[], to3D: boolean)}
  <div class="examples-list">
    {#each items as ex}
      <button class="example-item" onclick={async () => {
        if (to3D && uiStore.analysisMode !== '3d') uiStore.analysisMode = '3d';
        await modelStore.loadExample(ex.id);
        resultsStore.clear();
        resultsStore.clear3D();
        if (uiStore.isMobile) uiStore.leftDrawerOpen = false;
        setTimeout(() => window.dispatchEvent(new Event('stabileo-zoom-to-fit')), 50);
      }}>
        <span class="example-name">{t(ex.nameKey)}</span>
        <span class="example-desc">{t(ex.descKey)}</span>
      </button>
    {/each}
  </div>
{/snippet}

{#snippet group(titleKey: string, items: { id: string; nameKey: string; descKey: string }[], to3D: boolean, open: boolean, toggle: () => void)}
  <div class="toolbar-section">
    {#if flat}
      <h3 class="ex-heading">{t(titleKey)}</h3>
      {@render exampleList(items, to3D)}
    {:else}
      <button class="section-toggle" onclick={toggle}>
        {open ? '▾' : '▸'} {t(titleKey)}
      </button>
      {#if open}{@render exampleList(items, to3D)}{/if}
    {/if}
  </div>
{/snippet}

<div data-tour="examples-section" class="ex-groups">
  {#if uiStore.analysisMode === 'pro'}
    {@render group('examples.titlePro', examplesPro, false, showExamples, () => showExamples = !showExamples)}
  {:else if uiStore.analysisMode === '3d'}
    <!--
      The catalogue for the mode you are IN goes first. Both are offered in both
      modes, but in 3D the 3D examples sat under nineteen 2D ones, far enough
      down the panel to read as an afterthought.
    -->
    {@render group('examples.title3d', examples3D, true, showExamples3D, () => showExamples3D = !showExamples3D)}
    {@render group('examples.title2d', [...examples], false, showExamples, () => showExamples = !showExamples)}
  {:else}
    {@render group('examples.title2d', [...examples], false, showExamples, () => showExamples = !showExamples)}
    {@render group('examples.title3d', examples3D, true, showExamples3D, () => showExamples3D = !showExamples3D)}
  {/if}
</div>

<style>
  .ex-groups {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .toolbar-section {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .toolbar-section h3 {
    font-size: 0.75rem;
    text-transform: uppercase;
    color: var(--st-text-3);
    letter-spacing: 0.05em;
  }

  .section-toggle {
    width: 100%;
    padding: 0.4rem 0.5rem;
    background: none;
    border: 1px solid var(--st-hair);
    border-radius: 4px;
    color: var(--st-text-2);
    cursor: pointer;
    font-size: 0.75rem;
    font-weight: 600;
    text-align: left;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    transition: all 0.2s;
  }

  .section-toggle:hover {
    background: var(--st-bg);
    color: var(--st-text);
    border-color: var(--st-hair-strong);
  }

  /*
     In the right panel the list IS the panel's content, so it drops the frame.
     A bordered, 260 px-tall scroll box made sense in the narrow left sidebar it
     was written for; inside a 320 px panel it reads as a window within a window,
     gives up width to its own padding, and scrolls internally while most of the
     panel below it sits empty.
  */
  :global(.basic-panel) .examples-list {
    max-height: none;
    overflow-y: visible;
    border: none;
    border-radius: 0;
    padding: 0;
    gap: 0;
  }

  :global(.basic-panel) .example-item + .example-item {
    border-top: 1px solid var(--st-hair);
  }

  :global(.basic-panel) .example-item {
    border-radius: 0;
    padding: 0.45rem 0.35rem;
  }

  .ex-heading {
    font-family: var(--st-mono);
    font-size: 0.66rem;
    letter-spacing: 0.11em;
    text-transform: uppercase;
    color: var(--st-text-2);
    font-weight: 400;
    padding-bottom: 0.15rem;
    border-bottom: 1px solid var(--st-hair);
  }

  .examples-list {
    display: flex;
    flex-direction: column;
    gap: 2px;
    max-height: 260px;
    overflow-y: auto;
    border: 1px solid var(--st-hair-strong);
    border-radius: 4px;
    padding: 2px;
  }

  .example-item {
    display: flex;
    flex-direction: column;
    padding: 0.35rem 0.5rem;
    background: none;
    border: none;
    border-radius: 3px;
    color: var(--st-text);
    cursor: pointer;
    text-align: left;
    transition: all 0.15s;
  }

  .example-item:hover {
    background: var(--st-surface-3);
    color: white;
  }

  .example-name {
    font-size: 0.8rem;
    font-weight: 500;
  }

  .example-desc {
    font-size: 0.65rem;
    color: var(--st-text-3);
  }

  .example-item:hover .example-desc {
    color: var(--st-text-2);
  }

  .input-group {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.875rem;
  }

  .input-group input {
    width: 70px;
    padding: 0.25rem;
    background: var(--st-surface-2);
    border: 1px solid var(--st-hair-strong);
    border-radius: 4px;
    color: var(--st-text);
    cursor: pointer;
  }

  .input-group select {
    flex: 1;
    min-width: 100px;
    padding: 0.25rem;
    background: var(--st-surface-2);
    border: 1px solid var(--st-hair-strong);
    border-radius: 4px;
    color: var(--st-text);
    cursor: pointer;
  }

  input[type="checkbox"] {
    accent-color: var(--st-accent);
  }

  .file-btn {
    padding: 0.35rem 0.4rem;
    background: var(--st-surface-2);
    border: 1px solid var(--st-hair-strong);
    border-radius: 4px;
    color: var(--st-text);
    cursor: pointer;
    font-size: 0.75rem;
    text-align: center;
    transition: all 0.2s;
  }

  .file-btn:hover:not(:disabled) {
    background: var(--st-surface-3);
    color: white;
  }

  .file-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
</style>
