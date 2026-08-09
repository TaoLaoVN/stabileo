/**
 * stress-state.ts — the complete stress state at one point of a section,
 * assembled entirely from canonical geometry.
 *
 * # Why this exists
 *
 * The section panel had two paths running side by side. The outline it drew
 * and the bending stress it plotted were canonical; the shear, the Mohr circle
 * and the failure criteria still came from the legacy resolver, which infers a
 * section's shape from its NAME and invents thicknesses when they are missing.
 * A user therefore read a Mohr circle built from a shape nobody verified,
 * drawn on top of an outline that was verified — and had no way to tell.
 *
 * This closes that. Every component here comes from the same polygons: axial
 * and bending in closed form, transverse shear from longitudinal equilibrium,
 * torsion from Saint-Venant. Mohr and the failure criteria are then pure
 * functions of the resulting sigma and tau, so those keep using the existing
 * helpers — they were never the problem.
 *
 * # What the caller must supply
 *
 * A point, centroid-relative. The panel has one because the user picks a fibre
 * on the drawing, and since the drawing is canonical the coordinates already
 * live in the right frame.
 */

import type { Section } from '../store/model.svelte';
import {
  analyzeSectionBending,
  analyzeSectionShear,
  analyzeSectionTorsion,
} from '../engine/wasm-solver';
import { computeMohrCircle, checkFailure } from '../engine/section-stress';
import type { MohrCircle, FailureCheck } from '../engine/section-stress';

/** Internal forces at a station, in the section's own frame. */
export interface SectionForces {
  /** Axial, kN. */
  n: number;
  /** Bending about the horizontal centroidal axis, kN·m. */
  my: number;
  /** Bending about the vertical centroidal axis, kN·m. */
  mz: number;
  /** Transverse shear along the horizontal axis, kN. */
  vy?: number;
  /** Transverse shear along the vertical axis, kN. */
  vz?: number;
  /** Torsion, kN·m. */
  t?: number;
}

export interface CanonicalStressState {
  /** Normal stress at the point, MPa. */
  sigma: number;
  /** Resultant in-plane shear at the point, MPa. */
  tau: number;
  /** Shear components `[tauXy, tauXz]`, MPa, so a direction can be drawn. */
  tauComponents: [number, number];
  /** Contribution of each source, for a panel that shows its working. */
  breakdown: {
    axial: number;
    bending: number;
    shearY: number;
    shearZ: number;
    torsion: number;
  };
  mohr: MohrCircle;
  failure: FailureCheck;
}

export type StressStateResult =
  | { ok: true; state: CanonicalStressState }
  | { ok: false; reason: 'notResolved' | 'engineError'; message?: string };

/**
 * Assemble the stress state at `point` from canonical geometry.
 *
 * Shear and torsion are solved on the section's mesh, so this is a
 * mesh-and-solve per call. The panel queries one point at a time as the user
 * drags a fibre, which is exactly the pattern this suits; a caller sweeping
 * many points should solve once and interpolate instead.
 */
export function canonicalStressState(
  sec: Section,
  forces: SectionForces,
  point: [number, number],
  fy?: number,
): StressStateResult {
  const st = sec.canonical;
  if (!st || st.kind !== 'geometry-backed') return { ok: false, reason: 'notResolved' };

  try {
    // ── Normal stress: axial plus unsymmetrical bending ──────────
    //
    // Every quantity below is in kN and metres, so every stress comes out in
    // kPa and is converted once, at the end. Mixing that up is the classic way
    // to be wrong by a thousand and still look plausible.
    const bending = analyzeSectionBending({
      geometry: st.geometry,
      n: forces.n,
      my: forces.my,
      mz: forces.mz,
      forcesAreLocal: true,
    });
    // The engine returns the bending curvatures, so the stress anywhere is
    // reconstructed exactly rather than interpolated between reported points:
    // `sigma = N/A + kz*z - ky*y`, the same expression the engine integrates.
    const [py, pz] = point;
    const axial = st.a > 0 ? forces.n / st.a : 0;
    const sigma = axial + bending.kz * pz - bending.ky * py;

    // ── Transverse shear ─────────────────────────────────────────
    let shearY = 0;
    let shearZ = 0;
    let tauXy = 0;
    let tauXz = 0;
    if (forces.vy || forces.vz) {
      const sh = analyzeSectionShear({ geometry: st.geometry, at: point });
      // The solve is per UNIT force, so scaling is linear and superposable.
      if (forces.vy && sh.vy.at) {
        tauXy += sh.vy.at[0] * forces.vy;
        tauXz += sh.vy.at[1] * forces.vy;
        shearY = Math.hypot(sh.vy.at[0], sh.vy.at[1]) * forces.vy;
      }
      if (forces.vz && sh.vz.at) {
        tauXy += sh.vz.at[0] * forces.vz;
        tauXz += sh.vz.at[1] * forces.vz;
        shearZ = Math.hypot(sh.vz.at[0], sh.vz.at[1]) * forces.vz;
      }
    }

    // ── Torsion ──────────────────────────────────────────────────
    let torsion = 0;
    if (forces.t) {
      const to = analyzeSectionTorsion({ geometry: st.geometry, at: point });
      if (to.at && to.j > 0) {
        // The field is per unit twist rate, with the shear modulus factored
        // out; a torque T gives twist T/(GJ), so G cancels and what remains is
        // T/J applied to the unit-rate field. The circle test pins this: there
        // the unit field's magnitude IS the radius, so tau = T r / J falls out.
        const k = forces.t / to.j;
        tauXy += to.at[0] * k;
        tauXz += to.at[1] * k;
        torsion = Math.hypot(to.at[0], to.at[1]) * k;
      }
    }

    const tau = Math.hypot(tauXy, tauXz);
    // kPa to MPa, once, at the boundary.
    const toMPa = (v: number) => v * 1e-3;
    const sMPa = toMPa(sigma);
    const tMPa = toMPa(tau);

    return {
      ok: true,
      state: {
        sigma: sMPa,
        tau: tMPa,
        tauComponents: [toMPa(tauXy), toMPa(tauXz)],
        breakdown: {
          axial: toMPa(axial),
          bending: sMPa - toMPa(axial),
          shearY: toMPa(shearY),
          shearZ: toMPa(shearZ),
          torsion: toMPa(torsion),
        },
        // Pure functions of the two scalars, and the only part of the old path
        // that was never in question.
        mohr: computeMohrCircle(sMPa, tMPa),
        failure: checkFailure(sMPa, tMPa, fy),
      },
    };
  } catch (err) {
    return { ok: false, reason: 'engineError', message: (err as Error)?.message ?? String(err) };
  }
}
