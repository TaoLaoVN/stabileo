<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { tPublic as t } from '../../lib/i18n/store.svelte';
  import { DEMO_EXAMPLES, demoEmbedUrl, editorExampleUrl } from './landing-utils';
  import Eyebrow from './Eyebrow.svelte';
  import Shot from './Shot.svelte';

  /**
   * The embedded editor, behind an explicit activation lock.
   *
   * WHY THE LOCK: an iframe is hit-testable as soon as the pointer is over it,
   * so a visitor scrolling the page with the cursor across the demo had their
   * wheel delivered to the embedded application, which read it as camera zoom.
   * Measured before the fix: at 768, 1024 and 1440 px the landing's scrollTop
   * did not move at all. A parent document cannot forward wheel events into or
   * out of a separate browsing context, so the fix is a real state rather than
   * event plumbing.
   *
   * LIFECYCLE: the iframe does not exist until the visitor presses the CTA. No
   * intersection observer, no prewarm, no second application instance on a page
   * nobody asked to interact with. Once mounted it STAYS mounted across exit —
   * see `deactivate` for why — but locked: `inert`, out of the tab order and
   * `pointer-events: none`, so the page behaves as if it were an image again.
   */

  type Phase = 'idle' | 'loading' | 'ready' | 'failed';

  let phase = $state<Phase>('idle');
  let active = $state(false);
  let index = $state(0);
  /** Bumped to force a clean remount: new element, new listeners, new timers. */
  let generation = $state(0);

  let sectionEl: HTMLElement | undefined;
  let frameEl: HTMLIFrameElement | undefined;
  let ctaEl: HTMLButtonElement | undefined;
  let tabEls: (HTMLButtonElement | undefined)[] = $state([]);
  let loadTimer: ReturnType<typeof setTimeout> | null = null;
  let frameDocCleanup: (() => void) | null = null;
  let panelTimer: ReturnType<typeof setTimeout> | null = null;

  const LOAD_TIMEOUT_MS = 8000;
  const mounted = $derived(phase !== 'idle');

  onMount(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && active) deactivate();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      clearTimers();
      frameDocCleanup?.();
    };
  });

  function clearTimers() {
    if (loadTimer) { clearTimeout(loadTimer); loadTimer = null; }
    if (panelTimer) { clearTimeout(panelTimer); panelTimer = null; }
  }

  /** Scroll container of the landing overlay — the thing that must not jump. */
  const scroller = () => sectionEl?.closest('.landing') as HTMLElement | null;

  /**
   * Every state transition below changes what is rendered inside a fixed-height
   * device, so in principle nothing can move. This pins it anyway: the one
   * thing a visitor will not forgive is the page jumping under them.
   */
  async function keepingScroll(fn: () => void) {
    const el = scroller();
    const top = el?.scrollTop ?? 0;
    fn();
    await tick();
    if (el && el.scrollTop !== top) el.scrollTop = top;
  }

  /** Start (or restart) the frame for the current example. */
  function loadFrame() {
    clearTimers();
    frameDocCleanup?.();
    frameDocCleanup = null;
    phase = 'loading';
    generation += 1;
    loadTimer = setTimeout(() => {
      if (phase === 'loading') phase = 'failed';
    }, LOAD_TIMEOUT_MS);
  }

  async function activate() {
    if (active) return;
    await keepingScroll(() => {
      active = true;
      if (phase === 'idle' || phase === 'failed') loadFrame();
    });
    await tick();
    /*
     * `preventScroll`, or focusing the frame undoes the scroll preservation
     * immediately above it.
     *
     * The frame is taller than most viewports, so when activation happens with
     * part of it off-screen the default focus() scrolls it into view — a 120 to
     * 1000 px jump under the visitor, depending on where the section sat. That
     * was latent for as long as the demo happened to be fully visible at the
     * moment of the click, and a content change that moved the section down was
     * enough to expose it. The focus itself is required: the frame must hold the
     * keyboard as well as the wheel once the lock is released.
     */
    if (phase === 'ready') frameEl?.focus({ preventScroll: true });
  }

  /**
   * Exit keeps the frame mounted and locks it rather than unmounting.
   *
   * Unmounting would free a whole application instance, but exiting to read the
   * page and coming back is the common pattern here, and paying a ~1.5 s reload
   * every time punishes exactly the visitors who engaged. The locked frame is
   * `inert` with `pointer-events: none`, so it costs nothing in behaviour — only
   * memory, and only for someone who already chose to use the demo. Swapping to
   * unmount-on-exit is a one-line change (`phase = 'idle'` here).
   */
  async function deactivate() {
    if (!active) return;
    await keepingScroll(() => { active = false; });
    // Same reason as activation: return focus without moving the page.
    ctaEl?.focus({ preventScroll: true });
  }

  /** Reload the current example from scratch, staying interactive. */
  function reset() {
    keepingScroll(() => loadFrame());
  }

  /** Same as reset, but from the failure state. */
  function retry() {
    keepingScroll(() => loadFrame());
  }

  function pick(i: number) {
    if (i === index) return;
    keepingScroll(() => {
      index = i;
      // Locked: just change the selection. Nothing is mounted, and choosing an
      // example is not consent to boot a second copy of the application.
      if (mounted) loadFrame();
    });
  }

  function onFrameLoad() {
    if (loadTimer) { clearTimeout(loadTimer); loadTimer = null; }
    phase = 'ready';
    wireFrameDocument();
  }

  /**
   * TEMPORARY COUPLING — tracked as debt, see the report.
   *
   * Two tidy-ups inside the embedded document. The frame is same-origin, so
   * this is ordinary runtime DOM work from the host page: no application source
   * is modified. Both are guarded so a change inside the app can only make this
   * a no-op, never an error.
   *
   *  1. Escape pressed while focus is inside the frame must reach us; key
   *     events do not cross the document boundary on their own.
   *  2. The mobile layout opens with the RESULTS panel expanded, covering about
   *     a third of the embed and hiding the model. We close it the way a
   *     visitor would.
   *
   * The right fix for (2) is an embed-aware default panel state in the
   * application, or a postMessage handshake. Both are application-owned.
   */
  function wireFrameDocument() {
    frameDocCleanup?.();
    frameDocCleanup = null;
    let doc: Document | null = null;
    try {
      doc = frameEl?.contentDocument ?? null;
    } catch {
      return; // cross-origin some day: give up quietly
    }
    if (!doc) return;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && active) deactivate();
    };
    doc.addEventListener('keydown', onKey, true);
    frameDocCleanup = () => doc?.removeEventListener('keydown', onKey, true);

    const closeResultsPanel = () => {
      try {
        for (const sel of ['.mrp-panel .mrp-close', '.mrp-panel button[aria-label*="lose"]', '.mrp-panel .close']) {
          const btn = doc!.querySelector(sel) as HTMLElement | null;
          if (btn) { btn.click(); return; }
        }
      } catch { /* the app moved on; an open panel is not fatal */ }
    };
    closeResultsPanel();
    if (panelTimer) clearTimeout(panelTimer);
    panelTimer = setTimeout(closeResultsPanel, 900);
  }

  function onCtaKeydown(e: KeyboardEvent) {
    // Handled explicitly: with the application mounted behind the landing, a
    // focused button was observed receiving an un-prevented Enter keydown
    // without Chromium synthesising the click.
    if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
    e.preventDefault();
    e.stopPropagation();
    activate();
  }

  function onTabKeydown(e: KeyboardEvent, i: number) {
    const last = DEMO_EXAMPLES.length - 1;
    let next: number | null = null;
    if (e.key === 'ArrowRight') next = i === last ? 0 : i + 1;
    else if (e.key === 'ArrowLeft') next = i === 0 ? last : i - 1;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = last;
    if (next === null) return;
    e.preventDefault();
    pick(next);
    // Roving tabindex: move focus between example tabs without scrolling the page.
    tabEls[next]?.focus({ preventScroll: true });
  }

  const statusText = $derived(
    phase === 'loading' ? t('landing.demoStatusLoading')
      : phase === 'failed' ? t('landing.demoStatusFailed')
      : active ? t('landing.demoStatusReady')
      : '',
  );
</script>

<section
  class="sec sec--ink demo reveal"
  data-section="demo"
  id="demo"
  aria-labelledby="demo-title"
  bind:this={sectionEl}
>
  <div class="wrap">
    <Eyebrow n="05" label={t('landing.ebDemo')} />
    <div class="demo-head">
      <div>
        <h2 id="demo-title" class="display">{t('landing.demoH')}</h2>
        <p class="lead">{t('landing.demoP')}</p>
      </div>
      <!--
        Two pills, and the Basic one is not decoration. The embed loads
        /app/basic?embed, so what the visitor touches is Basic mode and nothing
        else. Without saying so, a reader who has just been told PRO does
        finite elements and CIRSOC design will reasonably assume this window is
        that product.
      -->
      <div class="demo-pills">
        <p class="pill pill-basic">{t('landing.demoBasicPill')}</p>
        <p class="pill pill-live">{t('landing.demoInteractive')}</p>
      </div>
    </div>
    <p class="demo-scope">{t('landing.demoScopeNote')}</p>

    <!--
      Two columns on wide viewports. The embed is capped below the
      application's 768 px breakpoint, so on a 1440 px page it used to sit as a
      720 px device marooned inside a 1196 px bordered box — 238 px of empty
      frame on each side, and two nested borders. The device now keeps its
      native size and is the primary object, and the width that used to be
      empty gutter carries the examples, the status line and the controls.
    -->
    <div class="demo-stage">
      <!--
        Capped below the application's own 768 px mobile breakpoint, so the
        embed renders the real mobile interface at every landing width instead
        of a desktop layout squeezed into a letterbox. No user-agent spoofing
        and no new query parameter: the app reads window.innerWidth, and this
        is its window.
      -->
      <div class="demo-device" id="demo-panel" role="tabpanel" aria-labelledby="demo-tab-{index}">
        <!--
          Only while there is no live frame. The embedded document's html and
          body are fully transparent (only .app-container paints), so a poster
          left mounted underneath shows straight through the running editor.
        -->
        {#if phase !== 'ready'}
          <Shot base="2d-moments" alt={t('landing.demoPosterAlt')} sizes="(max-width: 760px) 94vw, 46vw" class="demo-poster-img" />
        {/if}

        {#if mounted && phase !== 'failed'}
          {#key generation}
            <iframe
              bind:this={frameEl}
              src={demoEmbedUrl(DEMO_EXAMPLES[index].id)}
              title="Stabileo live demo"
              class="demo-iframe"
              class:locked={!active}
              loading="lazy"
              tabindex={active ? 0 : -1}
              inert={!active}
              aria-hidden={!active}
              onload={onFrameLoad}
            ></iframe>
          {/key}
        {/if}

        {#if phase === 'loading'}
          <div class="demo-skeleton">{t('landing.demoLoadingNew')}</div>
        {/if}

        {#if phase === 'failed'}
          <div class="demo-fallback">
            <div class="demo-fallback-copy">
              <p>{t('landing.demoFallback')}</p>
              <div class="demo-fallback-actions">
                <button class="btn btn-primary" type="button" onclick={retry}>{t('landing.demoRetry')}</button>
                <a class="link-arrow" href={editorExampleUrl(DEMO_EXAMPLES[index].id)}>
                  {t('landing.demoFallbackCta')}
                </a>
              </div>
            </div>
          </div>
        {/if}

        {#if !active && phase !== 'failed'}
          <!--
            The overlay itself is transparent to the pointer: a wheel, a drag or
            a flick across the poster keeps scrolling the page. Only the CTA
            inside it activates, and the click that does so lands on the button,
            so it never reaches the application underneath.
          -->
          <div class="demo-lock" aria-hidden={phase === 'loading'}>
            <button
              bind:this={ctaEl}
              class="demo-cta"
              type="button"
              onclick={activate}
              onkeydown={onCtaKeydown}
              aria-describedby="demo-lock-hint"
            >
              {mounted ? t('landing.demoLockedCta') : t('landing.demoStart')}
            </button>
            <span class="demo-lock-hint" id="demo-lock-hint">
              {mounted ? t('landing.demoLockedHint') : t('landing.demoStartHint')}
            </span>
          </div>
        {/if}
      </div>

      <div class="demo-aside">
      <!--
        Always rendered — reserving the row means activating, resetting or
        failing cannot shift the page under the visitor's cursor.
      -->
      <div class="demo-controls" class:on={active}>
        <span class="demo-status" role="status" aria-live="polite">{statusText}</span>
        <span class="demo-control-group">
          <button
            class="demo-btn"
            type="button"
            onclick={reset}
            tabindex={active ? 0 : -1}
            title={t('landing.demoResetTitle')}
          >{t('landing.demoReset')}</button>
          <button
            class="demo-btn demo-btn-exit"
            type="button"
            onclick={deactivate}
            tabindex={active ? 0 : -1}
          >{t('landing.demoExit')}<kbd>Esc</kbd></button>
        </span>
      </div>

      <div class="demo-bar">
      <div class="demo-tabs" role="tablist" aria-label={t('landing.demoExamplesLbl')}>
        <span class="demo-tabs-label" aria-hidden="true">{t('landing.demoExamplesLbl')}</span>
        {#each DEMO_EXAMPLES as ex, i}
          <button
            bind:this={tabEls[i]}
            class="chip"
            class:active={i === index}
            id="demo-tab-{i}"
            role="tab"
            aria-selected={i === index}
            aria-controls="demo-panel"
            tabindex={i === index ? 0 : -1}
            onclick={() => pick(i)}
            onkeydown={(e) => onTabKeydown(e, i)}
          >
            {t(ex.key)}
          </button>
        {/each}
      </div>
        <a class="link-arrow" href={editorExampleUrl(DEMO_EXAMPLES[index].id)}>
          {t('landing.demoOpenFull')}
        </a>
      </div>

      <!--
        The guided alternative for someone who would rather be shown than poke.
        A plain anchor to the existing /demo route in the same tab — that route
        already redirects into Basic mode and starts the 14-step tour, so there
        is nothing to invent here. Deliberately the secondary weight: the
        activation CTA on the device stays primary and the editor link stays
        quiet, so the section never shows three competing buttons.
      -->
      <div class="demo-tour">
        <p class="demo-tour-copy">{t('landing.demoTourCopy')}</p>
        <a class="btn btn-ghost demo-tour-btn" href="/demo">{t('landing.demoTourCta')}</a>
      </div>
      </div>
    </div>
  </div>
</section>
