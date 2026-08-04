/**
 * state.ts — solver-ready canonical section state.
 *
 * # Why this layer exists
 *
 * `buildSolverInput2D/3D` is synchronous and runs on every solve. Canonical
 * geometry lives in Rust behind a WASM call. Calling into WASM from inside
 * solver preparation would either make that path async — rippling through
 * every caller — or risk publishing whatever the call happened to return.
 *
 * So resolution happens at the *edges*: when a section is created, chosen from
 * the catalogue, edited, migrated or loaded. The validated result is stored on
 * the section atomically, and `buildSolverInput` only ever reads it.
 *
 * The stored state is a cache with an integrity field: `digest` identifies the
 * exact geometry it was derived from, so a consumer can prove the numbers it
 * is using and the outline it is drawing describe the same section.
 *
 * # Torsion
 *
 * `J` is deliberately NOT taken from the polygon engine. That engine computes
 * `J` by Routh's approximation, which is exact for a circle or ellipse and
 * materially wrong otherwise — measured, 56.9 % low on a rectangle and 37.0 %
 * high on an I-section. Feeding it into 3D global stiffness would be worse
 * than the declared value it replaced. Every `J` therefore carries provenance,
 * and a non-circular section keeps its authoritative or legacy value until
 * Checkpoint 2C computes a validated Saint-Venant constant.
 */

import type { Section } from '../store/model.svelte';
import { resolveCanonicalSection, type PropertiesOnlyReason } from './canonical';
import type { CanonicalGeometry } from '../engine/wasm-solver';
import { isSolverReady } from '../engine/wasm-solver';

/** Where a torsional constant came from. Never inferred, never fabricated. */
export type TorsionProvenance =
  /** Closed-form exact for this shape: circle and CHS only. */
  | 'exactAnalytical'
  /** Published catalogue value carried on the profile. */
  | 'catalogue'
  /** Value declared in a saved file or by the user. */
  | 'legacy'
  /** Computed by the arbitrary-section warping solver. Reserved for 2C. */
  | 'saintVenant'
  /** No trustworthy value exists. 3D torsional stiffness must not proceed. */
  | 'unavailable';

/** Canonical state cached on a section for synchronous solver reads. */
export interface CanonicalSectionState {
  kind: 'geometry-backed';
  /** Schema version of the canonical geometry this was derived from. */
  version: number;
  digest: string;
  /** The geometry itself, so the drawing consumes exactly these polygons. */
  geometry: CanonicalGeometry;
  /** Derived properties. Outputs of the geometry, never independently edited. */
  a: number;
  yc: number;
  zc: number;
  iy: number;
  iz: number;
  iyz: number;
  i1: number;
  i2: number;
  thetaP: number;
  /** Torsional constant and where it came from. `null` means unavailable. */
  j: number | null;
  jProvenance: TorsionProvenance;
}

export interface PropertiesOnlyState {
  kind: 'properties-only';
  reason: PropertiesOnlyReason;
  /** Declared values that keep the section globally solvable. */
  a: number;
  iy?: number;
  iz: number;
  j?: number;
  jProvenance: TorsionProvenance;
}

export type SectionState = CanonicalSectionState | PropertiesOnlyState;

/**
 * True when the resolved geometry is a circle or a circular tube.
 *
 * Read from the geometry's own provenance rather than from the section's name
 * or fields, so a renamed profile and a catalogue one are judged identically
 * and a section without local dimensions is still recognised.
 */
function isCircularFamily(source: Record<string, unknown> | undefined): boolean {
  const shape = source?.shape;
  return shape === 'chs' || shape === 'circle';
}

/**
 * Torsional constant plus provenance, honouring the Routh prohibition.
 *
 * The ONLY geometry-derived case is the circular family, where the torsional
 * constant equals the polar second moment exactly: `J = Iy + Iz`. That
 * identity holds for circles and circular tubes and for nothing else, which is
 * precisely why no other shape may derive `J` from its polygons — the engine's
 * `J` there is Routh's approximation, measured 56.9 % low on a rectangle.
 */
function resolveTorsion(
  sec: Section,
  circular: { iy: number; iz: number } | null,
): { j: number | null; jProvenance: TorsionProvenance } {
  if (circular) {
    const j = circular.iy + circular.iz;
    if (Number.isFinite(j) && j > 0) return { j, jProvenance: 'exactAnalytical' };
  }
  if (sec.j != null && Number.isFinite(sec.j) && sec.j > 0) {
    // Preserve whatever the section already carried. A catalogue-sourced value
    // and a user-declared one are both more trustworthy than Routh; the
    // distinction is recorded rather than guessed at.
    return { j: sec.j, jProvenance: sec.name ? 'catalogue' : 'legacy' };
  }
  return { j: null, jProvenance: 'unavailable' };
}

/**
 * Resolve a section to solver-ready state.
 *
 * Call this whenever a section is created, edited, chosen from the catalogue,
 * migrated or loaded — never from inside solver preparation.
 *
 * When the engine is not initialised this returns properties-only rather than
 * throwing or publishing unverified numbers: an un-analysed section is exactly
 * a section whose geometry is unknown.
 */
export function resolveSectionState(sec: Section): SectionState {
  if (!isSolverReady()) {
    const torsion = resolveTorsion(sec, null);
    return {
      kind: 'properties-only',
      reason: { kind: 'noGeometry' },
      a: sec.a,
      iy: sec.iy,
      iz: sec.iz,
      j: sec.j,
      jProvenance: torsion.jProvenance,
    };
  }

  const resolved = resolveCanonicalSection(sec);
  if (resolved.state === 'properties-only') {
    const torsion = resolveTorsion(sec, null);
    return {
      kind: 'properties-only',
      reason: resolved.reason,
      a: resolved.declared.a,
      iy: resolved.declared.iy,
      iz: resolved.declared.iz,
      j: resolved.declared.j,
      jProvenance: torsion.jProvenance,
    };
  }

  const p = resolved.properties;
  const torsion = resolveTorsion(
    sec,
    isCircularFamily(resolved.geometry.source) ? { iy: p.iy, iz: p.iz } : null,
  );
  return {
    kind: 'geometry-backed',
    version: resolved.geometry.version,
    digest: resolved.digest,
    geometry: resolved.geometry,
    a: p.a,
    yc: p.yc,
    zc: p.zc,
    iy: p.iy,
    iz: p.iz,
    iyz: p.iyz,
    i1: p.i1,
    i2: p.i2,
    thetaP: p.thetaP,
    ...torsion,
  };
}

/**
 * Properties the global solver should use, read synchronously.
 *
 * Geometry-backed sections report their canonical values; properties-only
 * sections report what they declared. Nothing here falls back from one to the
 * other — a stale or absent canonical state means the declared values are
 * used, and the caller can see which by the `source` field.
 */
export function solverProperties(sec: Section): {
  a: number;
  /** Second moment about the section's horizontal axis. */
  iy: number;
  /** Second moment about the section's vertical axis. */
  iz: number;
  iyz: number;
  j: number | null;
  jProvenance: TorsionProvenance;
  source: 'canonical' | 'declared';
  digest?: string;
} {
  const st = sec.canonical;
  if (st && st.kind === 'geometry-backed') {
    return {
      a: st.a,
      iy: st.iy,
      iz: st.iz,
      iyz: st.iyz,
      j: st.j,
      jProvenance: st.jProvenance,
      source: 'canonical',
      digest: st.digest,
    };
  }
  const torsion = resolveTorsion(sec, null);
  return {
    a: sec.a,
    iy: sec.iy ?? sec.iz,
    iz: sec.iz,
    iyz: 0,
    j: torsion.j,
    jProvenance: torsion.jProvenance,
    source: 'declared',
  };
}

/** Deep clone of canonical state, so tabs and copies never share arrays. */
export function cloneSectionState(st: SectionState | undefined): SectionState | undefined {
  if (!st) return undefined;
  if (st.kind === 'properties-only') return { ...st, reason: { ...st.reason } };
  return {
    ...st,
    geometry: {
      ...st.geometry,
      source: { ...st.geometry.source },
      polygons: st.geometry.polygons.map((p) => ({
        ...p,
        vertices: p.vertices.map((v) => [v[0], v[1]] as [number, number]),
      })),
    },
  };
}
