<script lang="ts">
  /**
   * Project regulation settings: jurisdiction, adopted editions and concrete data.
   *
   * These are project facts printed on every certificate and drawing, not app
   * preferences, so they live on the model and are edited here rather than in a
   * settings dialog. Two things this panel exists to make impossible to miss:
   *
   *   1. that changing the code edition invalidates stored verification results, and
   *   2. that an unstated maximum aggregate size is an assumption, not a default.
   */
  import { t, tp } from '../../../lib/i18n';
  import { modelStore } from '../../../lib/store/model.svelte';
  import { verificationStore } from '../../../lib/store/verification.svelte';
  import {
    DAGG_ASSUMED_MM, DAGG_MAX_MM, DAGG_MIN_MM, DAGG_SHOTCRETE_MAX_MM,
    defaultCodeSettings, editionChangeNotice,
    type AdoptionBasis, type ProjectCodeSettings,
  } from '../../../lib/codes/project-code-settings';
  import { findRegulation, type RegulationEdition } from '../../../lib/codes/regulation';

  const settings = $derived<ProjectCodeSettings>(
    modelStore.model.codeSettings ?? defaultCodeSettings(),
  );

  const BASES: AdoptionBasis[] = ['national', 'adopted', 'voluntary', 'unstated'];
  const EDITIONS: RegulationEdition[] = ['2025', '2005'];

  /** Set when the user changes an edition, so the invalidation warning stays visible. */
  let editionWarning = $state<string | null>(null);
  let aggregateError = $state<string | null>(null);

  const concreteInfo = $derived(findRegulation('cirsoc-201', settings.concreteEdition));

  const aggregateAssumed = $derived(settings.concrete.maxAggregateSizeMm === null);

  const effectiveMax = $derived(
    settings.concrete.shotcrete ? DAGG_SHOTCRETE_MAX_MM : DAGG_MAX_MM,
  );

  function mutate(fn: (s: ProjectCodeSettings) => void): void {
    const next: ProjectCodeSettings = JSON.parse(JSON.stringify(settings));
    fn(next);
    modelStore.model.codeSettings = next;
  }

  function changeEdition(which: 'concreteEdition' | 'loadEdition' | 'windEdition', to: RegulationEdition) {
    const from = settings[which];
    if (from === to) return;
    mutate((s) => { s[which] = to; });
    const notice = editionChangeNotice(from, to);
    if (notice) {
      editionWarning = tp(notice.key, notice.params);
      // Stored verification results were produced under the previous edition and are
      // no longer comparable. Marking them stale is the honest state, not a courtesy.
      if (which === 'concreteEdition') verificationStore.invalidateForCodeChange();
    }
  }

  function setAggregate(raw: string) {
    aggregateError = null;
    const trimmed = raw.trim();
    if (trimmed === '') {
      mutate((s) => { s.concrete.maxAggregateSizeMm = null; });
      return;
    }
    const v = Number(trimmed.replace(',', '.'));
    if (!Number.isFinite(v) || v < DAGG_MIN_MM || v > effectiveMax) {
      aggregateError = tp('codes.aggregateInvalid', { min: DAGG_MIN_MM, max: effectiveMax });
      return;
    }
    mutate((s) => { s.concrete.maxAggregateSizeMm = v; });
  }
</script>

<section class="code-settings" aria-labelledby="code-settings-title">
  <h3 id="code-settings-title">{t('codes.title')}</h3>
  <p class="subtitle">{t('codes.subtitle')}</p>

  {#if editionWarning}
    <p class="notice warning" role="alert" data-testid="edition-warning">{editionWarning}</p>
  {/if}

  <div class="grid">
    <label for="cs-jurisdiction">{t('codes.jurisdiction')}</label>
    <input
      id="cs-jurisdiction" type="text" value={settings.jurisdiction.name}
      placeholder={t('codes.jurisdictionPlaceholder')}
      oninput={(e) => mutate((s) => { s.jurisdiction.name = e.currentTarget.value; })}
    />

    <label for="cs-basis">{t('codes.adoptionBasis')}</label>
    <div>
      <select
        id="cs-basis" value={settings.jurisdiction.basis}
        aria-describedby="cs-basis-help"
        onchange={(e) => mutate((s) => { s.jurisdiction.basis = e.currentTarget.value as AdoptionBasis; })}
      >
        {#each BASES as b (b)}
          <option value={b}>{t(`codes.basis.${b}`)}</option>
        {/each}
      </select>
      <p id="cs-basis-help" class="help">{t('codes.basisHelp')}</p>
    </div>

    <label for="cs-concrete-edition">{t('codes.concreteEdition')}</label>
    <div>
      <select
        id="cs-concrete-edition" value={settings.concreteEdition}
        data-testid="concrete-edition"
        onchange={(e) => changeEdition('concreteEdition', e.currentTarget.value as RegulationEdition)}
      >
        {#each EDITIONS as ed (ed)}
          <option value={ed}>{t(`codes.edition.${ed}`)}</option>
        {/each}
      </select>
      <p class="help">
        {#if concreteInfo?.inForce}
          {tp('codes.inForceSince', {
            date: concreteInfo.inForce.effectiveFrom,
            instrument: concreteInfo.inForce.instrument,
          })}
        {:else}
          {t('codes.noLegalClaim')}
        {/if}
      </p>
    </div>

    <label for="cs-load-edition">{t('codes.loadEdition')}</label>
    <select
      id="cs-load-edition" value={settings.loadEdition}
      onchange={(e) => changeEdition('loadEdition', e.currentTarget.value as RegulationEdition)}
    >
      {#each EDITIONS as ed (ed)}<option value={ed}>{t(`codes.edition.${ed}`)}</option>{/each}
    </select>

    <label for="cs-wind-edition">{t('codes.windEdition')}</label>
    <select
      id="cs-wind-edition" value={settings.windEdition}
      onchange={(e) => changeEdition('windEdition', e.currentTarget.value as RegulationEdition)}
    >
      {#each EDITIONS as ed (ed)}<option value={ed}>{t(`codes.edition.${ed}`)}</option>{/each}
    </select>

    <label for="cs-aggregate">{t('codes.aggregate')}</label>
    <div>
      <span class="field-row">
        <input
          id="cs-aggregate" type="text" inputmode="decimal"
          data-testid="max-aggregate"
          value={settings.concrete.maxAggregateSizeMm ?? ''}
          placeholder={t('codes.aggregateNotStated')}
          aria-describedby="cs-aggregate-help"
          aria-invalid={aggregateError !== null}
          onchange={(e) => setAggregate(e.currentTarget.value)}
        />
        <span class="unit">{t('codes.aggregateUnit')}</span>
      </span>
      {#if aggregateError}
        <p class="notice error" role="alert">{aggregateError}</p>
      {/if}
      {#if aggregateAssumed}
        <p class="notice warning" data-testid="aggregate-assumed">
          {tp('codes.aggregateAssumedWarning', { mm: DAGG_ASSUMED_MM })}
        </p>
      {/if}
      <p id="cs-aggregate-help" class="help">{t('codes.aggregateHelp')}</p>
    </div>

    <label for="cs-shotcrete">{t('codes.shotcrete')}</label>
    <div>
      <input
        id="cs-shotcrete" type="checkbox" checked={settings.concrete.shotcrete}
        aria-describedby="cs-shotcrete-help"
        onchange={(e) => mutate((s) => { s.concrete.shotcrete = e.currentTarget.checked; })}
      />
      <p id="cs-shotcrete-help" class="help">{t('codes.shotcreteHelp')}</p>
    </div>
  </div>
</section>

<style>
  .code-settings { padding: 0.75rem 1rem; font-size: 0.85rem; }
  h3 { margin: 0 0 0.15rem; font-size: 0.95rem; }
  .subtitle { margin: 0 0 0.75rem; opacity: 0.75; }
  .grid {
    display: grid;
    grid-template-columns: minmax(10rem, 18rem) 1fr;
    gap: 0.6rem 1rem;
    align-items: start;
  }
  .grid > label { padding-top: 0.3rem; font-weight: 500; }
  input[type='text'], select { width: 100%; max-width: 26rem; padding: 0.3rem 0.4rem; }
  .field-row { display: inline-flex; align-items: center; gap: 0.4rem; }
  .field-row input { max-width: 8rem; }
  .unit { opacity: 0.7; }
  .help { margin: 0.25rem 0 0; font-size: 0.78rem; opacity: 0.7; line-height: 1.35; }
  .notice { margin: 0.35rem 0 0; padding: 0.4rem 0.55rem; border-radius: 4px; line-height: 1.35; }
  /* Assumed and stale states are never green — see the capability model. */
  .notice.warning { background: #7a5b00; color: #fff6dd; }
  .notice.error { background: #7a1f1f; color: #ffe3e3; }
  @media (max-width: 720px) {
    .grid { grid-template-columns: 1fr; gap: 0.3rem; }
    .grid > label { padding-top: 0.5rem; }
  }
</style>
