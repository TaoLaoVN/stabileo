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
   * stated intent and a size, so they keep more than a name; at panel width
   * that is the name, one line of description and the model's size, which is
   * what anyone actually chooses on.
   */

  type ExGroup = { title: string; examples: Array<Record<string, any>> };
  type Props = { groups: ExGroup[]; onLoadExample: (ex: any) => void };
  let { groups, onLoadExample }: Props = $props();

  let fileInput: HTMLInputElement | undefined = $state();
  /*
   * The gallery lives IN the panel, not over the canvas.
   *
   * It was a floating menu with a backdrop, anchored to a button — so choosing
   * a model meant covering the model, and the one screen a project starts at
   * threw a dialog at you. At panel width the cards drop to one line of name
   * plus one of description, which is what you actually choose on; the tags
   * and the node counts follow underneath.
   */
  let showExamples = $state(false);

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

  <h4 class="pp-heading">{t('proProject.newModel')}</h4>

  <button
    class="pp-btn pp-btn-wide pp-disclose"
    onclick={() => (showExamples = !showExamples)}
    aria-expanded={showExamples}
    data-testid="pp-examples"
  >
    <span>{t('pro.exampleBtn')}</span>
    <span class="pp-caret">{showExamples ? '▾' : '▸'}</span>
  </button>

  {#if showExamples}
    <div class="pp-gallery" data-testid="pp-gallery">
      {#each groups as g (g.title)}
        <div class="pp-gal-group">{g.title}</div>
        {#each g.examples as ex (ex.nameKey)}
          <button class="pp-ex" onclick={() => { onLoadExample(ex); showExamples = false; }}>
            <span class="pp-ex-name">{t(ex.nameKey)}</span>
            <span class="pp-ex-desc">{t(ex.descKey)}</span>
            <span class="pp-ex-meta">
              {ex.stats.nodes} {t('pro.stats.nodes')} · {ex.stats.members} {t('pro.stats.members')}
              {#if ex.stats.shells}· {ex.stats.shells} {t('pro.stats.shells')}{/if}
            </span>
          </button>
        {/each}
      {/each}
    </div>
  {/if}

  <!--
    Two importers, each with what it actually does. "DXF plan" named a file
    format and left the rest to guesswork — it takes an architectural floor
    plan and proposes a structure from it, which is a different promise from
    "open a file".
  -->
  <div class="pp-row">
    <button
      class="pp-btn pp-btn-grow"
      onclick={() => window.dispatchEvent(new Event('stabileo-import-dxf'))}
    >{t('cad.proBarBtn')}</button>
    <button class="pp-help" title={t('proProject.dxfHelp')} aria-label={t('proProject.dxfHelp')}>?</button>
  </div>
  <div class="pp-row">
    <button
      class="pp-btn pp-btn-grow"
      onclick={() => window.dispatchEvent(new Event('stabileo-import-ifc'))}
    >{t('project.openIfc')}</button>
    <button class="pp-help" title={t('proProject.ifcHelp')} aria-label={t('proProject.ifcHelp')}>?</button>
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

  .pp-row { display: flex; gap: 0.3rem; align-items: stretch; margin-top: 0.3rem; }
  .pp-btn-grow { flex: 1; }

  .pp-help {
    width: 26px;
    flex: none;
    background: none;
    border: 1px solid var(--st-hair);
    border-radius: var(--st-radius);
    color: var(--st-text-3);
    font-size: 0.72rem;
    cursor: help;
  }

  .pp-help:hover { color: var(--st-text); border-color: var(--st-hair-strong); }

  .pp-disclose { justify-content: space-between; margin-top: 0.3rem; }
  .pp-caret { font-size: 0.6rem; color: var(--st-text-3); }

  .pp-gallery {
    display: flex;
    flex-direction: column;
    margin: 0.3rem 0 0.2rem;
    border: 1px solid var(--st-hair);
    border-radius: var(--st-radius);
    max-height: 46vh;
    overflow-y: auto;
  }

  .pp-gal-group {
    font-family: var(--st-mono);
    font-size: 0.6rem;
    letter-spacing: 0.11em;
    text-transform: uppercase;
    color: var(--st-text-3);
    padding: 0.4rem 0.5rem 0.2rem;
    background: var(--st-surface-2);
  }

  .pp-ex {
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
    text-align: left;
    background: none;
    border: none;
    border-top: 1px solid var(--st-hair);
    padding: 0.4rem 0.5rem;
    cursor: pointer;
  }

  .pp-ex:hover { background: var(--st-surface-3); }
  .pp-ex-name { font-size: 0.76rem; color: var(--st-text); }
  .pp-ex-desc { font-size: 0.66rem; color: var(--st-text-3); }
  .pp-ex-meta { font-family: var(--st-mono); font-size: 0.6rem; color: var(--st-text-3); }
</style>
