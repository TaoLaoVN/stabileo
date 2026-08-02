<script lang="ts">
  import { t } from '../../lib/i18n';
  import { enterApp } from './landing-utils';

  type Example = { key: string; path: string };

  const examples: Example[] = [
    { key: 'landing.demoExCantilever', path: '/app/basic?embed&example=cantilever' },
    { key: 'landing.demoExPortal', path: '/app/basic?embed&example=portal-frame' },
    { key: 'landing.demoExTruss', path: '/app/basic?embed&example=truss' },
    { key: 'landing.demoEx3D', path: '/app/basic?embed&example=3d-portal-frame' },
  ];

  let active = $state(0);
  let iframeLoaded = $state(false);
  let iframeEl: HTMLIFrameElement | undefined;
  let tabEls: (HTMLButtonElement | undefined)[] = $state([]);

  function pickExample(i: number) {
    if (i === active) return;
    active = i;
    iframeLoaded = false;
  }

  /**
   * Roving-tabindex keyboard support for the example tablist (ARIA APG "Tabs
   * with Manual Activation" minus the manual part — activation follows focus,
   * which is what a click already does here).
   */
  function onTabKeydown(e: KeyboardEvent, i: number) {
    const last = examples.length - 1;
    let next: number | null = null;
    if (e.key === 'ArrowRight') next = i === last ? 0 : i + 1;
    else if (e.key === 'ArrowLeft') next = i === 0 ? last : i - 1;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = last;
    if (next === null) return;
    e.preventDefault();
    pickExample(next);
    tabEls[next]?.focus();
  }
</script>

<section class="demo-section reveal" id="demo" aria-labelledby="demo-title">
  <div class="section-inner">
    <div class="demo-panel">
      <div class="demo-copy">
        <span class="tag">{t('landing.interactiveDemo')}</span>
        <h2 id="demo-title">{t('landing.demoCardTitle')}</h2>
        <p>{t('landing.demoCardDesc')}</p>
        <ul>
          <li>{t('landing.demoPoint1')}</li>
          <li>{t('landing.demoPoint2')}</li>
          <li>{t('landing.demoPoint3')}</li>
        </ul>
        <div class="demo-actions">
          <button class="btn-primary" onclick={() => enterApp()}>{t('landing.launchEditor')}</button>
          <a class="btn-link" href="/demo">{t('landing.tryTour')}</a>
        </div>
      </div>
      <div class="demo-viewport">
        <div
          class="demo-browser"
          id="demo-panel"
          role="tabpanel"
          aria-labelledby="demo-tab-{active}"
        >
          <div class="demo-skeleton" class:ready={iframeLoaded} aria-live="polite">
            {t('landing.demoLoading')}
          </div>
          <iframe
            bind:this={iframeEl}
            src={examples[active].path}
            title="Stabileo live demo"
            class="demo-iframe"
            loading="lazy"
            onload={() => (iframeLoaded = true)}
          ></iframe>
        </div>
        <div class="demo-examples" role="tablist" aria-label={t('landing.demoExamplesLabel')}>
          <!--
            The visible label duplicates the tablist's aria-label, and a <span>
            is not a valid tablist child, so it is hidden from the a11y tree
            rather than announced twice.
          -->
          <span class="demo-examples-label" aria-hidden="true">{t('landing.demoExamplesLabel')}</span>
          {#each examples as ex, i}
            <button
              bind:this={tabEls[i]}
              class="demo-chip"
              class:active={i === active}
              id="demo-tab-{i}"
              role="tab"
              aria-selected={i === active}
              aria-controls="demo-panel"
              tabindex={i === active ? 0 : -1}
              onclick={() => pickExample(i)}
              onkeydown={(e) => onTabKeydown(e, i)}
            >
              {t(ex.key)}
            </button>
          {/each}
        </div>
      </div>
    </div>
  </div>
</section>
