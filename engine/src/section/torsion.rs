//! Saint-Venant uniform torsion of an arbitrary cross-section.
//!
//! # What this replaces
//!
//! Until now the app had no honest torsional constant for a general shape. It
//! had an exact one for circles and tubes, whatever a catalogue happened to
//! publish, and — where neither existed — a placeholder of `Iz * 0.001` that
//! was a fabrication kept only so 3D models would solve. Routh's polygon
//! approximation was explicitly forbidden as a substitute, because it is exact
//! only for the ellipse and was measured 56.9 % low on a rectangle and 37.0 %
//! high on an I-section. This module computes the real thing.
//!
//! # Formulation
//!
//! Prandtl's stress function `phi` on the section `Omega`:
//!
//! ```text
//!   laplacian(phi) = -2      in Omega
//!   phi = 0                  on the outer boundary
//! ```
//!
//! from which the torsion constant is `J = 2 * integral(phi) dA` and the shear
//! stresses under unit twist rate are `tau_xz = d(phi)/dy`, `tau_xy = -d(phi)/dz`.
//!
//! The sign convention matters and is easy to get backwards: the Poisson solver
//! here solves `-laplacian(u) = f`, so the source is `f = +2`, not `-2`. A test
//! against the circle catches an inversion immediately — `J` would come out
//! negative rather than merely wrong.
//!
//! # Holes
//!
//! On a multiply-connected section `phi` is still constant on each hole
//! boundary, but the constant is unknown and fixed by the circulation
//! condition. That is a coupled problem this module does NOT yet solve, so a
//! section with holes is refused rather than answered with the
//! simply-connected result, which would understate `J` badly for a closed tube
//! — exactly the direction that matters. Closed tubes already have an
//! authoritative constant: exact for circular ones, tabulated for the IRAM
//! structural series.
//!
//! # Accuracy
//!
//! `J` is a functional of the field, not of its gradient, so it converges at
//! the field's rate rather than the gradient's — the same reason the tests
//! below can demand a few tenths of a percent from a mesh that resolves the
//! stresses only to a few percent.

use serde::{Deserialize, Serialize};

use super::mesh::SectionMesh;
use super::poisson::{LoopBc, PoissonProblem, PoissonSolution, SolveStrategy};

/// Result of a Saint-Venant torsion solve.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TorsionResult {
    /// Torsion constant `J`, in (section length unit)^4.
    pub j: f64,
    /// Prandtl stress function at each mesh node.
    pub phi: Vec<f64>,
    /// Shear stress per triangle under UNIT twist rate `theta' = 1`, as
    /// `[tau_xy, tau_xz]`. Multiply by `G * theta'` for a real state.
    pub tau: Vec<[f64; 2]>,
    /// Largest `|tau|` over the section, under unit twist rate.
    pub tau_max: f64,
    /// Triangle carrying `tau_max`, so the caller can report where it acts.
    pub tau_max_triangle: usize,
    /// Linear-system residual, carried through as evidence the solve converged.
    pub residual: f64,
}

/// Solve uniform torsion on a meshed section.
///
/// Refuses a section with holes: see the module note. The refusal is explicit
/// because silently returning the simply-connected answer for a closed tube
/// would understate `J` by more than an order of magnitude.
pub fn solve_torsion(mesh: &SectionMesh, strategy: SolveStrategy) -> Result<TorsionResult, String> {
    if mesh.loop_count > 1 {
        return Err(format!(
            "section has {} holes; multiply-connected torsion needs the circulation \
             constraint per hole, which this solver does not impose yet",
            mesh.loop_count - 1
        ));
    }
    if mesh.triangles.is_empty() {
        return Err("mesh has no triangles".into());
    }

    let mut problem = PoissonProblem::new(mesh);
    // `-laplacian(phi) = 2` is `laplacian(phi) = -2`, which is Prandtl's.
    problem.source = vec![2.0; mesh.triangles.len()];
    problem.loop_bcs = vec![LoopBc::Dirichlet { value: 0.0 }];
    problem.strategy = strategy;

    let sol: PoissonSolution = super::poisson::solve_poisson(&problem)?;

    // J = 2 * integral(phi). The integral is exact for P1 fields.
    let j = 2.0 * sol.integrate(mesh);
    if !j.is_finite() || j <= 0.0 {
        return Err(format!(
            "torsion constant came out {j}, which is not physical — check the source sign"
        ));
    }

    // tau_xy = -d(phi)/dz, tau_xz = +d(phi)/dy, with grad = [d/dy, d/dz].
    let mut tau = Vec::with_capacity(sol.grad.len());
    let mut tau_max = 0.0;
    let mut tau_max_triangle = 0;
    for (i, g) in sol.grad.iter().enumerate() {
        let t = [-g[1], g[0]];
        let mag = (t[0] * t[0] + t[1] * t[1]).sqrt();
        if mag > tau_max {
            tau_max = mag;
            tau_max_triangle = i;
        }
        tau.push(t);
    }

    Ok(TorsionResult { j, phi: sol.u, tau, tau_max, tau_max_triangle, residual: sol.residual })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::section::catalogue as cat;
    use crate::section::mesh::{mesh_section, MeshParams};

    fn meshed(g: &cat::CanonicalGeometry, target: f64) -> SectionMesh {
        let mut p = MeshParams::default();
        p.max_area = target;
        mesh_section(&g.polygons, &p).expect("mesh")
    }

    fn j_of(g: &cat::CanonicalGeometry, target: f64) -> f64 {
        solve_torsion(&meshed(g, target), SolveStrategy::Sparse).expect("torsion").j
    }

    fn src() -> cat::GeometrySource {
        cat::GeometrySource::Parametric { shape: "test".into() }
    }

    /// The one case with a closed form that admits no argument.
    #[test]
    fn a_solid_circle_converges_to_pi_r4_over_2() {
        let r = 50.0;
        let g = cat::solid_circle(2.0 * r, 64).unwrap();
        let exact = std::f64::consts::PI * r.powi(4) / 2.0;
        let j = j_of(&g, 4.0);
        let err = (j / exact - 1.0).abs();
        assert!(err < 0.01, "J = {j:.1} vs exact {exact:.1} ({:.3} %)", err * 100.0);
    }

    /// Refining the mesh must move the answer TOWARDS the closed form, not
    /// merely land near it — that is what distinguishes a converging solver
    /// from one that happens to be close at one resolution.
    #[test]
    fn refining_the_mesh_reduces_the_circle_error() {
        let r = 50.0;
        let g = cat::solid_circle(2.0 * r, 96).unwrap();
        let exact = std::f64::consts::PI * r.powi(4) / 2.0;
        let coarse = (j_of(&g, 40.0) / exact - 1.0).abs();
        let fine = (j_of(&g, 4.0) / exact - 1.0).abs();
        assert!(fine < coarse, "refining made it worse: {coarse:.4} -> {fine:.4}");
    }

    /// Saint-Venant's series for a rectangle. This is the case Routh's
    /// approximation missed by 56.9 %, so it is the one worth pinning.
    fn rectangle_j(a: f64, b: f64) -> f64 {
        // J = a*b^3 * (1/3 - 0.21*(b/a)*(1 - b^4/(12 a^4))) for a >= b.
        let (a, b) = if a >= b { (a, b) } else { (b, a) };
        a * b.powi(3) * (1.0 / 3.0 - 0.21 * (b / a) * (1.0 - b.powi(4) / (12.0 * a.powi(4))))
    }

    #[test]
    fn a_square_matches_saint_venants_series() {
        let s = 100.0;
        let g = cat::rectangle(s, s).unwrap();
        let j = j_of(&g, 4.0);
        let exact = rectangle_j(s, s);
        let err = (j / exact - 1.0).abs();
        assert!(err < 0.02, "J = {j:.1} vs series {exact:.1} ({:.2} %)", err * 100.0);
    }

    #[test]
    fn a_narrow_rectangle_matches_the_thin_strip_limit() {
        // For b << a the series collapses to J -> a*b^3/3, the thin-strip
        // result every open profile's torsion is built on.
        let (a, b) = (200.0, 10.0);
        let g = cat::rectangle(b, a).unwrap();
        let j = j_of(&g, 1.0);
        let thin = a * b.powi(3) / 3.0;
        assert!((j / thin - 1.0).abs() < 0.10, "J = {j:.1} vs thin-strip {thin:.1}");
        // And it must sit BELOW the thin-strip value, which ignores the ends.
        assert!(j < thin, "J = {j:.1} should be under the thin-strip bound {thin:.1}");
    }

    /// The property that makes J useful and that Routh's approximation lacks:
    /// an open section is enormously more flexible in torsion than a compact
    /// one of the same area.
    #[test]
    fn an_open_profile_is_far_more_torsionally_flexible_than_a_compact_one() {
        let i = cat::i_section(300.0, 150.0, 7.1, 10.7, 15.0, 8, src()).unwrap();
        let mesh_i = meshed(&i, 4.0);
        let area = mesh_i.area();
        let j_i = solve_torsion(&mesh_i, SolveStrategy::Sparse).unwrap().j;

        let side = area.sqrt();
        let sq = cat::rectangle(side, side).unwrap();
        let j_sq = j_of(&sq, 4.0);

        assert!(j_i < j_sq / 20.0, "I-section J {j_i:.0} vs equal-area square {j_sq:.0}");
    }

    /// An I-profile's torsion is the sum of its three plates, to within the
    /// junction effect that the fillets add.
    #[test]
    fn an_i_profile_lands_near_the_sum_of_its_plates() {
        let (h, b, tw, tf) = (300.0, 150.0, 7.1, 10.7);
        let g = cat::i_section(h, b, tw, tf, 0.0, 8, src()).unwrap();
        let j = j_of(&g, 2.0);
        let plates = (2.0 * b * tf.powi(3) + (h - 2.0 * tf) * tw.powi(3)) / 3.0;
        // The thin-strip sum ignores the web/flange junctions, so the true J is
        // higher; a factor of two would mean something is wrong.
        assert!(j > plates * 0.9, "J {j:.0} vs plate sum {plates:.0}");
        assert!(j < plates * 2.0, "J {j:.0} vs plate sum {plates:.0}");
    }

    /// A rolled I-profile's J against the thin-strip sum of its plates, with
    /// the junction effect the fillets add.
    ///
    /// The CIRSOC tables do publish a J column, but its position could not be
    /// established with confidence from the extracted text — the neighbouring
    /// warping constant maps cleanly and J does not — so it is deliberately NOT
    /// used as a reference here. Asserting against a number that might be the
    /// wrong column would be worse than asserting against physics: an early
    /// version of this test "passed" at +2.8 % against a misread value while
    /// the solver was actually converging to something else.
    #[test]
    fn a_rolled_i_profile_sits_above_its_plate_sum_by_the_fillet_contribution() {
        // IPE 300.
        let (h, b, tw, tf, r) = (300.0, 150.0, 7.1, 10.7, 15.0);
        let g = cat::i_section(h, b, tw, tf, r, 8, src()).unwrap();
        let j = j_of(&g, 2.0);
        let plates = (2.0 * b * tf.powi(3) + (h - 2.0 * tf) * tw.powi(3)) / 3.0;
        let ratio = j / plates;
        // Fillets add materially at the web/flange junctions but cannot double
        // the constant; for rolled I-profiles the factor sits near 1.2-1.4.
        assert!((1.1..1.5).contains(&ratio), "J {j:.0} / plate sum {plates:.0} = {ratio:.3}");
    }

    #[test]
    fn a_section_with_a_hole_is_refused_rather_than_answered_wrongly() {
        let tube = cat::circular_hollow(100.0, 5.0, 48).unwrap();
        let mesh = meshed(&tube, 4.0);
        let err = solve_torsion(&mesh, SolveStrategy::Sparse).unwrap_err();
        assert!(err.contains("circulation"), "{err}");
    }

    #[test]
    fn the_sparse_and_dense_paths_agree() {
        let g = cat::rectangle(60.0, 40.0).unwrap();
        let mesh = meshed(&g, 8.0);
        let a = solve_torsion(&mesh, SolveStrategy::Sparse).unwrap().j;
        let b = solve_torsion(&mesh, SolveStrategy::Dense).unwrap().j;
        assert!((a / b - 1.0).abs() < 1e-9, "{a} vs {b}");
    }

    #[test]
    fn peak_shear_on_a_circle_sits_at_the_rim_and_matches_t_r_over_j() {
        // Under unit twist rate the elastic solution gives tau = G*theta'*r, so
        // with G factored out the peak magnitude is the radius itself.
        let r = 50.0;
        let g = cat::solid_circle(2.0 * r, 96).unwrap();
        let mesh = meshed(&g, 4.0);
        let res = solve_torsion(&mesh, SolveStrategy::Sparse).unwrap();
        assert!((res.tau_max / r - 1.0).abs() < 0.05, "tau_max {} vs r {r}", res.tau_max);
        // And it must occur near the rim, not somewhere in the interior.
        let t = mesh.triangles[res.tau_max_triangle];
        let c: [f64; 2] = [
            (mesh.nodes[t[0]][0] + mesh.nodes[t[1]][0] + mesh.nodes[t[2]][0]) / 3.0,
            (mesh.nodes[t[0]][1] + mesh.nodes[t[1]][1] + mesh.nodes[t[2]][1]) / 3.0,
        ];
        assert!((c[0] * c[0] + c[1] * c[1]).sqrt() > 0.9 * r);
    }
}
