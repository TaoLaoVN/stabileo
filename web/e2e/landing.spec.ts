import { test, expect, type Page } from '@playwright/test';

/**
 * Landing-page coverage (Phase 1 of the landing workstream).
 *
 * Why Playwright and not Vitest: the landing is a Svelte component tree whose
 * behaviour is entirely DOM- and routing-shaped (an overlay on `/`, a custom
 * `stabileo-enter-app` event, a locale <select>). The repo has no jsdom /
 * happy-dom / testing-library dependency and this workstream may not add one,
 * so a real browser is the only way to assert any of it.
 *
 * Tagging: these are deliberately tagged `@landing`, NOT `@smoke`. CI's
 * blocking e2e job runs `--grep @smoke` and its opt-in job runs `--grep @slow`,
 * so nothing here changes what CI does today. Promoting the landing suite into
 * CI is a shared-workflow decision that has not been taken yet.
 *
 * Run locally:
 *   npx playwright test --grep @landing
 *
 * These tests characterise the landing AS IT IS. Several assertions (the exact
 * section inventory, the English-by-default copy) are expected to fail the day
 * the redesign lands — that is the point: a structural change to the landing
 * should have to update this file on purpose.
 */

/** The sections `LandingPage.svelte` composes, in DOM order. */
const SECTIONS = [
  'hero',
  'features-section',
  'ai-section',
  'docs-section',
  'demo-section',
  'cap-section',
  'roadmap-section',
  'social-section',
  'pricing-section',
  'changelog-section',
  'cta-section',
] as const;

/** Force a locale before the app boots, the way fixtures.ts does for PRO. */
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

    // The overlay renders and the application is behind it, not replaced.
    await expect(page.locator('.landing')).toBeVisible();
    await expect(page.locator('.app-container.hidden-behind-landing')).toHaveCount(1);

    // Exactly one h1, and it is the hero's.
    const h1 = page.locator('.landing h1');
    await expect(h1).toHaveCount(1);
    await expect(h1).toBeVisible();
    await expect(h1).toHaveAttribute('id', 'hero-title');

    await expect(page).toHaveTitle(/Stabileo/);
  });

  test('composes the expected section inventory, in order', async ({ page }) => {
    await bootLanding(page);

    const classes = await page.locator('.landing > section').evaluateAll((els) =>
      els.map((el) => el.className.split(/\s+/).find((c) => c.endsWith('-section') || c === 'hero') ?? ''),
    );
    expect(classes).toEqual([...SECTIONS]);

    // Nav and footer are the landmarks bracketing them.
    await expect(page.locator('.landing nav.nav')).toHaveCount(1);
    await expect(page.locator('.landing footer.lp-footer')).toHaveCount(1);
  });

  test('every section is an accessibly-named landmark', async ({ page }) => {
    await bootLanding(page);

    // A <section> is only exposed as a landmark once it has an accessible
    // name. Each one points at its own visible heading.
    const named = await page.locator('.landing > section').evaluateAll((els) =>
      els.map((el) => {
        const id = el.getAttribute('aria-labelledby');
        const target = id ? el.querySelector(`#${CSS.escape(id)}`) : null;
        return { cls: el.className.split(/\s+/)[0], id, text: target?.textContent?.trim() ?? null };
      }),
    );
    for (const s of named) {
      expect(s.id, `${s.cls} has aria-labelledby`).toBeTruthy();
      expect(s.text, `${s.cls} label resolves to a heading with text`).toBeTruthy();
    }
  });

  test('reveal animation does not leave content permanently hidden', async ({ page }) => {
    await bootLanding(page);

    // Sections start at opacity 0 and are revealed by an IntersectionObserver
    // rooted on the scroll container. If that ever breaks, the page renders
    // blank below the fold — and nothing else in the suite would notice.
    const cta = page.locator('.landing .cta-section');
    await cta.scrollIntoViewIfNeeded();
    await expect(cta).toHaveClass(/visible/);
    await expect(cta).toBeVisible();
  });

  test('the primary CTA enters Basic mode', async ({ page }) => {
    await bootLanding(page);

    await page.locator('.landing .hero-ctas .btn-primary').click();

    // App.svelte then rewrites the query with the active tab slug
    // (`replaceAppUrl`), so match the path and allow the query it adds.
    await expect(page).toHaveURL(/\/app\/basic(\?|$)/);
    await expect(page.locator('.landing')).toHaveCount(0);
    await expect(page.locator('.app-container')).toBeVisible();
    await expect(page.locator('.app-container.hidden-behind-landing')).toHaveCount(0);
  });

  test('the nav locale switcher changes the rendered copy', async ({ page }) => {
    await bootLanding(page, { locale: 'en' });

    const heroLine = page.locator('.landing .hero-line1');
    await expect(heroLine).toHaveText('Structural analysis,');

    await page.locator('.landing select.nav-lang').selectOption('es');

    await expect(heroLine).toHaveText('Análisis Estructural,');
    await expect(page.locator('.landing #features-title')).toHaveText('Lo que podés usar hoy');

    // The choice is persisted as an explicit, manual one.
    expect(await page.evaluate(() => localStorage.getItem('stabileo-lang'))).toBe('es');
    expect(await page.evaluate(() => localStorage.getItem('stabileo-lang-manual'))).toBe('1');
  });

  test('the locale switcher offers every locale the app ships', async ({ page }) => {
    await bootLanding(page);

    // Characterisation only. The product decision to expose just en + es on the
    // public landing is not implemented yet; when it is, this expectation is
    // the one that must change, deliberately.
    const values = await page
      .locator('.landing select.nav-lang option')
      .evaluateAll((els) => els.map((e) => (e as HTMLOptionElement).value));
    expect(values).toEqual([
      'en', 'es', 'pt', 'de', 'fr', 'it', 'tr', 'hi', 'zh', 'ja', 'ko', 'ru', 'ar', 'id',
    ]);
  });

  test('with no stored choice, the locale follows the browser preference', async ({ browser }) => {
    const ctx = await browser.newContext({ locale: 'es-AR' });
    const page = await ctx.newPage();
    // manual: false — nothing stored, so store.svelte.ts auto-detects.
    await bootLanding(page, { manual: false });

    await expect(page.locator('.landing .hero-line1')).toHaveText('Análisis Estructural,');
    await ctx.close();
  });

  test('the demo example tabs are a complete, keyboard-operable tablist', async ({ page }) => {
    await bootLanding(page);

    const tabs = page.locator('.landing [role="tab"]');
    await expect(tabs).toHaveCount(4);

    const panel = page.locator('.landing #demo-panel');
    await expect(panel).toHaveAttribute('role', 'tabpanel');

    // Roving tabindex: exactly one tab is in the tab order.
    const tabIndexes = await tabs.evaluateAll((els) => els.map((e) => e.getAttribute('tabindex')));
    expect(tabIndexes.filter((t) => t === '0')).toHaveLength(1);

    await tabs.first().focus();
    await page.keyboard.press('ArrowRight');
    await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true');
    await expect(panel).toHaveAttribute('aria-labelledby', 'demo-tab-1');

    await page.keyboard.press('End');
    await expect(tabs.nth(3)).toHaveAttribute('aria-selected', 'true');
  });

  test('the demo iframe points at the embedded application', async ({ page }) => {
    await bootLanding(page);

    const iframe = page.locator('.landing iframe.demo-iframe');
    await expect(iframe).toHaveAttribute('title', /demo/i);
    await expect(iframe).toHaveAttribute('loading', 'lazy');
    await expect(iframe).toHaveAttribute('src', '/app/basic?embed&example=cantilever');
  });

  test('every landing image resolves', async ({ page }) => {
    await bootLanding(page);

    // Guards the screenshot assets: a renamed or deleted file under
    // public/screenshots/ would otherwise only show up as a broken image.
    await page.locator('.landing .cta-section').scrollIntoViewIfNeeded();
    const broken = await page.locator('.landing img').evaluateAll((els) =>
      els
        .filter((el) => {
          const img = el as HTMLImageElement;
          return img.complete && img.naturalWidth === 0;
        })
        .map((el) => (el as HTMLImageElement).getAttribute('src')),
    );
    expect(broken).toEqual([]);
  });
});
