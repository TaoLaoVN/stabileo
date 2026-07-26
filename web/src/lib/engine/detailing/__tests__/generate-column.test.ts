import { describe, it, expect } from 'vitest';
import {
  MAX_OFFSET_SLOPE, allocateBeamLayers, classifyJoint, coordinateJoint, detectTransitions,
  generateColumnStack, planSplices, tieSpacing,
  type ColumnLift, type ColumnStackInput, type IncidentBeamAtJoint,
} from '../generate-column';

function lift(over: Partial<ColumnLift> = {}, i = 0): ColumnLift {
  return {
    elementId: 100 + i, baseZ: i * 3, topZ: (i + 1) * 3,
    b: 0.40, h: 0.40, centre: { x: 0, y: 0 },
    bars: { count: 8, diameterMm: 20 }, tieDia: 8, cover: 0.025,
    ...over,
  };
}

function stack(lifts: ColumnLift[], over: Partial<ColumnStackInput> = {}): ColumnStackInput {
  return {
    stackId: 'C-B2', lifts, fc: 25, fy: 420, maxAggregateSizeMm: 20, edition: '2025',
    lapSplice: (d) => 0.05 * d,
    beamDepthAtTop: new Map(lifts.map((_, i) => [i, 0.60])),
    roofTermination: false,
    ...over,
  };
}

const three = [lift({}, 0), lift({}, 1), lift({}, 2)];

describe('transitions between lifts', () => {
  it('reports no change when lifts match', () => {
    const t = detectTransitions(stack(three));
    expect(t).toHaveLength(2);
    expect(t.every((x) => x.kinds[0] === 'none')).toBe(true);
  });

  it('detects a bar-count change and counts the discontinued bars', () => {
    const t = detectTransitions(stack([
      lift({ bars: { count: 8, diameterMm: 20 } }, 0),
      lift({ bars: { count: 6, diameterMm: 20 } }, 1),
    ]));
    expect(t[0].kinds).toContain('countChange');
    expect(t[0].discontinued).toBe(2);
  });

  it('detects a diameter change', () => {
    const t = detectTransitions(stack([
      lift({ bars: { count: 8, diameterMm: 25 } }, 0),
      lift({ bars: { count: 8, diameterMm: 20 } }, 1),
    ]));
    expect(t[0].kinds).toContain('diameterChange');
  });

  it('detects a section change', () => {
    const t = detectTransitions(stack([
      lift({ b: 0.50, h: 0.50 }, 0), lift({ b: 0.40, h: 0.40 }, 1),
    ]));
    expect(t[0].kinds).toContain('sectionChange');
  });

  it('computes the offset slope against the joint depth', () => {
    // 50 mm shift over a 600 mm beam depth -> 1 in 12, within the limit.
    const t = detectTransitions(stack([
      lift({ centre: { x: 0, y: 0 } }, 0),
      lift({ centre: { x: 0.05, y: 0 } }, 1),
    ]));
    expect(t[0].kinds).toContain('offset');
    expect(t[0].offsetSlope).toBeCloseTo(0.05 / 0.60, 9);
    expect(t[0].offsetExceedsLimit).toBe(false);
    expect(t[0].note).toMatch(/Dentro del límite de 1 en 6/);
  });

  it('flags an offset steeper than the §10.7.4 limit of 1 in 6', () => {
    // 200 mm shift over 600 mm -> 1 in 3.
    const t = detectTransitions(stack([
      lift({ centre: { x: 0, y: 0 } }, 0),
      lift({ centre: { x: 0.20, y: 0 } }, 1),
    ]));
    expect(t[0].offsetSlope).toBeGreaterThan(MAX_OFFSET_SLOPE);
    expect(t[0].offsetExceedsLimit).toBe(true);
    expect(t[0].note).toMatch(/EXCEDE el límite de 1 en 6/);
    expect(t[0].refs.some((r) => r.clause === '10.7.4')).toBe(true);
  });

  it('surfaces an over-steep offset as unsupported rather than bending it anyway', () => {
    const g = generateColumnStack(stack([
      lift({ centre: { x: 0, y: 0 } }, 0),
      lift({ centre: { x: 0.20, y: 0 } }, 1),
    ]));
    expect(g.unsupported.join(' ')).toMatch(/barras de espera separadas/);
  });
});

describe('splices', () => {
  it('places a lap just above each floor above the first', () => {
    const s = planSplices(stack(three));
    // Two upper lifts x two stagger groups.
    expect(s).toHaveLength(4);
    expect(s[0].from).toBeCloseTo(3, 9);
  });

  it('staggers half the bars by one lap length', () => {
    // Splicing every bar at the same section concentrates the whole transfer in one plane.
    const s = planSplices(stack(three));
    const low = s.filter((x) => x.staggerGroup === 0);
    const high = s.filter((x) => x.staggerGroup === 1);
    expect(low[0].barCount + high[0].barCount).toBe(8);
    expect(high[0].from).toBeCloseTo(low[0].to, 9);
  });

  it('scales the lap with the bar diameter', () => {
    const small = planSplices(stack([lift({}, 0), lift({ bars: { count: 8, diameterMm: 12 } }, 1)]));
    const big = planSplices(stack([lift({}, 0), lift({ bars: { count: 8, diameterMm: 32 } }, 1)]));
    expect(big[0].to - big[0].from).toBeGreaterThan(small[0].to - small[0].from);
  });

  it('splices nothing on a single-lift stack', () => {
    expect(planSplices(stack([lift()]))).toEqual([]);
  });
});

describe('§10.7.6.2 tie spacing', () => {
  it('takes the least of 16 d_b, 48 d_be and the least column dimension', () => {
    // 16 × 20 = 320; 48 × 8 = 384; 400 -> 16 d_b governs.
    const r = tieSpacing(20, 8, 0.40, '2025');
    expect(r.spacing).toBeCloseTo(0.320, 9);
    expect(r.governedBy).toBe('16db');
  });

  it('lets 48 d_be govern with a large longitudinal bar and a thin tie', () => {
    // 16 × 32 = 512; 48 × 6 = 288; 500 -> 48 d_be governs.
    expect(tieSpacing(32, 6, 0.50, '2025').governedBy).toBe('48dbe');
  });

  it('lets the least dimension govern in a slender column', () => {
    // 16 × 16 = 256; 48 × 8 = 384; 200 -> the dimension governs.
    expect(tieSpacing(16, 8, 0.20, '2025').governedBy).toBe('leastDimension');
  });

  it('cites the right clause per edition', () => {
    expect(tieSpacing(20, 8, 0.4, '2025').refs[0].clause).toBe('10.7.6.2');
    expect(tieSpacing(20, 8, 0.4, '2005').refs[0].clause).toBe('7.10.5');
  });
});

describe('column stack generation', () => {
  it('generates bars for every lift', () => {
    const g = generateColumnStack(stack(three));
    for (let i = 0; i < 3; i++) {
      expect(g.bars.filter((b) => b.id.includes(`-L${i}-`))).toHaveLength(8);
    }
  });

  it('runs bars past the lift top by one lap, except at the top lift', () => {
    const g = generateColumnStack(stack(three));
    const lower = g.bars.find((b) => b.id.includes('-L0-'))!;
    const top = g.bars.find((b) => b.id.includes('-L2-'))!;
    // Lower lift: 3 m + lap (0.05 × 20 = 1.0 m).
    expect(lower.cuttingLength).toBeCloseTo(4.0, 6);
    expect(top.cuttingLength).toBeCloseTo(3.0, 6);
  });

  it('places four corner bars plus face bars, inside the cover', () => {
    const g = generateColumnStack(stack([lift({ bars: { count: 8, diameterMm: 20 } })]));
    const inset = 0.025 + 0.008 + 0.010;
    const xs = g.bars.map((b) => b.segments[0].start.x);
    expect(Math.max(...xs)).toBeCloseTo(0.20 - inset, 9);
    expect(Math.min(...xs)).toBeCloseTo(-(0.20 - inset), 9);
  });

  it('hooks the top-lift bars at a roof termination', () => {
    const plain = generateColumnStack(stack(three, { roofTermination: false }));
    const roof = generateColumnStack(stack(three, { roofTermination: true }));
    const pt = plain.bars.find((b) => b.id.includes('-L2-v0'))!;
    const rt = roof.bars.find((b) => b.id.includes('-L2-v0'))!;
    expect(pt.endTreatment.kind).toBe('straight');
    expect(rt.endTreatment.kind).toBe('hook');
    expect(rt.cuttingLength).toBeGreaterThan(pt.cuttingLength);
  });

  it('emits tie zones per lift with the governing spacing', () => {
    const g = generateColumnStack(stack(three));
    expect(g.ties).toHaveLength(3);
    expect(g.ties[0].spacing).toBeCloseTo(0.320, 9);
  });

  it('attributes bars to their own lift element', () => {
    const g = generateColumnStack(stack(three));
    expect(g.bars.find((b) => b.id.includes('-L1-'))!.ownerElementIds).toEqual([101]);
  });

  it('is byte-deterministic', () => {
    expect(JSON.stringify(generateColumnStack(stack(three))))
      .toBe(JSON.stringify(generateColumnStack(stack(three))));
  });

  it('cites only the declared edition', () => {
    for (const ed of ['2025', '2005'] as const) {
      const g = generateColumnStack(stack(three, { edition: ed }));
      const c201 = g.refs.filter((r) => r.regulation === 'cirsoc-201');
      expect(c201.length).toBeGreaterThan(0);
      expect(c201.every((r) => r.edition === ed), ed).toBe(true);
    }
  });
});

// ─── Joints ──────────────────────────────────────────────────────

const beam = (id: number, dir: { x: number; y: number }, depth = 0.60,
  continuous = true, dia = 20): IncidentBeamAtJoint =>
  ({ elementId: id, direction: dir, depth, topDiameterMm: dia, continuous });

describe('joint classification', () => {
  it('classifies by beam count and whether a column continues above', () => {
    expect(classifyJoint(4, true)).toBe('interior');
    expect(classifyJoint(3, true)).toBe('exterior');
    expect(classifyJoint(2, true)).toBe('corner');
    // No column above: nothing for the beam top bars to continue into.
    expect(classifyJoint(4, false)).toBe('roof');
  });
});

describe('layer allocation at a joint', () => {
  const X = { x: 1, y: 0 };
  const Y = { x: 0, y: 1 };

  it('stacks perpendicular beams into different layers', () => {
    // Two beams perpendicular to each other cannot both put their top bars at the same
    // depth; one set has to sit under the other.
    const l = allocateBeamLayers([beam(1, X), beam(2, Y)], 0.025, 8);
    expect(new Set(l.map((x) => x.layer)).size).toBe(2);
    expect(l[0].topOffset).toBeLessThan(l[1].topOffset);
  });

  it('keeps beams on the same axis in the same layer', () => {
    const l = allocateBeamLayers([beam(1, X), beam(2, { x: -1, y: 0 })], 0.025, 8);
    expect(l[0].layer).toBe(l[1].layer);
  });

  it('gives the outer layer to the axis with the deepest beam', () => {
    const l = allocateBeamLayers([beam(1, X, 0.40), beam(2, Y, 0.80)], 0.025, 8);
    expect(l.find((x) => x.elementId === 2)!.layer).toBe(0);
    expect(l.find((x) => x.elementId === 1)!.layer).toBe(1);
  });

  it('is deterministic and independent of input order', () => {
    // Arbitrary allocation would make two runs of the same model produce two different
    // bar schedules.
    const beams = [beam(3, Y, 0.60), beam(1, X, 0.60), beam(2, X, 0.60)];
    const a = allocateBeamLayers(beams, 0.025, 8);
    const b = allocateBeamLayers([...beams].reverse(), 0.025, 8);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('separates layers by at least the §25.2.2 clear distance', () => {
    const l = allocateBeamLayers([beam(1, X, 0.60, true, 25), beam(2, Y, 0.60, true, 25)], 0.025, 8);
    const gap = l[1].topOffset - l[0].topOffset;
    expect(gap).toBeGreaterThanOrEqual(0.025 + 0.025 / 2);
  });
});

describe('joint coordination', () => {
  const X = { x: 1, y: 0 };
  const Y = { x: 0, y: 1 };
  const base = { columnB: 0.40, columnH: 0.40, cover: 0.025, tieDia: 8, edition: '2025' as const };

  it('treats a four-beam joint as confined per §15.2.8', () => {
    const j = coordinateJoint({
      ...base, columnAbove: true,
      beams: [beam(1, X), beam(2, { x: -1, y: 0 }), beam(3, Y), beam(4, { x: 0, y: -1 })],
    });
    expect(j.kind).toBe('interior');
    expect(j.confined).toBe(true);
  });

  it('treats a corner joint as unconfined, which reduces its shear strength', () => {
    const j = coordinateJoint({ ...base, columnAbove: true, beams: [beam(1, X), beam(2, Y)] });
    expect(j.kind).toBe('corner');
    expect(j.confined).toBe(false);
  });

  it('flags beams that do not continue as needing a hooked anchorage', () => {
    const j = coordinateJoint({
      ...base, columnAbove: true,
      beams: [beam(1, X, 0.6, true), beam(2, Y, 0.6, false)],
    });
    expect(j.hookedAnchorages).toEqual([2]);
    expect(j.trace.join(' ')).toMatch(/anclaje con gancho/);
  });

  it('recognises a roof joint', () => {
    const j = coordinateJoint({ ...base, columnAbove: false, beams: [beam(1, X), beam(2, Y)] });
    expect(j.kind).toBe('roof');
    expect(j.trace.join(' ')).toMatch(/sin columna superior/);
  });

  it('declares more than four incident beams unsupported rather than guessing', () => {
    const j = coordinateJoint({
      ...base, columnAbove: true,
      beams: [beam(1, X), beam(2, { x: -1, y: 0 }), beam(3, Y),
        beam(4, { x: 0, y: -1 }), beam(5, { x: 0.7, y: 0.7 })],
    });
    expect(j.unsupported.join(' ')).toMatch(/hasta cuatro vigas/);
  });

  it('traces the layer assignment so the drawing can be checked', () => {
    const j = coordinateJoint({ ...base, columnAbove: true, beams: [beam(1, X), beam(2, Y)] });
    expect(j.trace.join('\n')).toMatch(/Capa 0:/);
    expect(j.trace.join('\n')).toMatch(/Capa 1:/);
  });

  it('is deterministic', () => {
    const run = () => coordinateJoint({
      ...base, columnAbove: true, beams: [beam(2, Y), beam(1, X)],
    });
    expect(JSON.stringify(run())).toBe(JSON.stringify(run()));
  });
});
