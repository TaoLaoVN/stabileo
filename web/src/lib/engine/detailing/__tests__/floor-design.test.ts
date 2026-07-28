import { describe, it, expect } from 'vitest';
import {
  buildFloorAssembly, generateDowels, generateSlabBars,
  type DowelInput, type FloorAssemblyInput, type SlabPanelGeometry,
} from '../floor-design';
import { designSlabPanel } from '../slab-design';
import { designWall } from '../wall-design';
import type { WallGeometry } from '../floor-transverse';
import { checkFooting } from '../foundation-check';

const geometry: SlabPanelGeometry = {
  panelId: 'P1', origin: { x: 0, y: 0, z: 3.0 },
  lx: 5, ly: 5, thickness: 0.20, cover: 0.025, elementIds: [50],
};

const slabDesign = () => designSlabPanel({
  panelId: 'P1', lx: 5, ly: 5, thickness: 0.20, cover: 0.025, supportedSides: 4,
  fc: 25, fy: 420, maxAggregateSizeMm: 20, edition: '2025',
  moments: { mx: 40, my: 30, mxy: 8 }, qu: 12,
});

/**
 * The wall's physical placement. A wall without geometry can be checked but not drawn, so
 * the floor now reports that as an unsupported condition rather than silently omitting the
 * steel — which is what it used to do.
 */
const wallGeometry: WallGeometry = {
  wallId: 'W1', start: { x: 0, y: 6, z: 0 }, end: { x: 4, y: 6, z: 0 },
  height: 3, thickness: 0.20, cover: 0.025, elementIds: [60],
};

const wallDesign = () => designWall({
  wallId: 'W1', length: 4, height: 3, thickness: 0.20, cover: 0.025,
  fc: 25, fy: 420, barDiameterMm: 12, edition: '2025',
  pu: 800, muInPlane: 300, vuInPlane: 200, seismicRequired: false,
});

const footing = () => checkFooting({
  kind: 'isolated', B: 2.5, L: 2.5, thickness: 0.60, d: 0.52,
  columnB: 0.40, columnH: 0.40, fc: 25, allowableBearing: 250,
  serviceAxial: 900, factoredAxial: 1250, position: 'interior',
});

function dowels(over: Partial<DowelInput> = {}): DowelInput {
  return {
    id: 'F1-C1', centre: { x: 0, y: 0 }, footingTopZ: 0,
    footingThickness: 0.60, footingCover: 0.05,
    columnB: 0.40, columnH: 0.40, cover: 0.025, tieDia: 8,
    bars: { count: 8, diameterMm: 20 },
    ldFooting: 0.40, lapAbove: 1.0, elementIds: [1], edition: '2025',
    ...over,
  };
}

describe('slab bar generation', () => {
  it('produces bars for every designed layer', () => {
    const d = slabDesign();
    const bars = generateSlabBars(geometry, d.layers, '2025');
    expect(bars.length).toBeGreaterThan(0);
    for (const layer of d.layers) {
      expect(bars.some((b) => b.id.includes(`-${layer.face[0]}${layer.direction}-`))).toBe(true);
    }
  });

  it('spaces bars at the designed spacing across the panel', () => {
    const layer = slabDesign().layers.find((l) => l.face === 'bottom' && l.direction === 'x')!;
    const bars = generateSlabBars(geometry, [layer], '2025');
    expect(bars).toHaveLength(Math.floor(5 / layer.spacing));
    const ys = bars.map((b) => b.segments[0].start.y);
    expect(ys[1] - ys[0]).toBeCloseTo(layer.spacing, 9);
  });

  it('extends bars past the panel edge for anchorage', () => {
    const layer = slabDesign().layers.find((l) => l.direction === 'x')!;
    const b = generateSlabBars(geometry, [layer], '2025')[0];
    expect(b.segments[0].start.x).toBeCloseTo(-0.15, 9);
    expect(b.cuttingLength).toBeCloseTo(5.3, 6);
  });

  it('puts top bars above bottom bars', () => {
    const d = slabDesign();
    const bars = generateSlabBars(geometry, d.layers, '2025');
    const top = bars.find((b) => b.id.includes('-tx-'))!;
    const bot = bars.find((b) => b.id.includes('-bx-'))!;
    expect(top.segments[0].start.z).toBeGreaterThan(bot.segments[0].start.z);
  });

  it('tucks the y bars inside the x bars on the same face', () => {
    // Without this an x and a y bar on the same face sit at the same depth and every
    // crossing reads as a clash.
    const d = slabDesign();
    const bars = generateSlabBars(geometry, d.layers, '2025');
    const bx = bars.find((b) => b.id.includes('-bx-'))!;
    const by = bars.find((b) => b.id.includes('-by-'))!;
    expect(by.segments[0].start.z).toBeGreaterThan(bx.segments[0].start.z);
  });

  it('keeps every bar inside the slab thickness', () => {
    const bars = generateSlabBars(geometry, slabDesign().layers, '2025');
    for (const b of bars) {
      const z = b.segments[0].start.z - geometry.origin.z;
      expect(Math.abs(z)).toBeLessThan(geometry.thickness / 2);
    }
  });

  it('attributes bars to the panel elements', () => {
    for (const b of generateSlabBars(geometry, slabDesign().layers, '2025')) {
      expect(b.ownerElementIds).toEqual([50]);
    }
  });

  it('is deterministic', () => {
    const d = slabDesign();
    expect(JSON.stringify(generateSlabBars(geometry, d.layers, '2025')))
      .toBe(JSON.stringify(generateSlabBars(geometry, d.layers, '2025')));
  });
});

describe('column starters and foundation dowels', () => {
  it('generates one dowel per column bar', () => {
    expect(generateDowels(dowels()).bars).toHaveLength(8);
  });

  it('embeds into the footing and laps above it', () => {
    const b = generateDowels(dowels()).bars[0];
    const zs = b.segments.flatMap((s) => [s.start.z, s.end.z]);
    expect(Math.min(...zs)).toBeLessThan(0);
    expect(Math.max(...zs)).toBeCloseTo(1.0, 6);
  });

  it('hooks the bottom when a straight development length will not fit', () => {
    // A footing is rarely deep enough for a straight l_d, which is exactly why the hook
    // exists.
    const deep = generateDowels(dowels({ ldFooting: 1.2 }));
    expect(deep.notes.join(' ')).toMatch(/rematan con gancho a 90/);
    expect(deep.bars[0].startTreatment.kind).toBe('hook');
  });

  it('leaves the bottom straight when there is room', () => {
    const shallow = generateDowels(dowels({ ldFooting: 0.20 }));
    expect(shallow.notes).toEqual([]);
    expect(shallow.bars[0].startTreatment.kind).toBe('straight');
  });

  it('never embeds past the footing bottom mat', () => {
    const b = generateDowels(dowels({ ldFooting: 5 })).bars[0];
    const lowest = Math.min(...b.segments.flatMap((s) => [s.start.z, s.end.z]));
    // Footing top 0, thickness 0.60, cover 0.05, 50 mm allowance for the mat.
    expect(lowest).toBeGreaterThanOrEqual(-(0.60 - 0.05 - 0.05) - 0.2);
  });

  it('cites §16.3.4 force transfer', () => {
    expect(generateDowels(dowels()).refs.some((r) => r.clause === '16.3.4')).toBe(true);
  });

  it('places dowels inside the column cover envelope', () => {
    const inset = 0.025 + 0.008 + 0.010;
    const xs = generateDowels(dowels()).bars.map((b) => b.segments[0].start.x);
    expect(Math.max(...xs)).toBeLessThanOrEqual(0.20 - inset + 1e-9);
  });
});

// ─── Floor assembly ──────────────────────────────────────────────

function floor(over: Partial<FloorAssemblyInput> = {}): FloorAssemblyInput {
  return {
    assemblyId: 'FLOOR-1', label: 'Nivel +3,00', edition: '2025',
    verifierId: 'cirsoc201.provided.v2.2025', demandRevision: 5,
    maxAggregateSizeMm: 20,
    slabs: [{ geometry, design: slabDesign() }],
    walls: [{
      wallId: 'W1', design: wallDesign(), elementIds: [60],
      geometry: wallGeometry, barDiameterMm: 12,
    }],
    footings: [{ id: 'F1', check: footing(), elementIds: [1], dowels: dowels() }],
    membersVerified: true,
    ...over,
  };
}

describe('whole-floor assembly', () => {
  it('collects bars from slabs and dowels into one assembly', () => {
    const r = buildFloorAssembly(floor());
    expect(r.assembly.bars.length).toBeGreaterThan(8);
    expect(r.assembly.marks.length).toBeGreaterThan(0);
  });

  it('merges the element ids of every family, sorted', () => {
    const ids = buildFloorAssembly(floor()).assembly.elementIds;
    expect(ids).toEqual([1, 50, 60]);
  });

  it('checks slab bars against dowels with the same engine that checks beam bars', () => {
    const r = buildFloorAssembly(floor());
    expect(r.trace.join(' ')).toMatch(/Verificación de interferencias sobre \d+ barra/);
    expect(r.trace.join(' ')).toMatch(/par\(es\) evaluado/);
  });

  it('carries each family\'s unsupported conditions with its own scope', () => {
    const r = buildFloorAssembly(floor({
      walls: [{
        wallId: 'W1', geometry: wallGeometry, barDiameterMm: 12,
        design: designWall({
          wallId: 'W1', length: 4, height: 3, thickness: 0.20, cover: 0.025,
          fc: 25, fy: 420, barDiameterMm: 12, edition: '2025',
          pu: 800, muInPlane: 300, vuInPlane: 200, seismicRequired: true,
        }),
        elementIds: [60],
      }],
    }));
    const wall = r.assembly.unsupported.find((u) => u.key === 'wall')!;
    expect(wall.message).toMatch(/103 Parte II/);
    expect(wall.scope.elementIds).toEqual([60]);
  });

  it('keeps producing output for the rest of the floor when one panel is problematic', () => {
    const bad = designSlabPanel({
      panelId: 'P2', lx: 5, ly: 5, thickness: 0.20, cover: 0.025, supportedSides: 4,
      fc: 25, fy: 420, maxAggregateSizeMm: 20, edition: '2025',
      moments: { mx: 40, my: 30, mxy: 8 }, qu: 12,
      openings: [{ x: 1, y: 1, w: 1, h: 1 }],
    });
    const r = buildFloorAssembly(floor({
      slabs: [
        { geometry, design: slabDesign() },
        { geometry: { ...geometry, panelId: 'P2', elementIds: [51] }, design: bad },
      ],
    }));
    expect(r.assembly.unsupported.some((u) => u.message.includes('abertura'))).toBe(true);
    // The good panel still produced bars and marks.
    expect(r.assembly.bars.some((b) => b.id.startsWith('P1-'))).toBe(true);
    expect(r.assembly.marks.length).toBeGreaterThan(0);
  });

  it('takes the worst maturity across the families', () => {
    // The slab and wall engines are provisional, so the floor is too.
    expect(buildFloorAssembly(floor()).assembly.maturity).toBe('IMPLEMENTED_PROVISIONAL');
  });

  it('drops to UNSUPPORTED when a footing could not be checked', () => {
    const r = buildFloorAssembly(floor({
      footings: [{
        id: 'F1',
        check: checkFooting({
          kind: 'combined', B: 2.5, L: 5, thickness: 0.60, d: 0.52,
          columnB: 0.40, columnH: 0.40, fc: 25, allowableBearing: 250,
          serviceAxial: 900, factoredAxial: 1250,
        }),
        elementIds: [1],
      }],
    }));
    expect(r.assembly.maturity).toBe('UNSUPPORTED');
    expect(r.assembly.unsupported.some((u) => u.key === 'foundation')).toBe(true);
  });

  it('reaches CONSTRUCTIBLE for a clean floor', () => {
    const r = buildFloorAssembly(floor());
    expect(r.assembly.unsupported).toEqual([]);
    expect(r.assembly.conflicts).toEqual([]);
    expect(r.assembly.state).toBe('CONSTRUCTIBLE');
  });

  it('blocks CONSTRUCTIBLE while an unsupported condition remains', () => {
    const r = buildFloorAssembly(floor({
      walls: [{
        wallId: 'W1', geometry: wallGeometry, barDiameterMm: 12,
        design: designWall({
          wallId: 'W1', length: 4, height: 3, thickness: 0.20, cover: 0.025,
          fc: 25, fy: 420, barDiameterMm: 12, edition: '2025',
          pu: 800, muInPlane: 300, vuInPlane: 200, seismicRequired: true,
        }),
        elementIds: [60],
      }],
    }));
    expect(r.assembly.unsupported.length).toBeGreaterThan(0);
    expect(r.assembly.state).toBe('COORDINATED');
  });

  it('does not report an orthogonal slab mat as eleven thousand overlaps', () => {
    // Two bars running in different directions cross, and in a mat they are MEANT to be
    // in contact - that is what the tie wire is for. Clear spacing is a rule about
    // parallel bars, where concrete has to flow between them along their length.
    const r = buildFloorAssembly(floor({ walls: [], footings: [] }));
    expect(r.assembly.conflicts).toEqual([]);
    // They still must not interpenetrate: the generator stacks the second direction a
    // full diameter inside the first.
    const bx = r.assembly.bars.find((b) => b.id.includes('-bx-'))!;
    const by = r.assembly.bars.find((b) => b.id.includes('-by-'))!;
    const gap = Math.abs(by.segments[0].start.z - bx.segments[0].start.z);
    expect(gap).toBeGreaterThanOrEqual((bx.diameterMm / 2 + by.diameterMm / 2) / 1000 - 1e-9);
  });

  it('still catches two PARALLEL bars that are too close', () => {
    const r = buildFloorAssembly(floor({
      walls: [], footings: [],
      slabs: [{
        geometry,
        design: {
          ...slabDesign(),
          layers: [
            {
              face: 'bottom', direction: 'x', diameterMm: 20, spacing: 0.025,
              asProvided: 1, asRequired: 1, minimumGoverns: false, refs: [],
            },
          ],
        },
      }],
    }));
    expect(r.assembly.conflicts.length).toBeGreaterThan(0);
  });

  it('collects assumptions without duplicating them', () => {
    const r = buildFloorAssembly(floor({
      slabs: [
        { geometry, design: slabDesign() },
        { geometry: { ...geometry, panelId: 'P2' }, design: slabDesign() },
      ],
    }));
    const a = r.assembly.provenance.assumptions;
    expect(new Set(a).size).toBe(a.length);
  });

  it('increments the revision rather than resetting it', () => {
    expect(buildFloorAssembly(floor({ previousRevision: 4 })).assembly.detailingRevision).toBe(5);
  });

  it('stamps the edition and verifier', () => {
    const p = buildFloorAssembly(floor()).assembly.provenance;
    expect(p.edition).toBe('2025');
    expect(p.verifierId).toBe('cirsoc201.provided.v2.2025');
  });

  it('is deterministic', () => {
    expect(JSON.stringify(buildFloorAssembly(floor())))
      .toBe(JSON.stringify(buildFloorAssembly(floor())));
  });

  it('handles an empty floor without throwing', () => {
    const r = buildFloorAssembly(floor({ slabs: [], walls: [], footings: [] }));
    expect(r.assembly.bars).toEqual([]);
    expect(r.assembly.state).toBe('VERIFIED');
  });
});
