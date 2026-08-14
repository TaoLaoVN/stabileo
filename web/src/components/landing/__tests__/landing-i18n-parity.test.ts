/**
 * Every language the public landing offers actually speaks the whole page.
 *
 * The landing offers the locales in PUBLIC_LOCALES (src/lib/i18n/store.svelte.ts)
 * and nothing else. `t()` falls back to English silently, so a missing key
 * renders an English sentence in the middle of a Spanish or Portuguese page and
 * nothing errors. That is precisely the defect this guards — and the reason the
 * list of offered locales and this test have to move together: adding a locale
 * to PUBLIC_LOCALES without its copy fails here rather than shipping a page
 * that switches language halfway down.
 *
 * Scope is derived from the source, not from a hand-maintained list: the test
 * scans every landing component for `t('landing.…')` and requires each key it
 * finds to exist in every offered dictionary. Adding a section with
 * untranslated copy therefore fails here, without anyone remembering to update
 * this file.
 *
 * Scope note: an earlier revision also asserted the editor's ribbon keys here,
 * because the landing embedded a live instance of the editor and rendered them
 * inside the page. That section is gone, so the assertion went with it. The
 * ribbon's Portuguese stays — it is a correct translation of real application
 * strings, and the editor is one click away — it is simply no longer the
 * landing's business to gate it.
 *
 * The repo-wide locale-parity test (src/lib/i18n/__tests__) is deliberately
 * untouched: it covers all fourteen dictionaries and a different namespace.
 */
import { describe, it, expect } from 'vitest';
import en from '../../../lib/i18n/locales/en';
import { PUBLIC_LOCALES, dictFor } from '../../../lib/i18n/store.svelte';

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

describe('public landing i18n', () => {
  const keys = usedKeys();
  const enDict = en as Record<string, string>;

  it('finds a plausible number of landing keys to check', () => {
    expect(keys.length).toBeGreaterThan(80);
  });

  it('every landing key used by a component exists in English', () => {
    const missing = keys.filter((k) => !(k in en));
    expect(missing, `missing from en.ts:\n${missing.join('\n')}`).toEqual([]);
  });

  for (const locale of PUBLIC_LOCALES.filter((l) => l !== 'en')) {
    const dict = () => dictFor(locale) as Record<string, string>;

    it(`${locale} has every landing key used by a component`, () => {
      const d = dict();
      const missing = keys.filter((k) => !(k in d));
      expect(missing, `missing from ${locale}.ts — these would render in English on the ${locale} landing:\n${missing.join('\n')}`).toEqual([]);
    });

    it(`${locale} has the runtime-composed capability and status keys`, () => {
      const d = dict();
      for (const prefix of COMPUTED_PREFIXED) {
        const group = Object.keys(en).filter((k) => new RegExp(`^landing\\.${prefix}\\d+$`).test(k));
        expect(group.length, `en.ts has no landing.${prefix}<n> keys`).toBeGreaterThan(0);
        const missing = group.filter((k) => !(k in d));
        expect(missing, `missing from ${locale}.ts:\n${missing.join('\n')}`).toEqual([]);
      }
    });

    it(`${locale} is translated, not English copied across`, () => {
      // A locale that "has" every key by repeating English reads as complete and
      // is not. Sampling the longest strings catches that without pretending to
      // judge translation quality: identical prose in two languages is the tell.
      const d = dict();
      const sample = keys
        .filter((k) => typeof enDict[k] === 'string' && enDict[k].length > 40)
        .sort((a, b) => enDict[b].length - enDict[a].length)
        .slice(0, 40);
      const copied = sample.filter((k) => d[k] === enDict[k]);
      expect(copied, `${locale} repeats the English text for: ${copied.join(', ')}`).toEqual([]);
    });
  }

  it('no landing key used by a component is an empty string in an offered locale', () => {
    const blank: string[] = [];
    for (const locale of PUBLIC_LOCALES) {
      const d = dictFor(locale) as Record<string, string>;
      for (const k of keys) if (k in d && d[k].trim() === '') blank.push(`${locale}:${k}`);
    }
    expect(blank).toEqual([]);
  });
});
