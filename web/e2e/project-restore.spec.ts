/**
 * Open an example, reload, restore the autosave, calculate.
 *
 * ── The journey this exists to keep working ────────────────────────
 *
 * It is the shortest path a returning user takes, and it was broken end to end: pressing
 * Calcular on a restored project produced two errors and no results.
 *
 *   Error al resolver 3D: Failed to execute 'postMessage' on 'Worker':
 *   [object Array] could not be cloned.
 *
 *   Error en caso 3D "Superimposed dead (screed+finish+partitions)":
 *   Parse error: Error: invalid type: unit value, expected a sequence
 *
 * The causes are in `project-restore-roundtrip.test.ts`, which owns the unit-level proof of
 * each one. What only a browser can show is the third finding, and it is the reason this file
 * asserts on a CONSOLE WARNING as well as on the toast: the parallel solve had been throwing
 * `DataCloneError` on every solve of any model carrying a constraint, restored or not, and
 * `solveCombinations3DParallel` caught it and fell back to the sequential solver. Correct
 * results, one thread, and the only trace was a `console.warn` nobody was reading — so the
 * worker pool had quietly stopped being used months before anything looked wrong.
 *
 * A silent fallback is therefore a failure here. If the payload stops being cloneable again,
 * this test says so on the run where it happens rather than on the day someone notices the
 * app got slower.
 *
 * The autosave is written by a 30 s timer, so this journey waits for the real thing rather
 * than reaching into the store to fake one — the bug lived in what that timer wrote and in
 * what the banner did with it.
 */

import { test, expect } from '@playwright/test';

const PRO_URL = '/app/pro?e2e=1';
const AUTOSAVE_KEY = 'stabileo-autosave';

/** Boot the PRO app with a known locale, optionally seeding an autosave. */
async function boot(page: import('@playwright/test').Page, autosave: string | null) {
  await page.addInitScript((saved) => {
    try {
      localStorage.clear();
      localStorage.setItem('stabileo-lang', 'es');
      localStorage.setItem('stabileo-lang-manual', '1');
      if (saved) localStorage.setItem('stabileo-autosave', saved as string);
    } catch { /* private mode */ }
  }, autosave);
  await page.goto(PRO_URL);
  await page.waitForFunction(() => !!window.__stabileo, null, { timeout: 60_000 });
  await expect
    .poll(() => page.evaluate(() => window.__stabileo.solverReady()), { timeout: 60_000 })
    .toBe(true);
}

test('@slow a restored project solves, and solves in the worker pool', async ({ page }) => {
  test.setTimeout(300_000);

  const errors: string[] = [];
  const fallbacks: string[] = [];
  page.on('console', (m) => {
    const text = m.text();
    if (m.type() === 'error' && !/SwiftShader|WebGL|GroupMarkerNotSet/i.test(text)) errors.push(text);
    if (/Parallel solve failed|falling back to sequential/i.test(text)) fallbacks.push(text);
  });
  page.on('pageerror', (e) => errors.push(String(e)));

  await boot(page, null);
  await page.evaluate(() => window.__stabileoActions.loadExample('pro-edificio-7p'));
  await expect.poll(() => page.evaluate(() => window.__stabileo.elementIds().length))
    .toBeGreaterThan(0);

  // The autosave the 30 s timer writes — the exact bytes the banner will restore from.
  await expect
    .poll(() => page.evaluate((k) => localStorage.getItem(k)?.length ?? 0, AUTOSAVE_KEY),
      { timeout: 90_000, intervals: [1000] })
    .toBeGreaterThan(0);
  const saved = await page.evaluate((k) => localStorage.getItem(k), AUTOSAVE_KEY);

  // Reload, and restore through the banner exactly as a user does.
  await boot(page, saved);
  const banner = page.locator('.autosave-banner');
  await expect(banner).toBeVisible({ timeout: 30_000 });
  await banner.locator('button.restore').click();
  await expect.poll(() => page.evaluate(() => window.__stabileo.elementIds().length))
    .toBeGreaterThan(0);

  // Calculate.
  fallbacks.length = 0;
  await page.evaluate(async () => { await window.__stabileoActions.solve(); });

  const toasts = page.locator('[class*=toast]');
  await expect
    .poll(async () => (await toasts.allTextContents()).join(' | '), { timeout: 120_000 })
    .toContain('Análisis 3D exitoso');

  const text = (await toasts.allTextContents()).join(' | ');
  expect(text, 'no clone failure reaches the user').not.toContain('could not be cloned');
  expect(text, 'no load case is rejected by the parser').not.toContain('Parse error');
  expect(text, 'every load case solved').not.toContain('Superimposed dead');
  expect(errors, `console errors:\n${errors.join('\n')}`).toEqual([]);
  // The pool is USED, not merely available: a fallback here means the payload stopped being
  // structured-cloneable and the app went single-threaded without telling anyone.
  expect(fallbacks, `the parallel solve fell back:\n${fallbacks.join('\n')}`).toEqual([]);
});
