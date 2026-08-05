/**
 * English / Spanish parity for the keys the public landing actually uses.
 *
 * The public landing offers exactly two languages (see PUBLIC_LOCALES in
 * src/lib/i18n/store.svelte.ts). `t()` falls back to English silently, so a
 * missing Spanish key renders an English sentence in the middle of a Spanish
 * page and nothing errors. That is precisely the defect this guards.
 *
 * Scope is derived from the source, not from a hand-maintained list: the test
 * scans every landing component for `t('landing.…')` and requires each key it
 * finds to exist in both dictionaries. Adding a section with untranslated copy
 * therefore fails here, without anyone remembering to update this file.
 *
 * The repo-wide locale-parity test (src/lib/i18n/__tests__) is deliberately
 * untouched: it covers all fourteen dictionaries and a different namespace.
 */
import { describe, it, expect } from 'vitest';
import en from '../../../lib/i18n/locales/en';
import es from '../../../lib/i18n/locales/es';

const sources = import.meta.glob('../**/*.{svelte,ts}', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

function usedKeys(): string[] {
  const found = new Set<string>();
  for (const [path, src] of Object.entries(sources)) {
    if (path.includes('__tests__')) continue;
    for (const m of src.matchAll(/t\(\s*'(landing\.[A-Za-z0-9_]+)'\s*\)/g)) found.add(m[1]);
    // Keys held in data tables and passed through `t()` indirectly.
    for (const m of src.matchAll(/'(landing\.[A-Za-z0-9_]+)'/g)) found.add(m[1]);
  }
  return [...found].sort();
}

/** Keys built at runtime as `'landing.' + key`, which the regex cannot see. */
const COMPUTED_PREFIXED = ['capLin', 'capNl', 'capEl', 'capTd', 'stT', 'stPa', 'stR'];

describe('public landing en/es key parity', () => {
  const keys = usedKeys();

  it('finds a plausible number of landing keys to check', () => {
    expect(keys.length).toBeGreaterThan(80);
  });

  it('every landing key used by a component exists in English', () => {
    const missing = keys.filter((k) => !(k in en));
    expect(missing, `missing from en.ts:\n${missing.join('\n')}`).toEqual([]);
  });

  it('every landing key used by a component exists in Spanish', () => {
    const missing = keys.filter((k) => !(k in es));
    expect(missing, `missing from es.ts — these would render in English on the Spanish landing:\n${missing.join('\n')}`).toEqual([]);
  });

  it('the runtime-composed capability and status keys exist in both', () => {
    const enKeys = Object.keys(en);
    for (const prefix of COMPUTED_PREFIXED) {
      const group = enKeys.filter((k) => new RegExp(`^landing\\.${prefix}\\d+$`).test(k));
      expect(group.length, `en.ts has no landing.${prefix}<n> keys`).toBeGreaterThan(0);
      const missing = group.filter((k) => !(k in es));
      expect(missing, `missing from es.ts:\n${missing.join('\n')}`).toEqual([]);
    }
  });

  it('no landing key used by a component is an empty string', () => {
    const blank = keys.filter((k) => (en as Record<string, string>)[k]?.trim() === '' || (es as Record<string, string>)[k]?.trim() === '');
    expect(blank).toEqual([]);
  });
});
