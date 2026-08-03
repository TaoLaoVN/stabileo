export const REPO_URL = 'https://github.com/lambdaclass/stabileo';
export const DOCS_HUB_URL = `${REPO_URL}/blob/main/docs/README.md`;
export const QUICK_START_URL = `${REPO_URL}/blob/main/docs/QUICKSTART.md`;
export const AI_WORKFLOW_URL = `${REPO_URL}/blob/main/docs/AI_MODELING_WORKFLOW.md`;
export const SOLVER_REF_URL = `${REPO_URL}/blob/main/docs/SOLVER_REFERENCE.md`;

/** Example ids the demo offers. `?example=<id>` is App.svelte's existing contract. */
export type DemoExample = { id: string; key: string };

export const DEMO_EXAMPLES: DemoExample[] = [
  { id: 'cantilever', key: 'landing.demoEx1' },
  { id: 'portal-frame', key: 'landing.demoEx2' },
  { id: 'truss', key: 'landing.demoEx3' },
  { id: '3d-portal-frame', key: 'landing.demoEx4' },
];

/** URL for the embedded demo iframe. Unchanged embed/example contract. */
export function demoEmbedUrl(id: string) {
  return `/app/basic?embed&example=${id}`;
}

/**
 * URL that opens the full editor with the same example preloaded.
 * `?example=` is read by App.svelte independently of `embed`, so this needs no
 * change to the application.
 */
export function editorExampleUrl(id: string) {
  return `/app/basic?example=${id}`;
}

export function enterApp() {
  window.dispatchEvent(new CustomEvent('stabileo-enter-app'));
}

export function scrollToId(id: string, root?: HTMLElement | null) {
  const el = (root ?? document).querySelector(`#${CSS.escape(id)}`) as HTMLElement | null;
  el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

const GITHUB_API = `https://api.github.com/repos/lambdaclass/stabileo`;
const CACHE_KEY = 'stabileo-gh-stars';
const CACHE_TTL = 6 * 60 * 60 * 1000;

export async function fetchGithubStars(): Promise<number | null> {
  try {
    const cached = localStorage.getItem(CACHE_KEY);
    if (cached) {
      const { stars, ts } = JSON.parse(cached);
      if (Date.now() - ts < CACHE_TTL && typeof stars === 'number') return stars;
    }
  } catch {}
  try {
    const res = await fetch(GITHUB_API);
    if (!res.ok) return null;
    const data = await res.json();
    const stars = typeof data?.stargazers_count === 'number' ? data.stargazers_count : null;
    if (stars != null) {
      try { localStorage.setItem(CACHE_KEY, JSON.stringify({ stars, ts: Date.now() })); } catch {}
    }
    return stars;
  } catch {
    return null;
  }
}
