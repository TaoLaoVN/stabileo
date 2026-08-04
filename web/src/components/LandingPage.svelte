<script lang="ts">
  import { onMount } from 'svelte';
  import { tPublic as t, publicI18n } from '../lib/i18n/store.svelte';
  import LandingNav from './landing/LandingNav.svelte';
  import LandingHero from './landing/LandingHero.svelte';
  import LandingProblem from './landing/LandingProblem.svelte';
  import LandingWhat from './landing/LandingWhat.svelte';
  import LandingRealtime from './landing/LandingRealtime.svelte';
  import LandingDemo from './landing/LandingDemo.svelte';
  import LandingCapabilities from './landing/LandingCapabilities.svelte';
  import LandingValidation from './landing/LandingValidation.svelte';
  import LandingCodes from './landing/LandingCodes.svelte';
  import LandingThesis from './landing/LandingThesis.svelte';
  import LandingStatus from './landing/LandingStatus.svelte';
  import LandingDocs from './landing/LandingDocs.svelte';
  import LandingCTA from './landing/LandingCTA.svelte';
  import LandingFooter from './landing/LandingFooter.svelte';
  import { enterApp } from './landing/landing-utils';
  import './landing/landing.css';

  let landingEl: HTMLDivElement;
  let scrollPct = $state(0);
  let prefersReducedMotion = $state(false);

  /**
   * Reactive metadata, applied by mutating the static tags in index.html
   * rather than appending a second set through `svelte:head`.
   *
   * The landing is client-rendered, so index.html holds the English metadata a
   * non-JS crawler sees and this only refines it for a real browser: the
   * Spanish landing gets Spanish title, description and og:locale. The
   * originals are captured once and restored when the landing unmounts, so
   * entering the application never leaves landing copy behind.
   */
  const META_TAGS = [
    ['meta[name="description"]', 'content'],
    ['meta[property="og:title"]', 'content'],
    ['meta[property="og:description"]', 'content'],
    ['meta[property="og:locale"]', 'content'],
    ['meta[property="og:locale:alternate"]', 'content'],
    ['meta[name="twitter:title"]', 'content'],
    ['meta[name="twitter:description"]', 'content'],
  ] as const;

  let originalMeta: { title: string; lang: string; tags: (string | null)[] } | null = null;

  function captureMetadata() {
    if (originalMeta) return;
    originalMeta = {
      title: document.title,
      lang: document.documentElement.lang,
      tags: META_TAGS.map(([sel, attr]) => document.querySelector(sel)?.getAttribute(attr) ?? null),
    };
  }

  function setMeta(selector: string, value: string) {
    document.querySelector(selector)?.setAttribute('content', value);
  }

  function syncMetadata() {
    const locale = publicI18n.locale;
    const title = `Stabileo — ${t('landing.heroH')}`;
    const description = t('landing.heroP');
    document.title = title;
    document.documentElement.lang = locale;
    setMeta('meta[name="description"]', description);
    setMeta('meta[property="og:title"]', title);
    setMeta('meta[property="og:description"]', description);
    setMeta('meta[property="og:locale"]', locale === 'es' ? 'es_AR' : 'en_US');
    setMeta('meta[property="og:locale:alternate"]', locale === 'es' ? 'en_US' : 'es_AR');
    setMeta('meta[name="twitter:title"]', title);
    setMeta('meta[name="twitter:description"]', description);
  }

  function restoreMetadata() {
    if (!originalMeta) return;
    document.title = originalMeta.title;
    document.documentElement.lang = originalMeta.lang;
    META_TAGS.forEach(([sel, attr], i) => {
      const v = originalMeta!.tags[i];
      if (v !== null) document.querySelector(sel)?.setAttribute(attr, v);
    });
  }

  $effect(() => {
    captureMetadata();
    syncMetadata();
    return restoreMetadata;
  });

  onMount(() => {
    const onScroll = () => {
      const el = landingEl;
      if (!el) return;
      const denom = Math.max(1, el.scrollHeight - el.clientHeight);
      scrollPct = (el.scrollTop / denom) * 100;
    };

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) entry.target.classList.add('visible');
        }
      },
      { threshold: 0.08, root: landingEl },
    );

    const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onMotionChange = (e: MediaQueryListEvent) => {
      prefersReducedMotion = e.matches;
    };

    prefersReducedMotion = motionQuery.matches;
    if (motionQuery.addEventListener) motionQuery.addEventListener('change', onMotionChange);
    else motionQuery.addListener(onMotionChange);

    landingEl?.addEventListener('scroll', onScroll, { passive: true });
    onScroll();

    for (const el of landingEl.querySelectorAll('.reveal')) observer.observe(el);

    const onMessage = (e: MessageEvent) => {
      if (e.data === 'stabileo-enter-app') enterApp();
    };
    window.addEventListener('message', onMessage);

    return () => {
      observer.disconnect();
      landingEl?.removeEventListener('scroll', onScroll);
      window.removeEventListener('message', onMessage);
      if (motionQuery.removeEventListener) motionQuery.removeEventListener('change', onMotionChange);
      else motionQuery.removeListener(onMotionChange);
    };
  });
</script>

<svelte:head>
  <!--
    No title/description/OG/Twitter tags here on purpose. `svelte:head` APPENDS
    to the document, and index.html already carries a full static set for
    crawlers that never run this code — emitting them again produced five
    <title> elements and eight duplicated metas whose English values
    contradicted each other. The reactive metadata is applied by rewriting the
    static tags in place (see `syncMetadata` in the script above), which keeps
    exactly one of each and lets the Spanish landing correct them.
  -->
  <!--
    Fonts are self-hosted from /fonts (see landing.css). The landing no longer
    contacts fonts.googleapis.com or fonts.gstatic.com. Only the four faces the
    first screen needs are preloaded; the rest arrive with the stylesheet.
  -->
  <link rel="preload" as="font" type="font/woff2" href="/fonts/space-grotesk-700.woff2" crossorigin="anonymous" />
  <link rel="preload" as="font" type="font/woff2" href="/fonts/ibm-plex-sans-400.woff2" crossorigin="anonymous" />
  <link rel="preload" as="font" type="font/woff2" href="/fonts/ibm-plex-mono-500.woff2" crossorigin="anonymous" />
</svelte:head>

<!--
  `.landing` is the scroll container (position: fixed; overflow-y: auto), not the
  document, so without a tabindex a keyboard-only user cannot scroll the page
  until they Tab onto something inside it. WCAG 2.1.1 / axe
  `scrollable-region-focusable`.
-->
<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<div class="landing" bind:this={landingEl} tabindex="0">
  <div class="scroll-progress" style="width:{scrollPct}%" aria-hidden="true"></div>

  <LandingNav />
  <LandingHero {prefersReducedMotion} />
  <LandingProblem />
  <LandingWhat />
  <LandingRealtime {prefersReducedMotion} />
  <LandingDemo />
  <LandingCapabilities />
  <LandingValidation />
  <LandingCodes />
  <LandingThesis />
  <LandingStatus />
  <LandingDocs />
  <LandingCTA />
  <LandingFooter />
</div>
