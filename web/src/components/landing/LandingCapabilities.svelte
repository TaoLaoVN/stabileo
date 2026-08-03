<script lang="ts">
  import { tPublic as t } from '../../lib/i18n/store.svelte';
  import Eyebrow from './Eyebrow.svelte';
  import Shot from './Shot.svelte';

  const columns = [
    { head: 'landing.capColLinear', items: ['capLin1','capLin2','capLin3','capLin4','capLin5','capLin6','capLin7','capLin8'] },
    { head: 'landing.capColNonlinear', items: ['capNl1','capNl2','capNl3','capNl4','capNl5','capNl6'] },
    { head: 'landing.capColElements', items: ['capEl1','capEl2','capEl3','capEl4','capEl5'] },
    { head: 'landing.capColTime', items: ['capTd1','capTd2','capTd3','capTd4'] },
  ];

  /**
   * Only shipped Basic-mode views. Every file here has a producer in
   * scripts/take-screenshots.ts, and every producer there is consumed here.
   */
  const shots = [
    { base: '2d-moments', alt: 'landing.capAlt2d', title: 'landing.capShot2dTitle', body: 'landing.capShot2dBody' },
    { base: '3d-industrial', alt: 'landing.capAlt3d', title: 'landing.capShot3dTitle', body: 'landing.capShot3dBody' },
    { base: '2d-section-analysis', alt: 'landing.capAltStress2d', title: 'landing.capShotStress2dTitle', body: 'landing.capShotStress2dBody' },
    { base: '3d-section-analysis', alt: 'landing.capAltStress3d', title: 'landing.capShotStress3dTitle', body: 'landing.capShotStress3dBody' },
  ];
</script>

<section class="sec sec--paper caps reveal" data-section="capabilities" id="capabilities" aria-labelledby="capabilities-title">
  <div class="wrap">
    <Eyebrow n="06" label={t('landing.ebCapabilities')} />
    <h2 id="capabilities-title" class="display">{t('landing.capH')}</h2>
    <p class="lead">{t('landing.capP')}</p>

    <div class="cap-matrix">
      {#each columns as col}
        <div class="cap-col">
          <p class="kicker">{t(col.head)}</p>
          <ul>
            {#each col.items as key}
              <li>{t('landing.' + key)}</li>
            {/each}
          </ul>
        </div>
      {/each}
    </div>

    <div class="card-row cols-2 cap-shots">
      {#each shots as sh}
        <article class="card card-media">
          <Shot base={sh.base} alt={t(sh.alt)} />
          <div class="card-body">
            <h3>{t(sh.title)}</h3>
            <p>{t(sh.body)}</p>
          </div>
        </article>
      {/each}
    </div>

  </div>
</section>
