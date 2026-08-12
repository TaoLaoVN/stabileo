<script lang="ts">
  import { uiStore, resultsStore, modelStore, historyStore } from '../lib/store';
  import { saveProject, loadFile, saveSession } from '../lib/store/file';
  import { t } from '../lib/i18n';
  import { countCollapsedElements, buildSimplified2DModel, type DrawPlane } from '../lib/geometry/plane-projection';
  import { TOOL_KEY_MAP } from '../lib/tool-keys';

  import ToolbarResults from './toolbar/ToolbarResults.svelte';
  import ToolbarAdvanced from './toolbar/ToolbarAdvanced.svelte';
  import ToolbarExamples from './toolbar/ToolbarExamples.svelte';
  import ToolbarConfig from './toolbar/ToolbarConfig.svelte';
  import ToolbarProject from './toolbar/ToolbarProject.svelte';

  let fileInput: HTMLInputElement;

  // ─── 3D→2D plane-selection modal ──────────────────────────────
  let show2DPlaneModal = $state(false);
  let planeCollapsed = $state<Record<DrawPlane, number>>({ xy: 0, xz: 0, yz: 0 });

  function isModelNative2D(): boolean {
    for (const node of modelStore.nodes.values()) {
      if (Math.abs(node.z ?? 0) > 1e-9) return false;
    }
    const _3dSups = new Set(['fixed3d','pinned3d','spring3d','rollerXZ','rollerXY','rollerYZ','custom3d']);
    for (const s of modelStore.supports.values()) {
      if (_3dSups.has(s.type)) return false;
    }
    const _3dLoads = new Set(['nodal3d','distributed3d','pointOnElement3d','surface3d']);
    for (const l of modelStore.loads) {
      if (_3dLoads.has(l.type)) return false;
    }
    return true;
  }

  function computePlaneStats() {
    const nodeArr = [...modelStore.nodes.values()];
    const elemArr = [...modelStore.elements.values()];
    // Count collapsed elements per plane for informational display
    for (const plane of ['xy', 'xz', 'yz'] as DrawPlane[]) {
      planeCollapsed[plane] = countCollapsedElements(plane, nodeArr, elemArr);
    }
  }

  function handleSwitchTo2D() {
    if (modelStore.nodes.size === 0 || isModelNative2D()) {
      uiStore.drawPlane2D = 'xy';
      uiStore.analysisMode = '2d';
    } else {
      computePlaneStats();
      show2DPlaneModal = true;
    }
  }

  // Backup of original 3D model for restoration when exiting simplified mode
  let original3DBackup: { nodes: Map<number, any>; elements: Map<number, any>; supports: Map<number, any>; loads: any[] } | null = null;

  function selectPlane(plane: DrawPlane) {
    const result = buildSimplified2DModel(
      plane,
      modelStore.nodes.values(),
      modelStore.elements.values(),
      modelStore.supports.values(),
      modelStore.loads,
      modelStore.materials,
      modelStore.sections,
    );
    if (!result.ok) {
      uiStore.toast(result.error, 'error');
      return;
    }

    // Backup original 3D model (only once — don't overwrite if already backed up)
    if (!original3DBackup) {
      original3DBackup = {
        nodes: new Map(modelStore.nodes),
        elements: new Map(modelStore.elements),
        supports: new Map(modelStore.supports),
        loads: [...modelStore.loads],
      };
    }

    // Replace model with simplified version
    const m = result.model;
    modelStore.replaceModelData(m.nodes, m.elements, m.supports, m.loads);

    // In simplified mode, the model data is already in XY convention (projected by the builder).
    // Set drawPlane2D to 'xy' so the viewport and solver don't double-remap.
    uiStore.drawPlane2D = 'xy';
    uiStore.simplified2DMode = true;
    uiStore.simplified2DStats = m.stats;
    uiStore.analysisMode = '2d';
    resultsStore.clear();
    show2DPlaneModal = false;
  }

  // Restore original 3D model when switching back
  function exitSimplified2D() {
    if (original3DBackup) {
      modelStore.replaceModelData(
        original3DBackup.nodes,
        original3DBackup.elements,
        original3DBackup.supports,
        original3DBackup.loads,
      );
      original3DBackup = null;
    }
    uiStore.simplified2DMode = false;
    uiStore.simplified2DStats = null;
    uiStore.drawPlane2D = 'xy';
    uiStore.analysisMode = '3d';
    resultsStore.clear();
  }

  // Keys come from lib/tool-keys.ts, like every other toolbar in the app.
  const tools = [
    { id: 'pan', icon: '✋', labelKey: 'toolbar.pan' },
    { id: 'select', icon: '↖', labelKey: 'toolbar.select' },
    { id: 'node', icon: '●', labelKey: 'toolbar.node' },
    { id: 'element', icon: '—', labelKey: 'toolbar.element' },
    { id: 'support', icon: '▽', labelKey: 'toolbar.support' },
    { id: 'load', icon: '↓', labelKey: 'toolbar.load' },
  ].map((tool) => ({ ...tool, key: TOOL_KEY_MAP[tool.id as keyof typeof TOOL_KEY_MAP] })) as Array<{
    id: string;
    icon: string;
    labelKey: string;
    key: string;
  }>;


  async function handleLoadFile(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    try {
      const result = await loadFile(file);
      if (result.type === 'session') {
        uiStore.toast(t('toast.sessionRestored').replace('{n}', String(result.count)), 'success');
      }
    } catch (err: any) {
      alert(err.message || t('toast.loadFileError'));
    }
    input.value = ''; // reset so same file can be loaded again
  }

</script>


<div class="toolbar">
  <div class="toolbar-section">
    <div class="undo-redo-row">
      <button
        class="undo-redo-btn"
        onclick={() => historyStore.undo()}
        disabled={!historyStore.canUndo}
        title={uiStore.isMobile ? t('toolbar.undo') : `${t('toolbar.undo')} (Ctrl+Z)`}
      >↶ {t('toolbar.undo')}</button>
      <button
        class="undo-redo-btn"
        onclick={() => historyStore.redo()}
        disabled={!historyStore.canRedo}
        title={uiStore.isMobile ? t('toolbar.redo') : `${t('toolbar.redo')} (Ctrl+Y)`}
      >↷ {t('toolbar.redo')}</button>
    </div>
  </div>

  <!-- 2D/3D dimension toggle (only in Básico mode) -->
  {#if uiStore.appMode === 'basico'}
    <div class="toolbar-section dim-toggle-section">
      <div class="dim-toggle">
        <button class:active={uiStore.analysisMode === '2d'} onclick={handleSwitchTo2D}>2D</button>
        <button class:active={uiStore.analysisMode === '3d'} onclick={() => { if (uiStore.simplified2DMode) exitSimplified2D(); else uiStore.analysisMode = '3d'; }}>3D</button>
      </div>
    </div>
  {/if}

  <ToolbarResults />
  <ToolbarAdvanced />
  <ToolbarExamples />

  <!-- Configuración + Proyecto wrapper for tour spotlight -->
  <div data-tour="config-project-section" style="display:flex;flex-direction:column;gap:1rem">
    <ToolbarConfig />
    <ToolbarProject />
  </div>

  <input
    bind:this={fileInput}
    type="file"
    accept=".ded,.json"
    style="display:none"
    onchange={handleLoadFile}
  />
</div>

{#if show2DPlaneModal}
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="plane-modal-overlay" onclick={() => show2DPlaneModal = false}>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="plane-modal" onclick={(e) => e.stopPropagation()}>
    <h3>{t('toolbar.planeModal.title')}</h3>
    <p>{t('toolbar.planeModal.description')}</p>
    <div class="plane-options">
      {#each [['xy', 'XY', t('toolbar.planeModal.xy')], ['xz', 'XZ', t('toolbar.planeModal.xz')], ['yz', 'YZ', t('toolbar.planeModal.yz')]] as [id, label, desc]}
        {@const n = planeCollapsed[id as DrawPlane]}
        <button class="plane-btn" class:plane-btn-warn={n > 0}
          onclick={() => selectPlane(id as DrawPlane)}>
          <span class="plane-label">{label}</span>
          <span class="plane-desc">{n > 0 ? `~${n} ${t('toolbar.planeModal.simplified')}` : desc}</span>
        </button>
      {/each}
    </div>
    <div class="plane-modal-footer">
      <button class="plane-btn plane-btn-secondary" onclick={() => show2DPlaneModal = false}>
        {t('toolbar.planeModal.stay3d')}
      </button>
      <button class="plane-btn plane-btn-destructive" onclick={() => { modelStore.clear(); uiStore.simplified2DMode = false; uiStore.simplified2DStats = null; uiStore.drawPlane2D = 'xy'; uiStore.analysisMode = '2d'; resultsStore.clear(); show2DPlaneModal = false; }}>
        {t('toolbar.planeModal.eraseAndSwitch')}
      </button>
    </div>
  </div>
</div>
{/if}

<style>
  .toolbar {
    padding: 1rem;
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

  .undo-redo-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.25rem;
  }

  .undo-redo-btn {
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

  .undo-redo-btn:hover:not(:disabled) {
    background: var(--st-surface-3);
    color: white;
  }

  .undo-redo-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .dim-toggle-section {
    padding-top: 0 !important;
    padding-bottom: 0 !important;
  }

  .dim-toggle {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0;
    border-radius: 4px;
    overflow: hidden;
    border: 1px solid var(--st-hair-strong);
  }

  .dim-toggle button {
    background: var(--st-surface-2);
    border: none;
    color: #778;
    font-size: 0.75rem;
    font-weight: 700;
    padding: 0.3rem 0;
    cursor: pointer;
    transition: background 0.15s, color 0.15s;
    text-align: center;
  }

  .dim-toggle button:first-child {
    border-right: 1px solid var(--st-hair-strong);
  }

  .dim-toggle button:hover {
    background: #1a3860;
    color: var(--st-text);
  }

  .dim-toggle button.active {
    background: var(--st-accent);
    color: white;
  }

  .solve-btn {
    width: 100%;
    padding: 0.5rem 0.5rem;
    background: var(--st-accent);
    border: 1px solid var(--st-danger);
    border-radius: 4px;
    color: white;
    cursor: pointer;
    font-size: 0.8rem;
    font-weight: 600;
    text-align: center;
    transition: all 0.2s;
  }

  .solve-btn:hover:not(:disabled) {
    background: var(--st-danger);
  }

  .solve-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .solve-btn.ready {
    animation: gentle-pulse 3s ease-in-out infinite;
  }

  @keyframes gentle-pulse {
    0%, 100% {
      box-shadow: 0 0 0 0 rgba(233, 69, 96, 0);
    }
    50% {
      box-shadow: 0 0 8px 2px rgba(233, 69, 96, 0.4);
    }
  }

  .solve-btn.solve-steps {
    background: var(--st-surface-2);
    border-color: var(--st-warn);
    color: var(--st-warn);
  }

  .solve-btn.solve-steps:hover {
    background: var(--st-surface-3);
    color: white;
  }

  .mode-3d-note {
    text-align: center;
    color: #667;
    font-size: 0.7rem;
    margin-top: 0.25rem;
    font-style: italic;
  }

  /* ─── 3D→2D plane modal ───────────────────────────────── */
  .plane-modal-overlay {
    position: fixed;
    inset: 0;
    z-index: 9999;
    background: rgba(0, 0, 0, 0.6);
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .plane-modal {
    background: var(--st-surface);
    border: 1px solid var(--st-hair-strong);
    border-radius: 8px;
    padding: 1.5rem;
    width: 320px;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }
  .plane-modal h3 {
    margin: 0;
    font-size: 0.95rem;
    color: var(--st-text);
  }
  .plane-modal p {
    margin: 0;
    font-size: 0.78rem;
    color: #999;
    line-height: 1.4;
  }
  .plane-options {
    display: flex;
    gap: 0.5rem;
  }
  .plane-btn {
    flex: 1;
    padding: 0.6rem 0.4rem;
    background: var(--st-surface-2);
    border: 1px solid var(--st-hair-strong);
    border-radius: 5px;
    color: var(--st-text);
    cursor: pointer;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.2rem;
    transition: all 0.15s;
  }
  .plane-btn:hover {
    background: var(--st-surface-3);
    color: white;
    border-color: var(--st-interactive);
  }
  .plane-label {
    font-size: 1rem;
    font-weight: 700;
    color: var(--st-value);
  }
  .plane-desc {
    font-size: 0.6rem;
    color: var(--st-text-3);
  }
  .plane-btn:hover .plane-desc { color: #bbb; }
  .plane-btn-warn .plane-desc { color: #e9a045; font-weight: 500; font-size: 0.55rem; }
  .plane-btn-destructive {
    background: #2a1520;
    border-color: var(--st-accent);
    color: var(--st-accent);
    font-size: 0.68rem;
    flex: unset;
  }
  .plane-btn-destructive:hover {
    background: var(--st-accent);
    color: white;
  }
  .plane-modal-footer {
    display: flex;
    justify-content: center;
    margin-top: 0.25rem;
  }
  .plane-btn-secondary {
    background: #12192e;
    border-color: var(--st-hair);
    color: var(--st-text-3);
    font-size: 0.75rem;
  }
  .plane-btn-secondary:hover {
    background: var(--st-bg);
    color: var(--st-text);
    border-color: var(--st-hair-strong);
  }
</style>
