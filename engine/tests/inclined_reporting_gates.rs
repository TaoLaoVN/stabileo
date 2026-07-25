//! Gates: reactions, displacements, and equilibrium sums are reported in
//! GLOBAL axes on every analysis path, including inclined supports.

#[path = "common/mod.rs"]
mod common;

use dedaliano_engine::solver::linear;
use dedaliano_engine::types::*;
use std::collections::HashMap;

/// 2D triangle with a 45° inclined roller: nodes 1 (pin), 2 (inclined roller), 3 loaded.
fn inclined_model_2d(with_constraint: bool) -> SolverInput {
    let mut nodes = HashMap::new();
    nodes.insert("1".to_string(), SolverNode { id: 1, x: 0.0, z: 0.0 });
    nodes.insert("2".to_string(), SolverNode { id: 2, x: 6.0, z: 0.0 });
    nodes.insert("3".to_string(), SolverNode { id: 3, x: 3.0, z: 3.0 });
    let mut materials = HashMap::new();
    materials.insert("1".to_string(), SolverMaterial { id: 1, e: 200_000.0, nu: 0.3 });
    let mut sections = HashMap::new();
    sections.insert("1".to_string(), SolverSection { id: 1, a: 0.01, iz: 1e-4, as_y: None });
    let mut elements = HashMap::new();
    for (id, ni, nj) in [(1usize, 1usize, 2usize), (2, 2, 3), (3, 3, 1)] {
        elements.insert(id.to_string(), SolverElement {
            id, elem_type: "frame".to_string(), node_i: ni, node_j: nj,
            material_id: 1, section_id: 1, hinge_start: false, hinge_end: false,
        });
    }
    let mut supports = HashMap::new();
    supports.insert("1".to_string(), SolverSupport {
        id: 1, node_id: 1, support_type: "pinned".to_string(),
        kx: None, ky: None, kz: None, dx: None, dz: None, dry: None, angle: None,
    });
    supports.insert("2".to_string(), SolverSupport {
        id: 2, node_id: 2, support_type: "inclinedRoller".to_string(),
        kx: None, ky: None, kz: None, dx: None, dz: None, dry: None, angle: Some(45.0),
    });
    let mut constraints = vec![];
    if with_constraint {
        // An unrelated EqualDOF elsewhere forces the constrained solve path.
        // Node 1 (pinned) leaves ry free; node 2 (inclinedRoller) restrains
        // only the rotated normal DOF and also leaves ry free — tying these
        // two free rotations together forces solve_constrained_2d without
        // touching any restrained master DOF (that interacts with the
        // separate prescribed-displacement redistribution path, out of
        // scope here — this constraint exists only to force the constrained
        // path so the inclined-reactions bug is exercised).
        constraints.push(Constraint::EqualDOF(EqualDOFConstraint {
            master_node: 1, slave_node: 2, dofs: vec![2], // tie ry (both free)
        }));
    }
    SolverInput {
        nodes, materials, sections, elements, supports,
        loads: vec![SolverLoad::Nodal(SolverNodalLoad { node_id: 3, fx: 5.0, fz: -15.0, my: 0.0 })],
        constraints,
        connectors: HashMap::new(),
    }
}

fn assert_global_equilibrium(res: &AnalysisResults, fx_applied: f64, fz_applied: f64, label: &str) {
    let sum_rx: f64 = res.reactions.iter().map(|r| r.rx).sum();
    let sum_rz: f64 = res.reactions.iter().map(|r| r.rz).sum();
    assert!((sum_rx + fx_applied).abs() < 1e-6, "{label}: \u{3a3}Rx {} vs applied {}", sum_rx, fx_applied);
    assert!((sum_rz + fz_applied).abs() < 1e-6, "{label}: \u{3a3}Rz {} vs applied {}", sum_rz, fz_applied);
}

#[test]
fn linear_path_inclined_reactions_global() {
    // Baseline — already fixed by 25d55b1; guards against regression.
    let res = linear::solve_2d(&inclined_model_2d(false)).expect("solve");
    assert_global_equilibrium(&res, 5.0, -15.0, "linear");
}

#[test]
fn constrained_path_inclined_reactions_match_summary() {
    let res = linear::solve_2d(&inclined_model_2d(true)).expect("solve");
    assert_global_equilibrium(&res, 5.0, -15.0, "constrained");
    // Per-node reactions and the equilibrium summary must agree.
    let sum_rx: f64 = res.reactions.iter().map(|r| r.rx).sum();
    let sum_rz: f64 = res.reactions.iter().map(|r| r.rz).sum();
    let eq = res.equilibrium.as_ref().expect("equilibrium summary present");
    assert!((eq.reaction_force_sum[0] - sum_rx).abs() < 1e-6,
        "summary Rx {} vs per-node {}", eq.reaction_force_sum[0], sum_rx);
    assert!((eq.reaction_force_sum[1] - sum_rz).abs() < 1e-6,
        "summary Rz {} vs per-node {}", eq.reaction_force_sum[1], sum_rz);
}
