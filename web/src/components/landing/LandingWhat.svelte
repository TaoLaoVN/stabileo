<script lang="ts">
  import { tPublic as t } from '../../lib/i18n/store.svelte';
  import Eyebrow from './Eyebrow.svelte';

  const cards = [
    { k: 'landing.whatK1', title: 'landing.whatT1', body: 'landing.whatB1' },
    { k: 'landing.whatK2', title: 'landing.whatT2', body: 'landing.whatB2' },
    { k: 'landing.whatK3', title: 'landing.whatT3', body: 'landing.whatB3' },
  ];
</script>

<section class="sec sec--paper what reveal" data-section="what" id="what" aria-labelledby="what-title">
  <div class="wrap">
    <Eyebrow n="03" label={t('landing.ebWhat')} />
    <h2 id="what-title" class="display">{t('landing.whatH')}</h2>

    <div class="card-row cols-3">
      {#each cards as c}
        <article class="card">
          <p class="kicker">{t(c.k)}</p>
          <h3>{t(c.title)}</h3>
          <p>{t(c.body)}</p>
        </article>
      {/each}
    </div>
  </div>
</section>
