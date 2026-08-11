/** Screenshot the Education mode from the dev server on 4001. */
import { chromium } from 'playwright';

const OUT = '/private/tmp/claude-501/-Users-bautistachesta-Claude/64c19d7d-8390-4823-8865-dd9bf80c4986/scratchpad/rev';
const shot = process.argv[2] ?? 'edu';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1680, height: 1000 } });
const errs = [];
p.on('pageerror', e => errs.push(String(e).slice(0, 200)));
p.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 200)); });

await p.goto('http://127.0.0.1:4001/app/education', { waitUntil: 'networkidle' });
await p.evaluate(() => localStorage.clear());
await p.reload({ waitUntil: 'networkidle' });
await p.waitForTimeout(2500);
await p.locator('.exercise-card').first().click();
await p.waitForTimeout(2500);
await p.screenshot({ path: `${OUT}/${shot}-step1.png` });

// Step 2 by clicking the stepper — proving it navigates.
await p.getByTestId('edu-step-2').click();
await p.waitForTimeout(700);
await p.screenshot({ path: `${OUT}/${shot}-step2.png` });
console.log('errores JS:', errs.length, errs.slice(0, 3));
await b.close();
