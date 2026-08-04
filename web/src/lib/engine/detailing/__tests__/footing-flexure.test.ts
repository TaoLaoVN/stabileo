import { describe, it, expect } from 'vitest';
import {
  MAX_SPACING_CAP_M, MIN_BOTTOM_MAT_DEPTH_M, barArea, designFootingMat,
  type FootingMatDesignInput,
} from '../footing-flexure';

/**
 * Bottom-mat flexural design, against the ENACTED CIRSOC 201-2025 Annex IV.
 *
 * The numerical fixture below is hand-checked, and hand-checked in a way that does not simply
 * restate the implementation: the moment is verified by two different expressions of the same
 * statics, and the steel area is closed back through φMn ≥ Mu instead of by re-running the
 * quadratic the code solves. A test that recomputes the code's own formula proves only that
 * the formula was typed twice.
 */

const DAGG = 20;

/** Ø16 both ways — the migration default, so the fixture is the ordinary case. */
const PREFS = {
  bottomMatDiameterXmm: 16,
  bottomMatDiameterYmm: 16,
  bottomMatSpacingPolicy: 'AUTO_CODE_COMPLIANT',
} as const;

/**
 * The reference footing: 2,00 × 2,00 × 0,50 m, 0,40 × 0,40 m column, N_u = 900 kN, centred.
 *
 * Same geometry and load as `run-footing-design.test.ts` uses, so the two files describe one
 * footing rather than two.
 */
const square = (over: Partial<FootingMatDesignInput> = {}): FootingMatDesignInput => ({
  B: 2.0, L: 2.0, thickness: 0.5, cover: 0.05,
  columnB: 0.4, columnH: 0.4,
  eccentricityB: 0, eccentricityL: 0,
  fc: 25, fy: 420,
  factoredAxial: 900,
  factoredMomentB: 0, factoredMomentL: 0,
  maxAggregateSizeMm: DAGG,
  edition: '2025',
  preferences: PREFS,
  ...over,
});

/** 1,50 × 3,00 m — β = 2 exactly, so γs = 2/3 is a number a reader can check by eye. */
const rectangular = (over: Partial<FootingMatDesignInput> = {}): FootingMatDesignInput =>
  square({ B: 1.5, L: 3.0, ...over });

const cm2 = (m2: number) => m2 * 1e4;

// ─── The hand-checked fixture ────────────────────────────────────

describe('footing bottom mat — hand-checked numerical fixture', () => {
  /**
   * Every intermediate value, derived by hand from the clauses:
   *
   *   A          = 2,00 × 2,00 = 4,00 m²
   *   q_u        = 900 / 4,00 = 225,0 kPa                       (uniform: no moment)
   *   cantilever = (2,00 − 0,40) / 2 = 0,800 m                   §13.2.7.1, column face
   *   M_u        = L·c²·(2q_face + q_edge)/6
   *              = 2,00 × 0,800² × (2×225 + 225)/6 = 144,0 kN·m  §13.2.6.6
   *   CROSS-CHECK, elementary statics on a uniform pressure:
   *              = q·c²/2 · L = 225 × 0,64/2 × 2,00 = 144,0 ✓    (two expressions, one answer)
   *   d          = 0,500 − 0,050 − 0,016/2 = 0,4420 m
   *   A_s,min    = 0,0018 A_g = 0,0018 × 2,00 × 0,500
   *              = 1,800e-3 m² = 18,00 cm²                       §7.6.1
   *   A_s,flex   = 8,7035e-4 m² = 8,704 cm²  ⇒ the MINIMUM GOVERNS
   *   s_max,gen  = min(3h, 300) = min(1500, 300) = 300 mm        §7.7.2.3
   *   c_c        = 50 + 16 = 66 mm            (this direction taken as the upper layer)
   *   s_max,24.3 = min(380·(280/280) − 2,5×66, 300) = 215 mm     §24.3.2 → GOVERNS
   *   s_min,clear= max(25, 16, (4/3)×20) = 26,67 mm              §25.2.1
   *   span       = 2,000 − 2×0,050 − 0,016 = 1,884 m
   *   n from A_s = ceil(1,800e-3 / 2,0106e-4) = ceil(8,95) = 9
   *   n from s   = 1 + ceil(1,884 / 0,215) = 1 + 9 = 10          ⇒ SPACING adds a bar
   *   n          = 10, s = 1,884/9 = 209,3 mm, clear = 193,3 mm
   *   A_s,prov   = 10 × 2,0106 = 20,106 cm²  ≥ 18,00 ✓
   */
  const r = designFootingMat(square());

  it('reproduces the hand-computed demand and depth in both directions', () => {
    expect(r.x.qFace).toBeCloseTo(225.0, 9);
    expect(r.x.qEdge).toBeCloseTo(225.0, 9);
    expect(r.x.cantilever).toBeCloseTo(0.8, 12);
    expect(r.x.Mu).toBeCloseTo(144.0, 9);
    expect(r.x.d).toBeCloseTo(0.442, 12);
    expect(r.y.Mu).toBeCloseTo(144.0, 9);
  });

  it('closes the flexural steel back through φMn, not through the same quadratic', () => {
    // Independent verification: take the A_s the design returned, form the stress block from
    // it and confirm the section develops the moment. If the quadratic were wrong this fails,
    // whereas restating the quadratic could not.
    const As = r.x.asFlexural;
    const a = (As * 420e3) / (0.85 * 25e3 * 2.0);   // a = As·fy / (α1·f'c·b)
    const phiMn = 0.9 * As * 420e3 * (r.x.d - a / 2);
    expect(phiMn).toBeCloseTo(144.0, 4);
    expect(cm2(As)).toBeCloseTo(8.704, 3);
  });

  it('applies §7.6.1 on the gross area, not the beam minimum', () => {
    // 0,0018 × A_g, A_g = width × h. The BEAM minimum would be
    // max(0,25√25/420, 1,4/420)·b·d = 1/300 × 2,00 × 0,442 = 29,5 cm², a different number
    // from a clause that does not apply to a footing mat.
    expect(cm2(r.x.asMinimum)).toBeCloseTo(18.0, 9);
    expect(r.x.governedBy).toBe('MINIMUM');
    expect(r.x.governingClause).toBe('7.6.1');
    expect(cm2(r.x.asGoverning)).toBeCloseTo(18.0, 9);
  });

  it('lands the hand-computed spacing limits and layout', () => {
    expect(r.x.spacing.generalMax).toBeCloseTo(0.3, 12);
    expect(r.x.spacing.crackControlCover).toBeCloseTo(0.066, 12);
    expect(r.x.spacing.crackControlMax).toBeCloseTo(0.215, 12);
    expect(r.x.spacing.governingMax).toBeCloseTo(0.215, 12);
    expect(r.x.spacing.governingMaxClause).toBe('24.3.2');
    expect(r.x.spacing.minClear).toBeCloseTo(26.666666666666668 / 1000, 12);

    expect(r.x.regions).toHaveLength(1);
    const reg = r.x.regions[0];
    expect(reg.barCount).toBe(10);
    expect(reg.spacingCentre * 1000).toBeCloseTo(209.333, 2);
    expect(reg.spacingClear * 1000).toBeCloseTo(193.333, 2);
    expect(cm2(reg.asProvided)).toBeCloseTo(20.106, 3);
  });

  it('reports the punching depth separately from the two flexural depths', () => {
    // h − cover − d_b, the AVERAGED two-layer convention, deliberately unchanged.
    expect(r.punchingD).toBeCloseTo(0.434, 12);
    expect(r.punchingD).not.toBeCloseTo(r.x.d, 4);
    expect(r.assumptions.map((a) => a.key)).toContain('footing.assumption.flexuralDepths');
  });
});

// ─── B, M: square footing ────────────────────────────────────────

describe('square footing', () => {
  it('produces symmetric demand and reinforcement when B=L and columnB=columnH (B)', () => {
    const r = designFootingMat(square());
    expect(r.x.Mu).toBeCloseTo(r.y.Mu, 12);
    expect(r.x.d).toBeCloseTo(r.y.d, 12);
    expect(r.x.asFlexural).toBeCloseTo(r.y.asFlexural, 12);
    expect(r.x.asGoverning).toBeCloseTo(r.y.asGoverning, 12);
    expect(r.x.barCount).toBe(r.y.barCount);
    expect(r.x.regions[0].spacingCentre).toBeCloseTo(r.y.regions[0].spacingCentre, 12);
  });

  it('distributes uniformly across the full width both ways, §13.3.3.2 (M)', () => {
    const r = designFootingMat(square());
    for (const dir of [r.x, r.y]) {
      expect(dir.distribution).toBe('UNIFORM_FULL_WIDTH');
      expect(dir.beta).toBeNull();
      expect(dir.gammaS).toBeNull();
      expect(dir.regions).toHaveLength(1);
      expect(dir.regions[0].kind).toBe('FULL_WIDTH');
      expect(dir.regions[0].width).toBeCloseTo(dir.distributionWidth, 12);
    }
    expect(designFootingMat(square()).refs.map((c) => c.clause)).toContain('13.3.3.2');
  });
});

// ─── C: axis mapping ─────────────────────────────────────────────

describe('rectangular footing axis mapping (C)', () => {
  const r = designFootingMat(rectangular({ columnB: 0.4, columnH: 0.6 }));

  it('maps B/columnB and the L distribution width onto direction X', () => {
    // X bars run parallel to B, span B, and are spread across L.
    expect(r.x.barsParallelTo).toBe('B');
    expect(r.x.cantilever).toBeCloseTo((1.5 - 0.4) / 2, 12);
    expect(r.x.distributionWidth).toBeCloseTo(3.0, 12);
  });

  it('maps L/columnH and the B distribution width onto direction Y', () => {
    expect(r.y.barsParallelTo).toBe('L');
    expect(r.y.cantilever).toBeCloseTo((3.0 - 0.6) / 2, 12);
    expect(r.y.distributionWidth).toBeCloseTo(1.5, 12);
  });

  it('does not let the two directions share a cantilever or a width', () => {
    // The defect this guards is the one-direction footing: designing X and copying it onto Y.
    expect(r.x.cantilever).not.toBeCloseTo(r.y.cantilever, 3);
    expect(r.x.distributionWidth).not.toBeCloseTo(r.y.distributionWidth, 3);
    expect(r.x.Mu).not.toBeCloseTo(r.y.Mu, 1);
  });
});

// ─── D: eccentric pressure, per direction ────────────────────────

describe('eccentric pressure integrates independently per direction (D)', () => {
  /**
   * M_B = 200 kN·m on the reference square, M_L = 0.
   *
   *   e   = 200/900 = 0,22222 m  <  B/6 = 0,33333 ✓ resultant inside the kern
   *   k   = 6e/B = 0,666667
   *   x_face = 2,000 − 0,800 = 1,200 m   (measured from the light edge)
   *   q_face = 225 (1 + 0,666667 (2×1,2/2,0 − 1)) = 225 × 1,133333 = 255,0 kPa
   *   q_edge = 225 (1 + 0,666667)                 = 375,0 kPa
   *   M_u,X  = 2,00 × 0,800² × (2×255 + 375)/6    = 188,8 kN·m
   */
  const r = designFootingMat(square({ factoredMomentB: 200 }));

  it('trapezoids only the axis the moment acts on', () => {
    expect(r.x.qFace).toBeCloseTo(255.0, 9);
    expect(r.x.qEdge).toBeCloseTo(375.0, 9);
    expect(r.x.Mu).toBeCloseTo(188.8, 9);
  });

  it('leaves the other direction at the uniform pressure', () => {
    expect(r.y.qFace).toBeCloseTo(225.0, 9);
    expect(r.y.qEdge).toBeCloseTo(225.0, 9);
    expect(r.y.Mu).toBeCloseTo(144.0, 9);
  });

  it('refuses to design through a resultant outside the kern', () => {
    // e = 400/900 = 0,4444 m > B/6 = 0,3333: the base lifts and the linear distribution is
    // invalid. Designing anyway would reinforce for a pressure the soil is not delivering,
    // and the linear q under-states the peak — the wrong direction to be wrong in.
    const up = designFootingMat(square({ factoredMomentB: 400 }));
    expect(up.x.status).toBe('NOT_EVALUATED');
    expect(up.x.regions).toEqual([]);
    expect(up.x.failures.map((f) => f.key)).toEqual(['footing.mat.upliftNotEvaluated']);
    // The unaffected direction is still designed: one bad axis does not void the other.
    expect(up.y.status).toBe('DESIGNED');
    expect(up.status).toBe('NOT_EVALUATED');
  });
});

// ─── E: the selected diameter really is the design input ─────────

describe('the selected diameter changes the design (E)', () => {
  const base = designFootingMat(square());
  const thick = designFootingMat(square({
    preferences: { ...PREFS, bottomMatDiameterXmm: 25 },
  }));

  it('moves the flexural depth of the direction it belongs to', () => {
    // d = h − cover − d_b/2 = 0,500 − 0,050 − 0,0125 = 0,4375 m
    expect(thick.x.d).toBeCloseTo(0.4375, 12);
    expect(thick.x.d).toBeLessThan(base.x.d);
  });

  it('moves that direction\'s required steel and layout', () => {
    expect(thick.x.asFlexural).toBeGreaterThan(base.x.asFlexural);   // shallower ⇒ more steel
    expect(thick.x.diameterMm).toBe(25);
    expect(thick.x.regions[0].spacingCentre).not.toBeCloseTo(base.x.regions[0].spacingCentre, 6);
  });

  it('leaves the other direction alone', () => {
    expect(thick.y.d).toBeCloseTo(base.y.d, 12);
    expect(thick.y.diameterMm).toBe(16);
    expect(thick.y.asFlexural).toBeCloseTo(base.y.asFlexural, 12);
  });
});

// ─── F, G: which requirement governs ─────────────────────────────

describe('minimum versus flexural strength', () => {
  it('lets the code minimum govern at low demand (F)', () => {
    // The reference footing: 8,70 cm² from strength, 18,00 cm² from §7.6.1.
    const r = designFootingMat(square());
    expect(r.x.asFlexural).toBeLessThan(r.x.asMinimum);
    expect(r.x.governedBy).toBe('MINIMUM');
    expect(r.x.asGoverning).toBeCloseTo(r.x.asMinimum, 12);
  });

  it('lets flexural strength govern at higher demand (G)', () => {
    /**
     * The 1,50 × 3,00 footing's LONG direction, from the same N_u = 900 kN:
     *
     *   q_u    = 900 / 4,50 = 200,0 kPa
     *   c      = (3,00 − 0,40)/2 = 1,300 m
     *   M_u,Y  = 1,50 × 1,300² × (3×200)/6 = 253,5 kN·m
     *   A_s    = 1,5532e-3 m² = 15,53 cm²   (φMn closure below)
     *   A_s,min= 0,0018 × 1,50 × 0,500 = 1,350e-3 m² = 13,50 cm²  ⇒ FLEXURE governs
     */
    const r = designFootingMat(rectangular());
    expect(r.y.Mu).toBeCloseTo(253.5, 9);
    expect(cm2(r.y.asFlexural)).toBeCloseTo(15.532, 2);
    expect(cm2(r.y.asMinimum)).toBeCloseTo(13.5, 9);
    expect(r.y.governedBy).toBe('FLEXURE');
    expect(r.y.governingClause).toBe('7.5.1.1');

    // Same independent closure as the fixture: φMn from the returned steel reproduces M_u.
    const a = (r.y.asFlexural * 420e3) / (0.85 * 25e3 * 1.5);
    expect(0.9 * r.y.asFlexural * 420e3 * (r.y.d - a / 2)).toBeCloseTo(253.5, 3);
  });

  it('refuses a section that would need compression steel instead of designing one', () => {
    // A pad footing is singly reinforced by construction. Reaching for A's means the section
    // is too thin, and the answer is a thicker footing.
    const r = designFootingMat(square({ thickness: 0.25, factoredAxial: 6000 }));
    expect(r.x.status).toBe('DESIGN_FAILED');
    expect(r.x.failures.map((f) => f.key)).toContain('footing.mat.needsCompressionSteel');
  });
});

// ─── H: §7.7.2.3 is 300 mm, not the draft's 450 ──────────────────

describe('§7.7.2.3 maximum spacing (H)', () => {
  it('caps at 300 mm and never at the 2024 draft\'s 450 mm', () => {
    // The enacted Annex IV reads "el menor entre 3h y 300 mm". 450 mm belongs to §7.7.2.4,
    // which is the shrinkage-and-temperature rule and a different requirement entirely.
    expect(MAX_SPACING_CAP_M).toBe(0.3);
    const r = designFootingMat(square());          // 3h = 1500 mm, so the cap governs
    expect(r.x.spacing.generalMax).toBe(0.3);
    expect(r.x.spacing.generalMax).not.toBe(0.45);
    expect(r.x.spacing.governingMax).toBeLessThanOrEqual(0.3);
    for (const reg of [...r.x.regions, ...r.y.regions]) {
      expect(reg.spacingCentre).toBeLessThanOrEqual(0.3);
      expect(reg.spacingCentre).toBeLessThan(0.45);
    }
  });

  it('takes 3h when 3h is the smaller of the two', () => {
    // h = 0,080 m ⇒ 3h = 240 mm < 300 mm.
    const r = designFootingMat(square({ thickness: 0.08 }));
    expect(r.x.spacing.generalMax).toBeCloseTo(0.24, 12);
  });

  it('enforces §13.3.1.2\'s 150 mm least effective depth', () => {
    expect(MIN_BOTTOM_MAT_DEPTH_M).toBe(0.15);
    const r = designFootingMat(square({ thickness: 0.08 }));
    expect(r.x.d).toBeCloseTo(0.022, 12);
    expect(r.x.meetsMinimumDepth).toBe(false);
    expect(r.x.failures.map((f) => f.key)).toContain('footing.mat.depthBelowMinimum');
    expect(r.x.status).toBe('DESIGN_FAILED');
  });
});

// ─── I: the most restrictive maximum governs ─────────────────────

describe('the governing maximum spacing is the most restrictive applicable one (I)', () => {
  it('lets §24.3 crack control beat the general 3h/300 limit', () => {
    // cc = 50 + 16 = 66 mm ⇒ 380 − 2,5×66 = 215 mm, against the general 300 mm.
    const r = designFootingMat(square());
    expect(r.x.spacing.crackControlMax).toBeCloseTo(0.215, 12);
    expect(r.x.spacing.crackControlMax).toBeLessThan(r.x.spacing.generalMax);
    expect(r.x.spacing.governingMax).toBeCloseTo(0.215, 12);
    expect(r.x.spacing.governingMaxClause).toBe('24.3.2');
  });

  it('lets the general limit govern when thin cover makes crack control permissive', () => {
    // cover 20 mm with Ø10 the other way ⇒ cc = 30 mm, so 380 − 75 = 305 mm and the
    // 300·(280/fs) cap holds at 300 mm; h = 0,080 m puts 3h at 240 mm, which then governs.
    const r = designFootingMat(square({
      thickness: 0.08, cover: 0.02,
      preferences: { ...PREFS, bottomMatDiameterXmm: 10, bottomMatDiameterYmm: 10 },
    }));
    expect(r.x.spacing.crackControlMax).toBeCloseTo(0.3, 12);
    expect(r.x.spacing.generalMax).toBeCloseTo(0.24, 12);
    expect(r.x.spacing.governingMax).toBeCloseTo(0.24, 12);
    expect(r.x.spacing.governingMaxClause).toBe('7.7.2.3');
  });

  it('cites both maxima and both spacing routes, once each', () => {
    const clauses = designFootingMat(square()).refs.map((c) => c.clause);
    for (const c of ['7.7.2.1', '7.7.2.2', '7.7.2.3', '24.3.2', '25.2.1', '13.2.7.1', '7.6.1']) {
      expect(clauses).toContain(c);
    }
    // Deduplicated by what they cite: both directions produce §24.3.2 as separate objects.
    expect(clauses.filter((c) => c === '24.3.2')).toHaveLength(1);
  });
});

// ─── J, K, L: the layout rules ───────────────────────────────────

describe('bar count and spacing (J, K, L)', () => {
  it('never lets the clear spacing fall below §25.2.1 (J)', () => {
    for (const input of [square(), rectangular(), square({ factoredMomentB: 200 })]) {
      const r = designFootingMat(input);
      for (const dir of [r.x, r.y]) {
        for (const reg of dir.regions) {
          expect(reg.spacingClear).toBeGreaterThanOrEqual(dir.spacing.minClear);
        }
      }
    }
  });

  it('never provides less steel than the governing requirement (K)', () => {
    for (const input of [square(), rectangular(), square({ factoredMomentB: 200 }),
      square({ preferences: { ...PREFS, bottomMatDiameterXmm: 25 } })]) {
      const r = designFootingMat(input);
      for (const dir of [r.x, r.y]) {
        if (dir.status !== 'DESIGNED') continue;
        // Per region — the integer count is chosen region by region…
        for (const reg of dir.regions) {
          expect(reg.asProvided).toBeGreaterThanOrEqual(reg.asRequired);
          expect(reg.barCount).toBeGreaterThanOrEqual(1);
          expect(Number.isInteger(reg.barCount)).toBe(true);
        }
        // …and across the direction, which is what the clause requires overall.
        expect(dir.asProvided).toBeGreaterThanOrEqual(dir.asGoverning);
      }
    }
  });

  it('returns a structured failure when the selected diameter admits no layout (L)', () => {
    /**
     * 0,60 × 0,60 m in plan and 6,00 m thick, at Ø32. Absurd as a footing and exact as a test
     * of the bound: §7.6.1 asks for 0,0018 × 0,60 × 6,00 = 6,48e-3 m², i.e. ceil(8,06) = 9
     * bars of Ø32, while §25.2.1's 32 mm clear distance leaves room for only
     * floor(0,468 / 0,064) + 1 = 8 across the 0,468 m placeable span.
     */
    const r = designFootingMat(square({
      B: 0.6, L: 0.6, thickness: 6.0, columnB: 0.2, columnH: 0.2,
      preferences: { ...PREFS, bottomMatDiameterXmm: 32, bottomMatDiameterYmm: 32 },
    }));
    expect(r.x.status).toBe('DESIGN_FAILED');
    expect(r.status).toBe('DESIGN_FAILED');
    // No region was emitted, so nothing reads as an acceptable layout…
    expect(r.x.regions).toEqual([]);
    const failure = r.x.failures.find((f) => f.key === 'footing.mat.noFeasibleLayout');
    expect(failure).toBeDefined();
    expect(failure!.params).toMatchObject({ diameter: 32, reason: 'minClear' });
    // …and the diameter the engineer chose was NOT quietly changed to one that would fit.
    expect(r.x.diameterMm).toBe(32);
  });

  it('adds bars when the maximum spacing asks for more than the area does', () => {
    // The reference footing: 9 bars satisfy the area, 10 are needed for the 215 mm limit.
    const r = designFootingMat(square());
    const needed = Math.ceil(r.x.asGoverning / barArea(16));
    expect(needed).toBe(9);
    expect(r.x.regions[0].barCount).toBe(10);
  });
});

// ─── N: §13.3.3.3 rectangular distribution ───────────────────────

describe('rectangular footing distribution, §13.3.3.3 (N)', () => {
  const r = designFootingMat(rectangular());

  it('bands the SHORT-direction reinforcement and leaves the long one uniform', () => {
    // X bars run parallel to B = 1,50 m, the short side, so X is the short-direction
    // reinforcement §13.3.3.3 (b) bands. Y runs parallel to the long side: (a), uniform.
    expect(r.x.distribution).toBe('BANDED_SHORT_DIRECTION');
    expect(r.y.distribution).toBe('UNIFORM_FULL_WIDTH');
    expect(r.y.regions).toHaveLength(1);
    expect(r.y.regions[0].kind).toBe('FULL_WIDTH');
  });

  it('uses γs = 2/(β+1) with β the long/short ratio', () => {
    expect(r.x.beta).toBeCloseTo(2.0, 12);
    expect(r.x.gammaS).toBeCloseTo(2 / 3, 12);
  });

  it('puts a band as wide as the SHORT side, centred on the column axis', () => {
    const band = r.x.regions.find((g) => g.kind === 'CENTRAL_BAND')!;
    expect(band.width).toBeCloseTo(1.5, 12);       // = min(B, L)
    expect(band.centreOffset).toBeCloseTo(0, 12);  // centred column
    const outside = r.x.regions.filter((g) => g.kind === 'OUTSIDE_BAND');
    expect(outside).toHaveLength(2);
    for (const o of outside) expect(o.width).toBeCloseTo(0.75, 12);
    // The three regions tile the distribution width exactly — no steel is lost or double-laid.
    expect(r.x.regions.reduce((s, g) => s + g.width, 0)).toBeCloseTo(3.0, 12);
  });

  it('allocates γs·As inside the band and (1−γs)·As outside it', () => {
    const gov = r.x.asGoverning;
    const band = r.x.regions.find((g) => g.kind === 'CENTRAL_BAND')!;
    const outside = r.x.regions.filter((g) => g.kind === 'OUTSIDE_BAND');
    expect(band.distributionShare).toBeCloseTo((2 / 3) * gov, 12);
    expect(outside.reduce((s, g) => s + g.distributionShare, 0))
      .toBeCloseTo((1 / 3) * gov, 12);

    // The identity that makes the clause checkable: for ANY β, γs·As over the short side is
    // exactly twice (1−γs)·As over the remaining width. Algebra, not a repeat of the code:
    //   band density    = 2As/(long + short)
    //   outside density =  As/(long + short)
    const bandDensity = band.distributionShare / band.width;
    const outDensity = outside[0].distributionShare / outside[0].width;
    expect(bandDensity / outDensity).toBeCloseTo(2.0, 9);
  });

  it('still applies §7.6.1 to each region, and says when it is what governs', () => {
    /**
     * The honest consequence of banding a minimum-governed footing. With A_s = 27,00 cm²:
     *
     *   band    γs·As = 18,00 cm² against 0,0018 × 1,50 × 0,50 = 13,50 ⇒ the SHARE governs
     *   outside     ⅙As =  4,50 cm² against 0,0018 × 0,75 × 0,50 =  6,75 ⇒ the MINIMUM governs
     *
     * Without the per-region floor the outside zones would sit below 0,0018 A_g precisely
     * where the band took steel from them: a mat that meets the minimum on average and not
     * where the bars are.
     */
    expect(cm2(r.x.asGoverning)).toBeCloseTo(27.0, 9);
    const band = r.x.regions.find((g) => g.kind === 'CENTRAL_BAND')!;
    const out = r.x.regions.find((g) => g.kind === 'OUTSIDE_BAND')!;
    expect(cm2(band.distributionShare)).toBeCloseTo(18.0, 9);
    expect(cm2(band.asRequired)).toBeCloseTo(18.0, 9);
    expect(band.governedBy).toBe('DISTRIBUTION');
    expect(cm2(out.distributionShare)).toBeCloseTo(4.5, 9);
    expect(cm2(out.asRequired)).toBeCloseTo(6.75, 9);
    expect(out.governedBy).toBe('MINIMUM');
  });

  it('does not approximate a rectangular footing as a square one', () => {
    const sq = designFootingMat(square());
    expect(sq.x.distribution).not.toBe(r.x.distribution);
    expect(r.x.regions.length).toBe(3);
    expect(sq.x.regions.length).toBe(1);
    expect(designFootingMat(rectangular()).refs.map((c) => c.clause)).toContain('13.3.3.3');
  });

  it('centres the band on the COLUMN axis, not on the footing centroid', () => {
    // The centroid sits 0,30 m from the column along L, so the band moves with the column and
    // the two outside zones stop being equal. Reading "centred" as the centroid would put the
    // extra steel in the wrong place on every eccentric footing.
    const e = designFootingMat(rectangular({ eccentricityL: 0.3 }));
    const band = e.x.regions.find((g) => g.kind === 'CENTRAL_BAND')!;
    expect(band.centreOffset).toBeCloseTo(-0.3, 12);
    const widths = e.x.regions.filter((g) => g.kind === 'OUTSIDE_BAND')
      .map((g) => g.width).sort((a, b) => a - b);
    expect(widths[0]).toBeCloseTo(0.45, 12);
    expect(widths[1]).toBeCloseTo(1.05, 12);
    // The remainder is spread by DENSITY over the outside zones, so the wider zone takes more.
    const regs = e.x.regions.filter((g) => g.kind === 'OUTSIDE_BAND');
    const density = regs.map((g) => g.distributionShare / g.width);
    expect(density[0]).toBeCloseTo(density[1], 12);
    expect(e.assumptions.map((a) => a.key))
      .toContain('footing.assumption.symmetricCantilever');
  });

  it('refuses when the prescribed band will not fit inside the footing', () => {
    // Offset the column far enough and the 1,50 m band runs off the 3,00 m width. Clipping it
    // would invent a rule §13.3.3.3 does not state.
    const r2 = designFootingMat(rectangular({ eccentricityL: -0.9 }));
    expect(r2.x.status).toBe('DESIGN_FAILED');
    expect(r2.x.failures.map((f) => f.key)).toContain('footing.mat.bandOutsideFooting');
  });
});

// ─── The status model ────────────────────────────────────────────

describe('the PR18-A status model is not one OK flag', () => {
  const r = designFootingMat(square());

  it('reports the mat as designed and its geometry as not modelled', () => {
    expect(r.status).toBe('DESIGNED');
    expect(r.x.status).toBe('DESIGNED');
    expect(r.y.status).toBe('DESIGNED');
    expect(r.geometry).toBe('REQUIRED_NOT_MODELED');
  });

  it('reports top reinforcement as NOT_EVALUATED', () => {
    // Nothing in this module evaluates top steel, so nothing here may imply it is unnecessary.
    expect(r.topReinforcement).toBe('NOT_EVALUATED');
  });

  it('rolls the mat status down when either direction fails', () => {
    const bad = designFootingMat(square({ thickness: 0.08 }));
    expect(bad.status).toBe('DESIGN_FAILED');
    expect(bad.geometry).toBe('REQUIRED_NOT_MODELED');
    expect(bad.failures.length).toBeGreaterThan(0);
  });
});
