/**
 * Where the 3D viewport actually spends its time.
 *
 * ── Why this spec is shaped the way it is ────────────────────────────────────
 * The viewport renders ON DEMAND: `Viewport3D.svelte` only re-schedules a frame
 * while something needs one (camera motion, animation, held nav key). When the
 * scene is quiet the render loop STOPS. Two consequences drive everything below.
 *
 * 1. There is no such thing as "idle fps". Zero frames render, so a reading taken
 *    while the scene is quiet is not a measurement of idle — it is whatever the
 *    HUD last flushed, frozen. The earlier version of this spec sampled exactly
 *    that and labelled it `idle`; it was really the tail of model LOAD.
 *
 * 2. A sample must cover a window that lies ENTIRELY inside the gesture. The HUD
 *    flushes every ~250ms, unaligned to when a gesture starts, so the first window
 *    after the gesture begins straddles the boundary and mixes in pre-gesture
 *    frames. `sampleCleanWindow` therefore waits for the HUD's `data-flush`
 *    counter to advance TWICE: edge 1 closes the straddling window, edge 2 closes
 *    the first window fully inside the gesture. That second window is the sample.
 *
 * ── Two kinds of rotation, measured separately ───────────────────────────────
 * They take different code paths, and conflating them hides the thing we care about:
 *
 *   • ARROW KEYS orbit the camera by mutating it directly (Viewport3D ~line 411).
 *     They never fire OrbitControls' `start` event, so the orbit LOD does NOT
 *     engage and pixelRatio is NOT dropped. Holding a key also keeps the loop
 *     continuous. This is the honest FULL-DETAIL cost of one frame of this model.
 *
 *   • MOUSE DRAG goes through OrbitControls, which fires `start` → the heavy-model
 *     LOD collapses the scene to the batched wireframe and pixelRatio drops to 1.
 *
 * Comparing the two on the same model is what tells you whether the LOD is
 * actually buying anything, and how much detail it costs to get it.
 *
 * ── Reading the numbers ──────────────────────────────────────────────────────
 * `calls`, `tris` and `geos` come from `renderer.info` as exact per-frame counts.
 * They do not depend on the GPU or on the harness — trust these across machines.
 *
 * `renderMs` and `syncMs` are measured INSIDE the page around real work, so they
 * are honest costs, but Playwright runs SwiftShader (software GL): treat them as
 * an A/B signal between rows, never as a real-GPU absolute.
 *
 * `fps` needs one more caveat, and it is the easy way to fool yourself here:
 *   • `orbit:fulldet` is SELF-DRIVEN — the key is held and rAF runs the loop, so
 *     its fps is the app's own rate and is meaningful.
 *   • `orbit:lod` and `zoom` are HARNESS-DRIVEN — each frame needs a
 *     `page.mouse.move`/`wheel` round trip, which costs far more than a frame.
 *     Their fps measures how fast Playwright can dispatch input, NOT how fast the
 *     app renders. Never compare an fps across those two groups. Compare
 *     `renderMs` instead — it is immune to the dispatch rate.
 *
 * Run: E2E_PORT=<free port> npx playwright test viewport-perf --reporter=list
 */
import { test, expect, loadModel, PRO_URL } from './fixtures';

/** `?perf` switches the HUD on at boot — more robust than seeding localStorage,
 *  which the shared fixture clears before the app boots. */
const PERF_URL = `${PRO_URL}&perf=1`;

interface PerfSample {
  flush: number;
  fps: number;
  renderMs: number;
  syncMs: number;
  calls: number;
  tris: number;
  geos: number;
}

/** Parse the on-screen perf HUD, including its monotonic window counter. */
async function readHud(page: import('@playwright/test').Page): Promise<PerfSample> {
  return page.evaluate(() => {
    const el = document.querySelector('.perf-hud');
    if (!el) throw new Error('perf HUD not present — is ?perf set?');
    const text = el.textContent ?? '';
    const num = (re: RegExp) => {
      const m = text.match(re);
      return m ? parseFloat(m[1]) : NaN;
    };
    return {
      flush: Number(el.getAttribute('data-flush') ?? '0'),
      fps: num(/fps\s*([\d.]+)/),
      renderMs: num(/render\s*([\d.]+)\s*ms/),
      syncMs: num(/sync\s*([\d.]+)\s*ms/),
      calls: num(/draw calls\s*([\d.]+)/),
      tris: num(/tris\s*([\d.]+)k/) * 1000,
      geos: num(/geos\s*([\d.]+)/),
    };
  });
}

/**
 * Drive a gesture until the HUD has closed a window that lies entirely inside it.
 *
 * `step` is called repeatedly to keep the gesture alive; it must be short (~one
 * frame of input) so polling stays fine-grained. Returns the first sample whose
 * window opened after the gesture was already running.
 */
async function sampleCleanWindow(
  page: import('@playwright/test').Page,
  step: (i: number) => Promise<void>,
  label: string,
): Promise<PerfSample> {
  const start = await readHud(page);
  const target = start.flush + 2; // edge 1 = straddling window, edge 2 = clean one
  const deadline = Date.now() + 15_000;
  for (let i = 0; Date.now() < deadline; i++) {
    await step(i);
    const s = await readHud(page);
    if (s.flush >= target) return s;
  }
  throw new Error(
    `${label}: HUD never closed a clean window (flush stuck at ${start.flush}). ` +
    'The render loop probably is not running — did the gesture actually take?',
  );
}

/**
 * The three.js canvas specifically. The page has more than one `<canvas>` (the 2D
 * viewport is also one), and `locator('canvas').first()` is not reliably the 3D one
 * — pointing a gesture at the wrong canvas silently measures nothing. Three sets
 * `data-engine` on the renderer's canvas, so key off that.
 */
function gl(page: import('@playwright/test').Page) {
  return page.locator('canvas[data-engine]').first();
}

/** Sustained mouse drag: OrbitControls path, so orbit LOD + pixelRatio drop engage. */
async function orbitByMouse(page: import('@playwright/test').Page): Promise<PerfSample> {
  const box = await gl(page).boundingBox();
  if (!box) throw new Error('no 3D canvas');
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;

  await page.mouse.move(cx, cy);
  await page.mouse.down();
  try {
    return await sampleCleanWindow(page, async (i) => {
      await page.mouse.move(cx + Math.cos(i / 3) * 140, cy + Math.sin(i / 3) * 90);
      await page.waitForTimeout(16);
    }, 'orbit(mouse)');
  } finally {
    await page.mouse.up();
  }
}

/** Held arrow key: direct camera orbit, full detail, continuous loop, no LOD. */
async function orbitByKeyboard(page: import('@playwright/test').Page): Promise<PerfSample> {
  // No click needed: the nav-key handler is bound to `window`. It only bails when
  // focus sits in an INPUT/TEXTAREA/SELECT, so blur instead of clicking the canvas
  // — a click there would also select an element and change what we are measuring.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.down('ArrowLeft');
  try {
    return await sampleCleanWindow(page, async () => {
      await page.waitForTimeout(16); // the key stays held; the loop drives itself
    }, 'orbit(keyboard)');
  } finally {
    await page.keyboard.up('ArrowLeft');
  }
}

/** Wheel zoom in and out: OrbitControls path, but discrete input rather than a drag. */
async function zoom(page: import('@playwright/test').Page): Promise<PerfSample> {
  const box = await gl(page).boundingBox();
  if (!box) throw new Error('no 3D canvas');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  return sampleCleanWindow(page, async (i) => {
    await page.mouse.wheel(0, i % 2 === 0 ? -220 : 180);
    await page.waitForTimeout(16);
  }, 'zoom');
}

const MODELS = ['la-bombonera', '3d-nave-industrial', '3d-building', '3d-tower'];

test.describe('3D viewport cost', () => {
  for (const name of MODELS) {
    test(`${name}: full-detail orbit / LOD orbit / zoom`, async ({ page }) => {
      await page.goto(PERF_URL);
      await expect.poll(() => page.evaluate(() => !!window.__stabileo)).toBe(true);

      const ids = await loadModel(page, name);
      const counts = await page.evaluate(() => window.__stabileo.counts());

      // Order matters: keyboard first, while the scene is still at full detail and
      // the camera has not been through an LOD cycle.
      const keys = await orbitByKeyboard(page);
      const mouse = await orbitByMouse(page);
      const wheel = await zoom(page);

      // fps is printed ONLY for the self-driven row. For harness-driven rows it
      // measures Playwright's input dispatch rate, and with discrete wheel input it
      // goes further and becomes nonsense: observed 6, 225, 1099 across repeats of
      // the same zoom. Printing it would just invite the next reader to trust it.
      const row = (label: string, s: PerfSample, selfDriven = false) =>
        `  ${label.padEnd(14)} fps ${(selfDriven ? String(Math.round(s.fps)) : '  n/a').padStart(4)}` +
        ` | render ${s.renderMs.toFixed(2).padStart(7)}ms` +
        ` | sync ${s.syncMs.toFixed(2).padStart(7)}ms` +
        ` | calls ${String(s.calls).padStart(5)}` +
        ` | tris ${String(Math.round(s.tris / 1000)).padStart(5)}k` +
        ` | geos ${String(s.geos).padStart(5)}`;

      console.log(`\n=== ${name} — ${ids.length} elements, counts: ${JSON.stringify(counts)}`);
      console.log(row('orbit:fulldet', keys, true));
      console.log(row('orbit:lod', mouse));
      console.log(row('zoom', wheel));
      console.log(`  LOD draw-call ratio: ${(mouse.calls / Math.max(1, keys.calls)).toFixed(2)}×`);

      // Not assertions on speed — proof that each row is a real, live window and
      // not a frozen HUD. `sampleCleanWindow` already throws if no window closed.
      expect(keys.calls).toBeGreaterThan(0);
      expect(mouse.calls).toBeGreaterThan(0);
      expect(wheel.calls).toBeGreaterThan(0);
    });
  }
});
