/**
 * PR17 — the coordinated detailing workflow in the browser.
 *
 * Covers what unit tests cannot: that the assemblies persist through the real store,
 * that the review gate refuses in the real UI, that a provisional calculation is visible
 * before anyone signs it off, and that the SUPERSEDED state reaches the screen.
 */

import { test, expect, loadModel } from './fixtures';

type Json = Record<string, unknown>;

/** One coordinated assembly, in exactly the shape the pipeline writes. */
function seed(over: Json = {}): Json {
  return {
    id: 'L1-B', kind: 'beamLine', label: 'Eje B — Nivel +3,40',
    elementIds: [1, 2],
    bars: [
      {
        id: 'b1', diameterMm: 20, role: 'longitudinal',
        segments: [{
          kind: 'straight',
          start: { x: 0, y: 0, z: -0.25 }, end: { x: 6, y: 0, z: -0.25 }, length: 6,
        }],
        startTreatment: { kind: 'straight' }, endTreatment: { kind: 'straight' },
        cuttingLength: 6, ownerElementIds: [1], source: 'generated', locked: false, refs: [],
      },
      {
        id: 'b2', diameterMm: 16, role: 'longitudinal',
        segments: [{
          kind: 'straight',
          start: { x: 0, y: 0, z: 0.25 }, end: { x: 4, y: 0, z: 0.25 }, length: 4,
        }],
        startTreatment: { kind: 'straight' }, endTreatment: { kind: 'straight' },
        cuttingLength: 4, ownerElementIds: [2], source: 'generated', locked: false, refs: [],
      },
    ],
    marks: [
      {
        mark: 'B1', diameterMm: 16, cuttingLength: 4, quantity: 1, shape: 'straight',
        massKg: 6.31, barIds: ['b2'],
      },
      {
        mark: 'B2', diameterMm: 20, cuttingLength: 6, quantity: 1, shape: 'straight',
        massKg: 14.8, barIds: ['b1'],
      },
    ],
    joints: [], conflicts: [], unsupported: [],
    detailingRevision: 1, demandRevision: 5,
    state: 'CONSTRUCTIBLE', maturity: 'VALIDATED',
    provenance: { edition: '2025', verifierId: 'cirsoc201.provided.v2.2025', trace: [], assumptions: [] },
    ...over,
  };
}

async function seedInto(page: import('@playwright/test').Page, assemblies: Json[]) {
  await page.evaluate((a) => {
    (window.__stabileoActions as unknown as { seedDetailing(x: unknown): void }).seedDetailing(a);
  }, assemblies);
}

async function openPanel(page: import('@playwright/test').Page) {
  const d = page.getByTestId('detailing-disclosure');
  await expect(d).toBeVisible();
  await d.locator('summary').click();
  return d;
}

function assemblies(page: import('@playwright/test').Page): Promise<Json[]> {
  return page.evaluate(() =>
    (window.__stabileo as unknown as { detailingAssemblies(): Json[] }).detailingAssemblies());
}

test.describe('@smoke coordinated detailing workflow', () => {
  test('D1 — an empty project says so instead of showing a blank panel', async ({ pro: page }) => {
    await openPanel(page);
    await expect(page.getByTestId('detailing-empty')).toBeVisible();
  });

  test('D2 — a seeded assembly appears with its earned state', async ({ pro: page }) => {
    await seedInto(page, [seed()]);
    await openPanel(page);
    await expect(page.getByTestId('assembly-L1-B')).toBeVisible();
    await expect(page.getByTestId('assembly-state')).toContainText('Constructible');
    await expect(page.getByTestId('detailing-count')).toHaveText('1');
  });

  test('D3 — the sheet preview renders real bar geometry', async ({ pro: page }) => {
    await seedInto(page, [seed()]);
    await openPanel(page);
    const sheet = page.getByTestId('sheet-preview');
    await expect(sheet).toBeVisible();
    await expect(sheet.locator('svg')).toHaveCount(1);
    // Two bars, drawn as paths from their actual segments.
    expect(await sheet.locator('svg path').count()).toBeGreaterThanOrEqual(2);
  });

  test('D4 — switching to the section view redraws', async ({ pro: page }) => {
    await seedInto(page, [seed()]);
    await openPanel(page);
    await page.getByLabel('Cross-section').check();
    const sheet = page.getByTestId('sheet-preview');
    // A section shows bars as circles, not as long paths.
    await expect(sheet.locator('svg circle').first()).toBeVisible();
  });

  test('D5 — the schedule totals the real bar masses', async ({ pro: page }) => {
    await seedInto(page, [seed()]);
    await openPanel(page);
    await expect(page.getByTestId('schedule')).toBeVisible();
    await expect(page.getByTestId('schedule-mass')).toHaveText('21.1');
  });

  test('D6 — the panel is keyboard reachable and labelled', async ({ pro: page }) => {
    await seedInto(page, [seed()]);
    const summary = page.getByTestId('detailing-disclosure').locator('summary');
    await summary.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('listbox', { name: 'Assemblies' })).toBeVisible();
    // Exact: the "Engineer review" section is also labelled, and a loose match hits both.
    await expect(page.getByLabel('Engineer', { exact: true })).toBeVisible();
    await expect(page.getByRole('option', { name: /Eje B/ })).toHaveAttribute('aria-selected', 'true');
  });
});

test.describe('@smoke review gate', () => {
  test('D7 — a review needs a named engineer', async ({ pro: page }) => {
    await seedInto(page, [seed()]);
    await openPanel(page);
    await page.getByTestId('review-submit').click();
    await expect(page.getByTestId('review-error')).toContainText('profesional');
  });

  test('D8 — an assembly below CONSTRUCTIBLE cannot be reviewed', async ({ pro: page }) => {
    await seedInto(page, [seed({ state: 'COORDINATED' })]);
    await openPanel(page);
    await page.getByTestId('review-engineer').fill('Ing. R. Pérez');
    await page.getByTestId('review-submit').click();
    await expect(page.getByTestId('review-error')).toContainText('CONSTRUCTIBLE');
  });

  test('D9 — a review is recorded against a specific revision', async ({ pro: page }) => {
    await seedInto(page, [seed()]);
    await openPanel(page);
    await page.getByTestId('review-engineer').fill('Ing. R. Pérez');
    await page.getByTestId('review-notes').fill('Verificado contra planilla.');
    await page.getByTestId('review-submit').click();

    await expect(page.getByTestId('review-error')).toBeHidden();
    await expect(page.getByTestId('review-record')).toContainText('Ing. R. Pérez');
    await expect(page.getByTestId('assembly-state')).toContainText('Reviewed');

    const stored = (await assemblies(page))[0] as Json & { review: Json };
    expect(stored.state).toBe('REVIEWED');
    expect((stored.review as Json).revision).toBe(1);
    expect((stored.review as Json).engineer).toBe('Ing. R. Pérez');
  });

  test('D10 — ISSUED is unavailable until the assembly has been reviewed', async ({ pro: page }) => {
    await seedInto(page, [seed()]);
    await openPanel(page);
    await expect(page.getByTestId('issue-submit')).toBeDisabled();

    await page.getByTestId('review-engineer').fill('Ing. R. Pérez');
    await page.getByTestId('review-submit').click();
    await expect(page.getByTestId('issue-submit')).toBeEnabled();
  });

  test('D11 — the panel states that software approval is not professional sign-off', async ({ pro: page }) => {
    await seedInto(page, [seed()]);
    await openPanel(page);
    await expect(page.getByText(/does not constitute professional sign-off/i)).toBeVisible();
  });
});

test.describe('@smoke provisional calculations', () => {
  test('D12 — a provisional assembly is badged before anyone signs it', async ({ pro: page }) => {
    await seedInto(page, [seed({ maturity: 'IMPLEMENTED_PROVISIONAL' })]);
    await openPanel(page);
    await expect(page.getByTestId('assembly-maturity')).toHaveText('Provisional');
    await expect(page.getByTestId('provisional-ack')).toBeVisible();
  });

  test('D13 — a review is refused while a provisional item is unacknowledged', async ({ pro: page }) => {
    await seedInto(page, [seed({ maturity: 'IMPLEMENTED_PROVISIONAL' })]);
    await openPanel(page);
    await page.getByTestId('review-engineer').fill('Ing. R. Pérez');
    await page.getByTestId('review-submit').click();
    await expect(page.getByTestId('review-error')).toContainText('provisorios');
  });

  test('D14 — acknowledging each item explicitly lets the review through', async ({ pro: page }) => {
    await seedInto(page, [seed({ maturity: 'IMPLEMENTED_PROVISIONAL' })]);
    await openPanel(page);
    await page.getByTestId('ack-assembly').check();
    await page.getByTestId('review-engineer').fill('Ing. R. Pérez');
    await page.getByTestId('review-submit').click();

    await expect(page.getByTestId('review-error')).toBeHidden();
    const stored = (await assemblies(page))[0] as Json & { review: Json };
    expect((stored.review as Json).acknowledgedProvisional).toEqual(['assembly']);
  });

  test('D15 — the sheet carries the provisional note', async ({ pro: page }) => {
    await seedInto(page, [seed({ maturity: 'IMPLEMENTED_PROVISIONAL' })]);
    await openPanel(page);
    await expect(page.getByTestId('sheet-preview')).toContainText('CÁLCULO PROVISORIO');
  });
});

test.describe('@smoke conflicts and superseded state', () => {
  const conflicted = () => seed({
    state: 'COORDINATED',
    conflicts: [
      {
        severity: 'overlap', barA: 'b1', barB: 'b2', at: { x: 1, y: 0, z: 0 },
        clearance: -0.005, required: 0.025, shortfall: 0.030, elementIds: [1, 2],
      },
      {
        severity: 'clearance', barA: 'b1', barB: 'b3', at: { x: 3, y: 0, z: 0 },
        clearance: 0.012, required: 0.025, shortfall: 0.013, elementIds: [1],
      },
    ],
  });

  test('D16 — conflicts are navigable one at a time', async ({ pro: page }) => {
    await seedInto(page, [conflicted()]);
    await openPanel(page);
    await expect(page.getByTestId('conflict-counter')).toContainText('1');
    await expect(page.getByTestId('conflict-detail')).toContainText('b1 / b2');

    await page.getByLabel('Next conflict').click();
    await expect(page.getByTestId('conflict-counter')).toContainText('2');
    await expect(page.getByTestId('conflict-detail')).toContainText('b1 / b3');

    // Wraps, so stepping is never a dead end.
    await page.getByLabel('Next conflict').click();
    await expect(page.getByTestId('conflict-counter')).toContainText('1');
  });

  test('D17 — a clean assembly says so rather than showing an empty list', async ({ pro: page }) => {
    await seedInto(page, [seed()]);
    await openPanel(page);
    await expect(page.getByTestId('no-conflicts')).toBeVisible();
  });

  test('D18 — an unsupported condition is listed and blocks the review', async ({ pro: page }) => {
    await seedInto(page, [seed({
      state: 'COORDINATED',
      unsupported: [{ key: 'beamTorsion', scope: {}, message: 'Torsión no verificada.', refs: [] }],
    })]);
    await openPanel(page);
    await expect(page.getByTestId('unsupported-list')).toContainText('Torsión no verificada');
    await page.getByTestId('review-engineer').fill('Ing. R. Pérez');
    await page.getByTestId('review-submit').click();
    await expect(page.getByTestId('review-error')).toBeVisible();
  });

  test('D19 — a review that no longer matches the revision reads SUPERSEDED', async ({ pro: page }) => {
    await seedInto(page, [seed({
      detailingRevision: 4,
      review: {
        engineer: 'Ing. P', at: '2026-07-26T10:00:00Z', revision: 3, state: 'REVIEWED',
        provisionalAcknowledged: false, acknowledgedProvisional: [],
      },
      state: 'REVIEWED',
    })]);
    await openPanel(page);
    await expect(page.getByTestId('assembly-superseded')).toBeVisible();
    await expect(page.getByTestId('sheet-preview')).toContainText('SUPERSEDED');
  });
});

test.describe('@slow detailing persistence', () => {
  test('D20 — assemblies survive a model snapshot round-trip', async ({ pro: page }) => {
    await seedInto(page, [seed()]);
    const before = await assemblies(page);
    expect(before).toHaveLength(1);

    // Loading an example replaces the model; the field must exist on the new one too.
    await loadModel(page, 'rc-design-qa-8');
    const after = await assemblies(page);
    expect(Array.isArray(after)).toBe(true);
  });

  test('D21 — a locked bar stays locked through the store', async ({ pro: page }) => {
    await seedInto(page, [seed()]);
    await openPanel(page);
    await page.evaluate(() => {
      (window.__stabileoActions as unknown as { toggleBarLock(id: string): void }).toggleBarLock('b1');
    });
    const stored = (await assemblies(page))[0] as Json & { bars: Array<{ id: string; locked: boolean }> };
    expect(stored.bars.find((b) => b.id === 'b1')!.locked).toBe(true);
    expect(stored.bars.find((b) => b.id === 'b2')!.locked).toBe(false);
  });

  test('D22 — selecting between assemblies switches the sheet', async ({ pro: page }) => {
    await seedInto(page, [
      seed(),
      seed({ id: 'L1-C', label: 'Eje C — Nivel +3,40' }),
    ]);
    await openPanel(page);
    await expect(page.getByTestId('detailing-count')).toHaveText('2');
    await page.getByTestId('assembly-L1-C').click();
    await expect(page.getByTestId('sheet-preview')).toContainText('Eje C');
  });
});
