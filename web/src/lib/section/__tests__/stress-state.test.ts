/**
 * The complete stress state, assembled from one geometry.
 *
 * The defect this closes was a split brain in the section panel: it DREW a
 * canonical outline and plotted canonical bending on it, while the shear, the
 * Mohr circle and the failure criteria came from the legacy resolver, which
 * infers a section's shape from its name and invents missing thicknesses. The
 * user saw one picture and two different sections, with no way to tell.
 *
 * What is pinned here is mostly units and superposition, because those are
 * where a stress assembly goes wrong quietly — off by a thousand, or with one
 * component silently dropped, and still plausible on screen.
 */

import { describe, it, expect } from 'vitest';
import { canonicalStressState } from '../stress-state';
import { resolveSectionState } from '../state';
import type { Section } from '../../store/model.svelte';

function sec(over: Partial<Section>): Section {
  const s = { id: 1, name: '', a: 0.01, iz: 1e-5, ...over } as Section;
  s.canonical = resolveSectionState(s, { torsion: true });
  return s;
}

/** 200 x 400 mm rectangle: A = 0.08 m², Iy = b h³/12 = 1.0667e-3 m⁴. */
const rect = () => sec({ shape: 'rect', b: 0.2, h: 0.4 });

describe('normal stress is assembled in the right units', () => {
  it('pure axial gives N/A, in MPa', () => {
    // 800 kN over 0.08 m² is 10 000 kPa, i.e. 10 MPa.
    const r = canonicalStressState(rect(), { n: 800, my: 0, mz: 0 }, [0, 0]);
    if (!r.ok) throw new Error(r.message ?? r.reason);
    expect(r.state.sigma).toBeCloseTo(10, 6);
    expect(r.state.breakdown.axial).toBeCloseTo(10, 6);
    expect(r.state.breakdown.bending).toBeCloseTo(0, 6);
  });

  it('pure bending gives M c / I at the extreme fibre', () => {
    // 100 kN·m, c = 0.2 m, I = 1.0667e-3 → 18 750 kPa = 18.75 MPa.
    const r = canonicalStressState(rect(), { n: 0, my: 100, mz: 0 }, [0, 0.2]);
    if (!r.ok) throw new Error(r.message ?? r.reason);
    expect(Math.abs(r.state.sigma)).toBeCloseTo(18.75, 2);
    expect(r.state.breakdown.axial).toBeCloseTo(0, 9);
  });

  it('bending is antisymmetric about the neutral axis, and zero on it', () => {
    const f = { n: 0, my: 100, mz: 0 };
    const top = canonicalStressState(rect(), f, [0, 0.2]);
    const bot = canonicalStressState(rect(), f, [0, -0.2]);
    const mid = canonicalStressState(rect(), f, [0, 0]);
    if (!top.ok || !bot.ok || !mid.ok) throw new Error('expected ok');
    expect(top.state.sigma).toBeCloseTo(-bot.state.sigma, 6);
    expect(mid.state.sigma).toBeCloseTo(0, 9);
  });

  it('axial and bending superpose', () => {
    const r = canonicalStressState(rect(), { n: 800, my: 100, mz: 0 }, [0, 0.2]);
    if (!r.ok) throw new Error('expected ok');
    expect(r.state.sigma).toBeCloseTo(r.state.breakdown.axial + r.state.breakdown.bending, 9);
    expect(Math.abs(r.state.sigma)).toBeGreaterThan(10);
  });
});

describe('shear enters the state at the right magnitude', () => {
  it('peak shear on a rectangle is 1.5 V/A', () => {
    // 160 kN over 0.08 m² averages 2 000 kPa; the peak is 1.5x that = 3 MPa.
    const r = canonicalStressState(rect(), { n: 0, my: 0, mz: 0, vz: 160 }, [0, 0]);
    if (!r.ok) throw new Error(r.message ?? r.reason);
    expect(r.state.tau).toBeGreaterThan(2.6);
    expect(r.state.tau).toBeLessThan(3.4);
  });

  it('shear vanishes at the extreme fibre where bending peaks', () => {
    const f = { n: 0, my: 0, mz: 0, vz: 160 };
    const edge = canonicalStressState(rect(), f, [0, 0.199]);
    const mid = canonicalStressState(rect(), f, [0, 0]);
    if (!edge.ok || !mid.ok) throw new Error('expected ok');
    expect(edge.state.tau).toBeLessThan(0.35 * mid.state.tau);
  });

  it('doubling the force doubles the shear — the solve is per unit force', () => {
    const one = canonicalStressState(rect(), { n: 0, my: 0, mz: 0, vz: 100 }, [0, 0]);
    const two = canonicalStressState(rect(), { n: 0, my: 0, mz: 0, vz: 200 }, [0, 0]);
    if (!one.ok || !two.ok) throw new Error('expected ok');
    expect(two.state.tau / one.state.tau).toBeCloseTo(2, 6);
  });
});

describe('torsion enters the state at the right magnitude', () => {
  it('a circular tube matches T r / J', () => {
    const tube = sec({ shape: 'CHS', h: 0.2, t: 0.01 });
    const st = tube.canonical!;
    if (st.kind !== 'geometry-backed') throw new Error('expected geometry-backed');
    const T = 50; // kN·m
    const r = canonicalStressState(tube, { n: 0, my: 0, mz: 0, t: T }, [0, 0.095]);
    if (!r.ok) throw new Error(r.message ?? r.reason);
    // tau = T r / J, in kPa, converted to MPa.
    const expected = (T * 0.095) / st.j! * 1e-3;
    expect(r.state.tau / expected).toBeGreaterThan(0.85);
    expect(r.state.tau / expected).toBeLessThan(1.15);
  });
});

describe('the state feeds Mohr and the failure criteria consistently', () => {
  it('pure axial gives a Mohr circle centred at sigma/2 with radius sigma/2', () => {
    const r = canonicalStressState(rect(), { n: 800, my: 0, mz: 0 }, [0, 0]);
    if (!r.ok) throw new Error('expected ok');
    expect(r.state.mohr.center).toBeCloseTo(5, 6);
    expect(r.state.mohr.radius).toBeCloseTo(5, 6);
    expect(r.state.mohr.sigma1).toBeCloseTo(10, 6);
    expect(r.state.mohr.sigma2).toBeCloseTo(0, 6);
  });

  it('von Mises reduces to |sigma| under pure axial, and to sqrt(3)|tau| under pure shear', () => {
    const axial = canonicalStressState(rect(), { n: 800, my: 0, mz: 0 }, [0, 0], 250);
    if (!axial.ok) throw new Error('expected ok');
    expect(axial.state.failure.vonMises).toBeCloseTo(10, 6);
    expect(axial.state.failure.ratioVM!).toBeCloseTo(10 / 250, 6);

    const shear = canonicalStressState(rect(), { n: 0, my: 0, mz: 0, vz: 160 }, [0, 0], 250);
    if (!shear.ok) throw new Error('expected ok');
    expect(shear.state.failure.vonMises / shear.state.tau).toBeCloseTo(Math.sqrt(3), 6);
  });

  it('a section without geometry is refused rather than approximated', () => {
    const bare = sec({ name: 'Losa equivalente', a: 0.05, iy: 4e-4, iz: 1e-4 });
    const r = canonicalStressState(bare, { n: 100, my: 10, mz: 0 }, [0, 0]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('notResolved');
  });
});

describe('shapes the legacy path could not handle', () => {
  it('an angle produces a full stress state', () => {
    const ang = sec({ shape: 'L', h: 0.1, b: 0.1, t: 0.01 });
    const r = canonicalStressState(ang, { n: 50, my: 5, mz: 2, vz: 20, vy: 10 }, [0.01, 0.01], 250);
    if (!r.ok) throw new Error(r.message ?? r.reason);
    expect(Number.isFinite(r.state.sigma)).toBe(true);
    expect(r.state.tau).toBeGreaterThan(0);
    expect(r.state.failure.vonMises).toBeGreaterThan(0);
  });
});
