/**
 * Stable canonical hash of a ProvidedReinforcement.
 *
 * Used as the memo-cache key for provided-rebar verification and as the identity a
 * design certificate is bound to: when the hash changes the certificate is void.
 *
 * Requirements it must satisfy (pinned by tests):
 *   - key-order invariant  (object literal order must not change the hash)
 *   - float-noise invariant (0.15 vs 0.1500000000000002 hash the same)
 *   - any real change to counts / diameters / spacing / continuity changes the hash
 *
 * Pure: no store access, no side effects.
 */

import type { ProvidedReinforcement } from '../../store/model.svelte';

/** Quantisation: 4 decimals is finer than any physically meaningful rebar value
 *  (spacing in m to 0.1 mm) while absorbing IEEE-754 accumulation noise. */
function q(n: number | undefined): string {
  if (n === undefined || n === null || !Number.isFinite(n)) return '_';
  // Normalise -0 to 0 and strip trailing zeros for a compact stable form.
  const v = Math.round(n * 1e4) / 1e4;
  return (v === 0 ? 0 : v).toString();
}

function canonicalise(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return q(value);
  if (typeof value === 'boolean' || typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(canonicalise);
  if (typeof value === 'object') {
    const src = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(src).sort()) {
      const v = src[k];
      if (v === undefined) continue; // absent and explicit-undefined must hash alike
      out[k] = canonicalise(v);
    }
    return out;
  }
  return String(value);
}

/** Canonical JSON form — deterministic, key-sorted, float-quantised. */
export function canonicalRebarJson(reinf: ProvidedReinforcement | undefined): string {
  if (!reinf) return 'none';
  return JSON.stringify(canonicalise(reinf));
}

/** FNV-1a 32-bit, rendered base36. Fast, allocation-free, no crypto dependency. */
function fnv1a(str: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/**
 * Stable hash of provided reinforcement. Includes the canonical length so two
 * different structures cannot collide on a short FNV digest alone.
 */
export function rebarHash(reinf: ProvidedReinforcement | undefined): string {
  const json = canonicalRebarJson(reinf);
  return `${fnv1a(json)}${json.length.toString(36)}`;
}
