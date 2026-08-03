<script lang="ts">
  import { tPublic as t } from '../../lib/i18n/store.svelte';
  import Eyebrow from './Eyebrow.svelte';

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
    <Eyebrow n="08" label={t('landing.ebCodes')} />
    <h2 id="codes-title" class="display">{t('landing.codesH')}</h2>

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
