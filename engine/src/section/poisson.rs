//! Generic scalar Poisson solver on a triangulated cross-section.
//!
//! Solves
//!
//! ```text
//!     -div( grad u ) = f            in  Omega
//!                  u = u_D          on  Gamma_D   (Dirichlet)
//!         du/dn      = g            on  Gamma_N   (Neumann)
//! ```
//!
//! with continuous linear (P1) triangles.
//!
//! # Why this layer is deliberately generic
//!
//! Both stress components that remain after this checkpoint reduce to this same
//! equation on the same mesh, with different data:
//!
//! * Saint-Venant torsion, Prandtl form: `f = 2`, `u = 0` on the outer boundary
//!   and `u = const_i` on each hole loop.
//! * Saint-Venant torsion, warping form: `f = 0` with a pure-Neumann boundary
//!   condition `du/dn = z*n_y - y*n_z` — hence the null-space handling below.
//! * Transverse shear: a further pair of Poisson problems with different source
//!   and Neumann data.
//!
//! Baking any one of those into the assembler would mean writing it three
//! times. Nothing torsion- or shear-specific belongs in this file.
//!
//! # Discretization
//!
//! For P1 triangles the gradient is constant per element, so the element
//! stiffness is exact:
//!
//! ```text
//!     K^e_ij = A_e * ( grad phi_i . grad phi_j )
//! ```
//!
//! with `grad phi_i = [b_i, c_i] / (2 A_e)`. The source term uses the exact
//! integral of a linear function over a triangle, `A/3` per node, which is the
//! consistent P1 load vector for element-wise constant `f`. Neumann data is
//! integrated along boundary edges with the exact linear rule, `L/2` per node.
//!
//! # Convergence
//!
//! P1 elements are second-order accurate in the L2 norm of the field and
//! first-order in the gradient. The tests measure both observed rates against
//! manufactured solutions; that is the evidence that the assembly is right, not
//! merely that it runs.

use serde::{Deserialize, Serialize};

use super::mesh::SectionMesh;
use crate::linalg::lu::lu_solve;

/// Boundary condition applied to a mesh boundary loop.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum LoopBc {
    /// `u = value` on every node of the loop.
    Dirichlet { value: f64 },
    /// `du/dn = value` along the loop. `value = 0.0` is the natural condition
    /// and needs no assembly contribution.
    Neumann { value: f64 },
    /// `du/dn` supplied per boundary edge by the caller, indexed by the edge's
    /// position in `SectionMesh::boundary_edges`.
    NeumannPerEdge,
}

/// A scalar Poisson problem posed on a section mesh.
#[derive(Debug, Clone)]
pub struct PoissonProblem<'a> {
    pub mesh: &'a SectionMesh,
    /// Source term `f`, one constant per triangle. Empty means `f = 0`.
    pub source: Vec<f64>,
    /// Boundary condition per loop id (`0` = outer, `1..` = holes).
    pub loop_bcs: Vec<LoopBc>,
    /// Per-edge Neumann data, parallel to `mesh.boundary_edges`. Only read for
    /// loops whose BC is `NeumannPerEdge`.
    pub edge_flux: Vec<f64>,
    /// Extra Dirichlet pins as `(node, value)`. Used to remove the constant
    /// null mode of a pure-Neumann problem when the caller prefers pinning to
    /// the zero-mean constraint.
    pub pins: Vec<(usize, f64)>,
    /// Impose `integral(u) = 0` instead of pinning, via one Lagrange multiplier.
    /// The physically meaningful choice for a pure-Neumann problem, because it
    /// does not privilege an arbitrary node.
    pub zero_mean: bool,
}

impl<'a> PoissonProblem<'a> {
    pub fn new(mesh: &'a SectionMesh) -> Self {
        Self {
            mesh,
            source: Vec::new(),
            loop_bcs: Vec::new(),
            edge_flux: Vec::new(),
            pins: Vec::new(),
            zero_mean: false,
        }
    }
}

/// Solution of a [`PoissonProblem`].
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PoissonSolution {
    /// Field value at each mesh node.
    pub u: Vec<f64>,
    /// Constant gradient `[du/dy, du/dz]` per triangle.
    pub grad: Vec<[f64; 2]>,
    /// `||K u - F||_inf` over the free equations — a direct check that the
    /// linear system was actually solved, independent of the physics.
    pub residual: f64,
}

impl PoissonSolution {
    /// Integrate the field over the domain (exact for P1).
    pub fn integrate(&self, mesh: &SectionMesh) -> f64 {
        let mut acc = 0.0;
        for &t in &mesh.triangles {
            let a = mesh.triangle_area(t);
            acc += a * (self.u[t[0]] + self.u[t[1]] + self.u[t[2]]) / 3.0;
        }
        acc
    }

    /// Integrate an element-wise function of the constant gradient.
    pub fn integrate_grad<F: Fn([f64; 2], [f64; 2]) -> f64>(&self, mesh: &SectionMesh, f: F) -> f64 {
        let mut acc = 0.0;
        for (e, &t) in mesh.triangles.iter().enumerate() {
            let a = mesh.triangle_area(t);
            let c = [
                (mesh.nodes[t[0]][0] + mesh.nodes[t[1]][0] + mesh.nodes[t[2]][0]) / 3.0,
                (mesh.nodes[t[0]][1] + mesh.nodes[t[1]][1] + mesh.nodes[t[2]][1]) / 3.0,
            ];
            acc += a * f(self.grad[e], c);
        }
        acc
    }

    /// L2 norm of `u - exact` over the domain, for convergence studies.
    pub fn l2_error<F: Fn(f64, f64) -> f64>(&self, mesh: &SectionMesh, exact: F) -> f64 {
        let mut acc = 0.0;
        for &t in &mesh.triangles {
            let a = mesh.triangle_area(t);
            // 3-point mid-edge rule: exact for quadratics, so the quadrature
            // does not pollute the P1 error being measured.
            for (i, j) in [(0usize, 1usize), (1, 2), (2, 0)] {
                let y = 0.5 * (mesh.nodes[t[i]][0] + mesh.nodes[t[j]][0]);
                let z = 0.5 * (mesh.nodes[t[i]][1] + mesh.nodes[t[j]][1]);
                let uh = 0.5 * (self.u[t[i]] + self.u[t[j]]);
                let d = uh - exact(y, z);
                acc += a / 3.0 * d * d;
            }
        }
        acc.sqrt()
    }

    /// L2 norm of `grad u - exact_grad` over the domain.
    pub fn h1_error<F: Fn(f64, f64) -> [f64; 2]>(&self, mesh: &SectionMesh, exact: F) -> f64 {
        let mut acc = 0.0;
        for (e, &t) in mesh.triangles.iter().enumerate() {
            let a = mesh.triangle_area(t);
            let c = [
                (mesh.nodes[t[0]][0] + mesh.nodes[t[1]][0] + mesh.nodes[t[2]][0]) / 3.0,
                (mesh.nodes[t[0]][1] + mesh.nodes[t[1]][1] + mesh.nodes[t[2]][1]) / 3.0,
            ];
            let g = exact(c[0], c[1]);
            let dy = self.grad[e][0] - g[0];
            let dz = self.grad[e][1] - g[1];
            acc += a * (dy * dy + dz * dz);
        }
        acc.sqrt()
    }
}

/// Per-element P1 shape-function gradient coefficients and area.
fn element_geometry(mesh: &SectionMesh, t: [usize; 3]) -> ([f64; 3], [f64; 3], f64) {
    let p = [mesh.nodes[t[0]], mesh.nodes[t[1]], mesh.nodes[t[2]]];
    let b = [p[1][1] - p[2][1], p[2][1] - p[0][1], p[0][1] - p[1][1]];
    let c = [p[2][0] - p[1][0], p[0][0] - p[2][0], p[1][0] - p[0][0]];
    let area = 0.5 * ((p[1][0] - p[0][0]) * (p[2][1] - p[0][1]) - (p[2][0] - p[0][0]) * (p[1][1] - p[0][1]));
    (b, c, area)
}

/// Assemble and solve.
///
/// The system is assembled dense and factored with the existing LU. Section
/// meshes are small (a few thousand nodes at the refinements the stress field
/// needs), and a dense factorisation keeps the null-space handling for the
/// pure-Neumann case straightforward. Swapping in the sparse Cholesky is a
/// contained change if profiling ever calls for it.
pub fn solve_poisson(problem: &PoissonProblem) -> Result<PoissonSolution, String> {
    let mesh = problem.mesh;
    let n = mesh.nodes.len();
    if n == 0 {
        return Err("Mesh has no nodes".into());
    }
    if !problem.source.is_empty() && problem.source.len() != mesh.triangles.len() {
        return Err("source must have one value per triangle (or be empty)".into());
    }
    if problem.loop_bcs.len() != mesh.loop_count {
        return Err(format!(
            "expected {} boundary conditions (one per loop), got {}",
            mesh.loop_count,
            problem.loop_bcs.len()
        ));
    }

    // ── Stiffness and consistent source vector ────────────────────
    let dim = if problem.zero_mean { n + 1 } else { n };
    let mut k = vec![0.0f64; dim * dim];
    let mut f = vec![0.0f64; dim];

    for (e, &t) in mesh.triangles.iter().enumerate() {
        let (b, c, area) = element_geometry(mesh, t);
        if area <= 0.0 {
            return Err(format!("Element {e} has non-positive area — mesh is invalid"));
        }
        let scale = 1.0 / (4.0 * area);
        for i in 0..3 {
            for j in 0..3 {
                k[t[i] * dim + t[j]] += scale * (b[i] * b[j] + c[i] * c[j]);
            }
        }
        let fe = problem.source.get(e).copied().unwrap_or(0.0);
        if fe != 0.0 {
            for i in 0..3 {
                f[t[i]] += fe * area / 3.0;
            }
        }
    }

    // ── Neumann contributions along boundary edges ────────────────
    for (idx, edge) in mesh.boundary_edges.iter().enumerate() {
        let bc = &problem.loop_bcs[edge.loop_id.min(problem.loop_bcs.len() - 1)];
        let g = match bc {
            LoopBc::Neumann { value } => *value,
            LoopBc::NeumannPerEdge => *problem.edge_flux.get(idx).unwrap_or(&0.0),
            LoopBc::Dirichlet { .. } => continue,
        };
        if g == 0.0 {
            continue;
        }
        let pa = mesh.nodes[edge.a];
        let pb = mesh.nodes[edge.b];
        let len = ((pb[0] - pa[0]).powi(2) + (pb[1] - pa[1]).powi(2)).sqrt();
        f[edge.a] += g * len / 2.0;
        f[edge.b] += g * len / 2.0;
    }

    // ── Zero-mean constraint (one Lagrange multiplier) ────────────
    if problem.zero_mean {
        let mut m = vec![0.0f64; n];
        for &t in &mesh.triangles {
            let a = mesh.triangle_area(t);
            for i in 0..3 {
                m[t[i]] += a / 3.0;
            }
        }
        for i in 0..n {
            k[i * dim + n] = m[i];
            k[n * dim + i] = m[i];
        }
    }

    // ── Dirichlet elimination ─────────────────────────────────────
    let mut fixed: Vec<Option<f64>> = vec![None; n];
    for (loop_id, bc) in problem.loop_bcs.iter().enumerate() {
        if let LoopBc::Dirichlet { value } = bc {
            for edge in mesh.boundary_edges.iter().filter(|e| e.loop_id == loop_id) {
                fixed[edge.a] = Some(*value);
                fixed[edge.b] = Some(*value);
            }
        }
    }
    for &(node, value) in &problem.pins {
        if node >= n {
            return Err(format!("pin references node {node} outside the mesh"));
        }
        fixed[node] = Some(value);
    }

    let k_full = k.clone();
    let f_full = f.clone();
    for (i, fx) in fixed.iter().enumerate() {
        if let Some(v) = fx {
            for j in 0..dim {
                if j != i {
                    f[j] -= k[j * dim + i] * v;
                }
                k[i * dim + j] = 0.0;
                k[j * dim + i] = 0.0;
            }
            k[i * dim + i] = 1.0;
            f[i] = *v;
        }
    }

    let has_constraint = fixed.iter().any(|x| x.is_some()) || problem.zero_mean;
    if !has_constraint {
        return Err(
            "Pure-Neumann problem with no constraint: the solution is only defined up to a \
             constant. Set `zero_mean` or supply a pin."
                .into(),
        );
    }

    let mut a = k;
    let mut rhs = f.clone();
    let u_all = lu_solve(&mut a, &mut rhs, dim).ok_or("Poisson system is singular")?;

    // ── Residual over the free equations ──────────────────────────
    let mut residual: f64 = 0.0;
    for i in 0..n {
        if fixed[i].is_some() {
            continue;
        }
        let mut r = -f_full[i];
        for j in 0..dim {
            r += k_full[i * dim + j] * u_all[j];
        }
        residual = residual.max(r.abs());
    }

    let u: Vec<f64> = u_all[..n].to_vec();
    let grad: Vec<[f64; 2]> = mesh
        .triangles
        .iter()
        .map(|&t| {
            let (b, c, area) = element_geometry(mesh, t);
            let s = 1.0 / (2.0 * area);
            [
                s * (b[0] * u[t[0]] + b[1] * u[t[1]] + b[2] * u[t[2]]),
                s * (c[0] * u[t[0]] + c[1] * u[t[1]] + c[2] * u[t[2]]),
            ]
        })
        .collect();

    Ok(PoissonSolution { u, grad, residual })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::section::mesh::{mesh_section, MeshParams};
    use crate::section::SectionPolygon;

    fn poly(v: &[[f64; 2]]) -> SectionPolygon {
        SectionPolygon { vertices: v.to_vec(), material_id: 0, is_void: false }
    }
    fn void(v: &[[f64; 2]]) -> SectionPolygon {
        SectionPolygon { vertices: v.to_vec(), material_id: 0, is_void: true }
    }
    fn rect(y0: f64, z0: f64, y1: f64, z1: f64) -> SectionPolygon {
        poly(&[[y0, z0], [y1, z0], [y1, z1], [y0, z1]])
    }
    fn circle(r: f64, n: usize) -> SectionPolygon {
        poly(&(0..n)
            .map(|i| {
                let a = 2.0 * std::f64::consts::PI * (i as f64) / (n as f64);
                [r * a.cos(), r * a.sin()]
            })
            .collect::<Vec<_>>())
    }

    /// Observed convergence rate between two refinement levels, using the
    /// square root of the element count as a proxy for 1/h.
    fn rate(e_coarse: f64, e_fine: f64, n_coarse: usize, n_fine: usize) -> f64 {
        let h_ratio = ((n_fine as f64) / (n_coarse as f64)).sqrt();
        (e_coarse / e_fine).ln() / h_ratio.ln()
    }

    // ── Manufactured solution 1: u = y^2 - z^2 on a square ────────
    //
    // Harmonic, so f = 0 and the exact solution is imposed on the boundary.
    // A P1 solution is exact for linear fields only, so this measures real
    // discretization error rather than a trivially reproduced field.
    #[test]
    fn square_dirichlet_manufactured_solution_converges_at_the_p1_rate() {
        let exact = |y: f64, z: f64| y * y - z * z;
        let exact_grad = |y: f64, z: f64| [2.0 * y, -2.0 * z];

        let mut prev: Option<(f64, f64, usize)> = None;
        let mut rates_l2 = Vec::new();
        let mut rates_h1 = Vec::new();

        for &ma in &[8.0e-2, 2.0e-2, 5.0e-3] {
            let mesh = mesh_section(&[rect(-1.0, -1.0, 1.0, 1.0)], &MeshParams { max_area: ma, ..Default::default() }).unwrap();
            let mut p = PoissonProblem::new(&mesh);
            p.loop_bcs = vec![LoopBc::Dirichlet { value: 0.0 }];
            // Exact Dirichlet data node by node.
            p.pins = mesh
                .boundary_edges
                .iter()
                .flat_map(|e| [e.a, e.b])
                .map(|i| (i, exact(mesh.nodes[i][0], mesh.nodes[i][1])))
                .collect();
            let sol = solve_poisson(&p).unwrap();

            assert!(sol.residual < 1e-8, "residual {}", sol.residual);
            let l2 = sol.l2_error(&mesh, exact);
            let h1 = sol.h1_error(&mesh, exact_grad);
            if let Some((pl2, ph1, pn)) = prev {
                rates_l2.push(rate(pl2, l2, pn, mesh.triangles.len()));
                rates_h1.push(rate(ph1, h1, pn, mesh.triangles.len()));
            }
            prev = Some((l2, h1, mesh.triangles.len()));
        }

        let l2_rate = rates_l2.iter().sum::<f64>() / rates_l2.len() as f64;
        let h1_rate = rates_h1.iter().sum::<f64>() / rates_h1.len() as f64;
        // P1: O(h^2) in L2, O(h) in the gradient.
        assert!(l2_rate > 1.7, "L2 convergence rate {l2_rate:.2}, expected ~2");
        assert!(h1_rate > 0.85, "gradient convergence rate {h1_rate:.2}, expected ~1");
    }

    // ── Manufactured solution 2: non-zero source ─────────────────
    //
    // u = sin(pi y) sin(pi z) on the unit square, so f = 2 pi^2 u and u = 0 on
    // the boundary. Exercises the consistent load vector.
    #[test]
    fn square_with_source_term_converges() {
        use std::f64::consts::PI;
        let exact = |y: f64, z: f64| (PI * y).sin() * (PI * z).sin();

        let mut prev: Option<(f64, usize)> = None;
        let mut rates = Vec::new();
        for &ma in &[3.2e-2, 8.0e-3, 2.0e-3] {
            let mesh = mesh_section(&[rect(0.0, 0.0, 1.0, 1.0)], &MeshParams { max_area: ma, ..Default::default() }).unwrap();
            let mut p = PoissonProblem::new(&mesh);
            p.loop_bcs = vec![LoopBc::Dirichlet { value: 0.0 }];
            p.source = mesh
                .triangles
                .iter()
                .map(|&t| {
                    let cy = (mesh.nodes[t[0]][0] + mesh.nodes[t[1]][0] + mesh.nodes[t[2]][0]) / 3.0;
                    let cz = (mesh.nodes[t[0]][1] + mesh.nodes[t[1]][1] + mesh.nodes[t[2]][1]) / 3.0;
                    2.0 * PI * PI * exact(cy, cz)
                })
                .collect();
            let sol = solve_poisson(&p).unwrap();
            assert!(sol.residual < 1e-8, "residual {}", sol.residual);
            let l2 = sol.l2_error(&mesh, exact);
            if let Some((pl2, pn)) = prev {
                rates.push(rate(pl2, l2, pn, mesh.triangles.len()));
            }
            prev = Some((l2, mesh.triangles.len()));
        }
        let r = rates.iter().sum::<f64>() / rates.len() as f64;
        assert!(r > 1.6, "L2 rate {r:.2} for the sourced problem, expected ~2");
    }

    // ── Triangle domain ──────────────────────────────────────────
    #[test]
    fn triangular_domain_reproduces_a_linear_field_exactly() {
        // P1 spaces contain linear functions, so this must be exact to
        // round-off — a sharp check that assembly and BC handling are right.
        let exact = |y: f64, z: f64| 3.0 + 2.0 * y - 5.0 * z;
        let mesh = mesh_section(
            &[poly(&[[0.0, 0.0], [1.0, 0.0], [0.0, 1.0]])],
            &MeshParams { max_area: 1e-2, ..Default::default() },
        )
        .unwrap();
        let mut p = PoissonProblem::new(&mesh);
        p.loop_bcs = vec![LoopBc::Dirichlet { value: 0.0 }];
        p.pins = mesh
            .boundary_edges
            .iter()
            .flat_map(|e| [e.a, e.b])
            .map(|i| (i, exact(mesh.nodes[i][0], mesh.nodes[i][1])))
            .collect();
        let sol = solve_poisson(&p).unwrap();
        assert!(sol.l2_error(&mesh, exact) < 1e-12, "linear field must be exact");
        for g in &sol.grad {
            assert!((g[0] - 2.0).abs() < 1e-9 && (g[1] + 5.0).abs() < 1e-9);
        }
    }

    // ── Circular domain with a known solution ────────────────────
    #[test]
    fn circle_with_unit_source_matches_the_analytic_solution() {
        // -lap(u) = 4, u = 0 on |x| = R  =>  u = R^2 - y^2 - z^2,
        // and integral(u) = pi R^4 / 2.
        let r = 1.0;
        let exact = |y: f64, z: f64| r * r - y * y - z * z;
        let mut prev: Option<(f64, usize)> = None;
        let mut rates = Vec::new();
        for &(nb, ma) in &[(48usize, 4.0e-2f64), (96, 1.0e-2), (192, 2.5e-3)] {
            let mesh = mesh_section(&[circle(r, nb)], &MeshParams { max_area: ma, ..Default::default() }).unwrap();
            let mut p = PoissonProblem::new(&mesh);
            p.loop_bcs = vec![LoopBc::Dirichlet { value: 0.0 }];
            p.source = vec![4.0; mesh.triangles.len()];
            let sol = solve_poisson(&p).unwrap();
            let l2 = sol.l2_error(&mesh, exact);
            if let Some((pl2, pn)) = prev {
                rates.push(rate(pl2, l2, pn, mesh.triangles.len()));
            }
            prev = Some((l2, mesh.triangles.len()));

            // Integral quantity — the shape every torsion constant takes.
            let integral = sol.integrate(&mesh);
            let exact_integral = std::f64::consts::PI * r.powi(4) / 2.0;
            let err = ((integral - exact_integral) / exact_integral).abs();
            assert!(err < 2e-2, "integral error {err:.3e} at maxArea={ma}");
        }
        let rr = rates.iter().sum::<f64>() / rates.len() as f64;
        assert!(rr > 1.3, "L2 rate {rr:.2} on the circle (boundary polygonization limits it)");
    }

    // ── Domain with a hole, per-loop Dirichlet values ────────────
    #[test]
    fn annulus_with_distinct_loop_values_matches_the_log_solution() {
        // lap(u) = 0 in an annulus with u = 0 outside and u = 1 on the hole is
        // u = ln(r_out/r) / ln(r_out/r_in) — the multiply-connected case the
        // torsion solver will need.
        let (ri, ro) = (0.4, 1.0);
        let exact = |y: f64, z: f64| {
            let r = (y * y + z * z).sqrt();
            (ro / r).ln() / (ro / ri).ln()
        };
        let mesh = mesh_section(
            &[circle(ro, 96), void(&circle(ri, 72).vertices)],
            &MeshParams { max_area: 1.2e-2, ..Default::default() },
        )
        .unwrap();
        assert_eq!(mesh.loop_count, 2);
        let mut p = PoissonProblem::new(&mesh);
        p.loop_bcs = vec![LoopBc::Dirichlet { value: 0.0 }, LoopBc::Dirichlet { value: 1.0 }];
        let sol = solve_poisson(&p).unwrap();
        assert!(sol.residual < 1e-8, "residual {}", sol.residual);
        let err = sol.l2_error(&mesh, exact);
        let norm = (std::f64::consts::PI * (ro * ro - ri * ri)).sqrt();
        assert!(err / norm < 2e-2, "relative L2 error {:.3e}", err / norm);
        // Values must respect both loops.
        assert!(sol.u.iter().cloned().fold(f64::MIN, f64::max) <= 1.0 + 1e-9);
        assert!(sol.u.iter().cloned().fold(f64::MAX, f64::min) >= -1e-9);
    }

    // ── Mixed Dirichlet / Neumann ────────────────────────────────
    #[test]
    fn mixed_boundary_conditions_reproduce_a_linear_field() {
        // u = z on the unit square: u = 0 pinned on the bottom, du/dn = 1 on
        // the top, zero flux on the sides. Linear, so P1 must be exact.
        let mesh = mesh_section(&[rect(0.0, 0.0, 1.0, 1.0)], &MeshParams { max_area: 1.6e-2, ..Default::default() }).unwrap();
        let mut p = PoissonProblem::new(&mesh);
        p.loop_bcs = vec![LoopBc::NeumannPerEdge];
        p.edge_flux = mesh
            .boundary_edges
            .iter()
            .map(|e| {
                let zm = 0.5 * (mesh.nodes[e.a][1] + mesh.nodes[e.b][1]);
                let ym = 0.5 * (mesh.nodes[e.a][0] + mesh.nodes[e.b][0]);
                // Top edge: outward normal +z, du/dn = 1. Sides: normal +/-y, du/dn = 0.
                if (zm - 1.0).abs() < 1e-12 && ym > 1e-12 && ym < 1.0 - 1e-12 { 1.0 } else { 0.0 }
            })
            .collect();
        // Dirichlet along the bottom edge only.
        p.pins = mesh
            .boundary_edges
            .iter()
            .flat_map(|e| [e.a, e.b])
            .filter(|&i| mesh.nodes[i][1].abs() < 1e-12)
            .map(|i| (i, 0.0))
            .collect();
        let sol = solve_poisson(&p).unwrap();
        assert!(sol.residual < 1e-8, "residual {}", sol.residual);
        assert!(sol.l2_error(&mesh, |_, z| z) < 1e-9, "mixed BC must reproduce u = z exactly");
    }

    // ── Pure Neumann and its null space ──────────────────────────
    #[test]
    fn pure_neumann_without_a_constraint_is_rejected() {
        let mesh = mesh_section(&[rect(0.0, 0.0, 1.0, 1.0)], &MeshParams { max_area: 2e-2, ..Default::default() }).unwrap();
        let mut p = PoissonProblem::new(&mesh);
        p.loop_bcs = vec![LoopBc::Neumann { value: 0.0 }];
        let err = solve_poisson(&p).expect_err("must not silently pick one of infinitely many solutions");
        assert!(err.contains("Pure-Neumann"), "unexpected error: {err}");
    }

    #[test]
    fn pure_neumann_with_zero_mean_recovers_the_compatible_solution() {
        // f = 0 with du/dn = (-z, -y).n is the boundary data of the warping
        // problem; on a square centred at the origin the compatible solution is
        // u = -y*z, fixed here by the zero-mean constraint (const = 0 by
        // symmetry).
        //
        // Note -y*z is BILINEAR, not linear, so P1 cannot reproduce it exactly.
        // The check is therefore convergence at the P1 rate, plus the two
        // properties that must hold exactly: the zero-mean constraint itself,
        // and a vanishing residual.
        let flux_for = |mesh: &SectionMesh| -> Vec<f64> {
            mesh.boundary_edges
                .iter()
                .map(|e| {
                    let (a, b) = (mesh.nodes[e.a], mesh.nodes[e.b]);
                    let (ym, zm) = (0.5 * (a[0] + b[0]), 0.5 * (a[1] + b[1]));
                    let (ny, nz) = if (ym - 0.5).abs() < 1e-9 {
                        (1.0, 0.0)
                    } else if (ym + 0.5).abs() < 1e-9 {
                        (-1.0, 0.0)
                    } else if (zm - 0.5).abs() < 1e-9 {
                        (0.0, 1.0)
                    } else {
                        (0.0, -1.0)
                    };
                    -zm * ny - ym * nz
                })
                .collect()
        };

        let mut prev: Option<(f64, usize)> = None;
        let mut rates = Vec::new();
        for &ma in &[2.4e-2, 6.0e-3, 1.5e-3] {
            let mesh = mesh_section(&[rect(-0.5, -0.5, 0.5, 0.5)], &MeshParams { max_area: ma, ..Default::default() }).unwrap();
            let mut p = PoissonProblem::new(&mesh);
            p.loop_bcs = vec![LoopBc::NeumannPerEdge];
            p.zero_mean = true;
            p.edge_flux = flux_for(&mesh);
            let sol = solve_poisson(&p).unwrap();

            assert!(sol.residual < 1e-7, "residual {}", sol.residual);
            assert!(sol.integrate(&mesh).abs() < 1e-9, "zero-mean constraint not satisfied");

            let l2 = sol.l2_error(&mesh, |y, z| -y * z);
            if let Some((pl2, pn)) = prev {
                rates.push(rate(pl2, l2, pn, mesh.triangles.len()));
            }
            prev = Some((l2, mesh.triangles.len()));
        }
        let r = rates.iter().sum::<f64>() / rates.len() as f64;
        assert!(r > 1.6, "pure-Neumann L2 rate {r:.2}, expected ~2 for P1");
    }

    #[test]
    fn pure_neumann_with_a_pin_matches_the_zero_mean_solution_up_to_a_constant() {
        let mesh = mesh_section(&[rect(-0.5, -0.5, 0.5, 0.5)], &MeshParams { max_area: 8e-3, ..Default::default() }).unwrap();
        let flux: Vec<f64> = mesh
            .boundary_edges
            .iter()
            .map(|e| {
                let (a, b) = (mesh.nodes[e.a], mesh.nodes[e.b]);
                let (ym, zm) = (0.5 * (a[0] + b[0]), 0.5 * (a[1] + b[1]));
                let (ny, nz) = if (ym - 0.5).abs() < 1e-12 {
                    (1.0, 0.0)
                } else if (ym + 0.5).abs() < 1e-12 {
                    (-1.0, 0.0)
                } else if (zm - 0.5).abs() < 1e-12 {
                    (0.0, 1.0)
                } else {
                    (0.0, -1.0)
                };
                -zm * ny - ym * nz
            })
            .collect();

        let mut a = PoissonProblem::new(&mesh);
        a.loop_bcs = vec![LoopBc::NeumannPerEdge];
        a.edge_flux = flux.clone();
        a.zero_mean = true;
        let sa = solve_poisson(&a).unwrap();

        let mut b = PoissonProblem::new(&mesh);
        b.loop_bcs = vec![LoopBc::NeumannPerEdge];
        b.edge_flux = flux;
        b.pins = vec![(0, 0.0)];
        let sb = solve_poisson(&b).unwrap();

        // Gradients are the physically meaningful output and must agree exactly.
        for (ga, gb) in sa.grad.iter().zip(sb.grad.iter()) {
            assert!((ga[0] - gb[0]).abs() < 1e-9 && (ga[1] - gb[1]).abs() < 1e-9);
        }
    }

    // ── Input validation ─────────────────────────────────────────
    #[test]
    fn rejects_malformed_problems() {
        let mesh = mesh_section(&[rect(0.0, 0.0, 1.0, 1.0)], &MeshParams { max_area: 5e-2, ..Default::default() }).unwrap();

        let mut p = PoissonProblem::new(&mesh);
        p.loop_bcs = vec![];
        assert!(solve_poisson(&p).is_err(), "missing BCs");

        let mut p = PoissonProblem::new(&mesh);
        p.loop_bcs = vec![LoopBc::Dirichlet { value: 0.0 }];
        p.source = vec![1.0; 3];
        assert!(solve_poisson(&p).is_err(), "wrong source length");

        let mut p = PoissonProblem::new(&mesh);
        p.loop_bcs = vec![LoopBc::Dirichlet { value: 0.0 }];
        p.pins = vec![(usize::MAX, 0.0)];
        assert!(solve_poisson(&p).is_err(), "out-of-range pin");
    }
}
