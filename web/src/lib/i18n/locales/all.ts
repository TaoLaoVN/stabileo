/**
 * Every dictionary on disk, including the ones the application does not offer.
 *
 * ── Why this file exists, and why nothing in `src/` may import it ──
 *
 * `store.svelte.ts` used to import all fourteen locales so that re-enabling
 * one would be a single edit. The cost of that convenience was not visible
 * until the landing and the blog were measured: the eleven locales the app
 * refuses to switch to were **2.0 MB of the 14.6 MB bundle** — the single
 * largest item in it, ahead of the solver and ahead of Three.js — and every
 * reader of a blog post downloaded all of them to read a page that exists in
 * three languages.
 *
 * They are unreachable at runtime, not merely unused: `setLocale` refuses a
 * code that is not offered, `detectBrowserLocale` only ever returns an offered
 * one, and no production caller passes a locale to `tAt`. Nothing but tests
 * ever read them.
 *
 * So the store now imports the three the app speaks, and the other eleven live
 * here. The translation work is kept — that was the point of holding on to
 * them — and the parity gates still read every one, because they import this
 * file. What changed is that a browser no longer does.
 *
 * Re-enabling a locale is still a single edit, just in the other direction:
 * add it to `dicts` in store.svelte.ts and to OFFERED_LOCALES.
 *
 * IMPORTANT: importing this from application code silently puts all fourteen
 * back into the bundle. `no-all-locales-in-app.test.ts` fails if anything
 * under `src/` outside `__tests__` does.
 */
import type { Translations } from '../types';
import es from './es';
import en from './en';
import pt from './pt';
import de from './de';
import fr from './fr';
import it from './it';
import tr from './tr';
import hi from './hi';
import ja from './ja';
import ko from './ko';
import ru from './ru';
import zh from './zh';
import ar from './ar';
import id from './id';

/** Every dictionary that exists, offered or not. Gates only. */
export const ALL_DICTS: Record<string, Translations> = {
  es, en, pt, de, fr, it, tr, hi, ja, ko, ru, zh, ar, id,
};

/** Every locale with a dictionary on disk. Gates only. */
export function allShippedLocales(): string[] {
  return Object.keys(ALL_DICTS);
}

/** One dictionary by code, offered or not. Gates only. */
export function allDictFor(locale: string): Record<string, string> {
  return (ALL_DICTS[locale] ?? {}) as Record<string, string>;
}
