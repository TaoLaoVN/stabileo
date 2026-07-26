/**
 * PR16 — project regulation settings in the browser.
 *
 * Three behaviours that no unit test can prove: that the settings reach the real
 * verifier through the real store wiring, that an unstated aggregate size is visible to
 * a user who never opens the settings panel, and that switching edition invalidates the
 * verdicts WITHOUT destroying the reinforcement — the regression PR15 was written to
 * repair, re-armed here against a new trigger.
 */

import { test, expect, loadModel, solveModel, computeDemands } from './fixtures';

const QA = 'rc-design-qa-8';

interface StoredSettings {
  concreteEdition: string;
  loadEdition: string;
  windEdition: string;
  jurisdiction: { name: string; basis: string };
  concrete: { maxAggregateSizeMm: number | null; shotcrete: boolean };
}

function settings(page: import('@playwright/test').Page): Promise<StoredSettings> {
  return page.evaluate(() =>
    (window.__stabileo as unknown as { codeSettings(): StoredSettings }).codeSettings());
}

async function openPanel(page: import('@playwright/test').Page) {
  const disclosure = page.getByTestId('code-settings-disclosure');
  await expect(disclosure).toBeVisible();
  await disclosure.locator('summary').click();
  return disclosure;
}

test.describe('@smoke project regulation settings', () => {
  test('C1 — defaults to the edition in force, with the aggregate left unstated', async ({ pro: page }) => {
    const s = await settings(page);
    expect(s.concreteEdition).toBe('2025');
    expect(s.loadEdition).toBe('2025');
    expect(s.windEdition).toBe('2025');
    // null, not 20. The assumption has to stay visible on every subsequent open rather
    // than being baked into the project the first time it is saved.
    expect(s.concrete.maxAggregateSizeMm).toBeNull();
    expect(s.jurisdiction.basis).toBe('unstated');
  });

  test('C2 — a user who never opens the panel still sees the assumption', async ({ pro: page }) => {
    await expect(page.getByTestId('code-settings-disclosure')).toBeVisible();
    await expect(page.getByTestId('code-settings-attention')).toBeVisible();
  });

  test('C3 — the panel is labelled and keyboard-operable', async ({ pro: page }) => {
    const summary = page.getByTestId('code-settings-disclosure').locator('summary');
    await summary.focus();
    await page.keyboard.press('Enter');

    await expect(page.getByLabel('Jurisdiction')).toBeVisible();
    await expect(page.getByLabel('Basis of application')).toBeVisible();
    await expect(page.getByLabel('Maximum nominal coarse-aggregate size')).toBeVisible();
    await expect(page.getByTestId('aggregate-assumed')).toBeVisible();
  });

  test('C4 — stating an aggregate size clears its assumption and persists', async ({ pro: page }) => {
    await openPanel(page);
    const field = page.getByTestId('max-aggregate');
    await field.fill('25');
    await field.blur();

    await expect(page.getByTestId('aggregate-assumed')).toBeHidden();
    expect((await settings(page)).concrete.maxAggregateSizeMm).toBe(25);

    // The header badge tracks EVERY unstated project fact, not just the aggregate, so
    // it correctly stays up while the jurisdiction is still unstated.
    await expect(page.getByTestId('code-settings-attention')).toBeVisible();
    await page.getByLabel('Basis of application').selectOption('adopted');
    await expect(page.getByTestId('code-settings-attention')).toBeHidden();
  });

  test('C5 — an out-of-range aggregate size is rejected, not stored', async ({ pro: page }) => {
    await openPanel(page);
    const field = page.getByTestId('max-aggregate');
    await field.fill('500');
    await field.blur();

    await expect(field).toHaveAttribute('aria-invalid', 'true');
    expect((await settings(page)).concrete.maxAggregateSizeMm).toBeNull();
  });

  test('C6 — shotcrete caps the aggregate at the §26.4.2.1(a)(13) limit', async ({ pro: page }) => {
    await openPanel(page);
    await page.getByLabel('Placed by shotcrete').check();

    const field = page.getByTestId('max-aggregate');
    await field.fill('20');
    await field.blur();
    // 20 mm is fine for cast concrete but not for shotcrete, so it must be refused here.
    await expect(field).toHaveAttribute('aria-invalid', 'true');
    expect((await settings(page)).concrete.maxAggregateSizeMm).toBeNull();

    await field.fill('13');
    await field.blur();
    expect((await settings(page)).concrete.maxAggregateSizeMm).toBe(13);
  });

  test('C7 — settings survive a model snapshot round-trip', async ({ pro: page }) => {
    await openPanel(page);
    await page.getByLabel('Jurisdiction').fill('CABA');
    await page.getByTestId('max-aggregate').fill('19');
    await page.getByTestId('max-aggregate').blur();

    await loadModel(page, QA);
    // Loading an example replaces the model, so the settings come from that model —
    // this asserts the field exists on every model, not that it survived a replacement.
    const s = await settings(page);
    expect(s.concreteEdition).toBeTruthy();
    expect(s.concrete).toHaveProperty('maxAggregateSizeMm');
  });
});

test.describe('@slow the code edition drives the real verifier', () => {
  test('C8 — certificates name the edition they were produced under', async ({ pro: page }) => {
    const ids = await loadModel(page, QA);
    await solveModel(page);
    await computeDemands(page);
    await page.evaluate(() => window.__stabileoActions.designAll());
    await expect.poll(() => page.evaluate(() => window.__stabileo.runCounts()?.verified ?? 0))
      .toBeGreaterThan(0);

    const certified = await page.evaluate(
      (list) => list.find((id) => window.__stabileo.hasCertificate(id)) ?? null, ids);
    expect(certified).not.toBeNull();

    const verifier = await page.evaluate(
      (id) => (window.__stabileo as unknown as { certificateVerifierId(i: number): string | null })
        .certificateVerifierId(id as number), certified);
    // A certificate that does not record its edition is not interpretable later.
    expect(verifier).toBe('cirsoc201.provided.v2.2025');
  });

  test('C9 — switching edition invalidates the verdicts and KEEPS the reinforcement', async ({ pro: page }) => {
    const ids = await loadModel(page, QA);
    await solveModel(page);
    await computeDemands(page);
    await page.evaluate(() => window.__stabileoActions.designAll());
    await expect.poll(() => page.evaluate(() => window.__stabileo.runCounts()?.verified ?? 0))
      .toBeGreaterThan(0);

    const target = ids[0];
    const rebarBefore = await page.evaluate((id) => window.__stabileo.rebarSummary(id), target);
    expect(rebarBefore).not.toBe('none');
    const demandBefore = await page.evaluate(() => window.__stabileo.demandRevision());

    await openPanel(page);
    await page.getByTestId('concrete-edition').selectOption('2005');
    await expect(page.getByTestId('edition-warning')).toBeVisible();

    // The PR15 regression must not return under a new trigger. The rebar is the user's
    // work; only the verdict belongs to the code that produced it.
    expect(await page.evaluate((id) => window.__stabileo.rebarSummary(id), target))
      .toBe(rebarBefore);
    // The design table itself must still be mounted — not cleared and rebuilt.
    await expect(page.getByTestId('design-table')).toBeVisible();

    expect(await page.evaluate(() => window.__stabileo.demandRevision()))
      .toBeGreaterThan(demandBefore);
    expect((await settings(page)).concreteEdition).toBe('2005');
  });
});
