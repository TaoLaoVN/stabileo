/**
 * What returning from another browser tab actually costs.
 *
 * ── Why this is measured and not just asserted ─────────────────────
 *
 * The viewport used to rebuild every tube whenever the scene OBJECT changed, and `filterScene`
 * returns a fresh object on every recompute. Any reactive touch rebuilt 20 917 tubes. Coming
 * back from another tab was the worst case: `requestAnimationFrame` is suspended while hidden,
 * Svelte flushes every pending effect the instant it returns, and the user got a frozen camera
 * and dead controls for about three seconds.
 *
 * `sceneSignature` fixed the cause. This measures the result, because a fix to a latency
 * problem that nobody timed is a hope.
 *
 * ── The limitation, stated ─────────────────────────────────────────
 *
 * Playwright cannot reproduce Chrome's real background throttling: a page driven by CDP is
 * never truly backgrounded, and `page.emulateMedia` does not touch the visibility state. So
 * this dispatches `visibilitychange` directly. That exercises every listener and every effect
 * flush the real transition triggers — which is where the cost was — but it does NOT reproduce
 * the timer clamping or the rAF suspension that precede them. The numbers here are therefore a
 * FLOOR on the real-world improvement, not a simulation of it.
 */
import { test, expect, designAll, loadModel } from './fixtures';

type Page = import('@playwright/test').Page;

async function openWorkspace(page: Page, example: string, withFloors = false) {
  await loadModel(page, example);
  await designAll(page);
  await page.getByTestId('detailing-disclosure').locator('> summary').click();
  const gen = page.getByTestId('cmd-generate-detailing');
  await expect(gen).toBeEnabled();
  await gen.click();
  await expect.poll(async () => page.evaluate(() =>
    (window.__stabileo as unknown as { detailingAssemblies(): unknown[] })
      .detailingAssemblies().length), { timeout: 30_000 }).toBeGreaterThan(0);
  if (withFloors) {
    await page.getByTestId('floor-families-disclosure').locator('> summary').click();
    const f = page.getByTestId('floor-design-run');
    await expect(f).toBeEnabled();
    await f.click();
    await expect(page.getByTestId('floor-families')).toBeVisible();
  }
  await page.getByTestId('doc-3d').click();
  await expect(page.getByTestId('rebar-workspace')).toBeVisible();
}

/** Drive the tab hidden and back, and time what the user would wait for. */
async function reactivate(page: Page) {
  return page.evaluate(async () => {
    const fire = (state: string) => {
      Object.defineProperty(document, 'visibilityState',
        { configurable: true, get: () => state });
      document.dispatchEvent(new Event('visibilitychange'));
      window.dispatchEvent(new Event(state === 'hidden' ? 'blur' : 'focus'));
    };
    fire('hidden');
    await new Promise((r) => setTimeout(r, 120));

    const t0 = performance.now();
    fire('visible');
    // One frame plus one macrotask is where a synchronous rebuild would land.
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    const afterFrame = performance.now() - t0;
    await new Promise((r) => setTimeout(r, 0));
    return { afterFrame, canvases: document.querySelectorAll('canvas').length };
  });
}

/** How long the side panel takes to answer a click. */
async function panelResponse(page: Page): Promise<number> {
  const t0 = Date.now();
  await page.getByTestId('rebar-element-list').locator('button').first().click();
  await expect(page.getByTestId('rebar-sel-parent')).toBeVisible();
  return Date.now() - t0;
}

/**
 * The budget each model is held to, in milliseconds to the first frame after returning.
 *
 * ── Why the big model's budget is not 600 ms ───────────────────────
 *
 * Because it does not meet 600 ms, and pretending otherwise by widening the number without
 * saying so is how a latency problem gets declared fixed.
 *
 * `sceneSignature` removed the geometry rebuild — the seconds of tube-building that used to
 * dominate — and the small model now returns in a frame. The 7-storey building still costs
 * about 2,4 s, and the WebGL evidence says the remaining cost is NOT the renderer: no context
 * is created or lost across five round trips, and no canvas is added. What is left is the
 * derived chain above the viewport, where `buildSceneModel` samples 20 917 bars.
 *
 * So the budget is the measured cost with headroom, pinned as a CEILING. It cannot silently
 * grow, and the gap between the two rows is the work that remains.
 */
const REACTIVATION_BUDGET_MS = { 'small control': 600, '7-storey building': 3200 } as const;

for (const [label, example, floors] of [
  ['small control', 'rc-qa-diagnostic', false],
  ['7-storey building', 'pro-edificio-7p', true],
] as const) {
  test.describe(`returning to the tab — ${label}`, () => {
    test('the workspace answers immediately and keeps its state', async ({ pro: page }) => {
      test.setTimeout(300_000);
      await openWorkspace(page, example, floors);

      // Set a state a rebuild would destroy, and a selection to compare against.
      await page.getByTestId('rebar-layer-footing').uncheck();
      await page.getByTestId('rebar-element-list').locator('button').first().click();
      const before = await page.getByTestId('rebar-sel-parent').innerText();
      const canvasesBefore = await page.evaluate(() => document.querySelectorAll('canvas').length);

      const { afterFrame, canvases } = await reactivate(page);

      // Held to this model's own budget. The gap between the two rows is the remaining work,
      // and neither may grow without this failing.
      expect(afterFrame, `first frame after returning (${label})`)
        .toBeLessThan(REACTIVATION_BUDGET_MS[label]);

      // No new WebGL context: a leaked one per reactivation is how the viewport silently
      // stops rendering after a dozen visits.
      expect(canvases).toBe(canvasesBefore);

      // Nothing the user had set is lost.
      await expect(page.getByTestId('rebar-layer-footing')).not.toBeChecked();
      await expect(page.getByTestId('rebar-sel-parent')).toHaveText(before);

      // And the panel still answers a click promptly.
      expect(await panelResponse(page), 'panel response').toBeLessThan(4000);
    });

    test('repeated switching does not accumulate contexts', async ({ pro: page }) => {
      test.setTimeout(300_000);
      await openWorkspace(page, example, floors);
      const start = await page.evaluate(() => document.querySelectorAll('canvas').length);
      for (let i = 0; i < 5; i++) await reactivate(page);
      // Five round trips. A context or a canvas per trip is the leak this catches.
      expect(await page.evaluate(() => document.querySelectorAll('canvas').length)).toBe(start);
      await expect(page.getByTestId('rebar-canvas')).toBeVisible();
    });
  });
}
