<script lang="ts">
  import { tPublic as t } from '../../lib/i18n/store.svelte';
  import Eyebrow from './Eyebrow.svelte';

  /**
   * CIRSOC leads this section because Stabileo is Argentine and this is the
   * framework its audience is actually held to.
   *
   * Every status below was read out of the repository, not estimated:
   *
   *   101  ROLE_CATALOG marks both the basis (combinations) and loads adapters
   *        VALIDATED for the 2025 edition. Rain and snow are unsupported —
   *        CIRSOC 104 was never supplied.
   *   102  wind adapter VALIDATED for 2025, but CAPABILITY-INDEX.md lists
   *        flexible buildings, torsional cases 2 and 4, C&C, parapets and
   *        domes as unsupported, so the row is PARTIAL, not "available".
   *   103  the seismic role is IMPLEMENTED_PROVISIONAL and covers only the
   *        effective seismic weight (I §6.2) and the static-method height
   *        distribution (I §6.2.4.1). The coefficient C is an INPUT — see
   *        `SeismicInput.coefficient` in lib/engine/loads/load-plan.ts.
   *        Zoning, spectra and behaviour factors are not derived, and
   *        `seismicDetailing` declares Parte II unimplemented.
   *   201  the 2025 capability matrix gives verify AND generate to beam
   *        flexure/shear, column axial-flexure/biaxial, ties and bar regions.
   *        Torsion, joints, joint shear and non-rectangular sections are gated.
   *        The matrix ALSO gates slabs, walls, foundations and diaphragms — and
   *        for the first three that is stale: the merge wired
   *        `designSlabPanel`/`designWall`/`runFootingDesign` to a real control
   *        (FloorFamiliesPanel.svelte:91), so they are designed today. Their
   *        maturity is IMPLEMENTED_PROVISIONAL, never VALIDATED, because
   *        `deriveMaturity` requires an `external` benchmark and these declare
   *        only handFixture/property/crossCheck evidence. Diaphragms genuinely
   *        have no design implementation. So: PARTIAL, with the strongest
   *        coverage of any code here, and the provisional status stated.
   *   301  a member checker exists (lib/engine/codes/argentina/cirsoc301.ts,
   *        on the AISC 360 LRFD basis), but the steel design role is
   *        UNSUPPORTED with note `textAvailableNotImplemented`.
   */
  const cirsoc = [
    { code: 'CIRSOC 101', ed: '2025', tone: 'today', badge: 'landing.badgeToday', scope: 'landing.cir101Scope', body: 'landing.cir101Body', limit: 'landing.cir101Limit' },
    { code: 'CIRSOC 102', ed: '2025', tone: 'today', badge: 'landing.badgeToday', scope: 'landing.cir102Scope', body: 'landing.cir102Body', limit: 'landing.cir102Limit' },
    { code: 'CIRSOC 201', ed: '2025', tone: 'testing', badge: 'landing.badgeTesting', scope: 'landing.cir201Scope', body: 'landing.cir201Body', limit: 'landing.cir201Limit' },
    { code: 'CIRSOC 301', ed: '2018', tone: 'partial', badge: 'landing.badgePartial', scope: 'landing.cir301Scope', body: 'landing.cir301Body', limit: 'landing.cir301Limit' },
    { code: 'INPRES-CIRSOC 103', ed: 'I 2018 · II 2005', tone: 'dev', badge: 'landing.badgeDev', scope: 'landing.cir103Scope', body: 'landing.cir103Body', limit: 'landing.cir103Limit' },
  ];

  /** Member checking only. None of these has a design or detailing implementation. */
  const codes = [
    { code: 'AISC 360', key: 'landing.codeSteel' },
    { code: 'ACI 318', key: 'landing.codeRc' },
    { code: 'EN 1993-1-1', key: 'landing.codeEcSteel' },
    { code: 'EN 1992-1-1', key: 'landing.codeEcConcrete' },
    { code: 'AISI S100', key: 'landing.codeCfs' },
    { code: 'NDS', key: 'landing.codeTimber' },
    { code: 'TMS 402', key: 'landing.codeMasonry' },
    { code: 'IFC', key: 'landing.codeIfc' },
  ];
</script>

<section class="sec sec--paper codes reveal" data-section="codes" id="codes" aria-labelledby="codes-title">
  <div class="wrap">
    <Eyebrow n="09" label={t('landing.ebCodes')} />
    <h2 id="codes-title" class="display">{t('landing.codesH')}</h2>
    <p class="lead">{t('landing.cirsocP')}</p>

    <ul class="cirsoc-list">
      {#each cirsoc as c}
        <li class="cirsoc-row" data-code={c.code}>
          <div class="cirsoc-id">
            <p class="cirsoc-name">{c.code}</p>
            <p class="cirsoc-ed">{c.ed}</p>
            <span class="badge badge-{c.tone}">{t(c.badge)}</span>
          </div>
          <div class="cirsoc-what">
            <h3>{t(c.scope)}</h3>
            <p>{t(c.body)}</p>
            <p class="cirsoc-limit">{t(c.limit)}</p>
          </div>
        </li>
      {/each}
    </ul>

    <div class="note">
      <p class="kicker">{t('landing.codesDistinctTitle')}</p>
      <p>{t('landing.codesDistinct')}</p>
    </div>

    <p class="kicker codes-intl-kicker">{t('landing.codesIntlTitle')}</p>
    <ul class="code-grid">
      {#each codes as c}
        <li class="code-cell">
          <p class="code-name">{c.code}</p>
          <p class="code-desc">{t(c.key)}</p>
        </li>
      {/each}
    </ul>

    <div class="note">
      <p class="kicker">{t('landing.interopTitle')}</p>
      <p>{t('landing.interopBody')}</p>
      <p>{t('landing.codesNote')}</p>
    </div>
  </div>
</section>
