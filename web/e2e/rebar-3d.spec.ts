/**
 * The 3-D reinforcement workspace, through visible controls only.
 *
 * ── What the QA pass found, and what these assert ──────────────────
 *
 * The viewer worked and was unusable: a canvas a few hundred pixels wide, because it was
 * nested inside a sidebar whose width is a fixed pixel value. So the first assertions here
 * are about SIZE — a viewer that renders correctly in a slot nobody can inspect through is a
 * feature that does not exist — and the rest are about whether the inspection it now affords
 * actually works: layers, selection, focus, and every state stated rather than hidden.
 *
 * ── Why its own file ───────────────────────────────────────────────
 *
 * These journeys load committed projects through the same path the document journeys use, and
 * an eleventh project load in one describe block has already broken all nine tests in another
 * spec through leftover autosaved state.
 */

import { test, expect, designAll, loadModel } from './fixtures';

type Page = import('@playwright/test').Page;
type Json = Record<string, unknown>;

function assemblies(page: Page): Promise<Json[]> {
  return page.evaluate(() =>
    (window.__stabileo as unknown as { detailingAssemblies(): Json[] }).detailingAssemblies());
}

/** Load, solve, design, coordinate, and open the workspace — all through the UI. */
async function openWorkspace(page: Page, example = 'rc-design-qa-8') {
  await loadModel(page, example);
  await designAll(page);
  await page.getByTestId('detailing-disclosure').locator('> summary').click();
  const generate = page.getByTestId('cmd-generate-detailing');
  await expect(generate).toBeEnabled();
  await generate.click();
  await expect.poll(async () => (await assemblies(page)).length, { timeout: 30_000 })
    .toBeGreaterThan(0);
  await page.getByTestId('doc-3d').click();
  await expect(page.getByTestId('rebar-workspace')).toBeVisible();
}

/** How much of the window the workspace covers, as a fraction of its area. */
async function coverage(page: Page): Promise<number> {
  const box = await page.getByTestId('rebar-workspace').boundingBox();
  const win = page.viewportSize()!;
  if (!box) return 0;
  return (box.width * box.height) / (win.width * win.height);
}

// ─── The size problem this pass exists for ───────────────────────

test.describe('the workspace is the workspace, not a corner of one', () => {
  test('it covers essentially the whole window', async ({ pro: page }) => {
    await openWorkspace(page);
    // The sidebar this used to live in is a few hundred pixels wide on a 1600 px viewport —
    // well under a fifth of it. Anything below 0,9 here means it is still nested in something.
    expect(await coverage(page)).toBeGreaterThan(0.9);
    await expect(page.getByTestId('rebar-canvas')).toBeVisible();
  });

  test('the canvas itself is large, not just the frame around it', async ({ pro: page }) => {
    await openWorkspace(page);
    const canvas = await page.getByTestId('rebar-canvas').boundingBox();
    const win = page.viewportSize()!;
    expect(canvas!.width).toBeGreaterThan(win.width * 0.5);
    expect(canvas!.height).toBeGreaterThan(win.height * 0.4);
  });

  test('it closes and the model is still there', async ({ pro: page }) => {
    await openWorkspace(page);
    const before = await page.evaluate(() => window.__stabileo.elementIds());
    await page.getByTestId('rebar-workspace-close').click();
    await expect(page.getByTestId('rebar-workspace')).toHaveCount(0);
    // Closing is a VIEW operation. The project must be identical either side of it.
    expect(await page.evaluate(() => window.__stabileo.elementIds())).toEqual(before);
    expect((await assemblies(page)).length).toBeGreaterThan(0);
  });

  test('it reopens with the layers the user left set', async ({ pro: page }) => {
    await openWorkspace(page);
    await page.getByTestId('rebar-layer-bars').uncheck();
    await page.getByTestId('rebar-workspace-close').click();
    await page.getByTestId('rebar-open-workspace').click();
    await expect(page.getByTestId('rebar-workspace')).toBeVisible();
    // Stepping out to check something and coming back must not cost the whole setup.
    await expect(page.getByTestId('rebar-layer-bars')).not.toBeChecked();
  });

  test('on a phone the rail folds away and the canvas keeps the screen',
    async ({ pro: page }) => {
      /**
       * Opened at desktop size and then resized, deliberately.
       *
       * Reaching the RC workflow on a 390 px screen goes through the PRO drawer, which is a
       * different navigation problem and not what this test is about. Resizing after the
       * workspace is open exercises exactly the thing under test — whether the workspace
       * itself is usable at that size.
       */
      await openWorkspace(page);
      await page.setViewportSize({ width: 390, height: 844 });
      await expect(page.getByTestId('rebar-workspace')).toBeVisible();
      expect(await coverage(page)).toBeGreaterThan(0.9);
      // The rail becomes a sheet over the canvas, reachable in one tap.
      const toggle = page.getByTestId('rebar-rail-toggle');
      await expect(toggle).toBeVisible();
      const canvas = await page.getByTestId('rebar-canvas').boundingBox();
      expect(canvas!.width).toBeGreaterThan(300);

      /**
       * Assert the toggle TOGGLES, not that it opens.
       *
       * The rail's initial state is decided at mount from the window width, and this test
       * mounts at desktop size before resizing — so pinning a direction here would be pinning
       * an artefact of the test's own setup rather than the control's behaviour.
       */
      const before = await toggle.getAttribute('aria-expanded');
      await toggle.click();
      await expect(toggle).not.toHaveAttribute('aria-expanded', before ?? '');
      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-expanded', before ?? '');
    });
});

// ─── Layers ──────────────────────────────────────────────────────

test.describe('every family is a layer of one model', () => {
  test('reinforcement can be hidden and shown without losing the concrete',
    async ({ pro: page }) => {
      await openWorkspace(page);
      const before = await page.getByTestId('rebar-workspace-summary').innerText();
      await page.getByTestId('rebar-layer-bars').uncheck();
      // "Hide reinforcement" hides reinforcement. It does not hide the building.
      await expect(page.getByTestId('rebar-workspace-summary')).not.toHaveText(before);
      await expect(page.getByTestId('rebar-canvas')).toBeVisible();
      await page.getByTestId('rebar-layer-bars').check();
      await expect(page.getByTestId('rebar-workspace-summary')).toHaveText(before);
    });

  test('foundations are a switch on the same model, not a separate route',
    async ({ pro: page }) => {
      await openWorkspace(page);
      const footings = page.getByTestId('rebar-layer-footing');
      await expect(footings).toBeVisible();
      await expect(footings).toBeChecked();
      await footings.uncheck();
      await expect(footings).not.toBeChecked();
      await footings.check();
      // The point of the switch: a footing and the column it carries are in one picture, so
      // "do these two agree" is a question the user can actually ask.
      await expect(page.getByTestId('rebar-layer-column')).toBeChecked();
    });

  test('concrete opacity does not break selection or identity', async ({ pro: page }) => {
    await openWorkspace(page);
    await page.getByTestId('rebar-element-list').locator('button').first().click();
    const parent = await page.getByTestId('rebar-sel-parent').innerText();
    // Turn the concrete right up; the selection and the ids it reports must not move.
    await page.getByTestId('rebar-opacity').fill('2');
    await expect(page.getByTestId('rebar-sel-parent')).toHaveText(parent);
  });

  test('a section can be cut and removed again', async ({ pro: page }) => {
    await openWorkspace(page);
    await page.getByTestId('rebar-section-axis').selectOption('z');
    await expect(page.getByTestId('rebar-section-at')).toBeVisible();
    await page.getByTestId('rebar-section-axis').selectOption('');
    await expect(page.getByTestId('rebar-section-at')).toHaveCount(0);
  });
});

// ─── Selection and navigation ────────────────────────────────────

test.describe('inspection', () => {
  test('picking a member from the list selects it and centres the camera',
    async ({ pro: page }) => {
      await openWorkspace(page);
      const first = page.getByTestId('rebar-element-list').locator('button').first();
      const label = await first.innerText();
      await first.click();
      // `data-focused` is set from the RETURN of the focus call, so it says the camera
      // actually moved rather than that a move was requested.
      await expect(page.getByTestId('rebar-inspector')).not.toHaveAttribute('data-focused', '');
      await expect(page.getByTestId('rebar-sel-parent')).toBeVisible();
      expect(label).toMatch(/\d/);
    });

  test('going back returns to the member looked at before', async ({ pro: page }) => {
    await openWorkspace(page);
    const list = page.getByTestId('rebar-element-list').locator('button');
    await list.nth(0).click();
    const firstParent = await page.getByTestId('rebar-sel-parent').innerText();
    await list.nth(1).click();
    await expect(page.getByTestId('rebar-sel-parent')).not.toHaveText(firstParent);
    await page.getByTestId('rebar-back').click();
    await expect(page.getByTestId('rebar-sel-parent')).toHaveText(firstParent);
  });

  test('a member can be isolated and the whole model brought back',
    async ({ pro: page }) => {
      await openWorkspace(page);
      const before = await page.getByTestId('rebar-workspace-summary').innerText();
      await page.getByTestId('rebar-element-list').locator('button').first().click();
      await page.getByTestId('rebar-isolate').click();
      await expect(page.getByTestId('rebar-workspace-summary')).not.toHaveText(before);
      await page.getByTestId('rebar-clear-isolation').click();
      await expect(page.getByTestId('rebar-workspace-summary')).toHaveText(before);
    });
});

// ─── Honest states ───────────────────────────────────────────────

test.describe('nothing is hidden because it has no steel', () => {
  test('every state present has a row with its own count', async ({ pro: page }) => {
    await openWorkspace(page, 'rc-qa-diagnostic');
    const counts = page.getByTestId('rebar-status-counts');
    await expect(counts).toBeVisible();
    // This fixture has four beams the verifier refuses. They are a state of their own, not
    // folded into a generic "not ready" and not absent.
    await expect(page.getByTestId('rebar-status-UNSUPPORTED')).toBeVisible();
    await expect(page.getByTestId('rebar-status-MODELLED')).toBeVisible();
  });

  test('filtering to a refused state lists exactly those members',
    async ({ pro: page }) => {
      await openWorkspace(page, 'rc-qa-diagnostic');
      await page.getByTestId('rebar-status-UNSUPPORTED').click();
      const rows = page.getByTestId('rebar-element-list').locator('button');
      await expect(rows).toHaveCount(4);
      // And they can still be selected and looked at — being refused does not make a member
      // unreachable, which was the original defect.
      await rows.first().click();
      await expect(page.getByTestId('rebar-sel-status')).toContainText(/No soportado|Unsupported/);
    });

  test('the sidebar states the same counts without opening the workspace',
    async ({ pro: page }) => {
      await openWorkspace(page, 'rc-qa-diagnostic');
      await page.getByTestId('rebar-workspace-close').click();
      // A user who never opens the overlay must still be told. Closing it cannot re-hide the
      // members the whole change exists to surface.
      await expect(page.getByTestId('rebar-panel-state-UNSUPPORTED')).toBeVisible();
      await expect(page.getByTestId('rebar-unreinforced')).toContainText('4');
    });
});

// ─── Cleanliness ─────────────────────────────────────────────────

test.describe('the workspace is quiet', () => {
  test('opening, filtering and selecting logs no Svelte error', async ({ pro: page }) => {
    const errors: string[] = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push(String(e)));

    await openWorkspace(page, 'rc-qa-diagnostic');
    await page.getByTestId('rebar-layer-footing').uncheck();
    await page.getByTestId('rebar-layer-bars').uncheck();
    await page.getByTestId('rebar-layer-bars').check();
    await page.getByTestId('rebar-status-MODELLED').click();
    await page.getByTestId('rebar-element-list').locator('button').first().click();
    await page.getByTestId('rebar-section-axis').selectOption('z');
    await page.getByTestId('rebar-workspace-close').click();

    // Svelte's dev-mode guards (each_key_duplicate, state_unsafe_mutation, effect_update_depth)
    // all report through console.error, so this catches the class rather than one instance.
    expect(errors.filter((e) => /svelte|each_key|effect_update|state_unsafe/i.test(e)))
      .toEqual([]);
  });
});

// ─── The drawings still come out ─────────────────────────────────

test.describe('the drawings exported from the panel have content', () => {
  test('the DXF carries geometry and states whether it may be built from',
    async ({ pro: page }) => {
      await openWorkspace(page);
      await page.getByTestId('rebar-workspace-close').click();
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
      const ordinates = dxf.split('\n').filter((l) => l.trim() === '10').length;
      expect(ordinates, 'the DXF has no coordinates in it').toBeGreaterThan(20);
      expect(dxf).toMatch(/NOT FOR CONSTRUCTION|ISSUED FOR CONSTRUCTION|FOR REVIEW/);
    });
});
