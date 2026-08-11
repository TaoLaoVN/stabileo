/**
 * tensors.ts — the full stress and strain state at a point of a section.
 *
 * # What beam theory actually gives you
 *
 * A section analysis produces three numbers at a point: a normal stress along
 * the member axis and two transverse shears. Those are not "the stress" — they
 * are three components of a tensor whose other components beam theory asserts
 * are zero:
 *
 * ```text
 *          | sigma_x  tau_xy  tau_xz |
 *   sigma = | tau_xy      0       0  |
 *          | tau_xz      0       0  |
 * ```
 *
 * Writing it out is not decoration. It is what makes principal directions,
 * invariants and the strain state computable, and it is what a student needs to
 * see to connect "the beam formula" with the elasticity they are taught
 * alongside it. The zeros are a MODELLING ASSUMPTION — a real member under
 * transverse load does carry small sigma_y near a load point — and stating them
 * explicitly is more honest than leaving them implicit.
 *
 * # Strain
 *
 * Hooke's law for an isotropic material, in full:
 *
 * ```text
 *   eps_x  = sigma_x / E
 *   eps_y  = eps_z = -nu * sigma_x / E      (Poisson contraction)
 *   gam_xy = tau_xy / G,   gam_xz = tau_xz / G,   G = E / (2(1+nu))
 * ```
 *
 * The transverse strains are the part people forget: a bar in pure tension gets
 * thinner, and that is where Poisson's ratio becomes something other than a
 * number in a material table.
 */

/** A symmetric 3×3 tensor, in the section's own axes: x along the member. */
export interface Tensor3 {
  xx: number;
  yy: number;
  zz: number;
  xy: number;
  xz: number;
  yz: number;
}

export interface PrincipalState {
  /** Principal values, sorted descending. */
  values: [number, number, number];
  /**
   * Angle from the member axis to the major principal direction, in the x–z
   * plane, in degrees. This is the direction a crack opens perpendicular to.
   */
  angleDeg: number;
  /** Largest shear on any plane — half the spread of the principal values. */
  maxShear: number;
}

export interface StressTensorState {
  stress: Tensor3;
  strain: Tensor3;
  principalStress: PrincipalState;
  principalStrain: PrincipalState;
  invariants: {
    /** First invariant, the trace: proportional to the volumetric part. */
    i1: number;
    /** Second deviatoric invariant; von Mises is sqrt(3 J2). */
    j2: number;
    /** Hydrostatic (mean) stress — the part that changes volume, not shape. */
    hydrostatic: number;
  };
  /** Volumetric strain, `eps_x + eps_y + eps_z`. Zero when nu = 0.5. */
  volumetricStrain: number;
}

/**
 * Build the tensors from what a beam analysis produces.
 *
 * `sigmaX`, `tauXy`, `tauXz` in MPa; `e` in MPa; `nu` dimensionless. Strains
 * come out dimensionless, so a caller reporting microstrain multiplies by 1e6.
 */
export function stressTensorState(
  sigmaX: number,
  tauXy: number,
  tauXz: number,
  e: number,
  nu: number,
): StressTensorState {
  const stress: Tensor3 = { xx: sigmaX, yy: 0, zz: 0, xy: tauXy, xz: tauXz, yz: 0 };

  // ── Strain, by Hooke's law for an isotropic material ─────────
  const g = e / (2 * (1 + nu));
  const strain: Tensor3 = {
    xx: sigmaX / e,
    // The transverse contractions. Omitting them is the common shortcut, and it
    // makes the volumetric strain wrong and Poisson's ratio invisible.
    yy: (-nu * sigmaX) / e,
    zz: (-nu * sigmaX) / e,
    // Engineering shear strain gamma = tau/G; the tensor component is gamma/2.
    xy: tauXy / g / 2,
    xz: tauXz / g / 2,
    yz: 0,
  };

  return {
    stress,
    strain,
    principalStress: principalOf(sigmaX, Math.hypot(tauXy, tauXz)),
    // For this stress state the principal strain directions coincide with the
    // principal stress directions — isotropy — so the same reduction applies to
    // the strain expressed as (eps_x, gamma_resultant/2).
    principalStrain: principalOf(strain.xx, Math.hypot(strain.xy, strain.xz)),
    invariants: invariantsOf(sigmaX, Math.hypot(tauXy, tauXz)),
    volumetricStrain: strain.xx + strain.yy + strain.zz,
  };
}

/**
 * Principal values of a state with one normal component and one resultant shear.
 *
 * With `sigma_y = sigma_z = 0`, the tensor reduces to a 2×2 problem in the
 * plane containing the axis and the shear direction, plus a third principal
 * value that is identically zero — the out-of-plane direction carries nothing.
 * That third zero is why a beam under combined bending and shear is a
 * *biaxial* state and not a uniaxial one, which is the whole reason a failure
 * criterion is needed at all.
 */
function principalOf(sigma: number, tau: number): PrincipalState {
  const centre = sigma / 2;
  const radius = Math.hypot(centre, tau);
  const raw: number[] = [centre + radius, centre - radius, 0];
  raw.sort((a, b) => b - a);
  return {
    values: [raw[0], raw[1], raw[2]],
    // Mohr's pole angle, halved because a rotation of 2θ in Mohr space is θ in
    // the material.
    angleDeg: (0.5 * Math.atan2(2 * tau, sigma) * 180) / Math.PI,
    maxShear: (raw[0] - raw[2]) / 2,
  };
}

function invariantsOf(sigma: number, tau: number): StressTensorState['invariants'] {
  const i1 = sigma; // sigma_y and sigma_z are zero
  // For this state, von Mises = sqrt(sigma² + 3 tau²), so J2 follows from it.
  const vonMises2 = sigma * sigma + 3 * tau * tau;
  return { i1, j2: vonMises2 / 3, hydrostatic: i1 / 3 };
}

/** Format a tensor for display, in the row order a textbook writes it. */
export function tensorRows(t: Tensor3): number[][] {
  return [
    [t.xx, t.xy, t.xz],
    [t.xy, t.yy, t.yz],
    [t.xz, t.yz, t.zz],
  ];
}
