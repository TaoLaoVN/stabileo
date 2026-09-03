<script lang="ts">
  import { tPublic as t } from '../../lib/i18n/store.svelte';
  import { REPO_URL, ORIGINAL_REPO_URL, MAHUNG_HOME_URL, MAHUNG_TOOLS_URL, enterApp } from './landing-utils';

  const year = new Date().getFullYear();
</script>

<footer class="sec sec--ink lp-footer">
  <div class="wrap footer-grid">
    <div class="footer-brand">
      <span class="nav-logo" aria-hidden="true">M</span>
      <div>
        <p class="footer-name">Mahung Structural Lab</p>
        <p class="footer-tagline">{t('landing.footTagline')}</p>
      </div>
    </div>

    <nav class="footer-links" aria-label={t('landing.footNav')}>
      <a href={MAHUNG_HOME_URL}>{t('landing.footHome')}</a>
      <a href={MAHUNG_TOOLS_URL}>{t('landing.footTools')}</a>
      <a href={REPO_URL} target="_blank" rel="noreferrer">{t('landing.footRepo')}</a>
      <button onclick={() => enterApp()}>{t('landing.footLaunch')}</button>
    </nav>
  </div>

  <div class="wrap footer-legal">
    <p>&copy; {year} Mahung.Space. {t('landing.footRights')}</p>
    <p>
      {t('landing.legalBasedOn')} <a href={ORIGINAL_REPO_URL} target="_blank" rel="noreferrer">Stabileo của LambdaClass</a>.
      {t('landing.legalModified')} <a href={REPO_URL} target="_blank" rel="noreferrer">TaoLaoVN/stabileo</a>.
      {t('landing.legalLicense')}
    </p>
  </div>
</footer>

<div class="mobile-sticky">
  <button class="btn btn-primary" onclick={() => enterApp()}>{t('landing.navOpenEditor')}</button>
</div>
