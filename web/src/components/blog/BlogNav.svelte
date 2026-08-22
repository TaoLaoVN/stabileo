<script lang="ts">
  /**
   * The blog's header.
   *
   * Deliberately not LandingNav: that one navigates by scrolling to sections
   * that only exist on the landing, so reusing it here would give the reader a
   * row of links that do nothing. What carries over is the visual system —
   * every class below is a landing class.
   */
  import { tPublic as t, publicI18n, PUBLIC_LOCALES } from '../../lib/i18n/store.svelte';
  import { REPO_URL, enterApp, switchPublicLocale } from '../landing/landing-utils';
  import PublicLink from '../landing/PublicLink.svelte';

  const LOCALE_NAMES: Record<string, string> = { en: 'English', es: 'Español', pt: 'Português' };
</script>

<nav class="nav" aria-label={t('landing.navPrimary')}>
  <div class="wrap nav-inner">
    <PublicLink to="/" class="nav-brand" title={t('blog.backHome')}>
      <span class="nav-logo" aria-hidden="true">S</span>
      <span class="nav-name">Stabileo</span>
    </PublicLink>

    <!--
      No section links here. The landing's nav scrolls to sections of the
      landing, and on the blog the only one that survived was "Blog", which
      pointed at the page the reader was already on. The logo goes home; that
      is the whole navigation this page needs.
    -->
    <div class="nav-actions">
      <a class="nav-gh" href={REPO_URL} target="_blank" rel="noreferrer" aria-label={t('landing.navGithubRepo')}>
        <span>GitHub</span>
      </a>

      <label class="nav-lang-wrap">
        <span class="sr-only">{t('landing.navLanguage')}</span>
        <select
          class="nav-lang"
          value={publicI18n.locale}
          onchange={(e) => switchPublicLocale((e.currentTarget as HTMLSelectElement).value as (typeof PUBLIC_LOCALES)[number])}
        >
          {#each PUBLIC_LOCALES as code}
            <option value={code}>{LOCALE_NAMES[code]}</option>
          {/each}
        </select>
      </label>

      <button class="btn btn-primary btn-sm" onclick={() => enterApp()}>{t('blog.openEditor')}</button>
    </div>
  </div>
</nav>
