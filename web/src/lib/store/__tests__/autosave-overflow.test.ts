/**
 * When the project outgrows the browser's store, the user is told.
 *
 * ── The lost afternoon this exists to prevent ──────────────────────
 *
 * `localStorage` gives an origin a few megabytes. A structural model fits easily; the same
 * model once every member carries reinforcement and a coordinated detailing does not. Measured
 * in a real browser on `Edificio H.A. 7 pisos — PRO`: the autosave is 172 kB after the example
 * loads, is rewritten normally after the solve, and from the moment `designAll` finishes every
 * write throws `QuotaExceededError` — for the rest of the session, on a 30 s timer, without a
 * word.
 *
 * The damage is not the missing save. It is that the KEY STILL HOLDS THE PRE-DESIGN SNAPSHOT,
 * so a reload offers a restore banner, and the banner restores the model as it was before the
 * design ran. The user presses Restaurar expecting their afternoon back and is handed the
 * morning, with nothing anywhere reporting that the two are different.
 *
 * So the write reports its own failure — once per session, because a warning on a 30 s timer
 * is a warning nobody reads — and names the way out. It cannot make the project fit, and it is
 * not pretending to: raising the ceiling is a change to how this app persists work.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { saveToLocalStorage, resetAutosaveOverflowNotice } from '../file';
import { modelStore } from '../model.svelte';
import { uiStore } from '../ui.svelte';

/** A localStorage that accepts reads and refuses writes the way a full one does. */
function stubStorage(opts: { throwOn?: 'quota' | 'other' | 'none' }) {
  const map = new Map<string, string>();
  const store = {
    getItem: (k: string) => map.get(k) ?? null,
    removeItem: (k: string) => { map.delete(k); },
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() { return map.size; },
    clear: () => map.clear(),
    setItem: (k: string, v: string) => {
      if (opts.throwOn === 'quota') {
        const e = new Error("Setting the value of 'stabileo-autosave' exceeded the quota.");
        e.name = 'QuotaExceededError';
        throw e;
      }
      if (opts.throwOn === 'other') {
        const e = new Error('storage disabled');
        e.name = 'SecurityError';
        throw e;
      }
      map.set(k, v);
    },
  };
  vi.stubGlobal('localStorage', store);
  return map;
}

describe('autosave overflow', () => {
  beforeEach(async () => {
    resetAutosaveOverflowNotice();
    uiStore.toasts.length = 0;
    if (modelStore.model.elements.size === 0) await modelStore.loadExample('pro-edificio-7p');
  }, 300_000);

  afterEach(() => {
    vi.unstubAllGlobals();
    uiStore.toasts.length = 0;
  });

  it('writes and reports success when the project fits', () => {
    const map = stubStorage({ throwOn: 'none' });
    expect(saveToLocalStorage()).toBe(true);
    expect(map.get('stabileo-autosave')).toBeTruthy();
    expect(uiStore.toasts).toHaveLength(0);
  });

  it('reports failure and warns the user when the project does not fit', () => {
    stubStorage({ throwOn: 'quota' });
    expect(saveToLocalStorage(), 'the caller learns the write did not happen').toBe(false);
    expect(uiStore.toasts, 'the user is told, rather than left believing it saved').toHaveLength(1);
    expect(uiStore.toasts[0].type).toBe('error');
    // The message has to name the way out — the .ded file — not merely state a fact.
    expect(uiStore.toasts[0].message).toMatch(/\.ded/);
  });

  it('warns once per session, not once every thirty seconds', () => {
    stubStorage({ throwOn: 'quota' });
    for (let i = 0; i < 5; i++) saveToLocalStorage();
    expect(uiStore.toasts).toHaveLength(1);
  });

  it('stays quiet when storage is unavailable for reasons that are not the project', () => {
    // Private mode and disabled storage are conditions of the BROWSER. Nothing the user does
    // to their project changes them, so a warning about their project would be a lie.
    stubStorage({ throwOn: 'other' });
    expect(saveToLocalStorage()).toBe(false);
    expect(uiStore.toasts).toHaveLength(0);
  });
});
