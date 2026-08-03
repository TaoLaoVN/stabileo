<script lang="ts">
  import { onMount } from 'svelte';
  import { tPublic as t } from '../lib/i18n/store.svelte';
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
  <title>Stabileo — {t('landing.heroH')}</title>
  <meta name="description" content={t('landing.heroP')} />
  <meta name="theme-color" content="#0c1620" />
  <meta property="og:type" content="website" />
  <meta property="og:title" content="Stabileo — {t('landing.heroH')}" />
  <meta property="og:description" content={t('landing.heroP')} />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="Stabileo — {t('landing.heroH')}" />
  <meta name="twitter:description" content={t('landing.heroP')} />
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
