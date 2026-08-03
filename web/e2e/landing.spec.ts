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

    async function activate(page: Page, settleMs = 6000) {
      await page.locator('.landing .demo-cta').click();
      await expect.poll(() => isActive(page)).toBe(true);
      await page.waitForTimeout(settleMs);
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

      // Count every pointer event the embedded document sees from now on.
      await page.frameLocator('.landing iframe.demo-iframe').locator('body').evaluate(() => {
        (window as unknown as { __hits: number }).__hits = 0;
        for (const type of ['pointerdown', 'mousedown', 'click']) {
          document.addEventListener(type, () => { (window as unknown as { __hits: number }).__hits++; }, true);
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
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(String(e)));
      await bootLanding(page);
      await reachDemo(page);
      await activate(page);
      const panelAfterActivate = await page.frameLocator('.landing iframe.demo-iframe').locator('.mrp-panel').count();

      await page.locator('.landing [role="tab"]').nth(1).click();
      await page.waitForTimeout(6000);
      const panelAfterSwitch = await page.frameLocator('.landing iframe.demo-iframe').locator('.mrp-panel').count();

      expect(panelAfterActivate, 'panel closed after activation').toBe(0);
      expect(panelAfterSwitch, 'panel closed after an example change').toBe(0);
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
      // query parameter.
      for (const width of [768, 1024, 1440]) {
        const ctx = await browser.newContext({ viewport: { width, height: 900 } });
        const page = await ctx.newPage();
        await bootLanding(page);
        await reachDemo(page);
        await activate(page);
        const inner = await page
          .frameLocator('.landing iframe.demo-iframe')
          .locator('body')
          .evaluate(() => window.innerWidth);
        expect(inner, `embed viewport at ${width}px`).toBeLessThan(768);
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
