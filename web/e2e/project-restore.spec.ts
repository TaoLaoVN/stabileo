/**
 * The returning user's whole path: open, reload, restore, and do the day's work.
 *
 * ── What this file is for ──────────────────────────────────────────
 *
 * Every failure in this investigation was reachable from one short sequence, and none of them
 * was reachable from the unit suite:
 *
 *   Error al resolver 3D: Failed to execute 'postMessage' on 'Worker':
 *   [object Array] could not be cloned.
 *
 *   Error en caso 3D "Superimposed dead (screed+finish+partitions)":
 *   Parse error: Error: invalid type: unit value, expected a sequence
 *
 * The causes are owned by `project-restore-roundtrip.test.ts`, which proves each one in
 * isolation. What only a browser can show is that they are GONE from the sequence a person
 * actually performs — and, in one case, that a repair was ever needed at all: the parallel
 * solve had been throwing `DataCloneError` on every solve of any model carrying a constraint,
 * and `solveCombinations3DParallel` caught it and fell back to the sequential solver. Correct
 * results, one thread, and the only trace was a `console.warn` nobody was reading. So a silent
 * fallback is a FAILURE here, not a detail.
 *
 * ── Restored twice, and what the second pass found ─────────────────
 *
 * The journey restores, works, and then reloads and restores AGAIN, because a returning user
 * does not return once.
 *
 * The second pass was written expecting to restore a snapshot carrying the whole design, and
 * that is not what the app can offer. `localStorage` gives an origin a few megabytes, and this
 * project stops fitting the moment `designAll` finishes: the autosave is written normally
 * after the load and after the solve, and from the design onwards every write throws
 * `QuotaExceededError`. It used to throw in silence, which is worse than not saving — the key
 * still held the PRE-DESIGN snapshot, so a reload offered a restore banner that handed back
 * the model as it was before the design ran, with nothing reporting the difference.
 *
 * That is now reported to the user (see `autosave-overflow.test.ts`), and this journey asserts
 * it: the warning appears, and the second restore is performed against the snapshot the app
 * genuinely has. Making the project fit — compressing it, or moving the autosave to IndexedDB
 * — is a change to how this app persists work and is not made here.
 *
 * ── Nothing here is a timing ───────────────────────────────────────
 *
 * The forbidden strings are watched on the console and on every toast for the whole run, so a
 * failure is attributed to the step that caused it. The viewport assertions are counters —
 * canvases, WebGL contexts, scene builds — because a browser drops the oldest context without
 * warning past about sixteen, and a leak per open is a viewport that silently stops rendering
 * after a dozen visits.
 */

import { test, expect } from '@playwright/test';

type Page = import('@playwright/test').Page;

const PRO_URL = '/app/pro?e2e=1';
const AUTOSAVE_KEY = 'stabileo-autosave';
const EXAMPLE = 'pro-edificio-7p';

/**
 * Anything that must never appear, whatever the step.
 *
 * Matched against console output AND against the visible toasts, because the app catches most
 * of these and turns them into a message — which is how they reached the user in the first
 * place, and how they would reach one again.
 */
const FORBIDDEN = [
  /could not be cloned/i,
  /structured.?clone/i,
  /postMessage/i,
  /invalid type/i,
  /parse error/i,
  /not structured-cloneable/i,
];

/** A silent downgrade from the worker pool to the main thread. */
const FALLBACK = /Parallel solve failed|falling back to sequential/i;

interface Watch {
  errors: string[];
  fallbacks: string[];
  forbidden: string[];
}

function watchPage(page: Page): Watch {
  const w: Watch = { errors: [], fallbacks: [], forbidden: [] };
  const inspect = (text: string, fromError: boolean) => {
    if (fromError && !/SwiftShader|WebGL|GroupMarkerNotSet|Automatic fallback/i.test(text)) {
      w.errors.push(text);
    }
    if (FALLBACK.test(text)) w.fallbacks.push(text);
    for (const rx of FORBIDDEN) if (rx.test(text)) { w.forbidden.push(text); break; }
  };
  page.on('console', (m) => inspect(m.text(), m.type() === 'error'));
  page.on('pageerror', (e) => inspect(String(e), true));
  return w;
}

/** Assert the run is still clean, naming the step that dirtied it. */
async function assertClean(page: Page, w: Watch, step: string) {
  const toasts = (await page.locator('[class*=toast]').allTextContents()).join(' | ');
  for (const rx of FORBIDDEN) {
    expect(toasts, `${step}: a toast matched ${rx}`).not.toMatch(rx);
  }
  expect(w.forbidden, `${step}: forbidden output\n${w.forbidden.join('\n')}`).toEqual([]);
  expect(w.errors, `${step}: console errors\n${w.errors.join('\n')}`).toEqual([]);
  expect(w.fallbacks, `${step}: the parallel solve fell back\n${w.fallbacks.join('\n')}`).toEqual([]);
}

/** Boot the PRO app in a known locale, optionally seeding an autosave. */
async function boot(page: Page, autosave: string | null) {
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

/** Press Restaurar on the banner the app shows for a saved project. */
async function restoreFromBanner(page: Page) {
  const banner = page.locator('.autosave-banner');
  await expect(banner, 'the saved-project banner is offered').toBeVisible({ timeout: 30_000 });
  await expect(banner).toContainText('Se encontró un proyecto guardado');
  await banner.locator('button.restore').click();
  await expect
    .poll(() => page.evaluate(() => window.__stabileo.elementIds().length), { timeout: 30_000 })
    .toBeGreaterThan(0);
}

/** Calculate, and wait for the result rather than for a duration. */
async function calculate(page: Page) {
  const before = await page.evaluate(() => window.__stabileo.solveCount());
  await page.evaluate(async () => { await window.__stabileoActions.solve(); });
  await expect
    .poll(() => page.evaluate(() => window.__stabileo.solveCount()), { timeout: 120_000 })
    .toBeGreaterThan(before);
  await expect
    .poll(async () => (await page.locator('[class*=toast]').allTextContents()).join(' | '),
      { timeout: 120_000 })
    .toContain('Análisis 3D exitoso');
}

/** The counters a viewport open must not move by more than one. */
async function counters(page: Page) {
  return page.evaluate(() => ({
    builds: window.__stabileo.rebarSceneBuilds(),
    canvases: document.querySelectorAll('canvas').length,
    contexts: [...document.querySelectorAll('canvas')].filter((c) =>
      !!(c as HTMLCanvasElement).getContext('webgl2')
      || !!(c as HTMLCanvasElement).getContext('webgl')).length,
  }));
}

/** What the workspace says is in the scene, read off its own tally. */
async function tally(page: Page) {
  const families: Record<string, { solids: number; longitudinal: number; transverse: number }> = {};
  for (const family of ['column', 'beam', 'slab', 'wall', 'footing', 'pedestal']) {
    const row = page.getByTestId(`rebar-tally-${family}`);
    if (await row.count() === 0) continue;
    const cells = await row.locator('td').allTextContents();
    families[family] = {
      solids: parseInt(cells[0] ?? '0', 10),
      longitudinal: parseInt(cells[1] ?? '0', 10),
      transverse: parseInt(cells[2] ?? '0', 10),
    };
  }
  return families;
}

/**
 * Open the 3-D workspace and wait for the SCENE, not for the overlay.
 *
 * The workspace paints before it builds — that is what stops the click looking dead on a model
 * whose floors have been designed — so "visible" is not "ready". The build counter is the
 * signal that the geometry exists, and it moves exactly once per build whatever the model's
 * size, unlike the transient "building" status which a small model may never paint.
 */
async function openViewer(page: Page, step: string) {
  const before = await counters(page);
  await page.getByTestId('doc-3d').click();
  await expect(page.getByTestId('rebar-workspace')).toBeVisible({ timeout: 120_000 });
  await expect
    .poll(() => page.evaluate(() => window.__stabileo.rebarSceneBuilds()), { timeout: 180_000 })
    .toBeGreaterThan(before.builds);
  // A scene that built but drew nothing is an empty viewport, and it looks like a working one.
  await expect
    .poll(() => page.evaluate(() => window.__stabileo.canvasInkRatio()), { timeout: 120_000 })
    .toBeGreaterThan(0);

  const after = await counters(page);
  expect(after.builds - before.builds, `${step}: one geometry build per open`).toBe(1);
  expect(after.canvases - before.canvases, `${step}: no duplicate canvas`).toBe(1);
  expect(after.contexts - before.contexts, `${step}: no extra WebGL context`).toBe(1);
  return after;
}

async function closeViewer(page: Page) {
  await page.getByTestId('rebar-workspace-close').click();
  await expect(page.getByTestId('rebar-workspace')).toBeHidden();
}

/** The app must still answer while and after all of this. */
async function assertResponsive(page: Page, step: string) {
  const t0 = Date.now();
  const answer = await page.evaluate(() => window.__stabileo.elementIds().length);
  const dt = Date.now() - t0;
  expect(answer, `${step}: the app still knows its model`).toBeGreaterThan(0);
  expect(dt, `${step}: the app answered in ${dt} ms`).toBeLessThan(15_000);
}

test('@slow restore, design, view in 3-D — then reload and do it again', async ({ page }) => {
  test.setTimeout(900_000);
  const w = watchPage(page);

  // ── 1. Open the example ──────────────────────────────────────────
  await boot(page, null);
  await page.evaluate(() => window.__stabileoActions.openDesignTab());
  await page.evaluate((name) => window.__stabileoActions.loadExample(name), EXAMPLE);
  await expect.poll(() => page.evaluate(() => window.__stabileo.elementIds().length))
    .toBeGreaterThan(0);

  // The autosave is written by the app's own 30 s timer. Waited for rather than faked: the
  // defect lived in what that timer wrote and in what the banner did with it.
  await expect
    .poll(() => page.evaluate((k) => localStorage.getItem(k)?.length ?? 0, AUTOSAVE_KEY),
      { timeout: 90_000, intervals: [1000] })
    .toBeGreaterThan(0);
  const firstSave = await page.evaluate((k) => localStorage.getItem(k), AUTOSAVE_KEY);

  // ── 2–4. Reload, find the banner, restore ────────────────────────
  await boot(page, firstSave);
  await page.evaluate(() => window.__stabileoActions.openDesignTab());
  await restoreFromBanner(page);
  await assertClean(page, w, 'restore');

  // ── 5–6. Calculate ───────────────────────────────────────────────
  await calculate(page);
  await assertClean(page, w, 'calculate after restore');

  // ── 7. Verify, design all, detail, and design the floors ─────────
  await page.evaluate(() => window.__stabileoActions.computeDemands());
  await page.evaluate(() => window.__stabileoActions.codeCheck());
  await page.evaluate(() => window.__stabileoActions.designAll());
  await expect.poll(() => page.evaluate(() => window.__stabileo.runCounts()?.total ?? 0),
    { timeout: 180_000 }).toBeGreaterThan(0);
  const runCounts = (await page.evaluate(() => window.__stabileo.runCounts()))!;
  expect(runCounts.verified, 'members were verified').toBeGreaterThan(0);
  await assertClean(page, w, 'design all');

  await page.getByTestId('detailing-disclosure').locator('> summary').click();
  const generate = page.getByTestId('cmd-generate-detailing');
  await expect(generate).toBeEnabled();
  await generate.click();
  await expect
    .poll(() => page.evaluate(() => (window.__stabileo as unknown as
      { detailingAssemblies(): unknown[] }).detailingAssemblies().length), { timeout: 180_000 })
    .toBeGreaterThan(0);

  await page.getByTestId('floor-families-disclosure').locator('> summary').click();
  const floors = page.getByTestId('floor-design-run');
  await expect(floors).toBeEnabled();
  await floors.click();
  await expect(page.getByTestId('floor-families')).toBeVisible({ timeout: 300_000 });
  await assertClean(page, w, 'detailing and floor design');
  await assertResponsive(page, 'after the floor design');

  // ── 8–9. Open the viewer and check the scene is COMPLETE ─────────
  await openViewer(page, 'first open');
  await assertClean(page, w, 'open 3-D');

  const families = await tally(page);
  console.log('scene tally after floor design:', JSON.stringify(families));
  for (const family of ['column', 'beam', 'slab', 'wall'] as const) {
    expect(families[family], `${family} is present in the tally`).toBeTruthy();
    expect(families[family].solids, `${family} has concrete in the scene`).toBeGreaterThan(0);
  }
  // The families the DOCUMENT produced steel for must have steel HERE. Slabs and walls are the
  // ones the floor design adds, and the ones a projection bug would drop.
  for (const family of ['column', 'slab', 'wall'] as const) {
    const bars = families[family].longitudinal + families[family].transverse;
    expect(bars, `${family} carries its steel into the scene`).toBeGreaterThan(0);
  }
  // …and none of them may be reported as an empty family while the document holds them.
  const emptyFamilies = await page.getByTestId('rebar-empty-families').textContent()
    .catch(() => null);
  for (const family of ['Losa', 'Tabique', 'Columna', 'Viga']) {
    if (emptyFamilies) expect(emptyFamilies).not.toContain(family);
  }

  // Beam states: the 117 biaxial refusals are reported, not hidden, and their cause is stated
  // once rather than 117 times.
  const unsupported = page.getByTestId('rebar-status-UNSUPPORTED');
  await expect(unsupported, 'refused members keep their own row').toBeVisible();
  const cause = page.getByTestId('rebar-status-cause-UNSUPPORTED');
  await expect(cause, 'the shared cause is stated').toBeVisible();
  await expect(cause).toHaveAttribute('data-reason-key', 'design.reason.secondaryAxisUnchecked');

  // Selection: a member picked from the list becomes the selection.
  const firstMember = page.getByTestId('rebar-element-list').locator('button.element').first();
  await firstMember.click();
  await expect(page.getByTestId('rebar-element-list').locator('button.selected'))
    .toHaveCount(1);

  // ── 10. Close ────────────────────────────────────────────────────
  await closeViewer(page);
  await assertClean(page, w, 'close 3-D');

  // ── 11–13. Reload, restore again, calculate again, open again ────
  /**
   * The designed project does not fit in `localStorage`, and the app must say so.
   *
   * Waited for rather than asserted immediately: the write is on the app's own 30 s timer, so
   * the warning arrives when the timer next fires and finds the project over quota. What is
   * NOT acceptable — and is what this asserts against — is the failure passing unremarked
   * while the stored snapshot silently stays at its pre-design state.
   */
  await expect
    .poll(async () => (await page.locator('[class*=toast]').allTextContents()).join(' | '),
      { timeout: 120_000, intervals: [1000] })
    .toMatch(/demasiado grande para el guardado autom/i);

  const designedSave = await page.evaluate((k) => localStorage.getItem(k), AUTOSAVE_KEY);
  expect(designedSave, 'the stored snapshot is the one from before the design')
    .toBe(firstSave);
  expect(firstSave, 'and it carries no reinforcement, which is exactly the problem reported')
    .not.toContain('"reinforcement"');

  await boot(page, designedSave);
  await page.evaluate(() => window.__stabileoActions.openDesignTab());
  w.errors.length = 0; w.fallbacks.length = 0; w.forbidden.length = 0;
  await restoreFromBanner(page);
  await calculate(page);
  await assertClean(page, w, 'calculate after the second restore');

  // The detailing has to be regenerated after a restore — the document is not persisted — so
  // the viewer is opened on the same path a user would take.
  await page.evaluate(() => window.__stabileoActions.computeDemands());
  await page.evaluate(() => window.__stabileoActions.designAll());
  await expect.poll(() => page.evaluate(() => window.__stabileo.runCounts()?.total ?? 0),
    { timeout: 180_000 }).toBeGreaterThan(0);
  await page.getByTestId('detailing-disclosure').locator('> summary').click();
  const regenerate = page.getByTestId('cmd-generate-detailing');
  await expect(regenerate).toBeEnabled();
  await regenerate.click();
  await expect
    .poll(() => page.evaluate(() => (window.__stabileo as unknown as
      { detailingAssemblies(): unknown[] }).detailingAssemblies().length), { timeout: 180_000 })
    .toBeGreaterThan(0);

  await openViewer(page, 'second open, after a second restore');
  await assertClean(page, w, 'open 3-D after the second restore');
  const familiesAgain = await tally(page);
  console.log('scene tally after the second restore:', JSON.stringify(familiesAgain));
  for (const family of ['column', 'beam'] as const) {
    expect(familiesAgain[family].solids, `${family} survives the second restore`)
      .toBeGreaterThan(0);
  }
  await assertResponsive(page, 'end of journey');
});
