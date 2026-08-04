/**
 * Drawing / numerical geometry identity.
 *
 * The defect: the drawing reconstructed an outline from the profile NAME while
 * the numbers came from Rust, and nothing checked they agreed. These tests pin
 * that the drawing consumes the numerical path's own polygons and that a
 * mismatch is refused — including a case that deliberately mismatches, because
 * a guard that cannot fail proves nothing.
 */

import { describe, it, expect } from 'vitest';
import {
  resolveDrawingGeometry,
  assertSameGeometry,
  supportsDetailedAnalysis,
  drawingGeometry,
} from '../drawing';
import { resolveSectionState } from '../state';
import { analyzeSectionBending } from '../../engine/wasm-solver';
import { ALL_PROFILES } from '../../data/steel-profiles';
import type { Section } from '../../store/model.svelte';

function sec(over: Partial<Section> & { id?: number }): Section {
  return { id: 1, name: '', a: 0.01, iz: 1e-5, ...over } as Section;
}
function fromCatalogue(name: string, id = 1): Section {
  const p = ALL_PROFILES.find((x) => x.name === name)!;
  return sec({ id, name: p.name, a: p.a * 1e-4, iy: p.iy * 1e-8, iz: p.iz * 1e-8 });
}
function resolved(s: Section): Section {
  return { ...s, canonical: resolveSectionState(s) };
}

// ─── The drawing renders the analysed geometry ─────────────────────

describe('drawing consumes the canonical polygons', () => {
  it('an IPE outline carries its root fillets, not a sharp box', () => {
    const r = resolveDrawingGeometry(resolved(fromCatalogue('IPE 300')));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // 12 vertices would be a sharp I; fillet arcs add many more.
    expect(r.geometry.solids[0].length).toBeGreaterThan(50);
    expect(r.geometry.holes.length).toBe(0);
    const [yMin, zMin, yMax, zMax] = r.geometry.bbox;
    expect(yMax - yMin).toBeCloseTo(0.15, 6);
    expect(zMax - zMin).toBeCloseTo(0.30, 6);
  });

  it('a CHS carries its bore as a hole', () => {
    const r = resolveDrawingGeometry(resolved(fromCatalogue('CHS 88.9x4')));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.geometry.solids.length).toBe(1);
    expect(r.geometry.holes.length).toBe(1);
    // The bore is smaller than the outer wall.
    const outerSpan = Math.max(...r.geometry.solids[0].map(([y]) => Math.abs(y)));
    const holeSpan = Math.max(...r.geometry.holes[0].map(([y]) => Math.abs(y)));
    expect(holeSpan).toBeLessThan(outerSpan);
    expect(holeSpan).toBeGreaterThan(outerSpan * 0.8);
  });

  it('coordinates are centroid-relative so overlays line up with the outline', () => {
    // A tee's centroid is not at its bounding-box centre, so this would show
    // up immediately as an offset overlay if the frames disagreed.
    const r = resolveDrawingGeometry(resolved(sec({ shape: 'T', h: 0.3, b: 0.3, tw: 0.1, tf: 0.15 })));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const zs = r.geometry.solids[0].map(([, z]) => z);
    const mid = (Math.max(...zs) + Math.min(...zs)) / 2;
    expect(Math.abs(mid)).toBeGreaterThan(1e-4); // centroid ≠ bbox centre
    expect(r.geometry.centroid[1]).not.toBe(0);
  });

  it('an asymmetric section reports its rotated principal axis to the drawing', () => {
    const r = resolveDrawingGeometry(resolved(sec({ shape: 'L', h: 0.1, b: 0.1, t: 0.01 })));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(Math.abs((r.geometry.principalAngle * 180) / Math.PI - 45)).toBeLessThan(1e-6);
  });
});

// ─── Identity enforcement ──────────────────────────────────────────

describe('digest identity is enforced, and the guard can actually fail', () => {
  it('the drawing and the bending result agree for the same section', () => {
    const s = resolved(fromCatalogue('IPE 300'));
    const r = resolveDrawingGeometry(s);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const st = s.canonical!;
    if (st.kind !== 'geometry-backed') throw new Error('geometry-backed');
    const bending = analyzeSectionBending({ geometry: st.geometry, n: 0, my: 10, mz: 0 });
    expect(assertSameGeometry(r.geometry, bending)).toBeNull();
  });

  it('a DIFFERENT section is refused rather than drawn', () => {
    const a = resolved(fromCatalogue('IPE 300'));
    const b = resolved(fromCatalogue('IPE 330'));
    const ra = resolveDrawingGeometry(a);
    const stb = b.canonical!;
    if (!ra.ok || stb.kind !== 'geometry-backed') throw new Error('setup');

    const bendingOfB = analyzeSectionBending({ geometry: stb.geometry, n: 0, my: 10, mz: 0 });
    const refusal = assertSameGeometry(ra.geometry, bendingOfB);
    expect(refusal).not.toBeNull();
    expect(refusal!.kind).toBe('digestMismatch');
  });

  it('a tampered drawing digest is refused', () => {
    const s = resolved(fromCatalogue('HEB 200'));
    const r = resolveDrawingGeometry(s);
    const st = s.canonical!;
    if (!r.ok || st.kind !== 'geometry-backed') throw new Error('setup');
    const bending = analyzeSectionBending({ geometry: st.geometry, n: 0, my: 5, mz: 0 });
    const tampered = { ...r.geometry, digest: 'ffffffffffffffff' };
    expect(assertSameGeometry(tampered, bending)!.kind).toBe('digestMismatch');
  });

  it('a version mismatch is refused', () => {
    const s = resolved(fromCatalogue('HEB 200'));
    const st = s.canonical!;
    if (st.kind !== 'geometry-backed') throw new Error('setup');
    const g = drawingGeometry({ ...st, version: 99 });
    const bending = analyzeSectionBending({ geometry: st.geometry, n: 0, my: 5, mz: 0 });
    expect(assertSameGeometry(g, bending)!.kind).toBe('versionMismatch');
  });
});

// ─── Properties-only sections are refused, never schematised ───────

describe('properties-only sections get no detailed drawing', () => {
  for (const name of ['UPN 200', 'IPN 200', 'L 100x100x10', 'RHS 100x50x4']) {
    it(`${name} is refused with its structured reason`, () => {
      const s = resolved(fromCatalogue(name));
      expect(supportsDetailedAnalysis(s)).toBe(false);
      const r = resolveDrawingGeometry(s);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.refusal.kind).toBe('propertiesOnly');
    });
  }

  it('an unresolved section is refused rather than assumed', () => {
    const r = resolveDrawingGeometry(fromCatalogue('IPE 300')); // no canonical state
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.refusal.kind).toBe('notResolved');
  });

  it('geometry-backed sections are permitted', () => {
    for (const name of ['IPE 300', 'HEA 300', 'HEB 200', 'CHS 88.9x4']) {
      expect(supportsDetailedAnalysis(resolved(fromCatalogue(name))), name).toBe(true);
    }
  });
});

// ─── Renaming ──────────────────────────────────────────────────────

describe('the drawing does not depend on the display name', () => {
  it('renaming a profile leaves the drawn outline byte-identical', () => {
    const a = resolved(fromCatalogue('IPE 300'));
    const renamed = resolved({ ...fromCatalogue('IPE 300'), name: 'IPE 300' });
    const ra = resolveDrawingGeometry(a);
    const rb = resolveDrawingGeometry(renamed);
    if (!ra.ok || !rb.ok) throw new Error('setup');
    expect(rb.geometry.digest).toBe(ra.geometry.digest);
    expect(rb.geometry.solids[0]).toEqual(ra.geometry.solids[0]);
  });
});
