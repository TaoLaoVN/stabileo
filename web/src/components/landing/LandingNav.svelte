<script lang="ts">
  import { tPublic as t, publicI18n, PUBLIC_LOCALES } from '../../lib/i18n/store.svelte';
  import { MAHUNG_HOME_URL, enterApp, scrollToId, switchPublicLocale } from './landing-utils';

  let open = $state(false);

  const LOCALE_NAMES: Record<string, string> = { en: 'English', es: 'Español', pt: 'Português', vi: 'Tiếng Việt' };

  const links = [
    { id: 'basic', key: 'landing.navBasic' },
    { id: 'codes', key: 'landing.navCodes' },
    { id: 'status', key: 'landing.navStatus' },
  ];

  function go(id: string) {
    open = false;
    scrollToId(id);
  }
</script>

<nav class="nav" aria-label={t('landing.navPrimary')}>
  <div class="nav-inner">
    <button class="nav-brand" onclick={() => go('top')} aria-label={t('landing.navBackToTop')}>
      <span class="nav-logo" aria-hidden="true">M</span>
      <span class="nav-brand-copy">
        <span class="nav-name">Mahung Structural Lab</span>
        <span class="nav-owner">{t('landing.ownerLine')}</span>
      </span>
    </button>

    <div class="nav-links" id="nav-links" class:open>
      {#each links as l}
        <button onclick={() => go(l.id)}>{t(l.key)}</button>
      {/each}
    </div>

    <div class="nav-actions">
      <a class="nav-mahung" href={MAHUNG_HOME_URL}>Mahung.Space <span aria-hidden="true">↗</span></a>

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

      <button class="btn btn-primary btn-sm" onclick={() => enterApp()}>{t('landing.navOpenEditor')}</button>

      <button
        class="nav-toggle"
        aria-expanded={open}
        aria-controls="nav-links"
        aria-label={t('landing.navMenuOpen')}
        onclick={() => (open = !open)}
      >
        <span aria-hidden="true"></span>
        <span aria-hidden="true"></span>
      </button>
    </div>
  </div>
</nav>
