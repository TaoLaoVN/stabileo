import { chromium } from 'playwright';
const OUT='/private/tmp/claude-501/-Users-bautistachesta-Claude/64c19d7d-8390-4823-8865-dd9bf80c4986/scratchpad/pro';
import fs from 'node:fs'; fs.mkdirSync(OUT,{recursive:true});
const b = await chromium.launch();
const errs = [];
const page = await b.newPage({ viewport: { width: 1680, height: 1000 } });
page.on('pageerror', e => errs.push(`PAGEERROR ${String(e).slice(0,150)}`));
page.on('console', m => { if (m.type()==='error') errs.push(`console ${m.text().slice(0,150)}`); });

await page.goto('http://127.0.0.1:4001/app/pro', { waitUntil: 'networkidle' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle' }); await page.waitForTimeout(1800);
await page.screenshot({ path: `${OUT}/00-vacio.png` });

// Load a PRO example so every tab has content.
await page.locator('button').filter({ hasText: /^Examples$|^Ejemplos$/ }).first().click();
await page.waitForTimeout(900);
const ex = page.locator('.example-item').first();
console.log('  ejemplos PRO:', await page.locator('.example-item').count());
if (await ex.count()) { await ex.click(); await page.waitForTimeout(4000); }
console.log('  modelo:', (await page.locator('body').innerText()).match(/\d+ nod\w+[^|\n]*/)?.[0] ?? '—');
await page.screenshot({ path: `${OUT}/01-cargado.png` });

// Walk every PRO tab.
const TABS = ['nodes','elements','shells','materials','sections','supports','constraints','loads','advanced','results','design','connections','diagnostics'];
for (const tabName of TABS) {
  const n = errs.length;
  // Open the group dropdown that owns this tab, then pick it.
  const groups = { nodes:'geometry', elements:'geometry', shells:'geometry',
    materials:'properties', sections:'properties',
    supports:'conditions', constraints:'conditions', loads:'conditions',
    advanced:'analysis', results:'analysis', design:'analysis', connections:'analysis', diagnostics:'analysis' };
  await page.getByTestId(`pb-group-${groups[tabName]}`).click().catch(()=>{});
  await page.waitForTimeout(400);
  await page.getByTestId(`pb-tab-${tabName}`).click().catch(()=>{});
  await page.waitForTimeout(1300);
  const body = await page.locator('aside.pro-sidebar, aside.right').first().innerText().catch(()=>'');
  console.log(`  ${errs.length > n ? '✗' : '·'} ${tabName.padEnd(13)} ${String(body.trim().length).padStart(5)} chars${errs.length > n ? ' — ' + errs.slice(n).join(' | ') : ''}`);
  await page.screenshot({ path: `${OUT}/tab-${tabName}.png` });
}
fs.writeFileSync(`${OUT}/errores.txt`, errs.join('\n'));
console.log(`\n  errores: ${errs.length}`);
await b.close();
