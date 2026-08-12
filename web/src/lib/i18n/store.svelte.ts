import es from './locales/es';
import en from './locales/en';
import pt from './locales/pt';
import de from './locales/de';
import fr from './locales/fr';
import it from './locales/it';
import tr from './locales/tr';
import hi from './locales/hi';
import ja from './locales/ja';
import ko from './locales/ko';
import ru from './locales/ru';
import zh from './locales/zh';
import ar from './locales/ar';
import id from './locales/id';
import type { Translations } from './types';

const dicts: Record<string, Translations> = { es, en, pt, de, fr, it, tr, hi, ja, ko, ru, zh, ar, id };

/** Safe localStorage check — vitest defines localStorage but without working methods. */
function hasLocalStorage(): boolean {
	try {
		return typeof localStorage !== 'undefined' && typeof localStorage.getItem === 'function';
	} catch { return false; }
}

// Migrate old storage keys
if (hasLocalStorage()) {
	for (const key of ['lang', 'lang-manual']) {
		const old = localStorage.getItem(`dedaliano-${key}`);
		if (old !== null && localStorage.getItem(`stabileo-${key}`) === null) {
			localStorage.setItem(`stabileo-${key}`, old);
			localStorage.removeItem(`dedaliano-${key}`);
		}
	}
}

function detectBrowserLocale(): string {
	if (typeof navigator === 'undefined') return 'en';
	for (const lang of navigator.languages ?? [navigator.language]) {
		const code = lang.split('-')[0].toLowerCase();
		if (code in dicts) return code;
	}
	return 'en';
}

function getInitialLocale(): string {
	if (!hasLocalStorage()) return detectBrowserLocale();
	// Only use stored locale if user explicitly chose it (flag set by setLocale)
	if (localStorage.getItem('stabileo-lang-manual') === '1') {
		const stored = localStorage.getItem('stabileo-lang');
		if (stored && stored in dicts) return stored;
	}
	// Otherwise auto-detect from browser and clear any stale stored value
	const detected = detectBrowserLocale();
	localStorage.setItem('stabileo-lang', detected);
	return detected;
}

let _locale = $state<string>(getInitialLocale());

export function t(key: string): string {
	return tAt(key, _locale);
}

/**
 * Translate at an explicit locale, without touching the active one.
 *
 * Report and export writers need this: a user may want a Spanish PDF while reading an
 * English UI, and flipping `_locale` to achieve that would persist to localStorage and
 * re-render the whole app mid-export.
 */
export function tAt(key: string, locale: string): string {
	const dict = dicts[locale] ?? dicts.en;
	return (dict as any)[key] ?? (dicts.en as any)[key] ?? key;
}

/** Every locale the app ships. Used by the locale-parity gate. */
export function shippedLocales(): string[] {
	return Object.keys(dicts);
}

/** A locale's raw dictionary. Gate use only. */
export function dictFor(locale: string): Record<string, string> {
	return (dicts[locale] ?? {}) as Record<string, string>;
}

/**
 * Translate with `{placeholder}` interpolation.
 *
 * `t()` has no parameter support, so PR15's design messages (which carry element
 * ids, utilizations and dimensions) go through this. Missing params are left as the
 * literal placeholder so an omission is visible rather than silently blank.
 */
export function tp(key: string, params?: Record<string, string | number>): string {
	const raw = t(key);
	if (!params) return raw;
	return raw.replace(/\{(\w+)\}/g, (m, name) => {
		const v = params[name];
		return v === undefined || v === null ? m : String(v);
	});
}

export function setLocale(loc: string) {
	_locale = loc;
	if (hasLocalStorage()) {
		localStorage.setItem('stabileo-lang', loc);
		localStorage.setItem('stabileo-lang-manual', '1');
	}
}

/** Set of all translations for a given key (across every locale). */
function allTranslations(key: string): Set<string> {
	const s = new Set<string>();
	for (const dict of Object.values(dicts)) {
		const v = (dict as any)[key];
		if (v) s.add(v);
	}
	return s;
}

/** Returns true if `name` matches any locale's default structure name. */
export function isDefaultName(name: string): boolean {
	return allTranslations('tabBar.newStructure').has(name);
}

export const i18n = {
	get locale() {
		return _locale;
	},
	set locale(v: string) {
		setLocale(v);
	},
	t,
	setLocale
};

// ─────────────────────────────────────────────────────────────────────────────
// Public landing locales
//
// The application ships fourteen languages and keeps all of them. The public
// landing page deliberately offers only two, because only `en` and `es` have a
// complete `landing.*` dictionary — the other twelve are ~97 keys short each,
// so `t()`'s silent English fallback renders them as a half-translated page.
// Offering a language the marketing copy does not actually speak is worse than
// not offering it.
//
// Nothing here mutates the application's locale. A visitor whose browser is set
// to French reads the landing in English and still gets a French editor.
// ─────────────────────────────────────────────────────────────────────────────

export const PUBLIC_LOCALES = ['en', 'es'] as const;
export type PublicLocale = (typeof PUBLIC_LOCALES)[number];

function isPublicLocale(loc: string): loc is PublicLocale {
	return (PUBLIC_LOCALES as readonly string[]).includes(loc);
}

/** The active locale if the landing speaks it, English otherwise. */
function publicLocale(): PublicLocale {
	return isPublicLocale(_locale) ? _locale : 'en';
}

/** `t()` constrained to the landing's public locales. */
export function tPublic(key: string): string {
	const dict = dicts[publicLocale()];
	return (dict as any)[key] ?? (dicts.en as any)[key] ?? key;
}

/** Reactive read-only view of the locale the landing is rendering in. */
export const publicI18n = {
	get locale(): PublicLocale {
		return publicLocale();
	}
};

/**
 * Set the locale from the landing's selector. This is a real, persisted, manual
 * choice and it applies to the whole application, exactly as the app's own
 * language selector does.
 */
export function setPublicLocale(loc: PublicLocale) {
	setLocale(loc);
}
