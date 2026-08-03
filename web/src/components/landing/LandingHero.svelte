<script lang="ts">
  import { tPublic as t } from '../../lib/i18n/store.svelte';
  import { enterApp, scrollToId } from './landing-utils';
  import Eyebrow from './Eyebrow.svelte';
  import TrussFigure from './TrussFigure.svelte';

  type Props = { prefersReducedMotion?: boolean };
  let { prefersReducedMotion = false }: Props = $props();
</script>

<section class="sec sec--ink hero" data-section="hero" id="top" aria-labelledby="hero-title">
  <div class="wrap hero-grid">
    <div class="hero-copy">
      <Eyebrow n="01" label={t('landing.ebHero')} />
      <h1 id="hero-title">{t('landing.heroH')}</h1>
      <p class="lead">{t('landing.heroP')}</p>

      <div class="hero-ctas">
        <button class="btn btn-primary btn-lg" onclick={() => enterApp()}>{t('landing.heroCtaPrimary')}</button>
        <button class="btn btn-ghost btn-lg" onclick={() => scrollToId('demo')}>{t('landing.heroCtaSecondary')}</button>
      </div>

      <dl class="hero-meta">
        <div><dt>{t('landing.heroMetaA')}</dt></div>
        <div><dt>{t('landing.heroMetaB')}</dt></div>
        <div><dt>{t('landing.heroMetaC')}</dt></div>
      </dl>
    </div>

    <div class="hero-figure">
      <TrussFigure mode="animate" {prefersReducedMotion} />
    </div>
  </div>
</section>
