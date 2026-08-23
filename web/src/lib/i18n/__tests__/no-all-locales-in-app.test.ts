/**
 * The eleven unoffered dictionaries must not come back into the bundle.
 *
 * `locales/all.ts` imports all fourteen. That is correct for a gate and
 * catastrophic for application code: one import from anywhere reachable by
 * `main.ts` puts 2.0 MB back into the chunk every landing and blog page
 * downloads, and nothing about the app would look or behave differently. The
 * regression would be invisible until someone measured again.
 *
 * So it is asserted structurally rather than by size: no file under `src/`
 * outside a `__tests__` directory may import it.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SRC = 'src';

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === '__tests__' || entry === 'node_modules') continue;
      walk(full, out);
    } else if (/\.(ts|svelte|js)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

describe('the unoffered dictionaries stay out of the application', () => {
  it('no application file imports locales/all', () => {
    const offenders = walk(SRC).filter((f) => {
      if (f.endsWith(join('locales', 'all.ts'))) return false;
      const src = readFileSync(f, 'utf8');
      return /from\s+['"][^'"]*locales\/all['"]/.test(src) || /import\(['"][^'"]*locales\/all['"]\)/.test(src);
    });
    expect(offenders, `these would pull all 14 dictionaries into the bundle:\n${offenders.join('\n')}`).toEqual([]);
  });

  it('the store itself imports only the offered three', () => {
    const src = readFileSync(join(SRC, 'lib/i18n/store.svelte.ts'), 'utf8');
    const imported = [...src.matchAll(/from '\.\/locales\/(\w+)'/g)].map((m) => m[1]).sort();
    expect(imported).toEqual(['en', 'es', 'pt']);
  });
});
