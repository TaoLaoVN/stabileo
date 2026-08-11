/**
 * Integrity of the multi-code grade database.
 *
 * A materials table fails quietly: a transposed digit produces a member that
 * is merely wrong, not one that errors, and nothing downstream can tell. So
 * what is pinned here is the physics that must hold of ANY grade — fu above
 * fy, strength falling with thickness, moduli in the right band — rather than
 * a restatement of the numbers, which would only test that the file equals
 * itself.
 */

import { describe, it, expect } from 'vitest';
import {
  ALL_GRADES,
  MATERIAL_DESIGN_CODES,
  HOT_ROLLED,
  ALUMINIUM,
  STAINLESS,
  gradesForFamily,
  codesForFamily,
  gradeById,
  strengthAtThickness,
  searchGrades,
  gradesForMode,
  codesForMode,
  defaultCodeFor,
  gradesForCode,
  type GradeFamily,
} from '../structural-grades';

const FAMILIES: GradeFamily[] = ['hot-rolled', 'cold-formed', 'aluminium', 'stainless'];

describe('every grade is physically coherent', () => {
  it('has a unique id', () => {
    const ids = ALL_GRADES.map((g) => g.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('reaches its ultimate strength above its yield strength', () => {
    // Not a formality: fu <= fy would mean a material that ruptures before it
    // yields, and every code's ductility check divides by the gap.
    const bad = ALL_GRADES.filter((g) => !(g.fu > g.fy));
    expect(bad.map((g) => g.designation)).toEqual([]);
  });

  it('carries a positive modulus, density and Poisson ratio below one half', () => {
    for (const g of ALL_GRADES) {
      expect(g.e, g.designation).toBeGreaterThan(0);
      expect(g.rho, g.designation).toBeGreaterThan(0);
      // At nu = 0.5 the bulk modulus is infinite: no structural metal is there.
      expect(g.nu, g.designation).toBeGreaterThan(0);
      expect(g.nu, g.designation).toBeLessThan(0.5);
    }
  });

  it('names the product standard that fixes its values', () => {
    // The whole point of the table: a number without a source cannot be
    // checked, and a grade without a standard cannot be specified.
    const unsourced = ALL_GRADES.filter((g) => !g.productStandard.trim());
    expect(unsourced.map((g) => g.id)).toEqual([]);
  });
});

describe('the families are distinguishable by their physics', () => {
  it('aluminium has about a third of steel’s modulus', () => {
    // The reason aluminium structures are governed by deflection: same load,
    // three times the movement.
    for (const g of ALUMINIUM) {
      expect(g.e, g.designation).toBeGreaterThan(60000);
      expect(g.e, g.designation).toBeLessThan(80000);
    }
    for (const g of HOT_ROLLED) {
      expect(g.e, g.designation).toBeGreaterThanOrEqual(200000);
      expect(g.e, g.designation).toBeLessThanOrEqual(210000);
    }
  });

  it('stainless is denser than carbon steel', () => {
    const maxCarbon = Math.max(...HOT_ROLLED.map((g) => g.rho));
    // Austenitics run near 7900 kg/m³ against carbon steel's 7850.
    expect(Math.max(...STAINLESS.map((g) => g.rho))).toBeGreaterThanOrEqual(maxCarbon);
  });

  it('EN grades use 210 GPa and ASTM grades 200 GPa, as their codes state', () => {
    // A real difference between standards, not a rounding: it moves every
    // deflection by 5%.
    const en = HOT_ROLLED.filter((g) => g.productStandard.startsWith('EN 10025'));
    const astm = HOT_ROLLED.filter((g) => g.productStandard.startsWith('ASTM'));
    expect(en.length).toBeGreaterThan(0);
    expect(astm.length).toBeGreaterThan(0);
    expect(en.every((g) => g.e === 210000)).toBe(true);
    expect(astm.every((g) => g.e === 200000)).toBe(true);
  });
});

describe('strength falls with thickness where the standard says so', () => {
  it('S355 is 355 MPa thin and 335 MPa thick', () => {
    const s355 = gradeById('en-s355');
    if (!s355) throw new Error('en-s355 missing');
    expect(strengthAtThickness(s355, 20).fy).toBe(355);
    expect(strengthAtThickness(s355, 40).fy).toBe(355); // band is inclusive at its top
    expect(strengthAtThickness(s355, 60).fy).toBe(335);
  });

  it('beyond the tabulated range it holds the THICK value and says so', () => {
    // The unconservative failure would be to fall back to the headline (thin)
    // value out of range. Flagging the extrapolation lets a caller refuse.
    const s355 = gradeById('en-s355');
    if (!s355) throw new Error('en-s355 missing');
    const r = strengthAtThickness(s355, 150);
    expect(r.fy).toBe(335);
    expect(r.extrapolated).toBe(true);
  });

  it('bands never increase with thickness, and never overlap', () => {
    for (const g of ALL_GRADES) {
      const bands = g.byThickness;
      if (!bands) continue;
      for (let i = 1; i < bands.length; i++) {
        expect(bands[i].fy, g.designation).toBeLessThanOrEqual(bands[i - 1].fy);
        expect(bands[i].overMm, g.designation).toBe(bands[i - 1].upToMm);
      }
      // The headline value is the thin one, so a caller ignoring thickness is
      // wrong in the known direction rather than in an arbitrary one.
      expect(g.fy, g.designation).toBe(bands[0].fy);
    }
  });

  it('a grade with no bands returns its headline values at any thickness', () => {
    const a36 = gradeById('astm-a36');
    if (!a36) throw new Error('astm-a36 missing');
    expect(strengthAtThickness(a36, 5)).toEqual({ fy: 250, fu: 400, extrapolated: false });
    expect(strengthAtThickness(a36, 90)).toEqual({ fy: 250, fu: 400, extrapolated: false });
  });
});

describe('grades and design codes are independent axes', () => {
  it('every family has both grades and at least one code', () => {
    for (const f of FAMILIES) {
      expect(gradesForFamily(f).length, f).toBeGreaterThan(0);
      expect(codesForFamily(f).length, f).toBeGreaterThan(0);
    }
  });

  it('every family is covered by codes from more than one region', () => {
    // The requirement that motivated the table: not CIRSOC-only.
    for (const f of FAMILIES) {
      const regions = new Set(codesForFamily(f).map((c) => c.region));
      expect(regions.size, f).toBeGreaterThan(1);
    }
  });

  it('a code never claims a family that has no grades', () => {
    for (const c of MATERIAL_DESIGN_CODES) {
      for (const f of c.families) {
        expect(gradesForFamily(f).length, `${c.name} / ${f}`).toBeGreaterThan(0);
      }
    }
  });

  it('code ids are unique', () => {
    const ids = MATERIAL_DESIGN_CODES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('search', () => {
  it('finds a grade by its designation, its standard, or its note', () => {
    expect(searchGrades('S355').some((g) => g.id === 'en-s355')).toBe(true);
    expect(searchGrades('NBR 7007').every((g) => g.productStandard.includes('NBR 7007'))).toBe(true);
    expect(searchGrades('weathering').some((g) => g.id === 'astm-a588')).toBe(true);
  });

  it('is case-insensitive and confined to the requested family', () => {
    const r = searchGrades('a', 'aluminium');
    expect(r.length).toBeGreaterThan(0);
    expect(r.every((g) => g.family === 'aluminium')).toBe(true);
  });

  it('returns the whole family for an empty query', () => {
    expect(searchGrades('   ', 'stainless')).toEqual(gradesForFamily('stainless'));
  });
});

/**
 * The profile catalogue keeps its own view of design codes — which dimensional
 * families each one ships. This one keeps which metal families each one covers.
 * Same codes, two projections, joined by id.
 *
 * They are not merged, because neither list has an opinion about the other's
 * axis. But they must not DISAGREE, and nothing structural stops them drifting:
 * the ids are plain strings in two files that no import connects.
 */
describe('the two views of a design code agree where they overlap', () => {
  it('an id shared with the profile catalogue names the same region', async () => {
    const { DESIGN_CODES: PROFILE_CODES } = await import('../section-catalog');
    const shared = PROFILE_CODES
      .map((p) => ({ p, m: MATERIAL_DESIGN_CODES.find((m) => m.id === p.id) }))
      .filter((x) => x.m);

    // If this drops to zero the test is vacuous, which is worth catching:
    // it would mean the ids were renamed apart rather than kept in step.
    expect(shared.length).toBeGreaterThan(0);
    for (const { p, m } of shared) {
      expect(m!.region, p.id).toBe(p.region);
    }
  });
});

/**
 * Mode gating and the code association.
 *
 * Basic ships European and American grades; PRO adds the rest. The gate lives
 * in the query rather than in a second database, so what is pinned here is that
 * the gate actually bites AND that nothing is lost behind it — a filter that
 * silently dropped Argentine grades would look identical to a working one until
 * someone went looking for F-24.
 */
describe('what Basic offers versus PRO', () => {
  it('Basic keeps European, American and Argentine grades, and hides the rest', () => {
    const basic = gradesForMode(ALL_GRADES, false);
    const regions = new Set(basic.map((g) => g.region));
    expect([...regions].sort()).toEqual(['AR', 'EU', 'US']);
    // CIRSOC is the default, so its own grades must survive the Basic filter.
    expect(basic.some((g) => g.id === 'iram-f24')).toBe(true);
  });

  it('PRO adds regions Basic withholds, without losing any', () => {
    const basic = gradesForMode(ALL_GRADES, false);
    const pro = gradesForMode(ALL_GRADES, true);
    expect(pro.length).toBe(ALL_GRADES.length);
    expect(pro.length).toBeGreaterThan(basic.length);
    // Nothing visible in Basic may vanish in PRO.
    for (const g of basic) expect(pro).toContain(g);
    // And the withheld ones are genuinely there, not absent from the database.
    expect(pro.some((g) => g.region === 'BR')).toBe(true);
  });

  it('Basic still offers a code for every family', () => {
    // The failure this guards: gating regions so hard that a family is left
    // with no design code, which would render an empty picker.
    for (const f of FAMILIES) {
      const codes = codesForMode(codesForFamily(f), false);
      expect(codes.length, f).toBeGreaterThan(0);
    }
  });
});

describe('the picker defaults to CIRSOC', () => {
  it('chooses CIRSOC for the families it covers', () => {
    expect(defaultCodeFor('hot-rolled')?.id).toBe('cirsoc-301');
    expect(defaultCodeFor('cold-formed')?.id).toBe('cirsoc-303');
    expect(defaultCodeFor('aluminium')?.id).toBe('cirsoc-701');
  });

  it('falls back to a real code where CIRSOC has none, rather than nothing', () => {
    // There is no Argentine stainless code, and an empty default would open the
    // picker on a blank selection.
    const d = defaultCodeFor('stainless');
    expect(d).toBeDefined();
    expect(d!.families).toContain('stainless');
  });

  it('CIRSOC surfaces both IRAM and ASTM steels, because local practice uses both', () => {
    const cirsoc = MATERIAL_DESIGN_CODES.find((c) => c.id === 'cirsoc-301')!;
    const grades = gradesForCode(cirsoc, 'hot-rolled');
    expect(grades.some((g) => g.region === 'AR')).toBe(true);
    expect(grades.some((g) => g.region === 'US')).toBe(true);
    // ...and it does not sweep in European grades it has no tables for.
    expect(grades.some((g) => g.region === 'EU')).toBe(false);
  });

  it('a code with no matching grades returns the family rather than an empty list', () => {
    // An empty picker reads as broken. The association is a convenience for
    // finding grades, not a rule about which are permitted.
    const fake = { ...MATERIAL_DESIGN_CODES[0], gradeRegions: [] as never[] };
    expect(gradesForCode(fake, 'hot-rolled').length).toBe(gradesForFamily('hot-rolled').length);
  });
});
