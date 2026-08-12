/**
 * Warping, checked against published section tables.
 *
 * The warping constant is tabulated for every rolled profile, which makes this
 * one of the few places where a closed form can be checked against an
 * independent authority rather than against itself. So it is: IPE, HEA and HEB
 * against their catalogue values.
 *
 * The behavioural checks matter as much as the numeric ones. Warping is worth
 * implementing because it changes conclusions — a short restrained member is
 * carried by it almost entirely, a long one barely at all, and a tube not at
 * all. Those are the statements a reader will rely on.
 */

import { describe, it, expect } from 'vitest';
import { warpingProperties, withLambda, warpingResponse } from '../warping';
import type { ResolvedSection } from '../section-stress';

function rs(over: Partial<ResolvedSection>): ResolvedSection {
  return {
    shape: 'rect', a: 0, iy: 0, iz: 0, j: 0,
    h: 0, b: 0, tw: 0, tf: 0, t: 0, tl: 0,
    yMin: 0, yMax: 0, zMin: 0, zMax: 0,
    ...over,
  } as ResolvedSection;
}

/** cm⁶ from m⁶, the unit profile tables use. */
const cm6 = (m6: number) => m6 * 1e12;

// Real catalogue values, SI.
const IPE300 = () => rs({
  shape: 'I', h: 0.3, b: 0.15, tw: 0.0071, tf: 0.0107,
  a: 5.381e-3, iy: 8.356e-5, iz: 6.04e-6, j: 2.01e-7,
});
const HEB300 = () => rs({
  shape: 'H', h: 0.3, b: 0.3, tw: 0.011, tf: 0.019,
  a: 0.01491, iy: 2.517e-4, iz: 8.563e-5, j: 1.85e-6,
});
const UPN200 = () => rs({
  shape: 'U', h: 0.2, b: 0.075, tw: 0.0085, tf: 0.0115,
  a: 3.22e-3, iy: 1.91e-5, iz: 1.48e-6, j: 1.19e-7,
});

describe('the warping constant against published tables', () => {
  it('IPE 300: 126 000 cm⁶', () => {
    // Cw = Iz·h0²/4 is not an approximation for a doubly-symmetric I — the
    // flanges bend about their own axes and h0 is the couple arm.
    expect(cm6(warpingProperties(IPE300()).cw)).toBeCloseTo(126_000, -3);
  });

  it('HEB 300: 1 688 000 cm⁶', () => {
    const cw = cm6(warpingProperties(HEB300()).cw);
    expect(Math.abs(cw - 1_688_000) / 1_688_000).toBeLessThan(0.01);
  });

  it('is reported as exact for I-beams and thin-wall for channels', () => {
    // The channel formula ignores root fillets and the tapered flange a UPN
    // actually has, and lands about 15% out. Saying which is which is the
    // difference between a number and a claim about its precision.
    expect(warpingProperties(IPE300()).fidelity).toBe('exact');
    expect(warpingProperties(UPN200()).fidelity).toBe('thinWall');
    const cw = cm6(warpingProperties(UPN200()).cw);
    expect(Math.abs(cw - 12_100) / 12_100).toBeLessThan(0.2);
  });
});

describe('sections that do not warp', () => {
  it('a tube carries torque by circulation, so its warping constant is zero', () => {
    for (const shape of ['RHS', 'CHS'] as const) {
      const p = warpingProperties(rs({ shape, h: 0.2, b: 0.1, t: 0.006, j: 3e-6 }));
      expect(p.cw, shape).toBe(0);
      expect(p.klass, shape).toBe('closedNegligible');
    }
  });

  it('an angle and a tee have walls meeting at a point, so nearly none either', () => {
    for (const shape of ['L', 'T', 'invL'] as const) {
      const p = warpingProperties(rs({ shape, h: 0.1, b: 0.1, tw: 0.01, tf: 0.01, t: 0.01, j: 6e-8 }));
      expect(p.cw, shape).toBe(0);
      expect(p.klass, shape).toBe('pointSymmetric');
    }
  });

  it('has no characteristic length, rather than a length of zero', () => {
    // Zero would read as "extremely short", which is the opposite of the truth.
    const tube = withLambda(warpingProperties(rs({ shape: 'RHS', h: 0.2, b: 0.1, t: 0.006, j: 3e-6 })), 200000);
    expect(tube.lambda).toBeNull();
    expect(warpingResponse(rs({ shape: 'RHS', h: 0.2, b: 0.1, t: 0.006, j: 3e-6 }), tube, 10, 5, 200000)).toBeNull();
  });
});

describe('the characteristic length decides which mechanism carries the torque', () => {
  it('an IPE 300 has a warping length of a couple of metres', () => {
    // Which is why a 1,5 m beam and a 12 m beam of the SAME section behave
    // completely differently under the same torque.
    const p = withLambda(warpingProperties(IPE300()), 210000);
    expect(p.lambda).not.toBeNull();
    expect(p.lambda!).toBeGreaterThan(1);
    expect(p.lambda!).toBeLessThan(4);
  });

  it('a short restrained member is carried almost entirely by warping', () => {
    const s = IPE300();
    const p = withLambda(warpingProperties(s), 210000);
    const short = warpingResponse(s, p, 10, 0.3, 210000, 'cantilever');
    expect(short!.saintVenantShare).toBeLessThan(0.05);
  });

  it('a long member is carried almost entirely by Saint-Venant', () => {
    const s = IPE300();
    const p = withLambda(warpingProperties(s), 210000);
    const long = warpingResponse(s, p, 10, 20, 210000, 'cantilever');
    expect(long!.saintVenantShare).toBeGreaterThan(0.95);
  });

  it('the share rises monotonically with length — no jump, a transition', () => {
    const s = IPE300();
    const p = withLambda(warpingProperties(s), 210000);
    const shares = [0.5, 1, 2, 4, 8, 16].map(
      (L) => warpingResponse(s, p, 10, L, 210000)!.saintVenantShare,
    );
    for (let i = 1; i < shares.length; i++) {
      expect(shares[i]).toBeGreaterThan(shares[i - 1]);
    }
  });
});

describe('warping stress — the part that is not conservative to omit', () => {
  it('produces a real normal stress that adds to bending', () => {
    const s = IPE300();
    const p = withLambda(warpingProperties(s), 210000);
    const r = warpingResponse(s, p, 10, 2, 210000, 'cantilever');
    expect(r!.sigmaW).toBeGreaterThan(0);
    // On a short restrained member under a serious torque it is not a rounding
    // — it is tens of MPa, comparable to the bending it sits on top of.
    expect(r!.sigmaW).toBeGreaterThan(10);
  });

  it('grows with the torque, in proportion', () => {
    const s = IPE300();
    const p = withLambda(warpingProperties(s), 210000);
    const a = warpingResponse(s, p, 5, 2, 210000)!.sigmaW;
    const b = warpingResponse(s, p, 10, 2, 210000)!.sigmaW;
    expect(b / a).toBeCloseTo(2, 6);
  });

  it('is larger with a restrained end than with free ends', () => {
    // The whole point of stating the boundary condition: it changes the answer,
    // so picking one silently would be picking the user's assumption for them.
    const s = IPE300();
    const p = withLambda(warpingProperties(s), 210000);
    const fixed = warpingResponse(s, p, 10, 4, 210000, 'cantilever')!;
    const free = warpingResponse(s, p, 10, 4, 210000, 'simple')!;
    expect(fixed.sigmaW).toBeGreaterThan(free.sigmaW);
    expect(fixed.caseKey).not.toBe(free.caseKey);
  });

  it('does not depend on the sign of the torque', () => {
    const s = IPE300();
    const p = withLambda(warpingProperties(s), 210000);
    expect(warpingResponse(s, p, -10, 3, 210000)!.sigmaW)
      .toBeCloseTo(warpingResponse(s, p, 10, 3, 210000)!.sigmaW, 9);
  });
});
