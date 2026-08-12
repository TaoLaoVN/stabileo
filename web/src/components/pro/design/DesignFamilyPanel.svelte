<script lang="ts">
  /**
   * Which families "Design all" designs, and what it did.
   *
   * ── The workflow this closes ───────────────────────────────────────
   *
   * "Diseñar todo" designed beams and columns. Slabs, walls and foundations came from a second
   * command in a different disclosure, so the button named "all" produced a building with no
   * floors and said nothing about it — the user found out from the 3-D view. One selection now
   * drives one run.
   *
   * ── Why the result lives here too ──────────────────────────────────
   *
   * Because the question after pressing the button is always "what did that do", and the
   * answer was previously spread across three panels. Processed, designed, refused and
   * not-modelled per family, then the ways out: the 3-D view and the exports, beside the
   * numbers rather than hunted for.
   */
  import { t, tp } from '../../../lib/i18n';
  import { designRunStore } from '../../../lib/store/design-run.svelte';
  import { detailingStore } from '../../../lib/store/detailing.svelte';
  import { rebarWorkspace } from '../../../lib/store/rebar-workspace.svelte';
  import {
    DESIGN_FAMILIES, DEFAULT_DESIGN_FAMILIES, totalsOf,
    type DesignFamily, type DesignRunReport,
  } from '../../../lib/engine/design/design-families';

  interface Props {
    /** Whether the upstream commands can run at all. */
    canDesign: boolean;
    /** Build the document so the 3-D view and the exports have one to project. */
    onView3d: () => void;
  }
  const { canDesign, onView3d }: Props = $props();

  /**
   * The selection, defaulting to everything except foundations.
   *
   * Session state, not project state: it is a statement about what the user wants to run now,
   * not a property of the structure. Persisting it into the project would make a saved file
   * carry someone's last click as if it were a design decision.
   */
  let selection = $state<DesignFamily[]>([...DEFAULT_DESIGN_FAMILIES]);
  let report = $state<DesignRunReport | null>(null);
  let running = $state(false);

  const summary = $derived(
    selection.length === 0
      ? t('design.families.none')
      : tp('design.families.summary', {
        list: selection.map((f) => t(`design.families.${f}`)).join(', '),
      }));

  function toggle(f: DesignFamily) {
    selection = selection.includes(f)
      ? selection.filter((x) => x !== f)
      : [...selection, f];
  }

  function run() {
    if (selection.length === 0) return;
    running = true;
    try {
      report = designRunStore.designFamilies(selection, {
        verifierId: 'cirsoc201.provided.v2.2025',
      });
    } finally {
      running = false;
    }
  }

  const totals = $derived(report ? totalsOf(report) : null);
</script>

<section class="families" data-testid="design-families">
  <h4>{t('design.families.title')}</h4>
  <!--
    What this runs, and how it differs from the command above.

    Both buttons used to read "Design all". They are not the same command: the one on the command
    row designs the FRAME, this one designs whichever families are ticked here — including slabs,
    walls and, if asked, foundations. Two identical labels for two different scopes is the
    ambiguity this subtitle and the button's new wording remove.
  -->
  <p class="subtitle" data-testid="design-families-subtitle">{t('design.families.subtitle')}</p>

  <div class="boxes">
    {#each DESIGN_FAMILIES as f (f)}
      <label>
        <input
          type="checkbox"
          data-testid={`design-family-${f}`}
          checked={selection.includes(f)}
          onchange={() => toggle(f)}
        />
        <span>{t(`design.families.${f}`)}</span>
      </label>
    {/each}
  </div>

  <div class="bulk">
    <button type="button" data-testid="design-family-all"
            onclick={() => { selection = [...DESIGN_FAMILIES]; }}>
      {t('design.families.selectAll')}
    </button>
    <button type="button" data-testid="design-family-none"
            onclick={() => { selection = []; }}>
      {t('design.families.clear')}
    </button>
  </div>

  <p class="summary" data-testid="design-family-summary">{summary}</p>
  <!-- Stated where the box is, so leaving foundations out is a visible choice. -->
  <p class="note">{t('design.families.footingNote')}</p>

  <button
    class="run"
    type="button"
    data-testid="cmd-design-families"
    disabled={!canDesign || selection.length === 0 || running}
    onclick={run}
  >
    {running ? t('design.families.running') : t('design.families.runScoped')}
  </button>

  {#if report}
    <div class="result" data-testid="design-family-result">
      <h5>{t('design.families.result')}</h5>
      <p class="cols">{t('design.families.cols')}</p>
      <table>
        <tbody>
          {#each report.families as f (f.family)}
            <tr data-testid={`design-result-${f.family}`} class={f.state}>
              <th scope="row">{t(`design.families.${f.family}`)}</th>
              <td class="state">{t(`design.families.state.${f.state}`)}</td>
              {#if f.state === 'designed'}
                <td>{f.processed}</td>
                <td>{f.designed}</td>
                <td>{f.refused}</td>
                <td>{f.notModelled}</td>
              {:else}
                <td colspan="4">—</td>
              {/if}
            </tr>
            {#if f.errorKey}
              <tr class="err"><td colspan="6">{tp(f.errorKey, f.errorParams ?? {})}</td></tr>
            {/if}
          {/each}
        </tbody>
      </table>

      {#if totals}
        <p class="totals" data-testid="design-family-totals">
          {totals.processed} / {totals.designed} / {totals.refused} / {totals.notModelled}
        </p>
      {/if}

      <!-- The ways out, beside the numbers rather than hunted for in another panel. -->
      <div class="actions">
        <button
          type="button"
          class="primary"
          data-testid="design-result-view-3d"
          disabled={detailingStore.assemblies.length === 0
            && (detailingStore.document?.assemblies.length ?? 0) === 0}
          onclick={() => { onView3d(); rebarWorkspace.openWorkspace(); }}
        >
          {t('detailing.scene.openWorkspace')}
        </button>
      </div>
    </div>
  {/if}
</section>

<style>
  .subtitle {
    margin: 0 0 0.4rem;
    font-size: 0.7rem;
    color: var(--st-text-2);
    line-height: 1.35;
  }
  .families { display: flex; flex-direction: column; gap: 0.4rem; }
  h4, h5 { margin: 0; font-size: 0.85rem; }
  .boxes { display: flex; flex-wrap: wrap; gap: 0.1rem 0.75rem; }
  label {
    display: flex; align-items: center; gap: 0.3rem;
    font-size: 0.78rem; cursor: pointer;
  }
  .bulk { display: flex; gap: 0.4rem; }
  .bulk button {
    font-size: 0.72rem; padding: 0.12rem 0.4rem; cursor: pointer;
    background: transparent; border: 1px solid var(--border, #2a2f3a); border-radius: 3px;
    color: inherit;
  }
  .summary { margin: 0; font-size: 0.78rem; }
  .note, .cols { margin: 0; font-size: 0.7rem; color: var(--text-muted, #8b93a3); }
  .run {
    align-self: flex-start; font-size: 0.82rem; padding: 0.3rem 0.8rem; cursor: pointer;
    background: #2b6cb0; color: #fff; border: none; border-radius: 4px;
  }
  .run:disabled { opacity: 0.5; cursor: default; }
  .result { border-top: 1px solid var(--border, #2a2f3a); padding-top: 0.35rem; }
  table { width: 100%; border-collapse: collapse; font-size: 0.74rem; }
  th { text-align: left; font-weight: 400; }
  td { text-align: right; font-variant-numeric: tabular-nums; }
  td.state { text-align: left; color: var(--text-muted, #8b93a3); }
  tr.skipped, tr.noElements { opacity: 0.6; }
  tr.failed td.state { color: #e0444a; }
  .err td { text-align: left; color: #e0444a; font-size: 0.72rem; }
  .totals { margin: 0.2rem 0 0; font-size: 0.76rem; font-variant-numeric: tabular-nums; }
  .actions { margin-top: 0.4rem; }
  .actions .primary {
    font-size: 0.8rem; padding: 0.25rem 0.7rem; cursor: pointer;
    background: #2b6cb0; color: #fff; border: none; border-radius: 4px;
  }
  .actions .primary:disabled { opacity: 0.5; cursor: default; }
</style>
