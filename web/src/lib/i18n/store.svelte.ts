import en from './locales/en';
import vi from './locales/vi';
import mahungVi from './locales/mahung-vi';
import steelEn from './locales/steel/en';
import steelVi from './locales/steel/vi';
import type { Translations } from './types';

/**
 * Runtime languages exposed by the Mahung.Space tool.
 *
 * Vietnamese is the product language. English remains as a technical fallback
 * for solver terms and untranslated edge cases, but the old Spanish/Portuguese
 * public surface is no longer offered in this deployment.
 */
const dicts: Record<string, Translations> = {
  vi: { ...vi, ...steelVi, ...mahungVi },
  en: { ...en, ...steelEn },
};

/** Safe localStorage check — vitest defines localStorage but without working methods. */
function hasLocalStorage(): boolean {
  try {
    return typeof localStorage !== 'undefined' && typeof localStorage.getItem === 'function';
  } catch {
    return false;
  }
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

/** The locales shown in the UI. */
export const OFFERED_LOCALES = ['vi', 'en'] as const;
export type OfferedLocale = (typeof OFFERED_LOCALES)[number];

/** Whether a bare language code is one the app offers. */
export function isOfferedLocale(code: string): code is OfferedLocale {
  return (OFFERED_LOCALES as readonly string[]).includes(code);
}

function detectBrowserLocale(): OfferedLocale {
  if (typeof navigator === 'undefined') return 'vi';
  for (const lang of navigator.languages ?? [navigator.language]) {
    if (!lang) continue;
    const code = lang.split('-')[0].toLowerCase();
    if (isOfferedLocale(code)) return code;
  }
  return 'vi';
}

function getInitialLocale(): string {
  if (!hasLocalStorage()) return detectBrowserLocale();
  if (localStorage.getItem('stabileo-lang-manual') === '1') {
    const stored = localStorage.getItem('stabileo-lang');
    if (stored && isOfferedLocale(stored)) return stored;
  }
  const detected = detectBrowserLocale();
  localStorage.setItem('stabileo-lang', detected);
  return detected;
}

let _locale = $state<string>(getInitialLocale());

export function t(key: string): string {
  return tAt(key, _locale);
}

export function tAt(key: string, locale: string): string {
  const dict = dicts[locale] ?? dicts.vi;
  return (dict as any)[key] ?? (dicts.en as any)[key] ?? key;
}

export function shippedLocales(): string[] {
  return Object.keys(dicts);
}

/** A locale's raw dictionary. Gate use only. */
export function dictFor(locale: string): Record<string, string> {
  return (dicts[locale] ?? {}) as Record<string, string>;
}

export function tp(key: string, params?: Record<string, string | number>): string {
  const raw = t(key);
  if (!params) return raw;
  return raw.replace(/\{(\w+)\}/g, (m, name) => {
    const v = params[name];
    return v === undefined || v === null ? m : String(v);
  });
}

export function setLocale(loc: string) {
  if (!isOfferedLocale(loc)) return;
  _locale = loc;
  if (hasLocalStorage()) {
    localStorage.setItem('stabileo-lang', loc);
    localStorage.setItem('stabileo-lang-manual', '1');
  }
}

function allTranslations(key: string): Set<string> {
  const s = new Set<string>();
  for (const dict of Object.values(dicts)) {
    const v = (dict as any)[key];
    if (v) s.add(v);
  }
  return s;
}

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

export const PUBLIC_LOCALES = ['vi', 'en'] as const;
export type PublicLocale = (typeof PUBLIC_LOCALES)[number];

function isPublicLocale(loc: string): loc is PublicLocale {
  return (PUBLIC_LOCALES as readonly string[]).includes(loc);
}

function publicLocale(): PublicLocale {
  return isPublicLocale(_locale) ? _locale : 'vi';
}

export function tPublic(key: string): string {
  const dict = dicts[publicLocale()];
  return (dict as any)[key] ?? (dicts.en as any)[key] ?? key;
}

export function tpPublic(key: string, params?: Record<string, string | number>): string {
  const raw = tPublic(key);
  if (!params) return raw;
  return raw.replace(/\{(\w+)\}/g, (m, name) => {
    const v = params[name];
    return v === undefined || v === null ? m : String(v);
  });
}

export const publicI18n = {
  get locale(): PublicLocale {
    return publicLocale();
  }
};

export function setPublicLocale(loc: PublicLocale) {
  setLocale(loc);
}
