import { describe, it, expect } from 'vitest';
import {
  buildLoadPlan, combinationSymbols, describePlanDelta, levelsWithPlanArea,
  type LoadModelData, type LoadPlanInput,
} from '../load-plan';
import {
  bindRole, defaultRegulations, unsetBinding, type ProjectRegulations,
} from '../../../codes/roles';

/** Two-storey 6×6 frame with real sections and density. */
function frame(storeys = 2, bay = 6, h = 3): LoadModelData {
  const nodes = new Map<number, { id: number; x: number; y: number; z?: number }>();
  const elements = new Map<number, { id: number; nodeI: number; nodeJ: number; sectionId: number; materialId: number }>();
  let nid = 1, eid = 1;
  const grid: number[][] = [];
  for (let s = 0; s <= storeys; s++) {
    const lvl: number[] = [];
    for (const [x, y] of [[0, 0], [bay, 0], [bay, bay], [0, bay]]) {
      nodes.set(nid, { id: nid, x, y, z: s * h }); lvl.push(nid); nid++;
    }
    grid.push(lvl);
  }
  for (let s = 0; s < storeys; s++) {
    for (let i = 0; i < 4; i++) {
      elements.set(eid, { id: eid, nodeI: grid[s][i], nodeJ: grid[s + 1][i], sectionId: 1, materialId: 1 }); eid++;
    }
    for (let i = 0; i < 4; i++) {
      elements.set(eid, { id: eid, nodeI: grid[s + 1][i], nodeJ: grid[s + 1][(i + 1) % 4], sectionId: 1, materialId: 1 }); eid++;
    }
  }
  return {
    nodes, elements,
    sections: new Map([[1, { id: 1, a: 0.09 }]]),
    materials: new Map([[1, { id: 1, rho: 25 }]]),
    loadCases: [{ id: 1, type: 'D', name: 'Dead' }, { id: 2, type: 'L', name: 'Live' }],
  };
}

function applied(reg: ProjectRegulations): ProjectRegulations {
  const out = { ...reg };
  for (const k of Object.keys(out) as Array<keyof ProjectRegulations>) {
    if (out[k].adapterId) out[k] = { ...out[k], configComplete: true, state: 'applied' };
  }
  return out;
}

function input(over: Partial<LoadPlanInput> = {}): LoadPlanInput {
  return {
    regulations: applied(defaultRegulations()),
    model: frame(),
    dead: [{ labelKey: 'a', q: 1.0 }, { labelKey: 'b', q: 0.8 }],
    occupancyKey: 'vivienda',
    tributaryWidth: 3,
    reductionElementKind: 'interiorBeam',
    floorsSupported: 1,
    applyLiveReduction: true,
    generateCombinations: true,
    ...over,
  };
}

// ─── Role gating ─────────────────────────────────────────────────

describe('role gating', () => {
  it('is READY with the default CIRSOC stack', () => {
    expect(buildLoadPlan(input()).outcome).toBe('READY');
  });

  it('is BLOCKED, with a reason, when the loads role is unset', () => {
    const reg = applied(defaultRegulations());
    reg.loads = unsetBinding('loads');
    const p = buildLoadPlan(input({ regulations: reg }));
    expect(p.outcome).toBe('BLOCKED');
    expect(p.blockedKeys.some((b) => b.key === 'loadPlan.blocked.roleUnusable')).toBe(true);
  });

  it('is BLOCKED when a bound role is still unconfigured', () => {
    const reg = applied(defaultRegulations());
    reg.loads = { ...reg.loads, configComplete: false };
    expect(buildLoadPlan(input({ regulations: reg })).outcome).toBe('BLOCKED');
  });

  it('is BLOCKED when wind is requested but the wind role is unusable', () => {
    const reg = applied(defaultRegulations());
    reg.wind = unsetBinding('wind');
    const p = buildLoadPlan(input({
      regulations: reg,
      wind: {
        enabled: true, basicSpeed: 45, exposure: 'C', enclosure: 'enclosed',
        siteAltitudeM: 0, kzt: 1, kztSurveyed: true, roofSlopeDeg: 20, rigid: true,
        directions: { x: true, y: false },
      },
    }));
    expect(p.outcome).toBe('BLOCKED');
    expect(p.blockedKeys.some((b) => b.key === 'loadPlan.blocked.windRoleUnusable')).toBe(true);
  });

  it('is BLOCKED when seismic is requested with no seismic role', () => {
    const p = buildLoadPlan(input({
      seismic: { enabled: true, coefficient: 0.15, liveParticipation: 0.25, directions: { x: true, y: false } },
    }));
    expect(p.outcome).toBe('BLOCKED');
    expect(p.blockedKeys.some((b) => b.key === 'loadPlan.blocked.seismicRoleUnusable')).toBe(true);
  });

  it('never silently substitutes a default for an unusable role', () => {
    const reg = applied(defaultRegulations());
    reg.basis = unsetBinding('basis');
    const p = buildLoadPlan(input({ regulations: reg }));
    expect(p.distributed).toEqual([]);
    expect(p.combinations).toEqual([]);
  });
});

// ─── Real geometry, no assumed floor area ────────────────────────

describe('level plan areas come from real geometry', () => {
  it('computes each level extent from the actual nodes', () => {
    const lv = levelsWithPlanArea(frame(2, 6));
    expect(lv.map((l) => l.elevation)).toEqual([0, 3, 6]);
    // 6 × 6 bay -> 36 m², not an assumed constant.
    for (const l of lv) expect(l.planAreaM2).toBeCloseTo(36, 6);
  });

  it('scales with the actual bay, which a 50 m² literal could not', () => {
    expect(levelsWithPlanArea(frame(1, 4))[1].planAreaM2).toBeCloseTo(16, 6);
    expect(levelsWithPlanArea(frame(1, 10))[1].planAreaM2).toBeCloseTo(100, 6);
  });

  it('reports zero area for a level with too few nodes to bound a plan', () => {
    const m = frame(1);
    m.nodes.set(99, { id: 99, x: 0, y: 0, z: 99 });
    const lv = levelsWithPlanArea(m);
    expect(lv[lv.length - 1].planAreaM2).toBe(0);
  });

  it('derives level masses from self-weight plus applied loads, not an estimate', () => {
    const p = buildLoadPlan(input());
    const lv = p.levels.find((l) => l.elevation === 3)!;
    // 6 m bay, 4 beams: 4 × 6 × 0.09 × 25 = 54 kN, plus half the columns each side.
    expect(lv.selfWeightKN).toBeGreaterThan(50);
    expect(lv.superimposedKN).toBeCloseTo(1.8 * 36, 6);
    expect(p.derivation.join(' ')).toMatch(/de la extensión real de los nodos/);
  });

  it('gives different levels different weights', () => {
    const p = buildLoadPlan(input());
    const w = p.levels.map((l) => l.weightKN.toFixed(3));
    expect(new Set(w).size).toBeGreaterThan(1);
  });
});

// ─── Live loads and reduction ────────────────────────────────────

describe('CIRSOC 101 imposed loads', () => {
  it('takes Lo from Table 4.1 and cites it', () => {
    const p = buildLoadPlan(input({ occupancyKey: 'oficina' }));
    expect(p.factors.occupancy.value).toBe(2.5);
    expect(p.refs.some((r) => r.clause === 'Tabla 4.1')).toBe(true);
  });

  it('applies the §4.7.2 reduction and records why', () => {
    const p = buildLoadPlan(input({ applyLiveReduction: true }));
    expect(p.factors.liveReduced.value).toBeLessThanOrEqual(p.factors.occupancy.value);
    expect(p.derivation.join(' ')).toMatch(/K_LL·A_t|no corresponde reducción/);
  });

  it('skips the reduction when the project says so, and says so', () => {
    const p = buildLoadPlan(input({ applyLiveReduction: false }));
    expect(p.factors.liveReduced.value).toBe(p.factors.occupancy.value);
    expect(p.derivation.join(' ')).toMatch(/no aplicada por decisión del proyecto/);
  });

  it('BLOCKS on an occupancy whose table entry is a cross-reference', () => {
    // Table 4.1 sends "Balcones — otros casos" to article 4.11; inventing a number here
    // would be worse than refusing.
    const p = buildLoadPlan(input({ occupancyKey: 'balcon_otros' }));
    expect(p.outcome).toBe('BLOCKED');
    expect(p.blockedKeys[0].key).toBe('loadPlan.blocked.occupancyCrossReference');
    expect(p.blockedKeys[0].params?.article).toBe('4.11');
  });

  it('BLOCKS on an unknown occupancy key', () => {
    expect(buildLoadPlan(input({ occupancyKey: 'nope' })).blockedKeys[0].key)
      .toBe('loadPlan.blocked.unknownOccupancy');
  });

  it('puts dead and live line loads on beam-like members only', () => {
    const p = buildLoadPlan(input());
    // 8 beams over two storeys; columns excluded.
    const beams = p.distributed.filter((d) => d.caseType === 'D');
    expect(beams).toHaveLength(8);
    for (const d of p.distributed) expect(d.q).toBeLessThan(0);   // downward
  });

  it('scales the line load with the tributary width', () => {
    const a = buildLoadPlan(input({ tributaryWidth: 2 })).distributed.find((d) => d.caseType === 'D')!;
    const b = buildLoadPlan(input({ tributaryWidth: 4 })).distributed.find((d) => d.caseType === 'D')!;
    expect(b.q).toBeCloseTo(2 * a.q, 6);
  });
});

// ─── Combinations ────────────────────────────────────────────────

describe('combinations come from the basis role', () => {
  it('generates the §2.3.2 set and cites it', () => {
    const p = buildLoadPlan(input());
    expect(p.combinations.length).toBeGreaterThan(0);
    expect(p.combinations.some((c) => c.label === '1,4 D')).toBe(true);
    expect(p.refs.some((r) => r.clause === '2.3.2')).toBe(true);
  });

  it('omits combinations entirely when asked', () => {
    expect(buildLoadPlan(input({ generateCombinations: false })).combinations).toEqual([]);
  });

  it('never mixes W and E in one combination', () => {
    const reg = applied(defaultRegulations());
    reg.seismic = { ...bindRole('seismic', 'inpres103-2018'), configComplete: true, state: 'applied' };
    const p = buildLoadPlan(input({
      regulations: reg,
      wind: { enabled: true, basicSpeed: 45, exposure: 'C', enclosure: 'enclosed',
        siteAltitudeM: 0, kzt: 1, kztSurveyed: true, roofSlopeDeg: 20, rigid: true,
        directions: { x: true, y: false } },
      seismic: { enabled: true, coefficient: 0.15, liveParticipation: 0.25, directions: { x: true, y: false } },
    }));
    for (const c of p.combinations) {
      const s = combinationSymbols(c);
      expect(s.includes('W') && s.includes('E'), c.id).toBe(false);
    }
  });

  it('records the Exception 1 decision in the derivation', () => {
    const p = buildLoadPlan(input({ occupancyKey: 'vivienda' }));
    expect(p.derivation.join(' ')).toMatch(/Excepción 1/);
  });
});

// ─── Wind ────────────────────────────────────────────────────────

describe('wind uses the CIRSOC 102-2025 engine', () => {
  const windOn = (over = {}) => buildLoadPlan(input({
    wind: {
      enabled: true, basicSpeed: 45, exposure: 'C', enclosure: 'enclosed',
      siteAltitudeM: 0, kzt: 1, kztSurveyed: true, roofSlopeDeg: 20, rigid: true,
      directions: { x: true, y: false }, ...over,
    },
  }));

  it('produces nodal wind forces and a q_h factor', () => {
    const p = windOn();
    expect(p.nodal.some((n) => n.caseType === 'W')).toBe(true);
    expect(p.factors.windQh?.value).toBeGreaterThan(0);
  });

  it('scales with the square of the basic speed', () => {
    const a = windOn({ basicSpeed: 40 }).factors.windQh!.value;
    const b = windOn({ basicSpeed: 80 }).factors.windQh!.value;
    expect(b / a).toBeCloseTo(4, 6);
  });

  it('records the unsurveyed K_zt as an assumption', () => {
    const p = windOn({ kztSurveyed: false });
    expect(p.assumptions.join(' ')).toMatch(/relevamiento del sitio/);
  });

  it('produces no wind forces for a flexible building, and says why', () => {
    const p = windOn({ rigid: false });
    expect(p.nodal.some((n) => n.caseType === 'W')).toBe(false);
    expect(p.unsupportedKeys.some((u) => /1\.9\.5/.test(String(u.params?.text ?? '')))).toBe(true);
  });

  it('always reports the torsional cases as not covered', () => {
    expect(windOn().unsupportedKeys.some((u) => /torsionales/.test(String(u.params?.text ?? ''))))
      .toBe(true);
  });

  it('adds a wind case per requested direction', () => {
    const p = windOn({ directions: { x: true, y: true } });
    expect(p.cases.filter((c) => c.type === 'W')).toHaveLength(2);
  });
});

// ─── Seismic ─────────────────────────────────────────────────────

describe('seismic uses the real level masses', () => {
  function seismicPlan(over = {}) {
    const reg = applied(defaultRegulations());
    reg.seismic = { ...bindRole('seismic', 'inpres103-2018'), configComplete: true, state: 'applied' };
    return buildLoadPlan(input({
      regulations: reg,
      seismic: { enabled: true, coefficient: 0.15, liveParticipation: 0.25, directions: { x: true, y: false }, ...over },
    }));
  }

  it('derives W from the level masses and V0 = C·W', () => {
    const p = seismicPlan();
    const W = p.factors.seismicWeight!.value;
    expect(W).toBeGreaterThan(0);
    expect(p.factors.baseShear!.value).toBeCloseTo(0.15 * W, 6);
    expect(p.derivation.join(' ')).toMatch(/de las masas reales por nivel/);
  });

  it('distributes by W·h and sums to V0', () => {
    const p = seismicPlan();
    const total = p.nodal.filter((n) => n.caseType === 'E').reduce((s, n) => s + n.fx, 0);
    expect(total).toBeCloseTo(p.factors.baseShear!.value, 4);
  });

  it('flags an unstated live participation as an assumption', () => {
    const p = seismicPlan({ liveParticipation: null });
    expect(p.assumptions.join(' ')).toMatch(/no la indica/);
  });

  it('does not flag a stated participation', () => {
    const p = seismicPlan({ liveParticipation: 0.5 });
    expect(p.assumptions.join(' ')).not.toMatch(/no la indica/);
  });

  it('reports no seismic mass rather than inventing one', () => {
    // A genuinely massless model: zero density AND a level too narrow to bound a plan, so
    // neither self-weight nor an area load can contribute. The plan must say so rather
    // than fall back to an assumed floor weight.
    const m = frame();
    m.materials = new Map([[1, { id: 1, rho: 0 }]]);
    for (const n of m.nodes.values()) { n.x = 0; n.y = 0; }   // collinear -> plan area 0
    const reg = applied(defaultRegulations());
    reg.seismic = { ...bindRole('seismic', 'inpres103-2018'), configComplete: true, state: 'applied' };
    const p = buildLoadPlan(input({
      regulations: reg, model: m, dead: [],
      seismic: { enabled: true, coefficient: 0.15, liveParticipation: 0.25, directions: { x: true, y: false } },
    }));
    expect(p.outcome).toBe('READY');
    expect(p.factors.seismicWeight).toBeUndefined();
    expect(p.unsupportedKeys.some((u) => u.key === 'loadPlan.unsupported.noSeismicMass')).toBe(true);
    expect(p.nodal.some((n) => n.caseType === 'E')).toBe(false);
  });
});

// ─── Plan is pure, and the delta drives the preview ──────────────

describe('the plan is a plan, not a mutation', () => {
  it('never touches the model it was given', () => {
    const m = frame();
    const before = JSON.stringify({ n: [...m.nodes], e: [...m.elements], c: m.loadCases });
    buildLoadPlan(input({ model: m }));
    expect(JSON.stringify({ n: [...m.nodes], e: [...m.elements], c: m.loadCases })).toBe(before);
  });

  it('is deterministic', () => {
    expect(JSON.stringify(buildLoadPlan(input()))).toBe(JSON.stringify(buildLoadPlan(input())));
  });

  it('reuses an existing case id where one matches, so Apply does not duplicate cases', () => {
    const p = buildLoadPlan(input());
    expect(p.cases.find((c) => c.type === 'D')!.existingId).toBe(1);
    expect(p.cases.find((c) => c.type === 'L')!.existingId).toBe(2);
  });

  it('reports a new case as needing creation', () => {
    const reg = applied(defaultRegulations());
    reg.seismic = { ...bindRole('seismic', 'inpres103-2018'), configComplete: true, state: 'applied' };
    const p = buildLoadPlan(input({
      regulations: reg,
      seismic: { enabled: true, coefficient: 0.15, liveParticipation: 0.25, directions: { x: true, y: false } },
    }));
    expect(p.cases.find((c) => c.type === 'E')!.existingId).toBeNull();
  });

  it('diffs against what the model already has', () => {
    const p = buildLoadPlan(input());
    const d = describePlanDelta(p, { distributed: 4, nodal: 0, combinations: 2, caseTypes: ['D', 'L'] });
    expect(d.before.distributed).toBe(4);
    expect(d.after.distributed).toBe(p.distributed.length);
    expect(d.changes).toBe(true);
  });

  it('reports no change when the plan matches the model exactly', () => {
    const p = buildLoadPlan(input({ generateCombinations: false }));
    const d = describePlanDelta(p, {
      distributed: p.distributed.length, nodal: p.nodal.length,
      combinations: 0, caseTypes: ['D', 'L'],
    });
    expect(d.changes).toBe(false);
  });

  it('names the case types a plan adds', () => {
    const reg = applied(defaultRegulations());
    reg.seismic = { ...bindRole('seismic', 'inpres103-2018'), configComplete: true, state: 'applied' };
    const p = buildLoadPlan(input({
      regulations: reg,
      seismic: { enabled: true, coefficient: 0.15, liveParticipation: 0.25, directions: { x: true, y: false } },
    }));
    const d = describePlanDelta(p, { distributed: 0, nodal: 0, combinations: 0, caseTypes: ['D', 'L'] });
    expect(d.addedCaseTypes).toContain('E');
  });
});
