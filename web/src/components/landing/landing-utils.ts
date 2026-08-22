import { setPublicLocale, type PublicLocale } from '../../lib/i18n/store.svelte';
import { parsePublicPath } from '../../lib/i18n/public-routes';

export const REPO_URL = 'https://github.com/lambdaclass/stabileo';
export const DOCS_HUB_URL = `${REPO_URL}/blob/main/docs/README.md`;
export const QUICK_START_URL = `${REPO_URL}/blob/main/docs/QUICKSTART.md`;
export const AI_WORKFLOW_URL = `${REPO_URL}/blob/main/docs/AI_MODELING_WORKFLOW.md`;
export const SOLVER_REF_URL = `${REPO_URL}/blob/main/docs/SOLVER_REFERENCE.md`;

export function enterApp() {
  window.dispatchEvent(new CustomEvent('stabileo-enter-app'));
}

/**
 * Move between the public pages — the landing and the blog — without
 * reloading the document.
 *
 * A plain `<a href="/blog">` would work in production and would be wrong
 * anyway: the site is static, so the browser would fetch /blog, get the 404
 * page, and bounce through `/?route=/blog` with a visible flash. App.svelte
 * listens for this and swaps the page in place.
 */
export function goPublic(path: string) {
  window.dispatchEvent(new CustomEvent('stabileo-navigate', { detail: path }));
}

/**
 * Change language on a public page: set it, then move to the same route under
 * the new prefix.
 *
 * Setting the locale alone would leave a Portuguese page at `/es/blog/x`. The
 * address is the part that gets shared and indexed, so it is the part that has
 * to be right — the rendering follows it, never the other way round.
 */
export function switchPublicLocale(locale: PublicLocale) {
  setPublicLocale(locale);
  goPublic(parsePublicPath(window.location.pathname).path);
}

/**
 * Scroll to a section, and keep scrolling to it while the page settles.
 *
 * A single `scrollIntoView` lands short on this page, and measurably so:
 * clicking "Estado" left its section 2,418 px below the fold. The target is
 * computed when the click happens, but the page grows on the way there —
 * screenshots below the fold are lazy, and each one that decodes pushes
 * everything after it further down. The smooth scroll finishes at a position
 * that was correct when it started and is not any more.
 *
 * So the intent is re-asserted rather than fired once: after the initial
 * scroll, the offset is re-checked a few times over a second and corrected if
 * it has drifted more than a few pixels. Cheap, and it stops as soon as the
 * element is where it should be — including immediately, when nothing moved.
 */
export function scrollToId(id: string, root?: HTMLElement | null) {
  const find = () => (root ?? document).querySelector(`#${CSS.escape(id)}`) as HTMLElement | null;
  const el = find();
  if (!el) return;
  el.scrollIntoView({ behavior: 'smooth', block: 'start' });

  let tries = 0;
  const settle = () => {
    const target = find();
    if (!target || tries++ > 6) return;
    const off = target.getBoundingClientRect().top;
    if (Math.abs(off) > 8) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setTimeout(settle, 220);
  };
  setTimeout(settle, 400);
}

const GITHUB_API = `https://api.github.com/repos/lambdaclass/stabileo`;
const CACHE_KEY = 'stabileo-gh-stars';
const CACHE_TTL = 6 * 60 * 60 * 1000;

/** Last value we successfully read, fresh or not. `null` when nothing is cached. */
function cachedStars(): { stars: number; ts: number } | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const { stars, ts } = JSON.parse(raw);
    return typeof stars === 'number' && typeof ts === 'number' ? { stars, ts } : null;
  } catch {
    return null;
  }
}

/**
 * Star count, with a stale cache preferred over no answer at all.
 *
 * The unauthenticated GitHub API allows 60 requests an hour per IP, and it
 * answers 403 rather than 0 once that is spent. This used to return `null` on
 * any non-OK response, so the moment the cache went stale AND the limit was
 * spent the page rendered an em dash where a number had been — which reads as
 * a broken counter, not as a rate limit.
 *
 * A star count changes slowly, so a value from yesterday is honest and useful
 * where "—" is neither. The fresh path is unchanged; only the failure path is,
 * and the em dash now means "never fetched" rather than "not fetched today".
 */
export async function fetchGithubStars(): Promise<number | null> {
  const cached = cachedStars();
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.stars;

  try {
    const res = await fetch(GITHUB_API);
    if (!res.ok) return cached?.stars ?? null;
    const data = await res.json();
    const stars = typeof data?.stargazers_count === 'number' ? data.stargazers_count : null;
    if (stars == null) return cached?.stars ?? null;
    try { localStorage.setItem(CACHE_KEY, JSON.stringify({ stars, ts: Date.now() })); } catch {}
    return stars;
  } catch {
    return cached?.stars ?? null;
  }
}
