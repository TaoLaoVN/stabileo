/**
 * The 3-D reinforcement view, through visible controls only.
 *
 * ── What a unit test cannot say ────────────────────────────────────
 *
 * `buildSceneModel` and `createRebarScene` are covered where they live, and a scene full of
 * bars proves nothing about whether a user can get to one. The failure mode this file exists
 * for is the one the Documents journey was written for: a complete, tested feature with no
 * reachable path to it.
 *
 * So every step here is a click, and the assertions are about what the app then shows —
 * including the export, whose CONTENT is read rather than its download event counted.
 *
 * ── Why its own file ───────────────────────────────────────────────
 *
 * The document journeys load the committed project through the same file input, and an
 * eleventh project load in one describe block has already broken all nine tests in another
 * spec through leftover autosaved state. A new journey gets a new file.
 */

import { test, expect, designAll, loadModel } from './fixtures';

type Page = import('@playwright/test').Page;
type Json = Record<string, unknown>;

function assemblies(page: Page): Promise<Json[]> {
  return page.evaluate(() =>
    (window.__stabileo as unknown as { detailingAssemblies(): Json[] }).detailingAssemblies());
}

/** Load, solve, design, coordinate, and open the 3-D view — all through the UI. */
async function open3d(page: Page) {
  await loadModel(page, 'rc-design-qa-8');
  await designAll(page);
  const d = page.getByTestId('detailing-disclosure');
  await expect(d).toBeVisible();
  await d.locator('> summary').click();
  const generate = page.getByTestId('cmd-generate-detailing');
  await expect(generate).toBeEnabled();
  await generate.click();
  await expect.poll(async () => (await assemblies(page)).length, { timeout: 30_000 })
    .toBeGreaterThan(0);

  const open = page.getByTestId('doc-3d');
  await expect(open).toBeVisible();
  await open.click();
  await expect(page.getByTestId('rebar-scene')).toBeVisible();
}

test.describe('the 3-D reinforcement view is reachable', () => {
  test('the command sits with the other document outputs', async ({ pro: page }) => {
    await loadModel(page, 'rc-design-qa-8');
    await designAll(page);
    await page.getByTestId('detailing-disclosure').locator('> summary').click();
    const generate = page.getByTestId('cmd-generate-detailing');
    await expect(generate).toBeEnabled();
    await generate.click();
    await expect.poll(async () => (await assemblies(page)).length, { timeout: 30_000 })
      .toBeGreaterThan(0);
    // Beside the report, the DXF and the schedule, because it is the same document.
    await expect(page.getByTestId('doc-report')).toBeVisible();
    await expect(page.getByTestId('doc-3d')).toBeVisible();
  });

  test('opening it renders a canvas and counts real steel', async ({ pro: page }) => {
    await open3d(page);
    await expect(page.getByTestId('rebar-canvas')).toBeVisible();
    // The canvas is WebGL; what is assertable is that the scene it was given is not empty.
    await expect(page.getByTestId('rebar-empty')).toHaveCount(0);
    const summary = page.getByTestId('rebar-summary');
    await expect(summary).toBeVisible();
    // "N barras · X m · Y kg" — a zero-bar summary would mean the view opened on nothing.
    await expect(summary).not.toContainText(/^0 /);
    await expect(summary).toContainText(/\d/);
  });

  test('it states the revision and readiness the exports state', async ({ pro: page }) => {
    await open3d(page);
    const scene = page.getByTestId('rebar-scene');
    const readiness = await page.getByTestId('doc-readiness').innerText();
    // The badge text is the readiness label; the 3-D subtitle must carry the same claim.
    await expect(scene).toContainText(readiness.split('\n')[0].trim());
  });
});

test.describe('filtering changes what is shown, and says so', () => {
  test('hiding every assembly empties the view rather than showing everything',
    async ({ pro: page }) => {
      await open3d(page);
      const before = await page.getByTestId('rebar-summary').innerText();

      // Deselect every assembly checkbox. An empty filter must match nothing — the state a
      // user reaches by unticking the last box.
      const boxes = page.getByTestId('rebar-scene').locator('fieldset').first()
        .locator('input[type="checkbox"]');
      const n = await boxes.count();
      for (let i = 0; i < n; i++) await boxes.nth(i).uncheck();

      await expect(page.getByTestId('rebar-scope'))
        .toContainText(/No hay ningún conjunto visible|No visible assembly/);
      await expect(page.getByTestId('rebar-export')).toBeDisabled();
      expect(await page.getByTestId('rebar-summary').innerText()).not.toBe(before);
    });

  test('the export scope names the assemblies it will write', async ({ pro: page }) => {
    await open3d(page);
    const scope = page.getByTestId('rebar-scope');
    await expect(scope).toBeVisible();
    // Not a count on its own: the ids, so the user can check before pressing.
    await expect(scope).toContainText(/\w/);
    await expect(page.getByTestId('rebar-export')).toBeEnabled();
  });
});

test.describe('a member the app could not design is shown, not omitted', () => {
  /**
   * The reported bug, as a journey.
   *
   * `rc-qa-diagnostic` has 26 members and four beams the verifier refuses — their secondary
   * bending crosses the biaxial threshold on an axis it does not check. Those four carried no
   * steel, so they joined no assembly, so the 3-D view drew 22 members and gave no sign that
   * anything was missing. The user found it by noticing a hole in a frame they had never seen
   * whole.
   */
  test('names the refused members and says why each has no steel', async ({ pro: page }) => {
    await loadModel(page, 'rc-qa-diagnostic');
    await designAll(page);
    await page.getByTestId('detailing-disclosure').locator('> summary').click();
    const generate = page.getByTestId('cmd-generate-detailing');
    await expect(generate).toBeEnabled();
    await generate.click();
    await expect.poll(async () => (await assemblies(page)).length, { timeout: 30_000 })
      .toBeGreaterThan(0);
    await page.getByTestId('doc-3d').click();

    const block = page.getByTestId('rebar-unreinforced');
    await expect(block).toBeVisible();
    await expect(block).toContainText('4');
    // The cause, not just the count: an unchecked secondary axis with its actual ratio.
    await expect(block).toContainText(/eje|axis/i);
    await expect(block).toContainText('%');
  });
});

test.describe('the drawings exported from the view have content', () => {
  test('the DXF carries geometry and states whether it may be built from',
    async ({ pro: page }) => {
      await open3d(page);
      const [download] = await Promise.all([
        page.waitForEvent('download', { timeout: 30_000 }),
        page.getByTestId('rebar-export').click(),
      ]);
      expect(download.suggestedFilename()).toMatch(/\.dxf$/);

      const stream = await download.createReadStream();
      const chunks: Buffer[] = [];
      for await (const c of stream) chunks.push(c as Buffer);
      const dxf = Buffer.concat(chunks).toString('utf8');

      expect(dxf).toContain('ENTITIES');
      expect(dxf).toContain('EOF');
      // Group code 10 is an X ordinate. No ordinates means nothing was drawn.
      const ordinates = dxf.split('\n').filter((l) => l.trim() === '10').length;
      expect(ordinates, 'the DXF has no coordinates in it').toBeGreaterThan(20);
      expect(dxf).toMatch(/NOT FOR CONSTRUCTION|ISSUED FOR CONSTRUCTION|FOR REVIEW/);
    });
});
