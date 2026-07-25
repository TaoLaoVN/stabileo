/**
 * ORIENTATION BOUNDARY — where X- and Y-direction members diverge, and where they do not.
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * INVESTIGATION RESULT (PR15)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * The `rc-design-frame` example showed its 128 X-direction beams bending about local
 * y (My/Vz — correct for gravity in the canonical Z-up convention) while its 120
 * Y-direction beams bent about local z (Mz/Vy). Two independent causes were traced,
 * and they must not be confused:
 *
 * CAUSE 1 — FIXTURE DATA (found, fixed in PR15)
 *   The fixture authored the Y-beams' gravity load in the LOCAL Y component
 *   (`qYI`), which is horizontal for every horizontal member. 240 load entries were
 *   moved from qY to qZ. `orientation-diagnostic.ts` now detects this class of error,
 *   and a flagged member can never be certified.
 *
 * CAUSE 2 — RAW-SOLVER DEFAULT AUTO-ORIENT (pre-existing, NOT fixed: solver-side)
 *   When NO explicit `localY` is supplied, the Rust/WASM solver's own default
 *   orientation for a Y-direction member disagrees with the app's
 *   `computeLocalAxes3D`. Quantified below: the discrepancy is exactly Iz/Iy, i.e.
 *   the two pick different bending axes.
 *
 *   THIS DOES NOT AFFECT THE APP. `buildSolverInput3D` (solver-service.ts:1158-1178)
 *   explicitly stamps `localY` on every frame element before calling the solver, so
 *   the app path is self-consistent — proved by the first test below, where an
 *   X-member and a Y-member with identical geometry, section, material and global
 *   gravity loading return IDENTICAL forces and displacements.
 *
 *   It is nevertheless a real seam defect. It is ALREADY captured by a failing
 *   assertion in `solver-3d.test.ts` ("member along global Y … horizontal
 *   displacement at top"), which fails on the untouched baseline too. PR15 does not
 *   modify solver code and does not paper over it: the divergence is measured and
 *   pinned here so it cannot regress further or be silently "fixed" by picking
 *   whichever component makes a candidate pass.
 *
 * ESCALATION WORDING (for the solver team)
 *   "For a frame element whose axis is global +Y and with no explicit localY vector,
 *    the WASM solver's default local frame bends the member about local y (uses Iy)
 *    under a global-X tip load. The app's canonical Z-up convention
 *    (local-axes-3d.ts: ez = global up projected ⊥ ex, ey = ez × ex) gives
 *    ey = [-1,0,0], ez = [0,0,1], so the same load must bend about local z (uses Iz).
 *    The measured tip displacement ratio is exactly Iz/Iy (2.0024 for Iz=8.33e-6,
 *    Iy=4.16e-6), confirming the axis swap rather than a stiffness scaling error.
 *    Reproducer: solver-3d.test.ts, describe('3D Solver — member along global Y')."
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import { describe, it, expect } from 'vitest';
import { solve3D } from '../../wasm-solver';
import { validateAndSolve3D } from '../../solver-service';
import { computeLocalAxes3D } from '../../local-axes-3d';
import { assertRealSolver } from './helpers';
import type { SolverInput3D } from '../../types-3d';

/** Solver material E is in MPa; the closed-form check needs kN/m². */
const E_MPA = 200_000;
const E = E_MPA * 1000;
const Iz = 8.33e-6;
const Iy = 4.16e-6;

/** Model built through the APP path (buildSolverInput3D stamps localY). */
function appModel(along: 'X' | 'Y') {
  const p = (t: number) => (along === 'X' ? { x: t, y: 0, z: 0 } : { x: 0, y: t, z: 0 });
  return {
    name: 't',
    nodes: new Map<number, any>([
      [1, { id: 1, ...p(0) }], [2, { id: 2, ...p(3) }], [3, { id: 3, ...p(6) }],
    ]),
    elements: new Map<number, any>([
      [1, { id: 1, type: 'frame', nodeI: 1, nodeJ: 2, materialId: 1, sectionId: 1, releaseI: {}, releaseJ: {} }],
      [2, { id: 2, type: 'frame', nodeI: 2, nodeJ: 3, materialId: 1, sectionId: 1, releaseI: {}, releaseJ: {} }],
    ]),
    materials: new Map<number, any>([[1, { id: 1, name: 'H30', e: 30000, nu: 0.2, rho: 25, fy: 30 }]]),
    sections: new Map<number, any>([[1, { id: 1, name: '300×600', a: 0.18, iy: 0.0054, iz: 0.00135, j: 0.00478, b: 0.3, h: 0.6, shape: 'rect' }]]),
    supports: new Map<number, any>([
      [1, { id: 1, nodeId: 1, type: 'fixed3d' }],
      [2, { id: 2, nodeId: 3, type: 'fixed3d' }],
    ]),
    // GLOBAL gravity at midspan — no local pre-encoding, so the app must decompose it.
    loads: [{ type: 'nodal3d', data: { id: 1, nodeId: 2, fx: 0, fy: 0, fz: -100, mx: 0, my: 0, mz: 0 } }],
    plates: new Map(), quads: new Map(), constraints: [], connectors: new Map(),
    loadCases: [], combinations: [],
  } as any;
}

describe('APP PATH: X- and Y-direction members are equivalent (no anomaly)', () => {
  it('computeLocalAxes3D puts local z along global up for both directions', () => {
    for (const [tag, i, j] of [
      ['X', { id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 6, y: 0, z: 0 }],
      ['Y', { id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 0, y: 6, z: 0 }],
    ] as const) {
      const a = computeLocalAxes3D(i as never, j as never);
      expect(a.ez.map(v => +v.toFixed(6)), `${tag} local z must be global up`).toEqual([0, 0, 1]);
      expect(+a.ey[2].toFixed(6), `${tag} local y must be horizontal`).toBe(0);
    }
  });

  it('identical geometry + section + global gravity → IDENTICAL response', () => {
    assertRealSolver();
    const rx = validateAndSolve3D(appModel('X'), false, false);
    const ry = validateAndSolve3D(appModel('Y'), false, false);
    if (typeof rx === 'string' || !rx || typeof ry === 'string' || !ry) throw new Error('solve failed');

    const mx = rx.displacements.find(d => d.nodeId === 2)!;
    const my = ry.displacements.find(d => d.nodeId === 2)!;
    // Same vertical deflection: the Y-member is NOT lying flat.
    expect(my.uz).toBeCloseTo(mx.uz, 9);
    expect(Math.abs(my.uz)).toBeGreaterThan(1e-9);

    const ex = rx.elementForces[0];
    const ey = ry.elementForces[0];
    // Gravity lands in My/Vz for BOTH directions.
    expect(ey.myStart).toBeCloseTo(ex.myStart, 6);
    expect(ey.vzStart).toBeCloseTo(ex.vzStart, 6);
    expect(Math.abs(ex.myStart)).toBeGreaterThan(1);
    expect(Math.abs(ex.mzStart)).toBeLessThan(1e-6);
    expect(Math.abs(ey.mzStart)).toBeLessThan(1e-6);
  });
});

describe('RAW SOLVER PATH: pre-existing default-auto-orient divergence (solver-side)', () => {
  /** Cantilever along `along`, tip load perpendicular in the horizontal plane. */
  function rawCantilever(along: 'X' | 'Y'): SolverInput3D {
    const p = (t: number) => (along === 'X' ? { x: t, y: 0, z: 0 } : { x: 0, y: t, z: 0 });
    const tip = along === 'X'
      ? { fx: 0, fy: 10, fz: 0 }     // ⊥ to the member, horizontal
      : { fx: 10, fy: 0, fz: 0 };
    return {
      nodes: new Map<any, any>([[1, { id: 1, ...p(0) }], [2, { id: 2, ...p(5) }]]),
      materials: new Map([[1, { id: 1, e: E_MPA, nu: 0.3 }]]),
      sections: new Map([[1, { id: 1, a: 0.01, iz: Iz, iy: Iy, j: 1e-5 }]]),
      elements: new Map<any, any>([[1, {
        id: 1, type: 'frame', nodeI: 1, nodeJ: 2, materialId: 1, sectionId: 1,
        releaseMyStart: false, releaseMyEnd: false, releaseMzStart: false,
        releaseMzEnd: false, releaseTStart: false, releaseTEnd: false,
      }]]),
      supports: new Map<any, any>([[0, { nodeId: 1, rx: true, ry: true, rz: true, rrx: true, rry: true, rrz: true }]]),
      // NOTE: no localY is supplied — this is the historical raw-input path that
      // buildSolverInput3D deliberately overrides in the app.
      loads: [{ type: 'nodal', data: { nodeId: 2, ...tip, mx: 0, my: 0, mz: 0 } }],
    } as unknown as SolverInput3D;
  }

  it('an X-direction member matches the app convention (bends about local z, uses Iz)', () => {
    assertRealSolver();
    const r = solve3D(rawCantilever('X'));
    const tip = r.displacements.find(d => d.nodeId === 2)!;
    const expectedIz = 10 * 125 / (3 * E * Iz);
    expect(Math.abs(tip.uy)).toBeCloseTo(expectedIz, 6);
  });

  it('a Y-direction member does NOT — the discrepancy is exactly Iz/Iy (axis swap)', () => {
    assertRealSolver();
    const r = solve3D(rawCantilever('Y'));
    const tip = r.displacements.find(d => d.nodeId === 2)!;
    const expectedIz = 10 * 125 / (3 * E * Iz);   // app convention
    const expectedIy = 10 * 125 / (3 * E * Iy);   // what the raw solver actually does

    // Documented, NOT worked around. If the solver is corrected upstream this
    // assertion flips and the escalation note above can be removed.
    expect(Math.abs(tip.ux)).toBeCloseTo(expectedIy, 6);
    expect(Math.abs(tip.ux)).not.toBeCloseTo(expectedIz, 6);
    const ratio = Math.abs(tip.ux) / expectedIz;
    expect(ratio).toBeCloseTo(Iz / Iy, 3);        // a clean axis swap, not a scaling error
  });

  it('the app never uses the raw path: localY is always stamped on frame elements', () => {
    const src = new URL('../../solver-service.ts', import.meta.url);
    const s = require('node:fs').readFileSync(src, 'utf8') as string;
    expect(s).toContain('elem.localYx = axes.ey[0]');
    expect(s).toContain('force the corrected local axes at the solver');
  });
});
