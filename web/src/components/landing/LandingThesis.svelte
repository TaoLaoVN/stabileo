<script lang="ts">
  import { tPublic as t } from '../../lib/i18n/store.svelte';
  import Eyebrow from './Eyebrow.svelte';

  const analogies = [
    { k: 'landing.thAn1K', body: 'landing.thAn1' },
    { k: 'landing.thAn2K', body: 'landing.thAn2' },
    { k: 'landing.thAn3K', body: 'landing.thAn3' },
  ];
</script>

<section class="sec sec--ink thesis reveal" data-section="thesis" id="thesis" aria-labelledby="thesis-title">
  <div class="wrap">
    <Eyebrow n="09" label={t('landing.ebThesis')} />
    <h2 id="thesis-title" class="display">
      {t('landing.thH1')} <em>{t('landing.thH2')}</em>
    </h2>
    <p class="lead lead-wide">{t('landing.thP')}</p>

    <div class="gv">
      <article class="gv-side">
        <p class="kicker kicker-blue">{t('landing.thGenK')}</p>
        <h3>{t('landing.thGenT')}</h3>
        <p>{t('landing.thGenB')}</p>
      </article>
      <p class="gv-arrow" aria-hidden="true">→</p>
      <article class="gv-side">
        <p class="kicker kicker-accent">{t('landing.thVerK')}</p>
        <h3>{t('landing.thVerT')}</h3>
        <p>{t('landing.thVerB')}</p>
      </article>
    </div>

    <div class="analogies">
      {#each analogies as a}
        <div class="analogy">
          <p class="kicker">{t(a.k)}</p>
          <p>{t(a.body)}</p>
        </div>
      {/each}
    </div>

    <p class="thesis-close">{t('landing.thClose')}</p>
  </div>
</section>
