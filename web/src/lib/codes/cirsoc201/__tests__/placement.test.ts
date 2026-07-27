/**
 * Placement tolerance: the research result, and the distinction it forces.
 *
 * CIRSOC Table 26.6.2.1(a) prescribes tolerances for the effective depth and the cover. It
 * prescribes NONE for the transverse spacing between parallel bars. The 10 mm the detailing
 * engine has been using on clear spacing therefore has no clause behind it, and these tests
 * pin it as a visible project assumption rather than a code value.
 *
 * The separation matters because conflating the two vetoed arrangements the verifier had
 * already certified: a 28Ø12 column at 46.9 mm clear against a 40 mm requirement was refused
 * for being under 40 + 10.
 */
import { describe, it, expect } from 'vitest';
import {
  assessSpacing, prescribedTolerances, worstCaseEffectiveDepth,
  DEFAULT_PLACEMENT_POLICY, ASSUMED_SPACING_ALLOWANCE_M,
} from '../placement';
import { teAt } from '../../../i18n/engine-text';

describe('Table 26.6.2.1(a) — what CIRSOC does prescribe', () => {
  it('gives ±10 mm on d at or below the 200 mm band', () => {
    expect(prescribedTolerances(0.180, 0.030, '2025').depth).toBeCloseTo(0.010, 9);
  });

  it('gives ±15 mm on d above it', () => {
    expect(prescribedTolerances(0.560, 0.030, '2025').depth).toBeCloseTo(0.015, 9);
  });

  it('takes the LESSER of the flat limit and a third of the cover', () => {
    // 30 mm cover: a third is 10 mm, below the 15 mm flat limit for a deep member.
    expect(prescribedTolerances(0.560, 0.030, '2025').cover).toBeCloseTo(0.010, 9);
    // 60 mm cover: a third is 20 mm, so the 15 mm flat limit governs.
    expect(prescribedTolerances(0.560, 0.060, '2025').cover).toBeCloseTo(0.015, 9);
  });

  it('holds the bottom face to the stricter 5 mm of footnote [1]', () => {
    expect(prescribedTolerances(0.560, 0.030, '2025').bottomCover).toBeCloseTo(0.005, 9);
  });

  it('cites the table', () => {
    const refs = prescribedTolerances(0.5, 0.03, '2025').refs.map((r) => r.clause);
    expect(refs).toContain('Tabla 26.6.2.1(a)');
  });

  it('re-verification uses the unfavourable end of the d band', () => {
    const { d } = worstCaseEffectiveDepth(0.560, 0.030, '2025');
    expect(d).toBeCloseTo(0.545, 9);
  });
});

describe('code compliance and placement robustness are separate answers', () => {
  const CODE = 0.040;

  it('at exactly the code minimum: LEGAL but NOT robust', () => {
    // The combination the product must be able to express: keep the certificate, withhold
    // CONSTRUCTIBLE.
    const a = assessSpacing({ codeMinimum: CODE, achievedNominalClear: CODE });
    expect(a.codeLegal).toBe(true);
    expect(a.placementRobust).toBe(false);
    expect(a.worstCasePlacedClear).toBeCloseTo(CODE - ASSUMED_SPACING_ALLOWANCE_M, 9);
  });

  it('at the target: legal AND robust', () => {
    const a = assessSpacing({
      codeMinimum: CODE, achievedNominalClear: CODE + ASSUMED_SPACING_ALLOWANCE_M,
    });
    expect(a.codeLegal).toBe(true);
    expect(a.placementRobust).toBe(true);
  });

  it('below the minimum: neither', () => {
    const a = assessSpacing({ codeMinimum: CODE, achievedNominalClear: 0.035 });
    expect(a.codeLegal).toBe(false);
    expect(a.placementRobust).toBe(false);
  });

  it('the real 28Ø12 case stays code-legal', () => {
    // 46.9 mm against 40 mm. Legal, keeps its PR15 certificate, and is not robust under a
    // 10 mm allowance — which is a reason to withhold CONSTRUCTIBLE, never to refuse a cage.
    const a = assessSpacing({ codeMinimum: 0.040, achievedNominalClear: 0.0469 });
    expect(a.codeLegal).toBe(true);
    expect(a.placementRobust).toBe(false);
  });

  it('reports all seven fields', () => {
    const a = assessSpacing({ codeMinimum: CODE, achievedNominalClear: 0.055 });
    expect(Object.keys(a)).toEqual(expect.arrayContaining([
      'codeMinimum', 'achievedNominalClear', 'placementAllowance',
      'worstCasePlacedClear', 'codeLegal', 'placementRobust', 'targetNominalClear',
    ]));
  });
});

describe('the allowance is an assumption until the project states it', () => {
  it('flags the default as assumed, and says why, in both languages', () => {
    const a = assessSpacing({ codeMinimum: 0.040, achievedNominalClear: 0.040 });
    expect(a.allowanceIsAssumed).toBe(true);
    expect(a.assumption).toBeDefined();
    for (const locale of ['en', 'es']) {
      const text = teAt(a.assumption!, locale);
      expect(text).not.toBe(a.assumption!.key);
      // It must say plainly that CIRSOC does not set this.
      expect(text).toMatch(/CIRSOC/);
    }
  });

  it('drops the flag once the project has stated a value', () => {
    const a = assessSpacing({
      codeMinimum: 0.040, achievedNominalClear: 0.040,
      policy: { spacingAllowance: 0.005, stated: true },
    });
    expect(a.allowanceIsAssumed).toBe(false);
    expect(a.assumption).toBeUndefined();
    expect(a.worstCasePlacedClear).toBeCloseTo(0.035, 9);
  });

  it('a stated allowance of zero makes legal and robust coincide', () => {
    const a = assessSpacing({
      codeMinimum: 0.040, achievedNominalClear: 0.040,
      policy: { spacingAllowance: 0, stated: true },
    });
    expect(a.codeLegal).toBe(true);
    expect(a.placementRobust).toBe(true);
  });

  it('the default policy is the assumed one', () => {
    expect(DEFAULT_PLACEMENT_POLICY.stated).toBe(false);
    expect(DEFAULT_PLACEMENT_POLICY.spacingAllowance)
      .toBeCloseTo(ASSUMED_SPACING_ALLOWANCE_M, 9);
  });
});
