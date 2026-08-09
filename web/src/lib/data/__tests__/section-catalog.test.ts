/**
 * Catalogue organisation: design codes index families, they do not own them.
 *
 * The trap this guards is the tempting one — labelling the shipped European
 * families "CIRSOC" so the picker looks complete. That reads fine until a
 * second code is added and it turns out no family was ever really owned by the
 * first. Worse, it tells an Argentine user their IPE 300 came from a local
 * table when it did not.
 */

import { describe, it, expect } from 'vitest';
import {
  FAMILY_CLASSIFICATION, DESIGN_CODES, ALL_FAMILIES,
  familiesForCode, groupBySeries, classifyFamily, designCode,
} from '../section-catalog';
import { ALL_PROFILES } from '../steel-profiles';

describe('every shipped family is classified, and by a real standard', () => {
  it('covers exactly the families that have profiles', () => {
    const shipped = new Set(ALL_PROFILES.map((p) => p.family));
    expect(new Set(ALL_FAMILIES)).toEqual(shipped);
    for (const f of shipped) expect(classifyFamily(f), f).toBeDefined();
  });

  it('names a specific dimensional standard, never a placeholder', () => {
    for (const c of Object.values(FAMILY_CLASSIFICATION)) {
      // "Euronorm" was the old placeholder — a family of standards, not one.
      expect(c.standard, c.family).not.toBe('Euronorm');
      expect(c.standard.length, c.family).toBeGreaterThan(3);
    }
  });

  it('records which families can be drawn exactly and which cannot', () => {
    // This is what the picker marks, so it has to match the engine's reality.
    const approximate = Object.values(FAMILY_CLASSIFICATION)
      .filter((c) => c.fidelity === 'propertiesOnly')
      .map((c) => c.family);
    // No family is properties-only: every one has an outline. W is the only
    // one whose outline does not reproduce the published properties, and that
    // is a separate, weaker claim tracked as `nominalDimensions`.
    expect(approximate).toEqual([]);
    const nominal = Object.values(FAMILY_CLASSIFICATION)
      .filter((c) => c.fidelity === 'nominalDimensions')
      .map((c) => c.family);
    expect(nominal).toEqual(['W']);
  });
});

describe('design codes are an index over families, not a relabelling', () => {
  it('every code references only families that exist', () => {
    for (const code of DESIGN_CODES) {
      expect(code.families.length, code.id).toBeGreaterThan(0);
      for (const f of code.families) {
        expect(ALL_FAMILIES, `${code.id} → ${f}`).toContain(f);
      }
    }
  });

  it('CIRSOC 301 claims only the families whose shipped dimensions it really uses', () => {
    const cirsoc = designCode('cirsoc-301')!;
    // IPN and UPN are the DIN 1025 "normal" series Argentine tables carry, so
    // they are honestly usable. IPE/HEA/HEB are European sections and must NOT
    // be presented as Argentine.
    expect(cirsoc.families).toContain('IPN');
    expect(cirsoc.families).toContain('UPN');
    // The tubes are IRAM-IAS tables, so they belong to it outright.
    for (const tube of ['CHS', 'RHS', 'SHS']) expect(cirsoc.families).toContain(tube);
    for (const european of ['IPE', 'HEA', 'HEB']) {
      expect(cirsoc.families, european).not.toContain(european);
    }
  });

  it('says what it is missing rather than implying the list is complete', () => {
    const cirsoc = designCode('cirsoc-301')!;
    expect(cirsoc.missingFamilies?.length).toBeGreaterThan(0);
    // The American channel series is the big one local practice uses and we do
    // not ship; if it gets added, update this deliberately.
    expect(cirsoc.missingFamilies!.join(' ')).toMatch(/canal americano/);
    // W is shipped now, so it must NOT still be advertised as missing.
    expect(cirsoc.families).toContain('W');
  });

  it('a family carries its own standard regardless of which code lists it', () => {
    // IPN appears under both CIRSOC 301 and Eurocode 3; its standard is a
    // property of the family, so it cannot differ per code.
    const codes = DESIGN_CODES.filter((c) => c.families.includes('IPN'));
    expect(codes.length).toBeGreaterThan(1);
    expect(classifyFamily('IPN')!.standard).toBe('DIN 1025-1');
  });
});

describe('the picker never ends up with nothing to show', () => {
  it('no filter yields every family', () => {
    expect(familiesForCode(null)).toEqual(ALL_FAMILIES);
  });

  it('an unknown code over-offers instead of emptying the picker', () => {
    expect(familiesForCode('does-not-exist')).toEqual(ALL_FAMILIES);
  });

  it('every code yields a non-empty, fully grouped family list', () => {
    for (const code of DESIGN_CODES) {
      const fams = familiesForCode(code.id);
      expect(fams.length, code.id).toBeGreaterThan(0);
      const grouped = groupBySeries(fams).flatMap((g) => g.families);
      // Grouping must not drop or duplicate a family.
      expect(new Set(grouped)).toEqual(new Set(fams));
      expect(grouped.length).toBe(fams.length);
    }
  });

  it('every family in a group really belongs to that series', () => {
    for (const g of groupBySeries(ALL_FAMILIES)) {
      for (const f of g.families) {
        expect(classifyFamily(f)!.series, f).toBe(g.series);
      }
    }
  });
});
