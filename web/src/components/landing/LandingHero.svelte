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

      <!--
        The three modes, named in the first screen.
        The hero used to lead on live re-solving, which is a real
        differentiator but answers "how does it feel?" before the visitor knows
        what the product is or which parts of it exist. Re-solving now appears
        as its own section further down; positioning belongs here.
      -->
      <ul class="hero-modes">
        <li><span class="hero-mode-name">{t('landing.heroModeBasic')}</span><span class="hero-mode-st hero-mode-st-today">{t('landing.heroModeBasicSt')}</span></li>
        <li><span class="hero-mode-name">{t('landing.heroModeEdu')}</span><span class="hero-mode-st">{t('landing.heroModeEduSt')}</span></li>
        <li><span class="hero-mode-name">{t('landing.heroModePro')}</span><span class="hero-mode-st">{t('landing.heroModeProSt')}</span></li>
      </ul>

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
