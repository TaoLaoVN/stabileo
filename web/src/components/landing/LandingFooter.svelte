<script lang="ts">
  import { tPublic as t } from '../../lib/i18n/store.svelte';
  import { REPO_URL, ORIGINAL_REPO_URL, DOCS_HUB_URL, enterApp } from './landing-utils';
  import PublicLink from './PublicLink.svelte';

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
      <a href={DOCS_HUB_URL} target="_blank" rel="noreferrer">{t('landing.footDocs')}</a>
      <a href={REPO_URL} target="_blank" rel="noreferrer">{t('landing.footRepo')}</a>
      <PublicLink to="/blog">{t('landing.footBlog')}</PublicLink>
      <button onclick={() => enterApp()}>{t('landing.footLaunch')}</button>
    </nav>
  </div>

  <div class="wrap footer-legal">
    <p>&copy; {year} Mahung.Space. {t('landing.footRights')}</p>
    <p>
      Based on <a href={ORIGINAL_REPO_URL} target="_blank" rel="noreferrer">Stabileo by LambdaClass</a>.
      Modified source available at <a href={REPO_URL} target="_blank" rel="noreferrer">TaoLaoVN/stabileo</a>.
      Licensed under AGPL-3.0.
    </p>
  </div>
</footer>

<div class="mobile-sticky">
  <button class="btn btn-primary" onclick={() => enterApp()}>{t('landing.navOpenEditor')}</button>
</div>
