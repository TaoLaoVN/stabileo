<script lang="ts">
  import { t } from '../../lib/i18n';
  import { uiStore, modelStore, resultsStore } from '../../lib/store';
  import {
    saveProject, saveSession, loadFile, downloadResultsCSV,
    downloadExcel, isMode3D,
  } from '../../lib/store/file';

  /**
   * PRO's project view: what you have open, and how it gets in and out.
   *
   * PRO had no such place. Saving was a keyboard shortcut, opening was a file
   * input owned by another component, exporting lived at the bottom of a tab
   * about something else, and "Examples" was a button that opened a floating
   * gallery over the canvas and nothing else. So the one screen every project
   * starts and ends at did not exist.
   *
   * Basic answered this with a Project panel, and the answer transfers — but
   * the content does not. PRO's examples are curated engineering cases with a
   * stated intent, a size and a set of tags; presenting them as a flat list of
   * names, the way Basic does, would throw away the part that makes them
   * choosable. So the gallery keeps its cards and comes in here, where the rest
   * of the document lives.
   */

  type Props = { onOpenExamples: (btn: HTMLButtonElement) => void };
  let { onOpenExamples }: Props = $props();

  let fileInput: HTMLInputElement | undefined = $state();
  let exampleBtn: HTMLButtonElement | undefined = $state();

  const solved = $derived(resultsStore.results3D != null || resultsStore.results != null);
  const hasModel = $derived(modelStore.nodes.size > 0);

  async function handleLoad(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    try {
      const r = await loadFile(file);
      if (r.type === 'session') {
        uiStore.toast(t('toast.sessionRestored').replace('{n}', String(r.count)), 'success');
      }
    } catch (err: unknown) {
      uiStore.toast(err instanceof Error ? err.message : String(err), 'error');
    }
    input.value = '';
  }
</script>

<div class="pp">
  <h4 class="pp-heading">{t('project.fileSection')}</h4>
  <div class="pp-grid">
    <button class="pp-btn" onclick={() => saveProject()} title={t('project.saveTabTooltip')}>
      {t('project.saveTab')}
    </button>
    <button class="pp-btn" onclick={() => saveSession()} title={t('project.saveSessionTooltip')}>
      {t('project.saveSession')}
    </button>
    <button class="pp-btn" onclick={() => fileInput?.click()} title={t('project.openTooltip')}>
      {t('project.open')}
    </button>
  </div>

  <!--
    The gallery opens anchored to this button rather than inline: its cards
    carry a description, tags and a model size, and at panel width they would
    wrap into an unreadable column. It is the one thing here that wants the
    canvas's room.
  -->
  <h4 class="pp-heading">{t('proProject.startFrom')}</h4>
  <div class="pp-grid">
    <button
      class="pp-btn pp-btn-wide"
      bind:this={exampleBtn}
      onclick={() => exampleBtn && onOpenExamples(exampleBtn)}
      data-testid="pp-examples"
    >{t('pro.exampleBtn')}</button>
    <button
      class="pp-btn pp-btn-wide"
      onclick={() => window.dispatchEvent(new Event('stabileo-import-dxf'))}
      title={t('project.openDxfCadTooltip')}
    >{t('cad.proBarBtn')}</button>
    <button
      class="pp-btn pp-btn-wide"
      onclick={() => window.dispatchEvent(new Event('stabileo-import-ifc'))}
      title={t('project.openIfcTooltip')}
    >{t('project.openIfc')}</button>
  </div>

  <h4 class="pp-heading">{t('project.export')}</h4>
  <div class="pp-grid">
    <button class="pp-btn" onclick={() => downloadExcel()} title={t('project.exportExcelTooltip')}>Excel</button>
    <button
      class="pp-btn"
      onclick={() => downloadResultsCSV()}
      disabled={!solved}
      title={solved ? t('project.exportCsvTooltip') : t('ribbon.needsSolve')}
    >CSV</button>
    <button
      class="pp-btn"
      onclick={() => window.dispatchEvent(new Event('stabileo-export-png'))}
      disabled={!hasModel}
      title={t('project.exportPngTooltip')}
    >PNG</button>
  </div>

  <!--
    Sharing is a link to this model, not a file — different verb, own heading.
  -->
  <h4 class="pp-heading">{t('project.share')}</h4>
  <div class="pp-grid">
    <button
      class="pp-btn pp-btn-wide"
      onclick={() => window.dispatchEvent(new Event('stabileo-copy-share-link'))}
      disabled={!hasModel}
      title={t('project.copyLinkTooltip')}
    >{t('project.copyLink')}</button>
  </div>
</div>

<input
  bind:this={fileInput}
  type="file"
  accept=".ded,.json"
  style="display:none"
  onchange={handleLoad}
/>

<style>
  .pp { display: flex; flex-direction: column; }

  .pp-heading {
    font-family: var(--st-mono);
    font-size: 0.66rem;
    font-weight: 400;
    letter-spacing: 0.11em;
    text-transform: uppercase;
    color: var(--st-text-2);
    margin: 0.9rem 0 0.4rem;
    padding-bottom: 0.15rem;
    border-bottom: 1px solid var(--st-hair);
  }

  .pp-heading:first-child { margin-top: 0; }

  /*
     Sized by content, not by count: a three-column grid gives three items a
     third of the panel each and six items a sixth, so the same class produced
     a wide Save and a small CSV and implied one outranked the other.
  */
  .pp-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(88px, 1fr));
    gap: 0.3rem;
  }

  .pp-btn-wide { grid-column: 1 / -1; }

  .pp-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 30px;
    padding: 0.35rem 0.5rem;
    background: none;
    border: 1px solid var(--st-hair);
    border-radius: var(--st-radius);
    color: var(--st-text-2);
    font-family: var(--st-sans);
    font-size: 0.75rem;
    cursor: pointer;
    transition: background 0.12s, color 0.12s, border-color 0.12s;
  }

  .pp-btn:hover:not(:disabled) {
    background: var(--st-surface-3);
    border-color: var(--st-hair-strong);
    color: var(--st-text);
  }

  .pp-btn:disabled { opacity: 0.4; cursor: not-allowed; }
</style>
