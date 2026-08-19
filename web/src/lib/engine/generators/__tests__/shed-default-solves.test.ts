/**
 * The shed the user actually gets, solved.
 *
 * ── Why this file exists next to `generated-models-solve.test.ts` ──
 *
 * That file solves a shed. It does not solve THE shed: every case in it overrides
 * `longitudinalBeams` to `true`, and `DEFAULT_SHED_PARAMS` ships it `false`. So the
 * configuration a user gets by opening the generator and pressing Generate was the one
 * configuration never put through the solver, and it was a mechanism — singular stiffness
 * matrix, at every frame count from 2 to 7.
 *
 * The cause was the latticed column cap: two COLLINEAR pin-ended bars tying the chord tops,
 * which restrain their node along one line and in no other direction. See the comment on
 * `capTop` in `lattice-column.ts`.
 *
 * The lesson is the shape of the test, not the fix. A generator's defaults are a code path
 * like any other, and "we test the generator with the options we happened to pass" is how one
 * stays unsolved. Every case below starts from `DEFAULT_SHED_PARAMS` spread with NOTHING
 * overridden that changes structure.
 */

import { describe, it, expect } from 'vitest';
import { generateShed, DEFAULT_SHED_PARAMS } from '../shed';
import { generateLatticeColumn } from '../lattice-column';
import { emitModel, defaultProfileSpec, type EmitOptions } from '../emit';
import { modelFromFixture, assertRealSolver } from '../../design/__tests__/helpers';
import { validateAndSolve3D } from '../../solver-service';

const PROFILES: EmitOptions['profiles'] = {
  chord: defaultProfileSpec('IPE 100'),
  post: defaultProfileSpec('L 50x50x5'),
  diagonal: defaultProfileSpec('L 50x50x5'),
  rafter: defaultProfileSpec('IPE 200'),
  column: defaultProfileSpec('HEB 160'),
  beam: defaultProfileSpec('IPE 200'),
  purlin: defaultProfileSpec('UPN 100'),
};

/** Solve under one downward nodal load at the highest node, as the sibling file does. */
function solve(json: any, fzKn: number) {
  assertRealSolver();
  const node = json.nodes.reduce((b: any, n: any) => (n.z > b.z ? n : b), json.nodes[0]).id;
  const res = validateAndSolve3D(modelFromFixture({
    ...json,
    loadCases: [{ id: 1, type: 'dead', name: 'D' }],
    loads: [{
      type: 'nodal3d',
      data: { id: 1, nodeId: node, fx: 0, fy: 0, fz: fzKn, mx: 0, my: 0, mz: 0, caseId: 1 },
    }],
  }).model, false, false);
  return res;
}

/**
 * The largest nodal displacement.
 *
 * The figure this suite asserts on, because `Number.isFinite` cannot tell a deflection from a
 * mechanism: before the cap was fixed, the shed with longitudinal beams returned 2·10^11 m and
 * every `isFinite` check on it passed.
 */
function maxDisplacement(res: unknown): number {
  const r = res as { displacements: Array<{ ux: number; uy: number; uz: number }> };
  return Math.max(...r.displacements.map((d) => Math.hypot(d.ux, d.uy, d.uz)));
}

const emit = (params: Parameters<typeof generateShed>[0], name: string) =>
  emitModel(generateShed(params), { name, profiles: PROFILES }).json as any;

describe('the default shed', () => {
  it('is not a mechanism, with nothing overridden', () => {
    const res = solve(emit({ ...DEFAULT_SHED_PARAMS }, 'Nave'), -20);
    expect(typeof res, typeof res === 'string' ? String(res) : '').not.toBe('string');
    expect(maxDisplacement(res)).toBeLessThan(0.05);
  });

  it('deflects like the same shed on solid columns, which is the check that it is stiffness', () => {
    // Two independently generated column types under one load. A latticed column and a solid
    // one are not required to agree exactly — they are required to be the same order of
    // magnitude, and that is what a real stiffness produces and a near-mechanism does not.
    const lattice = maxDisplacement(solve(emit({ ...DEFAULT_SHED_PARAMS }, 'Reticulada'), -20));
    const solid = maxDisplacement(solve(emit({ ...DEFAULT_SHED_PARAMS, columnKind: 'solid' }, 'Alma llena'), -20));
    expect(lattice).toBeGreaterThan(0);
    expect(solid).toBeGreaterThan(0);
    expect(lattice / solid).toBeGreaterThan(0.2);
    expect(lattice / solid).toBeLessThan(5);
  });

  it('stays solvable across the frame counts the panel offers', () => {
    for (const frames of [2, 3, 4, 6]) {
      const res = solve(emit({ ...DEFAULT_SHED_PARAMS, frames }, `Nave ${frames}`), -20);
      expect(typeof res, `frames=${frames}: ${typeof res === 'string' ? String(res) : ''}`)
        .not.toBe('string');
      expect(maxDisplacement(res), `frames=${frames}`).toBeLessThan(0.05);
    }
  });
});

describe('the default shed is connected', () => {
  const json = emit({ ...DEFAULT_SHED_PARAMS }, 'Nave');

  it('leaves no node without a member, and no unsupported node on a single member', () => {
    const incident = new Map<number, number>(json.nodes.map((n: any) => [n.id, 0]));
    for (const e of json.elements) {
      incident.set(e.nodeI, (incident.get(e.nodeI) ?? 0) + 1);
      incident.set(e.nodeJ, (incident.get(e.nodeJ) ?? 0) + 1);
    }
    const supported = new Set(json.supports.map((s: any) => s.nodeId));
    const orphans = [...incident].filter(([, k]) => k === 0).map(([id]) => id);
    const danglers = [...incident].filter(([id, k]) => k === 1 && !supported.has(id)).map(([id]) => id);
    expect(orphans, 'nodes with no member').toEqual([]);
    expect(danglers, 'unsupported nodes hanging off one member').toEqual([]);
  });

  it('supports every chord foot, which is where the four-per-frame count comes from', () => {
    // 2 columns × 2 chords per latticed column × frames.
    expect(json.supports.length).toBe(4 * DEFAULT_SHED_PARAMS.frames);
    for (const s of json.supports) expect(s.type).toBe('fixed3d');
  });
});

describe('the latticed column cap', () => {
  it('ties the chord tops with moment continuity, not with two pins', () => {
    // The regression guard for the mechanism. The two cap members are collinear, so pinning
    // them leaves their shared node free in the two directions across the cap — which is what
    // made every default shed singular. Pinned web elsewhere is fine and stays: it is
    // triangulated, and the cap is not.
    const col = generateLatticeColumn({ capTop: true, divisions: 4 });
    const cap = col.nodes[col.nodes.length - 1];
    const atCap = col.members.filter((m: any) => m.a === cap.i || m.b === cap.i);
    expect(atCap.length, 'the cap is tied to both chords').toBe(2);
    for (const m of atCap) expect(m.type, 'cap members carry moment').toBe('frame');
    // And the rest of the web is still pinned, so this is a targeted change and not a sweep.
    const web = col.members.filter((m: any) => (m.role === 'post' || m.role === 'diagonal')
      && m.a !== cap.i && m.b !== cap.i);
    expect(web.length).toBeGreaterThan(0);
    for (const m of web) expect(m.type).toBe('truss');
  });
});
