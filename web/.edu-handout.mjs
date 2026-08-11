/**
 * A student following a teacher's link: build a share link from an authored
 * spec the same way the app does, open it, and see what the window looks like.
 */
import { chromium } from 'playwright';

const OUT = '/private/tmp/claude-501/-Users-bautistachesta-Claude/64c19d7d-8390-4823-8865-dd9bf80c4986/scratchpad/rev';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1680, height: 1000 } });
const errs = [];
p.on('pageerror', e => errs.push(String(e).slice(0, 200)));

await p.goto('http://127.0.0.1:4001/app/education', { waitUntil: 'networkidle' });
await p.evaluate(() => localStorage.clear());

// A teacher's exercise, encoded by the app's own share-link writer.
const link = await p.evaluate(async () => {
  const lib = await import('/src/components/edu/exercise-library.ts');
  const spec = {
    id: 'probe-1',
    title: 'Viga en voladizo — carga en el extremo',
    description: 'Voladizo de 4 m con P = 10 kN en la punta. Calculá la reacción y el momento.',
    difficulty: 'easy',
    category: 'statics',
    model: {
      nodes: [[0, 0], [4, 0]],
      elements: [[0, 1]],
      supports: [{ node: 0, type: 'fixed' }],
      nodalLoads: [{ node: 1, fy: -10 }],
    },
    supports: [{ label: 'Empotramiento', nodeIndex: 0, dofs: ['Ry', 'M'] }],
    characteristics: [{ label: 'M máximo', unit: 'kN·m', answer: { kind: 'maxAbsMoment' } }],
    diagramQuestions: [],
  };
  return { url: lib.toShareLink(spec, location.origin + location.pathname) };
});
console.log('link:', JSON.stringify(link).slice(0, 220));
if (!link.url) { console.log('sin link, corto'); await b.close(); process.exit(0); }

await p.goto(link.url, { waitUntil: 'networkidle' });
await p.waitForTimeout(3000);
await p.screenshot({ path: `${OUT}/edu-handout.png` });
console.log('título handout:', await p.locator('[data-testid=edu-handout-title]').count());
console.log('errores JS:', errs.length, errs.slice(0, 2));
await b.close();
