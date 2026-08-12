/**
 * Basic mode must be complete in all three offered languages.
 *
 * `t()` falls back to English for a missing key, silently. That fallback is
 * what let a Spanish user read English trivia in a dialog nobody had checked,
 * and what hid 176 untranslated Portuguese strings across the editor. It is a
 * good runtime behaviour and a terrible development one: nothing fails, so
 * nothing gets fixed.
 *
 * This walks the source, collects every key the UI actually asks for, and
 * asserts all three dictionaries answer. Scoped to what Basic mode reaches —
 * PRO, Education, the DXF importer and the landing page have their own gaps and
 * their own PRs, and folding them in would make this fail for reasons that have
 * nothing to do with Basic.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import en from '../locales/en';
import es from '../locales/es';
import pt from '../locales/pt';

const SRC = join(import.meta.dirname, '../../..');

/** Areas with their own translation debt and their own PRs. */
const OUT_OF_SCOPE = /^(pro\.|edu\.|cad\.|landing\.)/;
const SKIP_DIRS = ['__tests__', 'locales', 'pro', 'edu'];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.includes(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.svelte') || p.endsWith('.ts')) out.push(p);
  }
  return out;
}

/**
 * Keys requested with a literal, which is the only form that can be checked.
 *
 * A key built by concatenation — `t('a.' + b)` — is invisible here, which is
 * one more reason the codebase writes them out in full.
 */
function usedKeys(): Set<string> {
  const keys = new Set<string>();
  for (const file of walk(SRC)) {
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(/\bt\(\s*['`]([a-zA-Z][\w.]*)['`]\s*[,)]/g)) {
      if (!OUT_OF_SCOPE.test(m[1])) keys.add(m[1]);
    }
  }
  return keys;
}

const used = usedKeys();

describe('Basic mode is fully translated', () => {
  it('asks for a substantial number of keys — the scan is not silently empty', () => {
    // Guards the test itself: a broken regex would make everything below pass
    // vacuously, which is the worst possible outcome for a coverage check.
    expect(used.size).toBeGreaterThan(1000);
  });

  it('every key it asks for is defined in English', () => {
    // English is the fallback, so a key missing HERE renders as nothing at all
    // in every language. That is not a translation gap, it is a blank label.
    const missing = [...used].filter((k) => !(k in en)).sort();
    expect(missing).toEqual([]);
  });

  it('every key is defined in Spanish', () => {
    const missing = [...used].filter((k) => !(k in es)).sort();
    expect(missing).toEqual([]);
  });

  it('every key is defined in Portuguese', () => {
    const missing = [...used].filter((k) => !(k in pt)).sort();
    expect(missing).toEqual([]);
  });

  it('placeholders survive translation in both target languages', () => {
    // A `{name}` lost in translation renders the brace to the user; one
    // renamed silently drops the value. Both look like content bugs rather
    // than translation bugs, which is why they are worth catching here.
    const issues: string[] = [];
    for (const k of used) {
      /*
       * `{s}` is excluded: it is the English plural suffix — "1 mode{s}" —
       * and Spanish and Portuguese form plurals differently, so a translation
       * that drops it is CORRECT rather than broken. Every other token names a
       * value, and losing one of those silently drops it from the sentence.
       */
      const tokens = (s: string) =>
        [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).filter((n) => n !== 's').sort().join(',');
      const ref = tokens(en[k] ?? '');
      for (const [lang, dict] of [['es', es], ['pt', pt]] as const) {
        const v = dict[k];
        if (v !== undefined && tokens(v) !== ref) issues.push(`${k} [${lang}]: "${ref}" vs "${tokens(v)}"`);
      }
    }
    expect(issues).toEqual([]);
  });
});
