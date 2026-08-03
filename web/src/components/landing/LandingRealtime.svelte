<script lang="ts">
  import { tPublic as t } from '../../lib/i18n/store.svelte';
  import Eyebrow from './Eyebrow.svelte';
  import TrussFigure from './TrussFigure.svelte';

  type Props = { prefersReducedMotion?: boolean };
  let { prefersReducedMotion = false }: Props = $props();

  /** Load at the first, middle and fifth panel point — B1, B3, B5. */
  const STATES = [
    { at: 1 / 6, key: 'landing.rtStateLeft' },
    { at: 3 / 6, key: 'landing.rtStateCentre' },
    { at: 5 / 6, key: 'landing.rtStateRight' },
  ];
</script>

<section class="sec sec--ink realtime reveal" data-section="realtime" id="realtime" aria-labelledby="realtime-title">
  <div class="wrap rt-grid">
    <div>
      <Eyebrow n="04" label={t('landing.ebRealtime')} />
      <h2 id="realtime-title" class="display">{t('landing.rtH')}</h2>
      <p class="lead">{t('landing.rtP')}</p>
      <ul class="tick-list">
        <li>{t('landing.rtPoint1')}</li>
        <li>{t('landing.rtPoint2')}</li>
        <li>{t('landing.rtPoint3')}</li>
      </ul>
    </div>
    <!--
      Deliberately NOT the hero animation again. Three frames from the same
      solved dataset, at the three panel points the hero sweeps through, so the
      visitor can compare what actually changes instead of watching it move.
    -->
    <div class="rt-figure">
      <p class="kicker">{t('landing.rtCompareTitle')}</p>
      <div class="rt-states">
        {#each STATES as st}
          <TrussFigure mode="still" position={st.at} compact captionKey={st.key} {prefersReducedMotion} />
        {/each}
      </div>
      <p class="rt-compare-hint">{t('landing.rtCompareHint')}</p>
    </div>
  </div>
</section>
