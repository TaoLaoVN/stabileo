import { test, expect, type Page } from '@playwright/test';

/**
 * Landing-page coverage.
 *
 * Why Playwright and not Vitest: the landing is a Svelte component tree whose
 * behaviour is DOM- and routing-shaped (an overlay on `/`, a custom
 * `stabileo-enter-app` event, a locale <select>, an embedded iframe). The repo
 * has no jsdom / happy-dom / testing-library dependency and this workstream may
 * not add one, so a real browser is the only way to assert any of it.
 *
 * Tagging: `@landing`, deliberately NOT `@smoke`. CI's blocking e2e job runs
 * `--grep @smoke` and its opt-in job runs `--grep @slow`, so nothing here
 * changes what CI does. Promoting the landing suite is a shared-workflow
 * decision that has not been taken.
 *
 * Run locally:
 *   npx playwright test --grep @landing
 */

/** Sections `LandingPage.svelte` composes, in DOM order (deck-aligned order). */
const SECTIONS = [
  'hero',
  'problem',
  'what',
  'realtime',
  'demo',
  'capabilities',
  'validation',
  'codes',
  'thesis',
  'status',
  'docs',
  'cta',
] as const;

async function bootLanding(page: Page, opts: { locale?: string; manual?: boolean } = {}) {
  const { locale = 'en', manual = true } = opts;
  await page.addInitScript(
    ({ locale, manual }) => {
      try {
        localStorage.clear();
        if (manual) {
          localStorage.setItem('stabileo-lang', locale);
          localStorage.setItem('stabileo-lang-manual', '1');
        }
      } catch {
        /* private mode */
      }
    },
    { locale, manual },
  );
  await page.goto('/');
  await expect(page.locator('.landing')).toBeVisible();
}

test.describe('@landing landing page', () => {
  test('renders the landing overlay at /', async ({ page }) => {
    await bootLanding(page);

    await expect(page.locator('.landing')).toBeVisible();
    // The application stays mounted behind the overlay rather than unmounting.
    await expect(page.locator('.app-container.hidden-behind-landing')).toHaveCount(1);

    const h1 = page.locator('.landing h1');
    await expect(h1).toHaveCount(1);
    await expect(h1).toBeVisible();
    await expect(h1).toHaveAttribute('id', 'hero-title');

    await expect(page).toHaveTitle(/Stabileo/);
  });

  test('composes the expected section inventory, in order', async ({ page }) => {
    await bootLanding(page);

    const order = await page
      .locator('.landing > section[data-section]')
      .evaluateAll((els) => els.map((el) => el.getAttribute('data-section')));
    expect(order).toEqual([...SECTIONS]);

    await expect(page.locator('.landing nav.nav')).toHaveCount(1);
    await expect(page.locator('.landing footer.lp-footer')).toHaveCount(1);
  });

  test('retired sections are gone', async ({ page }) => {
    await bootLanding(page);

    // Changelog and the standalone pricing table were removed on purpose, and
    // the fabricated testimonials with them. If any of these come back it must
    // be a deliberate change to this test.
    await expect(page.locator('.landing .changelog-section')).toHaveCount(0);
    await expect(page.locator('.landing .pricing-section')).toHaveCount(0);
    await expect(page.locator('.landing .quote-card')).toHaveCount(0);
    // No price anywhere on the page.
    const body = (await page.locator('.landing').innerText()).replace(/\s+/g, ' ');
    expect(body).not.toMatch(/\$\s?\d/);
    expect(body).not.toMatch(/\bUSD\s?\d/);
  });

  test('every section is an accessibly-named landmark', async ({ page }) => {
    await bootLanding(page);

    const named = await page.locator('.landing > section').evaluateAll((els) =>
      els.map((el) => {
        const id = el.getAttribute('aria-labelledby');
        const target = id ? el.querySelector(`#${CSS.escape(id)}`) : null;
        return { cls: el.getAttribute('data-section') ?? el.className, id, text: target?.textContent?.trim() ?? null };
      }),
    );
    for (const s of named) {
      expect(s.id, `${s.cls} has aria-labelledby`).toBeTruthy();
      expect(s.text, `${s.cls} label resolves to a heading with text`).toBeTruthy();
    }
  });

  test('reveal animation does not leave content permanently hidden', async ({ page }) => {
    await bootLanding(page);

    const cta = page.locator('.landing [data-section="cta"]');
    await cta.scrollIntoViewIfNeeded();
    await expect(cta).toHaveClass(/visible/);
    await expect(cta).toBeVisible();
  });

  test('the primary CTA enters Basic mode', async ({ page }) => {
    await bootLanding(page);

    await page.locator('.landing .hero-ctas .btn-primary').click();

    // App.svelte rewrites the query with the active tab slug (`replaceAppUrl`).
    await expect(page).toHaveURL(/\/app\/basic(\?|$)/);
    await expect(page.locator('.landing')).toHaveCount(0);
    await expect(page.locator('.app-container')).toBeVisible();
    await expect(page.locator('.app-container.hidden-behind-landing')).toHaveCount(0);
  });

  test('the nav locale switcher changes the rendered copy', async ({ page }) => {
    await bootLanding(page, { locale: 'en' });

    const h1 = page.locator('.landing h1');
    await expect(h1).toHaveText('Structural analysis, in a browser tab.');

    await page.locator('.landing select.nav-lang').selectOption('es');

    await expect(h1).toHaveText('Análisis estructural, en una pestaña del navegador.');
    await expect(page.locator('.landing #status-title')).toHaveText('Qué está disponible hoy — y qué no.');

    expect(await page.evaluate(() => localStorage.getItem('stabileo-lang'))).toBe('es');
    expect(await page.evaluate(() => localStorage.getItem('stabileo-lang-manual'))).toBe('1');
  });

  test('the landing offers English and Spanish only', async ({ page }) => {
    await bootLanding(page);

    const values = await page
      .locator('.landing select.nav-lang option')
      .evaluateAll((els) => els.map((e) => (e as HTMLOptionElement).value));
    expect(values).toEqual(['en', 'es']);
  });

  test('a Spanish browser gets the Spanish landing', async ({ browser }) => {
    const ctx = await browser.newContext({ locale: 'es-AR' });
    const page = await ctx.newPage();
    await bootLanding(page, { manual: false });
    await expect(page.locator('.landing h1')).toHaveText('Análisis estructural, en una pestaña del navegador.');
    await ctx.close();
  });

  test('any other browser language gets the English landing', async ({ browser }) => {
    // French is a language the *application* speaks, so this asserts the
    // landing's allow-list rather than a missing dictionary.
    const ctx = await browser.newContext({ locale: 'fr-FR' });
    const page = await ctx.newPage();
    await bootLanding(page, { manual: false });
    await expect(page.locator('.landing h1')).toHaveText('Structural analysis, in a browser tab.');
    await expect(page.locator('.landing select.nav-lang')).toHaveValue('en');
    await ctx.close();
  });

  test('no Google Fonts request is made', async ({ page }) => {
    const external: string[] = [];
    page.on('request', (r) => {
      const host = new URL(r.url()).host;
      if (/fonts\.(googleapis|gstatic)\.com/.test(host)) external.push(r.url());
    });
    await bootLanding(page);
    await page.locator('.landing [data-section="cta"]').scrollIntoViewIfNeeded();
    expect(external, `landing must not contact Google Fonts:\n${external.join('\n')}`).toEqual([]);
  });

  test('self-hosted fonts are served from the same origin', async ({ page }) => {
    const fonts: string[] = [];
    page.on('response', (r) => {
      if (r.url().includes('/fonts/') && r.url().endsWith('.woff2')) fonts.push(r.url());
    });
    await bootLanding(page);
    await page.waitForTimeout(1200);
    expect(fonts.length).toBeGreaterThan(0);
    for (const f of fonts) expect(new URL(f).host).toBe(new URL(page.url()).host);
  });

  /**
   * The demo used to hand the wheel to the embedded application the moment the
   * pointer crossed it, so scrolling the page zoomed the model instead. These
   * pin the locked/active contract that replaced that behaviour.
   */
  /**
   * The Live Demo. Two defects drove this contract: an iframe under the
   * pointer swallowed the wheel and turned page scrolling into camera zoom,
   * and a second application instance was booted on every visit whether or not
   * anyone wanted it. Nothing here is cosmetic — each test pins one of those.
   */
  test.describe('live demo', () => {
    const scrollTop = (page: Page) => page.evaluate(() => document.querySelector('.landing')!.scrollTop);

    async function reachDemo(page: Page) {
      await page.evaluate(() => document.querySelector('.landing [data-section="demo"]')!.scrollIntoView());
      await page.waitForTimeout(700);
    }
    /** True only when the control row is really lit, i.e. the demo is active. */
    const isActive = (page: Page) =>
      page.locator('.landing .demo-controls').evaluate((el) => el.classList.contains('on'));

    /**
     * Activate and wait for the frame to actually finish loading, rather than
     * for a fixed number of milliseconds. The skeleton is rendered only while
     * `phase === 'loading'`, so its disappearance is the real ready signal —
     * fixed waits were tight enough to flake when the whole suite ran serially
     * and every test was booting a second application instance.
     */
    async function activate(page: Page) {
      await page.locator('.landing .demo-cta').click();
      await expect.poll(() => isActive(page)).toBe(true);
      await expect(page.locator('.landing .demo-skeleton')).toHaveCount(0, { timeout: 45000 });
    }
    async function wheelOverDemo(page: Page, dy = 380) {
      const box = (await page.locator('.landing .demo-device').boundingBox())!;
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.wheel(0, dy);
      await page.waitForTimeout(400);
    }
    /** Bring a control into view before clicking, so Playwright's own
     *  scroll-into-view cannot be mistaken for the component moving the page. */
    async function settle(page: Page, sel: string) {
      await page.locator(sel).scrollIntoViewIfNeeded();
      await page.waitForTimeout(250);
    }

    test('no iframe exists before activation, at any width', async ({ browser }) => {
      for (const width of [390, 768, 1024, 1440]) {
        const ctx = await browser.newContext({ viewport: { width, height: 900 } });
        const page = await ctx.newPage();
        await bootLanding(page);
        await reachDemo(page);
        // Generous: any prewarm would have fired long before this.
        await page.waitForTimeout(4000);
        await expect(page.locator('.landing iframe.demo-iframe'), `iframe at ${width}px`).toHaveCount(0);
        await expect(page.locator('.landing .demo-cta')).toBeVisible();
        await ctx.close();
      }
    });

    test('wheeling and dragging over the poster scrolls the page and never activates', async ({ page }) => {
      await bootLanding(page);
      await reachDemo(page);

      const before = await scrollTop(page);
      await wheelOverDemo(page);
      expect(await scrollTop(page), 'the wheel belongs to the page').toBeGreaterThan(before);

      // A flick/drag across the poster, away from the CTA.
      const box = (await page.locator('.landing .demo-device').boundingBox())!;
      await page.mouse.move(box.x + 24, box.y + 24);
      await page.mouse.down();
      await page.mouse.move(box.x + 24, box.y + 140, { steps: 8 });
      await page.mouse.up();
      await page.waitForTimeout(400);

      expect(await isActive(page), 'a drag over the poster must not activate').toBe(false);
      await expect(page.locator('.landing iframe.demo-iframe')).toHaveCount(0);
    });

    test('only the CTA activates, and it mounts exactly one iframe', async ({ page }) => {
      await bootLanding(page);
      await reachDemo(page);
      await activate(page);
      await expect(page.locator('.landing iframe.demo-iframe')).toHaveCount(1);
      await expect(page.locator('.landing .demo-btn-exit')).toBeVisible();
    });

    for (const key of ['Enter', 'Space'] as const) {
      test(`${key} on the CTA activates it`, async ({ page }) => {
        await bootLanding(page);
        await reachDemo(page);
        await page.locator('.landing .demo-cta').focus();
        await page.keyboard.press(key);
        await expect.poll(() => isActive(page)).toBe(true);
        await expect(page.locator('.landing iframe.demo-iframe')).toHaveCount(1);
      });
    }

    test('the activating click is consumed by the CTA and never reaches the app', async ({ page }) => {
      await bootLanding(page);
      await reachDemo(page);
      await activate(page);

      // Count real user input the embedded document sees from now on.
      // `isTrusted` is the discriminator that matters: the landing's own
      // Results-panel mitigation calls btn.click() inside this document, and
      // that synthetic click is not what this test is about.
      await page.frameLocator('.landing iframe.demo-iframe').locator('body').evaluate(() => {
        (window as unknown as { __hits: number }).__hits = 0;
        for (const type of ['pointerdown', 'mousedown', 'click']) {
          document.addEventListener(type, (e) => {
            if (e.isTrusted) (window as unknown as { __hits: number }).__hits++;
          }, true);
        }
      });

      // Leave, then activate again: the re-activating click lands on the CTA,
      // which sits over the frame. If the overlay were not consuming it, the
      // counter below would move.
      await page.keyboard.press('Escape');
      await expect(page.locator('.landing .demo-cta')).toBeVisible();
      await page.locator('.landing .demo-cta').click();
      await expect.poll(() => isActive(page)).toBe(true);
      await page.waitForTimeout(500);

      const hits = await page.frameLocator('.landing iframe.demo-iframe').locator('body')
        .evaluate(() => (window as unknown as { __hits: number }).__hits);
      expect(hits, 'the activating click must not reach the application').toBe(0);
    });

    test('the frame is inert and untabbable while locked, interactive while active', async ({ page }) => {
      await bootLanding(page);
      await reachDemo(page);
      await activate(page);
      const frame = page.locator('.landing iframe.demo-iframe');
      await expect(frame).not.toHaveAttribute('inert', '');
      await expect(frame).toHaveAttribute('tabindex', '0');

      await page.keyboard.press('Escape');
      await expect(frame).toHaveAttribute('inert', '');
      await expect(frame).toHaveAttribute('tabindex', '-1');
      await expect(frame).toHaveAttribute('aria-hidden', 'true');
    });

    test('Escape exits, restores focus and returns the wheel to the page', async ({ page }) => {
      await bootLanding(page);
      await reachDemo(page);
      await activate(page);

      await page.keyboard.press('Escape');
      await expect(page.locator('.landing .demo-cta')).toBeVisible();
      expect(await page.evaluate(() => document.activeElement?.className ?? '')).toContain('demo-cta');

      const before = await scrollTop(page);
      await wheelOverDemo(page);
      expect(await scrollTop(page)).toBeGreaterThan(before);
    });

    test('exiting keeps the frame mounted but locked', async ({ page }) => {
      await bootLanding(page);
      await reachDemo(page);
      await activate(page);
      await page.locator('.landing .demo-btn-exit').click();
      // Deliberate: re-entry is instant and the locked frame cannot be reached.
      await expect(page.locator('.landing iframe.demo-iframe')).toHaveCount(1);
      await expect(page.locator('.landing iframe.demo-iframe')).toHaveAttribute('inert', '');
      await expect(page.locator('.landing .demo-cta')).toBeVisible();
    });

    test('Reset reloads the same example, shows loading and stays active', async ({ page }) => {
      await bootLanding(page);
      await reachDemo(page);
      await activate(page);
      const srcBefore = await page.locator('.landing iframe.demo-iframe').getAttribute('src');

      const sawLoading = page.evaluate(() => new Promise<boolean>((res) => {
        let saw = false;
        const iv = setInterval(() => { if (document.querySelector('.landing .demo-skeleton')) saw = true; }, 30);
        setTimeout(() => { clearInterval(iv); res(saw); }, 2500);
      }));
      await page.locator('.landing .demo-btn', { hasText: /Reset|Reiniciar/ }).click({ noWaitAfter: true });
      expect(await sawLoading, 'the loading state must be shown during reset').toBe(true);

      expect(await isActive(page), 'reset must not drop interactive mode').toBe(true);
      await expect(page.locator('.landing iframe.demo-iframe')).toHaveAttribute('src', srcBefore!);
    });

    test('switching example while active stays active and loads the new example', async ({ page }) => {
      await bootLanding(page);
      await reachDemo(page);
      await activate(page);

      await page.locator('.landing [role="tab"]').nth(2).click();
      expect(await isActive(page), 'switching must not drop interactive mode').toBe(true);
      await expect(page.locator('.landing iframe.demo-iframe'))
        .toHaveAttribute('src', '/app/basic?embed&example=truss');
      await expect(page.locator('.landing .demo-btn-exit')).toBeVisible();
      await expect(page.locator('.landing .demo-btn', { hasText: /Reset|Reiniciar/ })).toBeVisible();
    });

    test('switching example while locked does not mount anything', async ({ page }) => {
      await bootLanding(page);
      await reachDemo(page);
      await page.locator('.landing [role="tab"]').nth(1).click();
      await expect(page.locator('.landing [role="tab"]').nth(1)).toHaveAttribute('aria-selected', 'true');
      await expect(page.locator('.landing iframe.demo-iframe')).toHaveCount(0);
      // …and the continuation link follows the new selection.
      await expect(page.locator('.landing .demo-bar a.link-arrow'))
        .toHaveAttribute('href', '/app/basic?example=portal-frame');
    });

    test('every state transition preserves the landing scroll position', async ({ page }) => {
      await bootLanding(page);
      await reachDemo(page);

      await settle(page, '.landing .demo-cta');
      const a0 = await scrollTop(page);
      await activate(page);
      expect(Math.abs((await scrollTop(page)) - a0), 'activation').toBeLessThanOrEqual(2);

      await settle(page, '.landing .demo-controls');
      const a1 = await scrollTop(page);
      await page.locator('.landing .demo-btn', { hasText: /Reset|Reiniciar/ }).click({ noWaitAfter: true });
      await page.waitForTimeout(1200);
      expect(Math.abs((await scrollTop(page)) - a1), 'reset').toBeLessThanOrEqual(2);

      await settle(page, '.landing .demo-bar');
      const a2 = await scrollTop(page);
      await page.locator('.landing [role="tab"]').nth(3).click({ noWaitAfter: true });
      await page.waitForTimeout(1200);
      expect(Math.abs((await scrollTop(page)) - a2), 'example switch').toBeLessThanOrEqual(2);

      const a3 = await scrollTop(page);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);
      expect(Math.abs((await scrollTop(page)) - a3), 'exit').toBeLessThanOrEqual(2);
    });

    test('a frame that never loads fails over to a retry, which mounts a fresh one', async ({ page }) => {
      // Black-hole the embed so the load event can never fire.
      await page.route('**/app/basic?embed*', () => { /* never resolved */ });
      await bootLanding(page);
      await reachDemo(page);
      await page.locator('.landing .demo-cta').click();

      const failure = page.locator('.landing .demo-fallback');
      await expect(failure, 'failure state after the 8s timeout').toBeVisible({ timeout: 12000 });
      await expect(failure).toContainText(/could not load|no pudo cargarse/i);
      // Nothing invisible is left intercepting input.
      await expect(page.locator('.landing iframe.demo-iframe')).toHaveCount(0);

      await page.unroute('**/app/basic?embed*');
      const before = await scrollTop(page);
      await page.locator('.landing .demo-fallback button').click({ noWaitAfter: true });
      await expect(page.locator('.landing iframe.demo-iframe')).toHaveCount(1);
      await expect(page.locator('.landing .demo-fallback')).toHaveCount(0);
      expect(Math.abs((await scrollTop(page)) - before), 'retry keeps the scroll').toBeLessThanOrEqual(4);
      // The selected example survived the round trip.
      await expect(page.locator('.landing iframe.demo-iframe'))
        .toHaveAttribute('src', '/app/basic?embed&example=cantilever');
    });

    test('the Results panel cleanup runs after every fresh load and never throws', async ({ page }) => {
      /**
       * Asserts the OUTCOME, not an instant. The embedded app opens the panel
       * roughly 1.3 s after the frame loads and the mitigation's retry closes
       * it by ~2.1 s, so sampling at load time is a race — it caught this test
       * out when PR16-PR18 shifted the app's render timing.
       *
       * The `.mrp-reopen` assertion is the one that matters for the debt: it
       * proves the panel was really opened and really closed, so the day the
       * app's markup changes and the mitigation starts silently no-opping, this
       * fails instead of passing vacuously.
       */
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(String(e)));
      const app = page.frameLocator('.landing iframe.demo-iframe');

      await bootLanding(page);
      await reachDemo(page);
      await activate(page);
      await expect
        .poll(() => app.locator('.mrp-panel').count(), { timeout: 15000, message: 'panel closed after activation' })
        .toBe(0);
      await expect(app.locator('.mrp-reopen'), 'the panel was opened and then closed by the mitigation')
        .toHaveCount(1);

      await page.locator('.landing [role="tab"]').nth(1).click();
      await expect
        .poll(() => app.locator('.mrp-panel').count(), { timeout: 15000, message: 'panel closed after an example change' })
        .toBe(0);
      await expect(app.locator('.mrp-reopen')).toHaveCount(1);

      expect(errors, `the cleanup must be failure-safe:\n${errors.join('\n')}`).toEqual([]);
    });

    test('the demo does not trap keyboard focus', async ({ page }) => {
      await bootLanding(page);
      await reachDemo(page);
      await page.locator('.landing .demo-cta').focus();
      for (let i = 0; i < 6; i++) await page.keyboard.press('Tab');
      const inDevice = await page.evaluate(() => !!document.activeElement?.closest('.demo-device'));
      expect(inDevice).toBe(false);
    });

    test('the embed uses the application mobile layout at every width', async ({ browser }) => {
      // The app switches at window.innerWidth < 768 (ui.svelte.ts). The device
      // is capped below that: real mobile UI, no user-agent spoofing, no new
      // query parameter. Checked at every QA width, including the two phone
      // sizes where the frame only mounts after an explicit tap.
      for (const [width, height] of [[360, 780], [390, 844], [768, 1024], [1024, 768], [1440, 900]]) {
        const ctx = await browser.newContext({ viewport: { width, height } });
        const page = await ctx.newPage();
        await bootLanding(page);
        await reachDemo(page);
        await activate(page);
        const inner = await page
          .frameLocator('.landing iframe.demo-iframe')
          .locator('body')
          .evaluate(() => window.innerWidth);
        expect(inner, `embed viewport at ${width}px`).toBeLessThan(768);
        // …and the desktop chrome that goes with the wider layout never appears.
        await expect(
          page.frameLocator('.landing iframe.demo-iframe').locator('.sidebar-toggle-btn'),
          `desktop sidebar toggles at ${width}px`,
        ).toHaveCount(0);
        await ctx.close();
      }
    });

    /**
     * The embed is capped below 768 px, so on a wide page it is necessarily
     * narrower than the column. It used to sit inside a second bordered box
     * that stretched the full width — 238 px of empty frame each side at 1440,
     * the device only 60 % of it. These pin the composition that replaced it.
     */
    test('the demo stage has no empty framed gutter around the device', async ({ browser }) => {
      for (const width of [768, 1024, 1440]) {
        const ctx = await browser.newContext({ viewport: { width, height: 900 } });
        const page = await ctx.newPage();
        await bootLanding(page);
        await reachDemo(page);
        await activate(page);

        const m = await page.evaluate(() => {
          const stage = document.querySelector('.landing .demo-stage') as HTMLElement;
          const dev = document.querySelector('.landing .demo-device') as HTMLElement;
          const cs = getComputedStyle(stage);
          const used = [...stage.children].reduce((a, c) => a + c.getBoundingClientRect().width, 0);
          const cols = cs.gridTemplateColumns.split(' ').filter(Boolean).length;
          const gap = parseFloat(cs.columnGap) || 0;
          return {
            stageW: stage.getBoundingClientRect().width,
            devW: dev.getBoundingClientRect().width,
            unused: stage.getBoundingClientRect().width - used - (cols > 1 ? gap : 0),
            borderW: parseFloat(cs.borderTopWidth) || 0,
            padding: parseFloat(cs.paddingLeft) || 0,
          };
        });

        // The stage is layout only: one frame in this section, not two.
        expect(m.borderW, `stage border at ${width}px`).toBe(0);
        expect(m.padding, `stage padding at ${width}px`).toBe(0);
        // Nothing of consequence left over horizontally.
        expect(m.unused, `unused stage width at ${width}px`).toBeLessThanOrEqual(4);
      }
    });

    test('the activation overlay lines up with the frame it covers', async ({ browser }) => {
      for (const width of [390, 1024, 1440]) {
        const ctx = await browser.newContext({ viewport: { width, height: 900 } });
        const page = await ctx.newPage();
        await bootLanding(page);
        await reachDemo(page);
        const d = await page.evaluate(() => {
          const dev = document.querySelector('.landing .demo-device')!.getBoundingClientRect();
          const lock = document.querySelector('.landing .demo-lock')!.getBoundingClientRect();
          return { dx: lock.x - dev.x, dy: lock.y - dev.y, dw: lock.width - dev.width, dh: lock.height - dev.height };
        });
        // Inside the device's 1 px border on every edge, nothing more.
        for (const [k, v] of Object.entries(d)) {
          expect(Math.abs(v), `overlay ${k} at ${width}px`).toBeLessThanOrEqual(2);
        }
        await ctx.close();
      }
    });

    test('the embed is rendered at native size, never transform-scaled', async ({ page }) => {
      // Scaling a sub-768 viewport up would blur the canvas and shift pointer
      // coordinates inside the transformed hit area. If a transform ever
      // appears here, the interaction guarantees below stop holding.
      await bootLanding(page);
      await reachDemo(page);
      await activate(page);
      const transforms = await page.evaluate(() => {
        const out: string[] = [];
        let el: HTMLElement | null = document.querySelector('.landing iframe.demo-iframe');
        while (el && !el.classList.contains('demo')) {
          out.push(getComputedStyle(el).transform);
          el = el.parentElement;
        }
        return out;
      });
      for (const t of transforms) expect(['none', 'matrix(1, 0, 0, 1, 0, 0)']).toContain(t);

      // Pointer coordinates land where they look: the app sees the click at
      // the same place the host page aimed it.
      const box = (await page.locator('.landing .demo-device').boundingBox())!;
      await page.frameLocator('.landing iframe.demo-iframe').locator('body').evaluate(() => {
        (window as unknown as { __pt: { x: number; y: number } | null }).__pt = null;
        document.addEventListener('pointerdown', (e) => {
          (window as unknown as { __pt: { x: number; y: number } }).__pt = { x: e.clientX, y: e.clientY };
        }, true);
      });
      const aimX = Math.round(box.x + box.width * 0.5);
      const aimY = Math.round(box.y + box.height * 0.6);
      await page.mouse.click(aimX, aimY);
      await page.waitForTimeout(300);
      const seen = await page.frameLocator('.landing iframe.demo-iframe').locator('body')
        .evaluate(() => (window as unknown as { __pt: { x: number; y: number } | null }).__pt);
      expect(seen, 'the app must receive the click').not.toBeNull();
      expect(Math.abs(seen!.x - (aimX - box.x)), 'pointer x offset').toBeLessThanOrEqual(3);
      expect(Math.abs(seen!.y - (aimY - box.y)), 'pointer y offset').toBeLessThanOrEqual(3);
    });

    test('no horizontal overflow at any QA width, locked or active', async ({ browser }) => {
      for (const [width, height] of [[360, 780], [390, 844], [768, 1024], [1024, 768], [1440, 900]]) {
        const ctx = await browser.newContext({ viewport: { width, height } });
        const page = await ctx.newPage();
        await bootLanding(page);
        await reachDemo(page);
        const over = () => page.evaluate(() => {
          const l = document.querySelector('.landing') as HTMLElement;
          return Math.max(0, l.scrollWidth - window.innerWidth);
        });
        expect(await over(), `locked at ${width}px`).toBeLessThanOrEqual(1);
        await activate(page);
        expect(await over(), `active at ${width}px`).toBeLessThanOrEqual(1);
        await ctx.close();
      }
    });

    test('the example tablist stays complete and keyboard-operable', async ({ page }) => {
      await bootLanding(page);
      await reachDemo(page);
      const tabs = page.locator('.landing [role="tab"]');
      await expect(tabs).toHaveCount(4);
      await expect(page.locator('.landing #demo-panel')).toHaveAttribute('role', 'tabpanel');
      const tabIndexes = await tabs.evaluateAll((els) => els.map((e) => e.getAttribute('tabindex')));
      expect(tabIndexes.filter((t) => t === '0')).toHaveLength(1);

      await tabs.first().focus();
      await page.keyboard.press('ArrowRight');
      await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true');
      await page.keyboard.press('End');
      await expect(tabs.nth(3)).toHaveAttribute('aria-selected', 'true');
    });

    test('continue-in-editor still tracks the selection', async ({ page }) => {
      await bootLanding(page);
      await reachDemo(page);
      const cont = page.locator('.landing .demo-bar a.link-arrow');
      await expect(cont).toHaveAttribute('href', '/app/basic?example=cantilever');
      await page.locator('.landing [role="tab"]').nth(2).click();
      await expect(cont).toHaveAttribute('href', '/app/basic?example=truss');
    });

    /**
     * The guided alternative. /demo is an existing route that redirects into
     * Basic mode and starts the 14-step tour; the landing only links to it.
     */
    test('the guided-tour CTA reads correctly in both languages', async ({ page }) => {
      await bootLanding(page);
      await reachDemo(page);
      const cta = page.locator('.landing .demo-tour-btn');
      await expect(cta).toHaveText('Learn the basics');
      await expect(page.locator('.landing .demo-tour-copy')).toHaveText('Take a guided tour of Basic mode.');

      await page.locator('.landing select.nav-lang').selectOption('es');
      await expect(cta).toHaveText('Aprendé lo básico');
      await expect(page.locator('.landing .demo-tour-copy'))
        .toHaveText('Hacé un recorrido guiado por el modo Básico.');
    });

    test('the guided-tour CTA is a same-tab anchor to /demo', async ({ page }) => {
      await bootLanding(page);
      await reachDemo(page);
      const cta = page.locator('.landing .demo-tour-btn');
      await expect(cta).toHaveAttribute('href', '/demo');
      // No target: a guided tour that steals a tab is a worse guided tour.
      expect(await cta.getAttribute('target')).toBeNull();
      expect(await cta.evaluate((el) => el.tagName)).toBe('A');
    });

    test('the guided-tour CTA launches Basic mode with the tour running', async ({ page }) => {
      await bootLanding(page);
      await reachDemo(page);
      const pagesBefore = page.context().pages().length;

      await page.locator('.landing .demo-tour-btn').click();

      await expect(page).toHaveURL(/\/app\/basic/);
      await expect(page.locator('.tour-card')).toBeVisible({ timeout: 15000 });
      await expect(page.locator('.tour-counter')).toHaveText('1 / 14');
      await expect(page.locator('.landing')).toHaveCount(0);
      expect(page.context().pages().length, 'must not open a new tab').toBe(pagesBefore);
    });

    test('the guided-tour CTA does not mount the live demo first', async ({ page }) => {
      await bootLanding(page);
      await reachDemo(page);
      await expect(page.locator('.landing iframe.demo-iframe')).toHaveCount(0);
      await page.locator('.landing .demo-tour-btn').hover();
      await page.waitForTimeout(500);
      // Hovering or reaching the CTA must not boot a second application.
      await expect(page.locator('.landing iframe.demo-iframe')).toHaveCount(0);
      expect(await isActive(page)).toBe(false);
    });

    test('the CTA hierarchy sits beside the demo on wide screens and below it on mobile', async ({ browser }) => {
      for (const [width, height, expected] of [[390, 844, 'below'], [768, 1024, 'below'], [1440, 900, 'beside']] as const) {
        const ctx = await browser.newContext({ viewport: { width, height } });
        const page = await ctx.newPage();
        await bootLanding(page);
        await reachDemo(page);
        const g = await page.evaluate(() => {
          const dev = document.querySelector('.landing .demo-device')!.getBoundingClientRect();
          const btn = document.querySelector('.landing .demo-tour-btn')!.getBoundingClientRect();
          const link = document.querySelector('.landing .demo-bar a.link-arrow')!.getBoundingClientRect();
          const l = document.querySelector('.landing') as HTMLElement;
          return {
            beside: btn.left >= dev.right - 2,
            below: btn.top >= dev.bottom - 2,
            height: btn.height,
            groupedWithEditorLink: Math.abs(btn.top - link.bottom) < 160,
            overflow: Math.max(0, l.scrollWidth - window.innerWidth),
          };
        });
        expect(g[expected], `tour CTA ${expected} the demo at ${width}px`).toBe(true);
        // Comfortable touch target, everywhere.
        expect(g.height, `touch target at ${width}px`).toBeGreaterThanOrEqual(44);
        expect(g.overflow, `overflow at ${width}px`).toBeLessThanOrEqual(1);
        if (expected === 'below') {
          expect(g.groupedWithEditorLink, 'grouped with the editor link on mobile').toBe(true);
        }
        await ctx.close();
      }
    });

    test('the three demo actions keep their distinct weights and all still work', async ({ page }) => {
      await bootLanding(page);
      await reachDemo(page);

      // Exactly one filled/primary button in the section: the activation CTA.
      const primaries = await page.locator('.landing [data-section="demo"] .demo-cta, .landing [data-section="demo"] .btn-primary').count();
      expect(primaries, 'one primary action only').toBe(1);
      // The tour is the secondary (outlined) one, the editor link is quiet.
      await expect(page.locator('.landing .demo-tour-btn')).toHaveClass(/btn-ghost/);
      await expect(page.locator('.landing .demo-bar a.link-arrow')).toBeVisible();

      // Activation still works and the editor link still tracks the selection.
      await activate(page);
      await expect(page.locator('.landing iframe.demo-iframe')).toHaveCount(1);
      await page.locator('.landing [role="tab"]').nth(2).click();
      await expect(page.locator('.landing .demo-bar a.link-arrow'))
        .toHaveAttribute('href', '/app/basic?example=truss');
      expect(await isActive(page)).toBe(true);
    });

    test('the Spanish demo copy is complete', async ({ page }) => {
      await bootLanding(page, { locale: 'es' });
      await reachDemo(page);
      await expect(page.locator('.landing .demo-cta')).toHaveText('Iniciar la demo interactiva');
      await expect(page.locator('.landing .demo-lock-hint')).toHaveText(/Carga el editor dentro de esta página/i);
      await activate(page);
      await expect(page.locator('.landing .demo-btn', { hasText: 'Reiniciar' })).toBeVisible();
      await expect(page.locator('.landing .demo-btn-exit')).toContainText('Salir');
      await expect(page.locator('.landing .demo-status')).toHaveText(/la demo recibe la rueda/i);
      await page.keyboard.press('Escape');
      await expect(page.locator('.landing .demo-cta')).toHaveText('Tocá para interactuar');
    });
  });

  test('the status section labels every capability and names no price', async ({ page }) => {
    await bootLanding(page);
    const status = page.locator('.landing [data-section="status"]');
    await status.scrollIntoViewIfNeeded();

    await expect(status.locator('.badge-today')).toHaveCount(1);
    await expect(status.locator('.badge-partial')).toHaveCount(1);
    await expect(status.locator('.badge-roadmap')).toHaveCount(1);

    // Hosted services appear only under the roadmap badge.
    const roadmap = status.locator('.status-group', { has: page.locator('.badge-roadmap') });
    await expect(roadmap).toContainText('Remote solving');
    await expect(roadmap).toContainText('Stabileo AI credits');
    await expect(roadmap).toContainText('Cloud workspace');

    const today = status.locator('.status-group', { has: page.locator('.badge-today') });
    await expect(today).not.toContainText('Remote solving');
    await expect(today).not.toContainText('Cloud workspace');

    await expect(status.locator('.access')).toContainText('AGPL-3.0');
  });

  test('the evidence counters settle on their real values', async ({ browser }) => {
    // Regression: these counted up from an IntersectionObserver left on the
    // default root. `.landing` is a fixed-position scroll container, so that
    // observer never fired and every figure rendered a permanent 0. Checked at
    // a short viewport too, where the section cannot reach a high ratio.
    for (const [width, height] of [[1440, 900], [1440, 700], [390, 844]]) {
      const ctx = await browser.newContext({ viewport: { width, height } });
      const page = await ctx.newPage();
      await bootLanding(page);
      await page.locator('.landing [data-section="validation"]').scrollIntoViewIfNeeded();
      const nums = page.locator('.landing .stat-num');
      await expect(nums.nth(0), `tests counter at ${width}x${height}`).toHaveText('5,655', { timeout: 8000 });
      await expect(nums.nth(1), `examples counter at ${width}x${height}`).toHaveText('54', { timeout: 8000 });
      await ctx.close();
    }
  });

  test('the hero truss animates and the real-time section does not repeat it', async ({ page }) => {
    await bootLanding(page);

    // Hero: one figure, one moving load.
    const hero = page.locator('.landing .hero-figure .truss-fig');
    await expect(hero).toHaveCount(1);
    const loadX = () =>
      page.locator('.landing .hero-figure .tf-load').evaluate((g) => g.getAttribute('transform'));
    const first = await loadX();
    await page.waitForTimeout(1200);
    expect(await loadX(), 'the hero load must actually move').not.toBe(first);

    // Real-time: three still frames, not the same animation again.
    await page.locator('.landing [data-section="realtime"]').scrollIntoViewIfNeeded();
    const states = page.locator('.landing .rt-states .truss-fig');
    await expect(states).toHaveCount(3);
    const positions = await page
      .locator('.landing .rt-states .tf-load')
      .evaluateAll((gs) => gs.map((g) => g.getAttribute('transform')));
    expect(new Set(positions).size, 'the three frames must show different load positions').toBe(3);

    const before = positions.join('|');
    await page.waitForTimeout(1200);
    const after = (await page
      .locator('.landing .rt-states .tf-load')
      .evaluateAll((gs) => gs.map((g) => g.getAttribute('transform')))).join('|');
    expect(after, 'the comparison frames must be static').toBe(before);

    // Each frame is captioned, so it explains rather than decorates.
    for (let i = 0; i < 3; i++) {
      await expect(states.nth(i).locator('.tf-caption')).not.toBeEmpty();
    }
  });

  test('the moving load is the arrow alone — no caption in either language', async ({ browser }) => {
    // The arrow used to carry a "UNIT MOVING LOAD" caption. It was removed; the
    // meaning now lives only in the SVG <desc>, which is not rendered text.
    for (const [locale, phrase] of [['en', 'unit moving load'], ['es', 'carga móvil unitaria']] as const) {
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      const page = await ctx.newPage();
      await bootLanding(page, { locale });

      // Walk the whole page so the real-time comparison frames render too.
      await page.locator('.landing [data-section="realtime"]').scrollIntoViewIfNeeded();
      await page.waitForTimeout(400);

      const visible = (await page.locator('.landing').innerText()).toLowerCase();
      expect(visible, `"${phrase}" must not be visible in ${locale}`).not.toContain(phrase);

      // Nothing took its place next to the arrow, in either variant.
      await expect(page.locator('.landing .tf-load text')).toHaveCount(0);
      await expect(page.locator('.landing .tf-load-label')).toHaveCount(0);

      // …but a screen reader still learns what the arrow means.
      // textContent, not innerText: <desc> is an SVGElement and is never rendered.
      const desc = (await page.locator('.landing .hero-figure svg desc').textContent()) ?? '';
      expect(desc.toLowerCase()).toMatch(locale === 'en' ? /unit load/ : /carga unitaria/);
      expect(desc.toLowerCase()).toMatch(locale === 'en' ? /downward/ : /descendente/);

      // The legend and the comparison captions are untouched.
      const legend = await page.locator('.landing .hero-figure .tf-legend').innerText();
      expect(legend).toContain('+');
      expect(legend).toContain('\u2212');
      const captions = await page.locator('.landing .rt-states .tf-caption').allInnerTexts();
      expect(captions).toHaveLength(3);
      for (const c of captions) expect(c.trim().length).toBeGreaterThan(0);

      await ctx.close();
    }
  });

  test('the hero animation pauses on hover', async ({ page }) => {
    await bootLanding(page);
    const svg = page.locator('.landing .hero-figure svg');
    await svg.hover();
    await page.waitForTimeout(400);
    const a = await page.locator('.landing .hero-figure .tf-load').getAttribute('transform');
    await page.waitForTimeout(1200);
    const b = await page.locator('.landing .hero-figure .tf-load').getAttribute('transform');
    expect(b, 'hovering must freeze the sweep').toBe(a);
  });

  test('reduced motion gets a static, representative state', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    await bootLanding(page);
    const load = page.locator('.landing .hero-figure .tf-load');
    const a = await load.getAttribute('transform');
    await page.waitForTimeout(1500);
    expect(await load.getAttribute('transform'), 'no sweep under reduced motion').toBe(a);
    // and it is a loaded state, not the blank over-a-support one
    const coloured = await page.locator('.landing .hero-figure .tf-members line').evaluateAll((ls) =>
      ls.filter((l) => (l.getAttribute('stroke') ?? '').includes('tension') || (l.getAttribute('stroke') ?? '').includes('compression')).length);
    expect(coloured, 'the static state must show real forces').toBeGreaterThan(8);
    await ctx.close();
  });

  test('the truss figure is an accessibly named image with a description', async ({ page }) => {
    await bootLanding(page);
    const svg = page.locator('.landing .hero-figure svg');
    await expect(svg).toHaveAttribute('role', 'img');
    const labelled = await svg.getAttribute('aria-labelledby');
    expect(labelled).toBeTruthy();
    for (const id of labelled!.split(/\s+/)) {
      await expect(page.locator(`.landing #${id}`)).not.toBeEmpty();
    }
    // The legend must not depend on colour alone.
    const legend = await page.locator('.landing .hero-figure .tf-legend').innerText();
    expect(legend).toContain('+');
    expect(legend).toContain('\u2212');
    expect(legend.toLowerCase()).toContain('zero');
  });

  test('the published test count carries its provenance', async ({ page }) => {
    await bootLanding(page);
    const validation = page.locator('.landing [data-section="validation"]');
    await validation.scrollIntoViewIfNeeded();
    await expect(validation).toContainText('6c3369d6');
    await expect(validation).toContainText('2026-08-01');
    // The stale figure must not reappear.
    await expect(validation).not.toContainText('1117');
  });

  /**
   * The landing is client-rendered, so index.html is the only metadata a
   * crawler that does not run JavaScript ever sees. It must be correct on its
   * own, and hydration must refine it in place rather than append a second,
   * contradictory set — which is what it used to do.
   */
  test.describe('metadata', () => {
    const SOCIAL = 'https://stabileo.com/og/stabileo-social.png';
    const EN_TITLE = 'Stabileo — Structural analysis, in a browser tab.';

    function readHead(page: Page) {
      return page.evaluate(() => {
        const byKey: Record<string, string[]> = {};
        for (const m of document.querySelectorAll('meta[name], meta[property]')) {
          const k = m.getAttribute('name') ?? m.getAttribute('property')!;
          (byKey[k] ??= []).push(m.getAttribute('content') ?? '');
        }
        return {
          title: document.title,
          headTitles: document.querySelectorAll('head > title').length,
          lang: document.documentElement.lang,
          canonicals: [...document.querySelectorAll('link[rel="canonical"]')].map((l) => l.getAttribute('href')),
          meta: byKey,
        };
      });
    }
    const one = (h: Awaited<ReturnType<typeof readHead>>, k: string) => {
      expect(h.meta[k], `${k} must exist exactly once`).toHaveLength(1);
      return h.meta[k][0];
    };

    test('a crawler with no JavaScript gets a complete, correct English head', async ({ browser }) => {
      const ctx = await browser.newContext({ javaScriptEnabled: false });
      const page = await ctx.newPage();
      await page.goto('/');
      const h = await readHead(page);

      expect(h.headTitles).toBe(1);
      expect(h.title).toBe(EN_TITLE);
      expect(h.lang).toBe('en');
      expect(h.canonicals).toEqual(['https://stabileo.com/']);

      expect(one(h, 'description')).toMatch(/free and open-source/i);
      expect(one(h, 'theme-color')).toBe('#0c1620');
      expect(one(h, 'og:type')).toBe('website');
      expect(one(h, 'og:url')).toBe('https://stabileo.com/');
      expect(one(h, 'og:site_name')).toBe('Stabileo');
      expect(one(h, 'og:locale')).toBe('en_US');
      expect(one(h, 'og:locale:alternate')).toBe('es_AR');
      expect(one(h, 'og:title')).toBe(EN_TITLE);
      expect(one(h, 'twitter:card')).toBe('summary_large_image');
      expect(one(h, 'twitter:title')).toBe(EN_TITLE);

      // Absolute URL: crawlers do not reliably resolve a relative og:image.
      expect(one(h, 'og:image')).toBe(SOCIAL);
      expect(one(h, 'twitter:image')).toBe(SOCIAL);
      expect(one(h, 'og:image:type')).toBe('image/png');
      expect(one(h, 'og:image:width')).toBe('1200');
      expect(one(h, 'og:image:height')).toBe('630');
      expect(one(h, 'og:image:alt').length).toBeGreaterThan(30);
      expect(one(h, 'twitter:image:alt').length).toBeGreaterThan(30);
      await ctx.close();
    });

    test('the legacy screenshot is no longer referenced as a social image', async ({ browser }) => {
      const ctx = await browser.newContext({ javaScriptEnabled: false });
      const page = await ctx.newPage();
      await page.goto('/');
      const html = await page.content();
      expect(html).not.toContain('3d-industrial.png');
      await ctx.close();
    });

    test('hydration refines the head in place, with no duplicates', async ({ page }) => {
      await bootLanding(page);
      const h = await readHead(page);

      expect(h.headTitles, 'exactly one <title> in the head').toBe(1);
      // Every social key appears exactly once — `one()` throws otherwise.
      for (const k of ['description', 'theme-color', 'og:type', 'og:title', 'og:description',
        'og:image', 'og:locale', 'twitter:card', 'twitter:title', 'twitter:description', 'twitter:image']) {
        one(h, k);
      }
      expect(h.canonicals).toEqual(['https://stabileo.com/']);
      expect(h.title).toBe(EN_TITLE);
      expect(one(h, 'og:title')).toBe(EN_TITLE);
      // The description sharpens to the live hero copy.
      expect(one(h, 'og:description')).toBe(one(h, 'description'));
      expect(one(h, 'og:image')).toBe(SOCIAL);
    });

    test('the Spanish landing carries Spanish metadata', async ({ page }) => {
      await bootLanding(page);
      await page.locator('.landing select.nav-lang').selectOption('es');
      await expect(page.locator('.landing h1')).toHaveText('Análisis estructural, en una pestaña del navegador.');
      const h = await readHead(page);

      expect(h.headTitles).toBe(1);
      expect(h.lang).toBe('es');
      expect(h.title).toBe('Stabileo — Análisis estructural, en una pestaña del navegador.');
      expect(one(h, 'og:title')).toBe(h.title);
      expect(one(h, 'og:locale')).toBe('es_AR');
      expect(one(h, 'og:locale:alternate')).toBe('en_US');
      expect(one(h, 'description')).toMatch(/El solver corre en cada edición/);
      expect(one(h, 'twitter:description')).toBe(one(h, 'description'));
      // The canonical and the social image do not vary by locale.
      expect(h.canonicals).toEqual(['https://stabileo.com/']);
      expect(one(h, 'og:image')).toBe(SOCIAL);
    });

    test('a Spanish browser gets Spanish metadata without touching the switcher', async ({ browser }) => {
      const ctx = await browser.newContext({ locale: 'es-AR' });
      const page = await ctx.newPage();
      await bootLanding(page, { manual: false });
      const h = await readHead(page);
      expect(h.lang).toBe('es');
      expect(h.title).toMatch(/Análisis estructural/);
      expect(h.headTitles).toBe(1);
      await ctx.close();
    });

    test('entering the application leaves no landing copy behind', async ({ page }) => {
      await bootLanding(page);
      await page.locator('.landing select.nav-lang').selectOption('es');
      await page.waitForTimeout(300);
      await page.locator('.landing .hero-ctas .btn-primary').click();
      await expect(page.locator('.landing')).toHaveCount(0);

      const h = await readHead(page);
      expect(h.headTitles).toBe(1);
      expect(h.title, 'restored to the static English title').toBe(EN_TITLE);
      expect(h.lang).toBe('en');
      expect(one(h, 'og:locale')).toBe('en_US');
      expect(one(h, 'description')).toMatch(/free and open-source/i);
    });

    test('the social card exists, resolves, and is a 1200x630 PNG', async ({ page }) => {
      const res = await page.request.get('/og/stabileo-social.png');
      expect(res.status(), 'social card must be served').toBe(200);
      expect(res.headers()['content-type']).toContain('image/png');

      const body = await res.body();
      // PNG signature, then IHDR width/height as big-endian uint32.
      expect([...body.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      expect(body.readUInt32BE(16)).toBe(1200);
      expect(body.readUInt32BE(20)).toBe(630);
      // Comfortably inside every platform's social-card size limit.
      expect(body.length).toBeLessThan(1_000_000);
    });

    test('deep links and the landing overlay still behave', async ({ page }) => {
      // The 404.html -> /?route= recovery and the overlay are untouched by this
      // pass; this is the guard that says so.
      await bootLanding(page);
      await expect(page.locator('.landing')).toBeVisible();
      await expect(page.locator('.app-container.hidden-behind-landing')).toHaveCount(1);

      await page.goto('/app/basic');
      await expect(page.locator('.landing')).toHaveCount(0);
      await expect(page.locator('.app-container')).toBeVisible();
    });
  });

  test('every landing image resolves', async ({ page }) => {
    await bootLanding(page);
    await page.locator('.landing [data-section="cta"]').scrollIntoViewIfNeeded();
    await page.waitForTimeout(600);

    const broken = await page.locator('.landing img').evaluateAll((els) =>
      els
        .filter((el) => {
          const img = el as HTMLImageElement;
          return img.complete && img.naturalWidth === 0;
        })
        .map((el) => (el as HTMLImageElement).currentSrc || (el as HTMLImageElement).src),
    );
    expect(broken).toEqual([]);
  });

  test('no horizontal overflow at the QA widths', async ({ browser }) => {
    for (const width of [360, 390, 768, 1024, 1440]) {
      const ctx = await browser.newContext({ viewport: { width, height: 900 } });
      const page = await ctx.newPage();
      await bootLanding(page);
      const overflow = await page.evaluate(() => {
        const el = document.querySelector('.landing') as HTMLElement;
        return { scrollW: el.scrollWidth, inner: window.innerWidth };
      });
      expect(overflow.scrollW, `horizontal overflow at ${width}px`).toBeLessThanOrEqual(overflow.inner + 1);
      await ctx.close();
    }
  });
});
