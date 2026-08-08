/**
 * The 3-D scene is a projection, and these tests are what makes that a fact rather than a
 * claim in a comment.
 *
 * The interesting assertions are not "a bar came out". They are the ones that would fail if
 * this module ever started deciding something for itself: that the polyline it hands the
 * renderer is byte-for-byte what `samplePath` gives the elevation and the clash check, that
 * the marks are the schedule's, and that concrete it was not given is REPORTED rather than
 * quietly omitted.
 */

import { describe, expect, it } from 'vitest';
import {
  buildSceneModel, filterScene, summariseScene, barMatchesFilter,
  type MemberGeometry, type SceneBar,
} from '../scene-model';
import { buildDocumentModel, type CertificateEntry } from '../document-model';
import type { DetailingAssembly } from '../assembly';
import type { BarConflict } from '../collision';
import type { FootingDesignRecord } from '../family-record';
import { buildStraightBarWithHooks, samplePath, type BarPath }
  from '../../../codes/cirsoc201/bar-geometry';

const X = { x: 1, y: 0, z: 0 };
const UP = { x: 0, y: 0, z: 1 };

function bar(id: string, over: Partial<Parameters<typeof buildStraightBarWithHooks>[0]> = {}):
BarPath {
  return buildStraightBarWithHooks({
    id, diameterMm: 16, role: 'longitudinal',
    start: { x: 0, y: 0, z: 0.05 }, end: { x: 5, y: 0, z: 0.05 },
    axis: X, hookNormal: UP,
    ownerElementIds: [1], layerId: 'e1:bottom:0',
    ...over,
  });
}

function assembly(over: Partial<DetailingAssembly> = {}): DetailingAssembly {
  return {
    id: 'level-3.20', labelKey: 'detailing.assembly.level', labelParams: { level: '3.20' },
    kind: 'beamLine', elementIds: [1, 2],
    bars: [bar('b1', { endHook: 90 }), bar('b2')],
    joints: [], conflicts: [], unsupported: [],
    marks: [{
      mark: 'B1', diameterMm: 16, cuttingLength: 5.34, quantity: 2,
      shape: 'L90', massKg: 16.9, barIds: ['b1', 'b2'],
    }],
    state: 'CONSTRUCTIBLE', stateBlockers: [], detailingRevision: 7,
    maturity: 'VALIDATED',
    provenance: { edition: '2025', verifierId: 'cirsoc201.v2', trace: [], assumptions: [] },
    ...over,
  } as DetailingAssembly;
}

const CERT: CertificateEntry = {
  elementId: 1, certifiedHash: 'h', currentHash: 'h', matches: true,
  verifierId: 'cirsoc201.v2', status: 'ok',
};

const CONFLICT = {
  severity: 'blocking', barA: 'b1', barB: 'b2', at: { x: 2, y: 0, z: 0.05 },
  clearance: -0.006, required: 0.025, shortfall: 0.031,
  elementIds: [1, 2], pairClass: 'prohibitedOverlap',
} as unknown as BarConflict;

function doc(over: { assemblies?: DetailingAssembly[] } = {}) {
  return buildDocumentModel({
    seriesId: 'S',
    revision: {
      number: 5, at: '2026-07-27T09:00:00Z', author: 'Bauti',
      detailingRevision: 7, demandRevision: 4,
    },
    regulations: [{ id: 'cirsoc-201', edition: '2025' }],
    assemblies: over.assemblies ?? [assembly({ state: 'ISSUED' })],
    laps: [], certificates: [CERT],
  });
}

const MEMBERS: MemberGeometry[] = [
  {
    elementId: 1, kind: 'beam',
    start: { x: 0, y: 0, z: 0 }, end: { x: 5, y: 0, z: 0 },
    width: 0.2, depth: 0.5,
  },
  {
    elementId: 2, kind: 'column',
    start: { x: 5, y: 0, z: 0 }, end: { x: 5, y: 0, z: 3 },
    width: 0.4, depth: 0.4,
  },
];

// ─── The projection rule ─────────────────────────────────────────

describe('the scene reads the document and nothing else', () => {
  const scene = buildSceneModel(doc(), { members: MEMBERS });

  it('samples every bar with the SAME function the elevation and the clash check use', () => {
    // Not "close to": identical. Two samplings of one hook that differ by a chord tolerance
    // are two hooks, and the whole point of the projection is that there is one.
    const source = assembly().bars;
    for (const src of source) {
      const drawn = scene.bars.find((b) => b.barId === src.id) as SceneBar;
      expect(drawn.polyline).toEqual(samplePath(src));
    }
  });

  it('carries the schedule mark, not a mark of its own', () => {
    expect(scene.bars.map((b) => b.mark)).toEqual(['B1', 'B1']);
  });

  it('states which document it is showing, and what that document may claim', () => {
    expect(scene.seriesId).toBe('S');
    expect(scene.revision).toBe(5);
    expect(scene.readiness).toBe('ISSUED');
  });

  it('is deterministic: two builds of one document are the same scene', () => {
    expect(buildSceneModel(doc(), { members: MEMBERS }))
      .toEqual(buildSceneModel(doc(), { members: MEMBERS }));
  });
});

// ─── Concrete ────────────────────────────────────────────────────

describe('concrete the caller did not supply is reported, not omitted', () => {
  it('resolves the members it was given', () => {
    const scene = buildSceneModel(doc(), { members: MEMBERS });
    expect(scene.solids.map((s) => s.id).sort()).toEqual(['member:1', 'member:2']);
    expect(scene.unresolvedMembers).toEqual([]);
  });

  it('names the members it was NOT given', () => {
    const scene = buildSceneModel(doc(), { members: [MEMBERS[0]] });
    expect(scene.unresolvedMembers).toEqual([2]);
  });

  it('reports every member the ASSEMBLY claims, not only the ones with steel on them', () => {
    // Element 2 owns no bar in this fixture. A scene that decided membership from bar
    // owners would call the floor complete while a whole member was missing from it.
    const scene = buildSceneModel(doc(), { members: [] });
    expect(scene.unresolvedMembers).toEqual([1, 2]);
  });

  it('builds a column section in the plane normal to a VERTICAL axis', () => {
    const scene = buildSceneModel(doc(), { members: MEMBERS });
    const col = scene.solids.find((s) => s.id === 'member:2')!;
    // All four base corners sit at the column foot, and the sweep is the 3 m height.
    expect(col.base.every((p) => p.z === 0)).toBe(true);
    expect(col.extrude).toEqual({ x: 0, y: 0, z: 3 });
    // 0.40 × 0.40 about the axis at x = 5.
    expect(col.base.map((p) => Math.round(p.x * 1000) / 1000).sort())
      .toEqual([4.8, 4.8, 5.2, 5.2]);
  });

  it('builds a beam section in the plane normal to a HORIZONTAL axis', () => {
    const scene = buildSceneModel(doc(), { members: MEMBERS });
    const beam = scene.solids.find((s) => s.id === 'member:1')!;
    expect(beam.extrude).toEqual({ x: 5, y: 0, z: 0 });
    // The 0.5 m depth is vertical and the 0.2 m width is across — not the other way round.
    const zs = beam.base.map((p) => Math.round(p.z * 1000) / 1000);
    expect(Math.max(...zs) - Math.min(...zs)).toBeCloseTo(0.5, 6);
    const ys = beam.base.map((p) => Math.round(p.y * 1000) / 1000);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(0.2, 6);
  });
});

describe('a footing solid comes from its record, and is placed by its dowels', () => {
  const dowel = bar('d1', {
    diameterMm: 20, start: { x: 3, y: 2, z: -0.6 }, end: { x: 3, y: 2, z: 1.2 },
    axis: UP, hookNormal: X, ownerElementIds: [9], layerId: 'f1:dowel:0',
  });

  const record = {
    family: 'footing', ownerId: 'F1', ownerElementIds: [9], barIds: ['d1'],
    // Enough certificate for `buildDocumentModel` to ask its freshness question. The answer
    // is not what this describe block is about; the geometry it carries is.
    certificate: {
      family: 'footing', recordId: 'footing:F1', ownerId: 'F1', ownerElementIds: [9],
      inputHash: 'i', geometryHash: 'g',
      revisions: { analysis: 1, loads: 1, regulation: 1, entity: 1 },
      edition: '2025', governingChecks: [], status: 'CERTIFIED', maturity: 'VALIDATED',
      assumptions: [], reinforcementHash: 'r', finalGeometryHash: 'f',
    },
    geometryHash: 'g', inputHash: 'i',
    geometry: {
      footingId: 9, name: 'Z1', kind: 'isolated', B: 2.5, L: 2.0, thickness: 0.6,
      rotationDeg: 0, eccentricityB: 0, eccentricityL: 0, cover: 0.05,
      foundingElevation: -1.2, d: 0.52,
    },
    dowels: { count: 1, diameterMm: 20, ldFooting: 0.5, lapAbove: 0.6, hooked: false, barIds: ['d1'] },
  } as unknown as FootingDesignRecord;

  const scene = buildSceneModel(doc({
    assemblies: [assembly({
      id: 'FLOOR', elementIds: [], bars: [dowel], marks: [], families: [record],
    })],
  }));

  it('sits at the founding elevation and rises by its own thickness', () => {
    const f = scene.solids.find((s) => s.kind === 'footing')!;
    expect(f.base.every((p) => p.z === -1.2)).toBe(true);
    expect(f.extrude).toEqual({ x: 0, y: 0, z: 0.6 });
  });

  it('is centred on the dowel it starts, not on the origin', () => {
    const f = scene.solids.find((s) => s.kind === 'footing')!;
    const xs = f.base.map((p) => p.x);
    const ys = f.base.map((p) => p.y);
    expect((Math.min(...xs) + Math.max(...xs)) / 2).toBeCloseTo(3, 9);
    expect((Math.min(...ys) + Math.max(...ys)) / 2).toBeCloseTo(2, 9);
    // B along x, L along y — swapping them is the classic silent footing bug.
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(2.5, 9);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(2.0, 9);
  });

  it('tags the bar with the family that owns it', () => {
    expect(scene.bars[0].family).toBe('footing');
  });
});

// ─── Conflicts ───────────────────────────────────────────────────

describe('conflicts are placed in space, not only listed', () => {
  const scene = buildSceneModel(
    doc({ assemblies: [assembly({ conflicts: [CONFLICT], state: 'COORDINATED' })] }),
    { members: MEMBERS });

  it('flags both bars named by the conflict', () => {
    expect(scene.bars.filter((b) => b.conflicted).map((b) => b.barId)).toEqual(['b1', 'b2']);
  });

  it('carries what was measured and what was required, unchanged', () => {
    expect(scene.conflicts).toHaveLength(1);
    expect(scene.conflicts[0].clearance).toBe(-0.006);
    expect(scene.conflicts[0].required).toBe(0.025);
    expect(scene.conflicts[0].at).toEqual({ x: 2, y: 0, z: 0.05 });
  });

  it('drops the readiness to a draft, so the view cannot render a clean cage', () => {
    expect(scene.readiness).toBe('REVIEW_DRAFT');
  });
});

// ─── Filtering ───────────────────────────────────────────────────

describe('an absent filter and an empty filter are different states', () => {
  const scene = buildSceneModel(doc(), { members: MEMBERS });

  it('absent means no restriction', () => {
    expect(filterScene(scene, {}).bars).toHaveLength(2);
  });

  it('empty means nothing matches', () => {
    // The state a UI reaches when the user deselects the last checkbox. Showing the whole
    // floor there is the bug this distinction exists to prevent.
    expect(filterScene(scene, { roles: [] }).bars).toHaveLength(0);
  });

  it('hides frame steel when the user narrows to a floor family', () => {
    // Beam and column bars belong to no family. "Show me the footings" must not answer
    // "this bar has no family, so it is not excluded" and put the frame back on screen.
    expect(barMatchesFilter(scene.bars[0], { families: ['footing'] })).toBe(false);
  });

  it('keeps a conflict marker only while a bar it names is visible', () => {
    const withConflict = buildSceneModel(
      doc({ assemblies: [assembly({ conflicts: [CONFLICT] })] }), { members: MEMBERS });
    expect(filterScene(withConflict, { conflictedOnly: true }).conflicts).toHaveLength(1);
    expect(filterScene(withConflict, { roles: [] }).conflicts).toHaveLength(0);
  });

  it('keeps the concrete a visible bar sits in, whatever the bar filter says', () => {
    // Narrowing to a ROLE is a question about steel. Answering it by also hiding the beam
    // the steel is in would leave bars floating in space, which is a different picture from
    // the one the user asked for.
    const all = buildSceneModel(doc(), { members: MEMBERS });
    expect(filterScene(all, { roles: ['longitudinal'] }).solids).toHaveLength(2);
  });

  it('reframes the bounds around what is left, and frames nothing as null', () => {
    const all = buildSceneModel(doc(), { members: MEMBERS });
    // The column reaches z = 3, so the unfiltered scene is framed on the concrete.
    expect(all.bounds!.max.z).toBeCloseTo(3, 9);
    // With no assembly visible there is no solid either, and a camera cannot frame nothing.
    const empty = filterScene(all, { roles: [] });
    expect(empty.solids).toEqual([]);
    expect(empty.bounds).toBeNull();
  });
});

// ─── Facets and summary ──────────────────────────────────────────

describe('the view offers what exists and counts what it shows', () => {
  const scene = buildSceneModel(doc(), { members: MEMBERS });

  it('lists every assembly in document order, with its bar count', () => {
    expect(scene.facets.assemblies).toEqual([
      { id: 'level-3.20', label: { key: 'detailing.assembly.level', params: { level: '3.20' } }, barCount: 2 },
    ]);
  });

  it('offers only the layers and roles actually present', () => {
    expect(scene.facets.layers).toEqual(['e1:bottom:0']);
    expect(scene.facets.roles).toEqual(['longitudinal']);
    expect(scene.facets.families).toEqual([]);
  });

  it('totals the same cutting lengths the schedule bills', () => {
    const s = summariseScene(scene);
    expect(s.barCount).toBe(2);
    expect(s.totalLength).toBeCloseTo(
      assembly().bars.reduce((n, b) => n + b.cuttingLength, 0), 9);
    expect(s.byDiameter).toEqual([
      { diameterMm: 16, count: 2, lengthM: s.totalLength },
    ]);
  });

  it('summarises what is FILTERED, not what was built', () => {
    expect(summariseScene(filterScene(scene, { roles: [] })).barCount).toBe(0);
  });
});
