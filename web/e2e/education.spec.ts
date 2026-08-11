import { test, expect, type Page } from '@playwright/test';

/**
 * Education, driven the way the two people who use it do.
 *
 * Every defect this suite pins was invisible to unit tests, because each unit
 * involved was correct and only the arrangement was wrong:
 *
 *  - A teacher's exercise link was eaten before anything could read it. The app
 *    rewrote the URL from `pathname + search` while the mode was still being
 *    resolved, so `#edu-ex=` was gone by the time the Education panel mounted.
 *    Nothing threw; the student simply landed on the exercise list.
 *  - The authoring form's default option told a teacher to draw with "the usual
 *    tools" in a mode that mounts no tools at all.
 *  - The three steps of an exercise were stacked in one scroll under a stepper
 *    that did nothing.
 *
 * All three are integration properties of the shell, so they are checked here
 * rather than by reading source.
 */

const EDU_URL = '/app/education';

/** An exercise a teacher would hand out, in the format the app writes. */
const EXERCISE = {
  stabileoExercise: 1,
  exercise: {
    id: 'e2e-cantilever',
    title: 'E2E cantilever',
    description: 'A 4 m cantilever with a 10 kN point load at the tip.',
    difficulty: 'easy',
    category: 'statics',
    model: {
      nodes: [[0, 0], [4, 0]],
      elements: [[0, 1]],
      supports: [{ node: 0, type: 'fixed' }],
      nodalLoads: [{ node: 1, fy: -10 }],
    },
    supports: [{ label: 'Fixed end', nodeIndex: 0, dofs: ['Ry', 'M'] }],
    characteristics: [{ label: 'M max', unit: 'kN·m', answer: { kind: 'maxAbsMoment' } }],
    diagramQuestions: [],
  },
};

/** The same encoding `toShareLink` uses, so the spec exercises the real reader. */
function shareLink(): string {
  const json = JSON.stringify(EXERCISE, null, 2);
  const b64 = Buffer.from(json, 'utf8').toString('base64');
  return `${EDU_URL}#edu-ex=${b64}`;
}

async function bootEducation(page: Page, url = EDU_URL) {
  await page.addInitScript(() => {
    try {
      localStorage.clear();
      localStorage.setItem('stabileo-lang', 'en');
      localStorage.setItem('stabileo-lang-manual', '1');
    } catch { /* private mode */ }
  });
  await page.goto(url);
  await expect(page.locator('.edu-panel')).toBeVisible({ timeout: 30_000 });
}

test.describe('@smoke Education — a handed-out exercise', () => {
  test('a link opens the exercise it carries, not the exercise list', async ({ page }) => {
    await bootEducation(page, shareLink());

    // The exercise itself, not the catalogue it was filed into.
    await expect(page.locator('.exercise-view')).toBeVisible();
    await expect(page.getByTestId('edu-handout-title')).toHaveText('E2E cantilever');
    await expect(page.locator('.exercise-card')).toHaveCount(0);
  });

  test('the window drops the exits a student was not sent to', async ({ page }) => {
    await bootEducation(page, shareLink());

    // No mode switcher, no tab strip, no "+" for a new project.
    await expect(page.locator('.mode-toggle')).toHaveCount(0);
    await expect(page.locator('.tab-bar')).toHaveCount(0);
  });

  test('one step at a time, and the stepper moves between them', async ({ page }) => {
    await bootEducation(page, shareLink());

    await expect(page.locator('.step-section')).toHaveCount(1);
    // Uppercase is a CSS transform; the DOM text is the sentence itself.
    await expect(page.locator('.step-title')).toContainText('Support Reactions');

    await page.getByTestId('edu-step-3').click();
    await expect(page.locator('.step-section')).toHaveCount(1);
    await expect(page.locator('.step-title')).toContainText('Characteristic values');
  });

  test('a student hands in a code the teacher can open', async ({ page }) => {
    await bootEducation(page, shareLink());

    // Answer the reaction the exercise asks for. 10 kN up, 40 kN·m at the base.
    const fields = page.locator('.dof-input input');
    await fields.nth(0).fill('10');
    await fields.nth(1).fill('-40');
    await page.locator('.verify-btn').first().click();

    await page.locator('.handin-name input').fill('E2E student');
    await page.getByTestId('edu-handin-code').click();
    const code = await page.locator('.handin-code').inputValue();
    expect(code.length, 'a code was produced').toBeGreaterThan(50);

    // A different session — the teacher's — reads it.
    await page.evaluate(() => localStorage.clear());
    await page.goto(EDU_URL);
    await expect(page.locator('.edu-panel')).toBeVisible();
    await page.locator('.submit-code').fill(code);
    await page.getByTestId('edu-open-code').click();

    const review = page.locator('.review');
    await expect(review).toBeVisible();
    await expect(review).toContainText('E2E student');
    await expect(review).toContainText('E2E cantilever');
    // Question / answer / outcome for every field that was asked for.
    await expect(review.locator('tbody tr')).toHaveCount(3);
  });
});

test.describe('@smoke Education — authoring', () => {
  test('the drawing tools exist in the mode that tells you to draw', async ({ page }) => {
    await bootEducation(page);
    await page.locator('.edu-author-btn').click();

    // The bar, and the four tools an exercise author needs.
    await expect(page.locator('.floating-tools')).toBeVisible();
    for (const tool of ['Node', 'Element', 'Support', 'Load']) {
      await expect(page.locator('.ft-btn', { hasText: tool })).toBeVisible();
    }
  });

  test('both ways into a submission are named, and neither is a system widget', async ({ page }) => {
    await bootEducation(page);

    // A native file input renders as an unstyled button labelled "Choose File";
    // the visible controls here must be the app's own, each with its `?`.
    await expect(page.getByTestId('edu-open-submission')).toContainText(/Open a file/i);
    await expect(page.getByTestId('edu-open-code')).toContainText(/Open code/i);
    await expect(page.locator('.submit-row .help-btn')).toHaveCount(2);
    await expect(page.locator('.submit-row input[type=file]')).toHaveCount(0);
  });
});
