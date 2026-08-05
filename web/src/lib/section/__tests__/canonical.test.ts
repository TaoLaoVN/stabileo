/**
 * Canonical section resolution — end-to-end through the real WASM engine.
 *
 * These pin the two properties the whole canonical architecture exists for:
 *
 *  1. A geometry-backed section's numbers and its drawing come from ONE
 *     geometry, provable by digest.
 *  2. A section whose true outline is not known is refused rather than
 *     approximated. The old path inferred a shape from the profile NAME and
 *     invented thicknesses when they were missing, which produced a measured
 *     40 % error in shear stress with no warning.
 */

import { describe, it, expect } from 'vitest';
import {
  resolveCanonicalSection,
  isGeometryBacked,
  type ResolvedSection,
} from '../canonical';
import { analyzeSectionBending, sectionGeometryDigest } from '../../engine/wasm-solver';
import { ALL_PROFILES } from '../../data/steel-profiles';
import type { Section } from '../../store/model.svelte';

/** Build a stored section as the app would hold it. */
function sec(over: Partial<Section> & { id?: number }): Section {
  return { id: 1, name: '', a: 0.01, iz: 1e-5, ...over } as Section;
}

/** Look up a catalogue profile and wrap it as a stored section. */
function fromCatalogue(name: string, id = 1): Section {
  const p = ALL_PROFILES.find((x) => x.name === name);
  if (!p) throw new Error(`catalogue profile ${name} not found`);
  return sec({
    id,
    name: p.name,
    a: p.a * 1e-4,
    iy: p.iy * 1e-8,
    iz: p.iz * 1e-8,
  });
}

const rel = (got: number, exp: number) => (exp === 0 ? Math.abs(got) : Math.abs((got - exp) / exp));

function backed(r: ResolvedSection) {
  if (!isGeometryBacked(r)) throw new Error(`expected geometry-backed, got ${r.state}: ${JSON.stringify(r.reason)}`);
  return r;
}

// ─── Geometry-backed catalogue families ────────────────────────────

describe('IPE / HEA / HEB resolve to canonical geometry with root fillets', () => {
  const CASES: Array<[string, number, number, number]> = [
    // name, published A (cm2), Iy (cm4), Iz (cm4)
    ['IPE 300', 53.8, 8356, 604],
    ['IPE 80', 7.64, 80.1, 8.49],
    ['HEB 200', 78.1, 5696, 2003],
    ['HEA 300', 113, 18260, 6310],
  ];

  for (const [name, a, iy, iz] of CASES) {
    it(`${name} matches its published properties`, () => {
      const r = backed(resolveCanonicalSection(fromCatalogue(name)));
      // 0.6 %: the published tables carry three significant figures, so
      // ~0.1-0.5 % is inherent in the reference. Tight enough that a missing
      // fillet (2.4-6.0 %) still fails.
      expect(rel(r.properties.a * 1e4, a)).toBeLessThan(6e-3);
      expect(rel(r.properties.iy * 1e8, iy)).toBeLessThan(6e-3);
      expect(rel(r.properties.iz * 1e8, iz)).toBeLessThan(6e-3);
      expect(r.profileId).toBe(name);
      expect(r.digest).toMatch(/^[0-9a-f]{16}$/);
    });
  }

  it('every IPE, HEA and HEB profile resolves', () => {
    const rolled = ALL_PROFILES.filter((p) => ['IPE', 'HEA', 'HEB'].includes(p.family));
    expect(rolled.length).toBe(56);
    for (const p of rolled) {
      const r = resolveCanonicalSection(fromCatalogue(p.name));
      expect(r.state, `${p.name}`).toBe('geometry-backed');
    }
  });

  it('a doubly symmetric profile has no product of inertia', () => {
    const r = backed(resolveCanonicalSection(fromCatalogue('IPE 300')));
    expect(Math.abs(r.properties.iyz) / r.properties.iy).toBeLessThan(1e-9);
  });
});

describe('CHS resolves to the exact annulus', () => {
  it('every CHS profile resolves and is isotropic in bending', () => {
    const chs = ALL_PROFILES.filter((p) => p.family === 'CHS');
    expect(chs.length).toBe(12);
    for (const p of chs) {
      const r = backed(resolveCanonicalSection(fromCatalogue(p.name)));
      expect(rel(r.properties.iy, r.properties.iz), p.name).toBeLessThan(1e-6);
      expect(r.geometry.polygons.filter((q) => q.isVoid).length, `${p.name} bore`).toBe(1);
    }
  });

  it('reaches the CORRECTED inertia, not the superseded value', () => {
    // CHS 48.3x3.2 listed 12.3 cm^4; the exact annulus is 11.59, and
    // EN 10219-2 agrees with the formula.
    const r = backed(resolveCanonicalSection(fromCatalogue('CHS 48.3x3.2')));
    expect(rel(r.properties.iy * 1e8, 11.59)).toBeLessThan(5e-3);
    expect(rel(r.properties.iy * 1e8, 12.3)).toBeGreaterThan(0.04);
  });
});

// ─── Properties-only families ──────────────────────────────────────

describe('incomplete rolled families stay properties-only', () => {
  const EXPECTED: Array<[string, number, string]> = [
    ['IPN', 21, 'missingTaperAndRadii'],
    ['UPN', 12, 'missingTaperAndRadii'],
    ['L', 10, 'missingRootRadius'],
    ['RHS', 12, 'missingCornerRadii'],
  ];

  for (const [family, count, reasonKind] of EXPECTED) {
    it(`${family} (${count} profiles) is refused with a structured reason`, () => {
      const profiles = ALL_PROFILES.filter((p) => p.family === family);
      expect(profiles.length).toBe(count);
      for (const p of profiles) {
        const r = resolveCanonicalSection(fromCatalogue(p.name));
        expect(r.state, p.name).toBe('properties-only');
        if (r.state === 'properties-only') {
          expect(r.reason.kind).toBe(reasonKind);
          // Still globally solvable: the declared values survive.
          expect(r.declared.a).toBeGreaterThan(0);
          expect(r.declared.iz).toBeGreaterThan(0);
        }
      }
    });
  }

  it('a section with neither shape nor polygon is properties-only, not guessed', () => {
    const r = resolveCanonicalSection(sec({ name: 'Amorphous', a: 0.005, iz: 2e-5, iy: 8e-5 }));
    expect(r.state).toBe('properties-only');
    if (r.state === 'properties-only') expect(r.reason.kind).toBe('noGeometry');
  });

  it('a parametric shape missing a dimension is refused, never invented', () => {
    // This is the S1 defect made unrepresentable: the old path would have
    // substituted tw = 0.05*b and tf = 0.06*h here.
    const r = resolveCanonicalSection(sec({ shape: 'I', b: 0.15, h: 0.3 }));
    expect(r.state).toBe('properties-only');
    if (r.state === 'properties-only') {
      expect(r.reason.kind).toBe('missingDimensions');
      if (r.reason.kind === 'missingDimensions') {
        expect(r.reason.missing.sort()).toEqual(['tf', 'tw']);
      }
    }
  });
});

// ─── Identity: name must not touch geometry ────────────────────────

describe('identity is dimensional, never the display name', () => {
  it('renaming a catalogue section changes neither geometry nor digest', () => {
    const original = backed(resolveCanonicalSection(fromCatalogue('IPE 300')));
    // Same dimensions, different display name — resolved as a parametric
    // section so the catalogue lookup cannot rescue it.
    const renamed = backed(
      resolveCanonicalSection(
        sec({ id: 2, name: 'Main beam', shape: 'I', h: 0.3, b: 0.15, tw: 0.0071, tf: 0.0107 }),
      ),
    );
    // The parametric build is sharp-cornered, so it is a DIFFERENT geometry —
    // and the digest says so rather than silently pretending otherwise.
    expect(renamed.digest).not.toBe(original.digest);
    expect(renamed.properties.a).toBeLessThan(original.properties.a);
  });

  it('two sections with identical geometry share a digest regardless of id or name', () => {
    const a = backed(resolveCanonicalSection(sec({ id: 1, name: 'A', shape: 'rect', b: 0.2, h: 0.4 })));
    const b = backed(resolveCanonicalSection(sec({ id: 99, name: 'Z', shape: 'rect', b: 0.2, h: 0.4 })));
    expect(b.digest).toBe(a.digest);
    expect(b.properties.a).toBeCloseTo(a.properties.a, 15);
  });

  it('the same catalogue profile resolves identically every time', () => {
    const a = backed(resolveCanonicalSection(fromCatalogue('HEB 200', 1)));
    const b = backed(resolveCanonicalSection(fromCatalogue('HEB 200', 7)));
    expect(b.digest).toBe(a.digest);
  });
});

// ─── Digest identity between drawing and numbers ───────────────────

describe('drawing and numerical analysis prove they share one geometry', () => {
  it('the bending result echoes the geometry digest', () => {
    const r = backed(resolveCanonicalSection(fromCatalogue('IPE 300')));
    const stress = analyzeSectionBending({ geometry: r.geometry, n: 100, my: 50, mz: 10 });
    expect(stress.digest).toBe(r.digest);
    expect(stress.geometryVersion).toBe(r.geometry.version);
  });

  it('the digest a drawing would recompute matches the numerical one', () => {
    // The drawing receives the geometry over the wire and recomputes the
    // digest; it must land on the same value. This fails if serialization
    // perturbs coordinates, which it measurably does at the f64 level.
    const r = backed(resolveCanonicalSection(fromCatalogue('CHS 88.9x4')));
    const roundTripped = JSON.parse(JSON.stringify(r.geometry));
    expect(sectionGeometryDigest(roundTripped).digest).toBe(r.digest);
  });

  it('a deliberately different geometry FAILS the digest check', () => {
    // Guards the guard: if the digest could not tell two sections apart it
    // would prove nothing.
    const a = backed(resolveCanonicalSection(fromCatalogue('IPE 300')));
    const b = backed(resolveCanonicalSection(fromCatalogue('IPE 330')));
    expect(b.digest).not.toBe(a.digest);
    const stress = analyzeSectionBending({ geometry: a.geometry, n: 0, my: 10, mz: 0 });
    expect(stress.digest).not.toBe(b.digest);
  });
});

// ─── Unsymmetrical bending reaches the web layer ───────────────────

describe('axial and unsymmetrical bending through the web boundary', () => {
  it('an equal-leg angle reports non-principal geometric axes', () => {
    const r = backed(resolveCanonicalSection(sec({ shape: 'L', h: 0.1, b: 0.1, t: 0.01 })));
    expect(Math.abs(r.properties.iyz)).toBeGreaterThan(1e-9);
    expect(Math.abs(Math.abs(r.properties.thetaP * 180 / Math.PI) - 45)).toBeLessThan(1e-6);

    const stress = analyzeSectionBending({ geometry: r.geometry, n: 0, my: 10, mz: 0 });
    // With Iyz != 0 and only My applied, the neutral axis must NOT lie on the
    // geometric y-axis. That is precisely what the old reduced formula got
    // wrong for every angle.
    expect(Math.abs(stress.neutralAxis.angle)).toBeGreaterThan(1e-3);
    expect(stress.neutralAxis.uniform).toBe(false);
  });

  it('a rectangle under pure axial load has uniform stress and no neutral axis', () => {
    const r = backed(resolveCanonicalSection(sec({ shape: 'rect', b: 0.2, h: 0.4 })));
    const stress = analyzeSectionBending({ geometry: r.geometry, n: 200, my: 0, mz: 0 });
    expect(stress.neutralAxis.uniform).toBe(true);
    for (const p of stress.boundary) expect(rel(p.sigma, 200 / 0.08)).toBeLessThan(1e-12);
  });

  it('uniaxial bending on a rectangle reproduces M c / I', () => {
    const r = backed(resolveCanonicalSection(sec({ shape: 'rect', b: 0.2, h: 0.4 })));
    const stress = analyzeSectionBending({ geometry: r.geometry, n: 0, my: 50, mz: 0 });
    const iy = (0.2 * 0.4 ** 3) / 12;
    expect(rel(stress.max.sigma, (50 * 0.2) / iy)).toBeLessThan(1e-12);
    expect(rel(stress.min.sigma, -(50 * 0.2) / iy)).toBeLessThan(1e-12);
  });

  it('reversing every resultant negates the field', () => {
    const r = backed(resolveCanonicalSection(fromCatalogue('IPE 300')));
    const a = analyzeSectionBending({ geometry: r.geometry, n: 100, my: 50, mz: -20 });
    const b = analyzeSectionBending({ geometry: r.geometry, n: -100, my: -50, mz: 20 });
    expect(rel(a.max.sigma, -b.min.sigma)).toBeLessThan(1e-12);
  });

  it('the resultants used are echoed for traceability', () => {
    const r = backed(resolveCanonicalSection(fromCatalogue('IPE 300')));
    const stress = analyzeSectionBending({ geometry: r.geometry, n: 7, my: 11, mz: 13 });
    expect(stress.forces).toEqual({ n: 7, my: 11, mz: 13 });
  });
});

// ─── Custom geometry ───────────────────────────────────────────────

describe('custom geometry is canonical by definition', () => {
  it('an explicit polygon with a hole resolves and subtracts the void', () => {
    const r = backed(
      resolveCanonicalSection(
        sec({
          name: 'Custom box',
          polygon: [[0, 0], [0.2, 0], [0.2, 0.3], [0, 0.3]],
          holes: [[[0.05, 0.06], [0.15, 0.06], [0.15, 0.2], [0.05, 0.2]]],
        }),
      ),
    );
    expect(rel(r.properties.a, 0.2 * 0.3 - 0.1 * 0.14)).toBeLessThan(1e-12);
    expect(r.geometry.polygons.filter((p) => p.isVoid).length).toBe(1);
  });

  it('an explicit polygon wins over any name that looks like a catalogue profile', () => {
    // The name-inference defect, made impossible: this section is called
    // "IPE 300" but its geometry is a plain rectangle, and the geometry wins.
    const r = backed(
      resolveCanonicalSection(
        sec({ name: 'IPE 300', polygon: [[0, 0], [0.1, 0], [0.1, 0.1], [0, 0.1]] }),
      ),
    );
    expect(rel(r.properties.a, 0.01)).toBeLessThan(1e-12);
  });
});

// ─── The refusal must say something true ───────────────────────────

/**
 * A user opened a model carrying an IPN 300 and was told the section was
 * "amorfa (sin forma geométrica definida)". An IPN 300 is neither: it is a
 * fully standardised rolled profile whose flange taper and fillet radii we do
 * not hold. The refusal reason is what the panel selects its wording from, so
 * the distinction is pinned here rather than left to the component.
 */
describe('a properties-only refusal distinguishes a data gap from a shapeless section', () => {
  const dataGap: Array<[string, string]> = [
    ['IPN 300', 'missingTaperAndRadii'],
    ['UPN 200', 'missingTaperAndRadii'],
    ['L 100x100x10', 'missingRootRadius'],
    ['RHS 100x50x4', 'missingCornerRadii'],
  ];

  for (const [name, kind] of dataGap) {
    it(`${name} reports ${kind}, never noGeometry`, () => {
      const r = resolveCanonicalSection(fromCatalogue(name));
      expect(r.state).toBe('properties-only');
      if (r.state !== 'properties-only') return;
      expect(r.reason.kind).toBe(kind);
      // The panel keys the "amorphous" wording off this exact value.
      expect(r.reason.kind).not.toBe('noGeometry');
    });
  }

  it('only a section with no shape and no polygon is genuinely shapeless', () => {
    const r = resolveCanonicalSection({ id: 9, name: 'Losa equivalente', a: 0.01, iz: 1e-5 } as Section);
    expect(r.state).toBe('properties-only');
    if (r.state !== 'properties-only') return;
    expect(r.reason.kind).toBe('noGeometry');
  });
});
