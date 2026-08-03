/**
 * Capture screenshots for the landing page using Playwright.
 *
 * Usage:
 *   npm run dev -- --port 4001 --strictPort      # in another terminal
 *   npx tsx scripts/take-screenshots.ts
 *   npx tsx scripts/take-screenshots.ts --base http://127.0.0.1:5173
 *   STABILEO_SCREENSHOT_BASE=http://127.0.0.1:4001 npx tsx scripts/take-screenshots.ts
 *
 * The base URL is configurable and defaults to the landing workstream's
 * reserved preview port (4001). Port 4000 belongs to another workstream's dev
 * server and this script refuses to touch it.
 *
 * Output filenames are the exact asset names the landing consumes (see
 * CONSUMED_ASSETS below), and every capture here has a consumer. Do not
 * rename an output without renaming its consumer.
 *
 * These PNGs are the capture SOURCE, not what ships. The landing serves AVIF
 * with a WebP fallback at two widths (`<base>-800.avif`, `<base>-1600.webp`,
 * …) via Shot.svelte, and only those derivatives are committed. After running
 * this script, convert the PNGs and delete them:
 *
 *   for f in 2d-moments 2d-section-analysis 3d-industrial 3d-section-analysis; do
 *     for w in 800 1600; do
 *       npx --yes sharp-cli -i public/screenshots/$f.png -o public/screenshots \
 *         resize $w -- avif --quality 52
 *       npx --yes sharp-cli -i public/screenshots/$f.png -o public/screenshots \
 *         resize $w -- webp --quality 78
 *     done
 *   done
 *
 * `npx --yes` is used deliberately: an image encoder is a one-off authoring
 * tool and must not become a dependency in web/package.json.
 *
 * `3d-industrial.png` is also kept as the PNG the site's Open Graph tag points
 * at (web/index.html), so that one file stays committed alongside its
 * derivatives.
 */
import { chromium } from 'playwright';

/** Port reserved by another workstream's dev server. Never contact it. */
const FORBIDDEN_PORT = '4000';
const DEFAULT_BASE = 'http://127.0.0.1:4001';

function resolveBase(): string {
  const flagIdx = process.argv.indexOf('--base');
  const raw =
    (flagIdx !== -1 ? process.argv[flagIdx + 1] : undefined) ??
    process.env.STABILEO_SCREENSHOT_BASE ??
    DEFAULT_BASE;

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`Invalid base URL: ${raw}`);
  }
  if (url.port === FORBIDDEN_PORT) {
    throw new Error(
      `Refusing to use port ${FORBIDDEN_PORT}: it is reserved for another workstream's dev server. ` +
        `Start this workstream's preview with \`npm run dev -- --port 4001 --strictPort\` and re-run.`,
    );
  }
  return url.origin;
}

const BASE = resolveBase();
const OUT = 'public/screenshots';

/**
 * Assets the landing actually references, and which capture below produces
 * each one. Kept next to the captures so a rename cannot drift again.
 */
const CONSUMED_ASSETS = [
  '2d-moments.png',
  '2d-section-analysis.png',
  '3d-industrial.png',
  '3d-section-analysis.png',
] as const;

const captured: string[] = [];

function record(name: string, note = '') {
  captured.push(name);
  console.log(`✓ ${name}${note ? ` (${note})` : ''}`);
}

// Use a reasonable viewport with 2x DPR for crisp retina images
const VP = { width: 1440, height: 900 };
const DPR = 2;

// Crop region: remove app header (~48px) and status bar (~26px)
// These are CSS pixels; Playwright scales by DPR automatically
const HEADER_H = 48;
const STATUS_H = 26;
const CROP = {
  x: 0,
  y: HEADER_H,
  width: VP.width,
  height: VP.height - HEADER_H - STATUS_H,
};

// NOTE: the event names below are `stabileo-*`. They were `dedaliano-*` until
// this repair — names that stopped existing at the rebrand, so the captures had
// silently not been solving or zooming to fit for months.
function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const browser = await chromium.launch({
    headless: false,
    args: [
      '--use-gl=angle',
      '--use-angle=metal',
      '--enable-gpu-rasterization',
      '--enable-webgl',
      '--ignore-gpu-blocklist',
    ],
  });
  const ctx = await browser.newContext({
    viewport: VP,
    deviceScaleFactor: DPR,
    locale: 'en',
  });

  async function freshPage() {
    const page = await ctx.newPage();
    await page.goto(`${BASE}?embed`, { waitUntil: 'networkidle' });
    await sleep(1500);
    return page;
  }

  // ═══ 1. BASIC 2D ═══

  // 1.2 — Portal frame solved with moment diagram
  {
    const page = await freshPage();
    await page.evaluate(async () => {
      const { modelStore, resultsStore, uiStore } = await import('/src/lib/store/index.ts');
      modelStore.loadExample('portal-frame');
      resultsStore.clear();
      uiStore.leftSidebarOpen = true;
      uiStore.rightSidebarOpen = false;
      setTimeout(() => window.dispatchEvent(new Event('stabileo-zoom-to-fit')), 100);
    });
    await sleep(500);
    await page.evaluate(() => window.dispatchEvent(new Event('stabileo-solve')));
    await sleep(2000);
    await page.evaluate(async () => {
      const { resultsStore } = await import('/src/lib/store/index.ts');
      resultsStore.diagramType = 'moment';
    });
    await sleep(500);
    await page.screenshot({ path: `${OUT}/2d-moments.png`, clip: CROP });
    record('2d-moments.png');
    await page.close();
  }

  // 1.3 — Section stress analysis — full viewport showing the stress panel + structure
  {
    const page = await freshPage();
    await page.evaluate(async () => {
      const { modelStore, resultsStore, uiStore } = await import('/src/lib/store/index.ts');
      modelStore.loadExample('portal-frame');
      resultsStore.clear();
      uiStore.leftSidebarOpen = false;
      uiStore.rightSidebarOpen = false;
      setTimeout(() => window.dispatchEvent(new Event('stabileo-zoom-to-fit')), 100);
    });
    await sleep(500);
    await page.evaluate(() => window.dispatchEvent(new Event('stabileo-solve')));
    await sleep(2000);
    await page.evaluate(async () => {
      const { resultsStore, uiStore, modelStore } = await import('/src/lib/store/index.ts');
      resultsStore.diagramType = 'none';
      uiStore.currentTool = 'select';
      uiStore.selectMode = 'stress';
      const elem = modelStore.elements.get(3);
      if (elem) {
        const nI = modelStore.nodes.get(elem.nodeI);
        const nJ = modelStore.nodes.get(elem.nodeJ);
        if (nI && nJ) {
          resultsStore.stressQuery = {
            elementId: 3,
            t: 0.5,
            worldX: (nI.x + nJ.x) / 2,
            worldY: (nI.y + nJ.y) / 2,
          };
        }
      }
    });
    await sleep(2000);

    // Expand all sections in the stress panel for a richer view
    await page.evaluate(() => {
      document.querySelectorAll('.ssp-panel details:not([open])').forEach(d => (d as HTMLDetailsElement).open = true);
    });
    await sleep(500);

    // Full viewport screenshot (structure + stress panel visible)
    await page.screenshot({ path: `${OUT}/2d-section-analysis.png`, clip: CROP });
    record('2d-section-analysis.png');
    await page.close();
  }

  // ═══ 2. BASIC 3D ═══

  // 2.2 — Nave industrial with stress ratio color map (σ/fy)
  {
    const page = await freshPage();
    await page.evaluate(async () => {
      const { modelStore, resultsStore, uiStore } = await import('/src/lib/store/index.ts');
      uiStore.analysisMode = '3d';
      uiStore.leftSidebarOpen = false;
      uiStore.rightSidebarOpen = false;
    });
    await sleep(1500);
    await page.evaluate(async () => {
      const { modelStore, resultsStore } = await import('/src/lib/store/index.ts');
      modelStore.loadExample('3d-nave-industrial');
      resultsStore.clear3D();
      setTimeout(() => window.dispatchEvent(new Event('stabileo-zoom-to-fit')), 200);
    });
    await sleep(2000);
    // Solve
    await page.evaluate(() => window.dispatchEvent(new Event('stabileo-solve')));
    await sleep(5000);
    // Set color map mode with stress ratio σ/fy
    await page.evaluate(async () => {
      const { resultsStore } = await import('/src/lib/store/index.ts');
      resultsStore.diagramType = 'colorMap';
      resultsStore.colorMapKind = 'stressRatio';
    });
    await sleep(2000);
    await page.screenshot({ path: `${OUT}/3d-industrial.png`, clip: CROP });
    record('3d-industrial.png', 'stress ratio color map');
    await page.close();
  }

  // ═══ 3. EDUCATIONAL ═══
  //
  // Removed. These two captures wrote `edu-exercises.png` and
  // `edu-exercise.png`, which no landing component has ever referenced, under
  // names that did not even match the two Education assets that were sitting
  // unused in public/screenshots (`edu-panel.png`, `edu-exercise-new.png`,
  // both deleted). If the landing gains an Education section, add captures
  // here named after whatever assets that section consumes.

  // ═══ 4. 3D SECTION STRESS ═══
  //
  // Added because `3d-section-analysis` is consumed by the landing and had no
  // producer. Same store API as the 2D stress shot — `resultsStore.stressQuery`
  // takes an optional worldZ and is shared between the 2D and 3D viewports.
  {
    const page = await freshPage();
    await page.evaluate(async () => {
      const { uiStore } = await import('/src/lib/store/index.ts');
      uiStore.analysisMode = '3d';
      uiStore.leftSidebarOpen = false;
      uiStore.rightSidebarOpen = false;
    });
    await sleep(1500);
    await page.evaluate(async () => {
      const { modelStore, resultsStore } = await import('/src/lib/store/index.ts');
      modelStore.loadExample('3d-portal-frame');
      resultsStore.clear3D();
      setTimeout(() => window.dispatchEvent(new Event('stabileo-zoom-to-fit')), 200);
    });
    await sleep(2000);
    await page.evaluate(() => window.dispatchEvent(new Event('stabileo-solve')));
    await sleep(4000);
    await page.evaluate(async () => {
      const { modelStore, resultsStore, uiStore } = await import('/src/lib/store/index.ts');
      uiStore.currentTool = 'select';
      uiStore.selectMode = 'stress';
      const [first] = [...modelStore.elements.keys()];
      const elem = modelStore.elements.get(first);
      if (!elem) return;
      const nI = modelStore.nodes.get(elem.nodeI);
      const nJ = modelStore.nodes.get(elem.nodeJ);
      if (!nI || !nJ) return;
      resultsStore.stressQuery = {
        elementId: first,
        t: 0.5,
        worldX: (nI.x + nJ.x) / 2,
        worldY: (nI.y + nJ.y) / 2,
        worldZ: ((nI.z ?? 0) + (nJ.z ?? 0)) / 2,
      };
    });
    await sleep(2500);
    await page.evaluate(() => {
      document.querySelectorAll('.ssp-panel details:not([open])').forEach((d) => ((d as HTMLDetailsElement).open = true));
    });
    await sleep(500);
    await page.screenshot({ path: `${OUT}/3d-section-analysis.png`, clip: CROP });
    record('3d-section-analysis.png');
    await page.close();
  }

  await browser.close();

  const missing = CONSUMED_ASSETS.filter((a) => !captured.includes(a));
  console.log(`\n✅ ${captured.length} screenshot(s) captured from ${BASE}`);
  if (missing.length) {
    console.log(
      `\n⚠️  ${missing.length} asset(s) the landing consumes have no capture in this script:\n` +
        missing.map((m) => `   · ${m}`).join('\n') +
        `\n   The committed files for those are whatever was checked in previously.` +
        `\n   Add a capture above (or drop the consumer) rather than hand-editing them.`,
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
