import { PUBLIC_LOCALES, type PublicLocale } from './store.svelte';

/** Where the tool lives. Used for canonical and hreflang, which must be absolute. */
export const SITE_ORIGIN = 'https://stabileo.mahung.space';

/** Vietnamese is the default public language for the Mahung.Space deployment. */
export const DEFAULT_PUBLIC_LOCALE: PublicLocale = 'vi';

function isPublic(code: string): code is PublicLocale {
  return (PUBLIC_LOCALES as readonly string[]).includes(code);
}

export type PublicRoute = {
  /** The language the prefix asked for, or null at the bare root. */
  locale: PublicLocale | null;
  /** What is left after the prefix: '/', '/blog', '/blog/<slug>'. */
  path: string;
};

/**
 * Split a pathname into its language prefix and the route under it.
 *
 * `/vi/blog/x` -> { locale: 'vi', path: '/blog/x' }
 * `/blog/x`    -> { locale: null, path: '/blog/x' }  (old links still work)
 * `/`          -> { locale: null, path: '/' }
 */
export function parsePublicPath(pathname: string): PublicRoute {
  const segments = pathname.split('/').filter(Boolean);
  if (segments.length > 0 && isPublic(segments[0])) {
    const rest = segments.slice(1).join('/');
    return { locale: segments[0], path: rest ? `/${rest}` : '/' };
  }
  return { locale: null, path: pathname === '' ? '/' : pathname };
}

/** `('/blog/x', 'vi')` -> `/vi/blog/x`. The root of a language has no trailing slash. */
export function publicHref(path: string, locale: PublicLocale): string {
  const clean = path === '/' ? '' : path.startsWith('/') ? path : `/${path}`;
  return `/${locale}${clean}`;
}

/** The same, absolute. Canonical and hreflang may not be relative. */
export function publicUrl(path: string, locale: PublicLocale): string {
  return `${SITE_ORIGIN}${publicHref(path, locale)}`;
}

/** Every language's address for one route, plus x-default. */
export function alternateUrls(path: string): Array<{ hreflang: string; href: string }> {
  return [
    ...PUBLIC_LOCALES.map((l) => ({ hreflang: l, href: publicUrl(path, l) })),
    { hreflang: 'x-default', href: publicUrl(path, DEFAULT_PUBLIC_LOCALE) }
  ];
}

/** Routes that exist in every language. Posts are appended by the caller. */
export const STATIC_PUBLIC_PATHS = ['/', '/blog'] as const;

export function preferredPublicLocale(languages: readonly string[]): PublicLocale {
  for (const tag of languages) {
    const code = tag.split('-')[0].toLowerCase();
    if (isPublic(code)) return code;
  }
  return DEFAULT_PUBLIC_LOCALE;
}
