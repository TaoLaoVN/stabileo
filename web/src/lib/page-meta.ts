import { PUBLIC_LOCALES, type PublicLocale } from './i18n/store.svelte';
import { alternateUrls, publicUrl } from './i18n/public-routes';

const OG_LOCALE: Record<PublicLocale, string> = {
  vi: 'vi_VN',
  en: 'en_US'
};

const META_TAGS = [
  ['meta[name="description"]', 'content'],
  ['meta[property="og:title"]', 'content'],
  ['meta[property="og:description"]', 'content'],
  ['meta[property="og:locale"]', 'content'],
  ['meta[name="twitter:title"]', 'content'],
  ['meta[name="twitter:description"]', 'content']
] as const;

const ALTERNATE = 'meta[property="og:locale:alternate"]';
const HREFLANG = 'link[rel="alternate"][hreflang]';
const JSONLD = 'script[type="application/ld+json"][data-page-meta]';

export type ArticleMeta = {
  headline: string;
  description: string;
  datePublished: string;
  authors: string[];
  url: string;
  locale: PublicLocale;
};

function setArticleData(article: ArticleMeta | undefined) {
  document.querySelector(JSONLD)?.remove();
  if (!article) return;
  const el = document.createElement('script');
  el.setAttribute('type', 'application/ld+json');
  el.setAttribute('data-page-meta', '');
  el.textContent = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: article.headline,
    description: article.description,
    datePublished: article.datePublished,
    inLanguage: article.locale,
    author: article.authors.map((name) => ({ '@type': 'Person', name })),
    publisher: { '@type': 'Organization', name: 'Mahung.Space', url: 'https://mahung.space' },
    mainEntityOfPage: { '@type': 'WebPage', '@id': article.url },
    url: article.url,
    image: 'https://stabileo.mahung.space/og/stabileo-social.png'
  });
  document.head.appendChild(el);
}

type Hreflang = { hreflang: string; href: string };

let original: {
  title: string;
  lang: string;
  tags: (string | null)[];
  alternates: string[];
  canonical: string | null;
  hreflangs: Hreflang[];
} | null = null;

function setMeta(selector: string, value: string) {
  document.querySelector(selector)?.setAttribute('content', value);
}

function readAlternates(): string[] {
  return [...document.querySelectorAll(ALTERNATE)].map((el) => el.getAttribute('content') ?? '');
}

function readHreflangs(): Hreflang[] {
  return [...document.querySelectorAll(HREFLANG)].map((el) => ({
    hreflang: el.getAttribute('hreflang') ?? '',
    href: el.getAttribute('href') ?? ''
  }));
}

function setHreflangs(values: Hreflang[], anchor: Element | null) {
  for (const el of document.querySelectorAll(HREFLANG)) el.remove();
  if (!anchor?.parentNode) return;
  let after: Node = anchor;
  for (const value of values) {
    const el = document.createElement('link');
    el.setAttribute('rel', 'alternate');
    el.setAttribute('hreflang', value.hreflang);
    el.setAttribute('href', value.href);
    anchor.parentNode.insertBefore(el, after.nextSibling);
    after = el;
  }
}

function setAlternateLocales(values: string[]) {
  const anchor = document.querySelector('meta[property="og:locale"]');
  if (!anchor?.parentNode) return;
  for (const el of document.querySelectorAll(ALTERNATE)) el.remove();
  let after: Node = anchor;
  for (const value of values) {
    const el = document.createElement('meta');
    el.setAttribute('property', 'og:locale:alternate');
    el.setAttribute('content', value);
    anchor.parentNode.insertBefore(el, after.nextSibling);
    after = el;
  }
}

function setLinks(path: string, locale: PublicLocale) {
  const canonical = document.querySelector('link[rel="canonical"]');
  if (canonical) canonical.setAttribute('href', publicUrl(path, locale));
  setHreflangs(alternateUrls(path), canonical ?? document.head.lastElementChild);
  setMeta('meta[property="og:url"]', publicUrl(path, locale));
}

export function applyPageMeta(meta: {
  title: string;
  description: string;
  locale: PublicLocale;
  path: string;
  article?: ArticleMeta;
}) {
  if (!original) {
    original = {
      title: document.title,
      lang: document.documentElement.lang,
      tags: META_TAGS.map(([sel, attr]) => document.querySelector(sel)?.getAttribute(attr) ?? null),
      alternates: readAlternates(),
      canonical: document.querySelector('link[rel="canonical"]')?.getAttribute('href') ?? null,
      hreflangs: readHreflangs()
    };
  }
  document.title = meta.title;
  document.documentElement.lang = meta.locale;
  setMeta('meta[name="description"]', meta.description);
  setMeta('meta[property="og:title"]', meta.title);
  setMeta('meta[property="og:description"]', meta.description);
  setMeta('meta[property="og:locale"]', OG_LOCALE[meta.locale]);
  setAlternateLocales(PUBLIC_LOCALES.filter((l) => l !== meta.locale).map((l) => OG_LOCALE[l]));
  setMeta('meta[name="twitter:title"]', meta.title);
  setMeta('meta[name="twitter:description"]', meta.description);
  setLinks(meta.path, meta.locale);
  setArticleData(meta.article);
}

export function restorePageMeta() {
  if (!original) return;
  document.title = original.title;
  document.documentElement.lang = original.lang;
  META_TAGS.forEach(([sel, attr], i) => {
    const v = original!.tags[i];
    if (v !== null) document.querySelector(sel)?.setAttribute(attr, v);
  });
  setAlternateLocales(original.alternates);
  const canonical = document.querySelector('link[rel="canonical"]');
  if (canonical && original.canonical) canonical.setAttribute('href', original.canonical);
  setHreflangs(original.hreflangs, canonical ?? document.head.lastElementChild);
  setArticleData(undefined);
}
