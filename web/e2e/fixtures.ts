import { test as base, expect, type Page } from '@playwright/test';

/**
 * Shared Playwright fixtures for the RC Design suite.
 *
 * Determinism rules encoded here:
 *  - localStorage is cleared and the locale forced to `en` BEFORE the app boots, so
 *    autosave never leaks between specs and assertions are language-stable.
 *  - the model is loaded through a hook, never by clicking through the examples menu.
 *  - every spec waits on REAL state (`solverReady`, revision counters), never on a
 *    sleep. A stubbed WASM solver fails the readiness gate loudly.
 */

export const PRO_URL = '/app/pro?e2e=1';

/**
 * The bar and concrete families the 3-D scene batches by.
 *
 * Restated here rather than imported: `e2e/` is compiled by Playwright, not by the app's Vite
 * pipeline, and reaching into `src/lib/three` from a spec would drag Three.js into the test
 * process to read six strings. `rebar-toggles.spec.ts` asserts that this list matches the
 * renderer's own, so a family added on one side cannot go unnoticed on the other.
 */
export const SOLID_FAMILIES = [
  'column', 'beam', 'slab', 'wall', 'footing', 'pedestal',
] as const;

export type SolidFamily = typeof SOLID_FAMILIES[number];

/** What the renderer is drawing right now, per family. See `rebarSceneCensus`. */
export interface RebarSceneCensus {
  /** Bars drawn, per family — plus `unknown` for steel no family could claim. */
  bars: Record<SolidFamily | 'unknown', number>;
  /** Concrete solids drawn, per family. */
  solids: Record<SolidFamily, number>;
  /** Conflict markers on screen. */
  markers: number;
  /** Triangles drawn, bars and concrete together. */
  triangles: number;
  /** Meshes a raycast would consider — what is selectable. */
  pickable: number;
}

export interface TestHooks {
  version: number;
  solverReady(): boolean;
  analysisRevision(): number;
  demandRevision(): number;
  providedRevision(): number;
  baselineRevision(): number;
  isBaselineStale(): boolean;
  solveCount(): number;
  modelVersion(): number;
  designRunId(): string | null;
  displayStatus(id: number): string;
  displayRatio(id: number): number | null;
  outcome(id: number): string | null;
  hasCertificate(id: number): boolean;
  counts(): Record<string, number>;
  runCounts(): Record<string, number> | null;
  selection(): number[];
  reinforcement(id: number): unknown;
  rebarSummary(id: number): string;
  elementIds(): number[];
  orientationSuspectCount(): number;
  undoCount(): number;
  canvasInkRatio(): number;
  /** How many times the 3-D viewport has built its tube geometry. */
  rebarSceneBuilds(): number;
  /**
   * What the open 3-D workspace is DRAWING, per family. Null when none is open.
   *
   * Read off the meshes, not off the filter. The on-screen tally is the filter's own account of
   * itself and was updating perfectly while every layer switch reached nothing.
   */
  rebarSceneCensus(): RebarSceneCensus | null;
  /** Canvases in the page, of any kind. A layer switch must not add one. */
  canvasCount(): number;
  /** Scene-projection cache hits and misses. */
  sceneCacheStats(): { hits: number; misses: number };
  /** Every autosave revision currently stored in IndexedDB, newest first. */
  autosaveRevisions(): Promise<Array<{ revision: number; timestamp: string; status: string }>>;
  /** The family census of the newest readable stored project, plus how it was read. */
  autosaveStored(): Promise<{
    revision: number | null;
    fingerprint: Record<string, number>;
    backend: string;
    rejected: number;
    unfinishedRevision: number | null;
  }>;
  /** The last write attempt: trigger, outcome, backend, revision. */
  autosaveOutcome(): {
    reason: string; at: string; ok: boolean; backend: string;
    revision: number | null; failureKind: string | null;
  } | null;
}

/** Actions a spec may drive — the same operations the UI controls perform. */
export interface TestActions {
  loadExample(name: string): Promise<void>;
  solve(): Promise<void>;
  openDesignTab(): void;
  computeDemands(): unknown;
  codeCheck(): unknown;
  autoDesign(ids: number[]): unknown;
  designAll(): unknown;
  cancel(): void;
  /** The same save the 30 s timer and every post-design hook ask for. */
  autosaveNow(): Promise<unknown>;
  /** The same clear the restore banner's Descartar button performs. */
  autosaveDiscard(): Promise<void>;
}

declare global {
  interface Window {
    __stabileo: TestHooks;
    // Declared alongside the hooks because specs drive it. It was missing, and Playwright does
    // not typecheck, so nothing said so.
    __stabileoActions: TestActions;
    __stabileoCommands: {
      computeDemands(): unknown;
      codeCheck(): unknown;
      autoDesign(ids: number[]): unknown;
      designAll(): unknown;
      cancel(): void;
    };
  }
}

/** Evaluate a hook in the page. */
export function hook<T>(page: Page, fn: (h: TestHooks) => T): Promise<T> {
  return page.evaluate(fn as never, undefined as never) as never;
}

/**
 * A PRO page booted in an explicit locale.
 *
 * Default `en`, so every existing spec keeps its stable English assertions. A spec that
 * needs Spanish sets `test.use({ appLocale: 'es' })` — which is how the bilingual journeys
 * prove that engine output is translated rather than pasted.
 */
export const test = base.extend<{ pro: Page; appLocale: string }>({
  appLocale: ['en', { option: true }],
  pro: async ({ page, appLocale }, use) => {
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    page.on('console', (m) => {
      if (m.type() !== 'error') return;
      const text = m.text();
      // WebGL software-rasteriser chatter is expected under SwiftShader.
      if (/SwiftShader|WebGL|GroupMarkerNotSet|Automatic fallback/i.test(text)) return;
      consoleErrors.push(text);
    });
    page.on('pageerror', (e) => pageErrors.push(String(e)));

    await page.addInitScript((loc) => {
      try {
        localStorage.clear();
        // Force a stable locale: the RC surface is localised, so assertions on
        // English text would otherwise depend on the browser's language.
        localStorage.setItem('stabileo-lang', loc);
        localStorage.setItem('stabileo-lang-manual', '1');
      } catch { /* private mode */ }
    }, appLocale);

    await page.goto(PRO_URL);
    // Hooks exist ⇒ the app booted with ?e2e=1.
    await page.waitForFunction(() => !!window.__stabileo, null, { timeout: 60_000 });
    // The REAL WASM solver must be live; the Vite stub fails here.
    await expect
      .poll(() => page.evaluate(() => window.__stabileo.solverReady()), { timeout: 60_000, message: 'real WASM solver must be initialised (not the Vite stub)' })
      .toBe(true);

    // The RC Design tab must be the active PRO tab for its table to exist.
    await page.evaluate(() => window.__stabileoActions.openDesignTab());

    await use(page);

    expect(pageErrors, `page errors:\n${pageErrors.join('\n')}`).toEqual([]);
    expect(consoleErrors, `console errors:\n${consoleErrors.join('\n')}`).toEqual([]);
  },
});

/** Load a fixture and wait for the model to settle. */
export async function loadModel(page: Page, name: string): Promise<number[]> {
  await page.evaluate(async (n) => { await window.__stabileoActions.loadExample(n); }, name);
  await expect.poll(() => page.evaluate(() => window.__stabileo.elementIds().length)).toBeGreaterThan(0);
  return page.evaluate(() => window.__stabileo.elementIds());
}

/** Solve, then run the three design commands. Returns the run counts. */
export async function designAll(page: Page): Promise<Record<string, number>> {
  await solveModel(page);
  await page.evaluate(() => window.__stabileoActions.designAll());
  await expect.poll(() => page.evaluate(() => window.__stabileo.runCounts()?.total ?? 0)).toBeGreaterThan(0);
  return (await page.evaluate(() => window.__stabileo.runCounts()))!;
}

/** Run the same global solve the toolbar button triggers, and wait for it. */
export async function solveModel(page: Page): Promise<void> {
  const before = await page.evaluate(() => window.__stabileo.solveCount());
  await page.evaluate(async () => { await window.__stabileoActions.solve(); });
  await expect.poll(() => page.evaluate(() => window.__stabileo.solveCount()), { timeout: 90_000 })
    .toBeGreaterThan(before);
}

/** Ensure demands exist (the design table needs them). */
export async function computeDemands(page: Page): Promise<void> {
  await page.evaluate(() => window.__stabileoActions.computeDemands());
  await expect.poll(() => page.evaluate(() => window.__stabileo.demandRevision())).toBeGreaterThan(0);
}

export { expect };
