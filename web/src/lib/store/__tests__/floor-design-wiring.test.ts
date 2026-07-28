/**
 * Regression pin: the slab and wall engines must be reachable through the STORE.
 *
 * PR18 shipped `designSlabPanel`, `designWall`, `checkFooting` and `buildFloorAssembly`
 * with no caller outside their own unit tests, and an e2e spec that injected a
 * hand-written `DetailingAssembly` through `seedDetailing`. Every engine-level test was
 * green and no user action could reach any of it.
 *
 * So this file drives the production command — `detailingStore.generateFloors()` — over a
 * model built through `modelStore`'s own API, and asserts that real assemblies with real
 * bars come out. Nothing is seeded.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { modelStore } from '../model.svelte';
import { detailingStore } from '../detailing.svelte';
import { resultsStore } from '../results.svelte';
import type { QuadStress } from '../../engine/types-3d';

/**
 * The assemblies as PERSISTED on the model.
 *
 * Read from the model rather than from `detailingStore.assemblies`, which is a `$derived`
 * and does not recompute inside the synchronous call that wrote it. The model is the thing
 * that actually persists, so it is also the stronger assertion.
 */
function persistedIds(): string[] {
  return (modelStore.model.detailing?.assemblies ?? []).map((a) => a.id);
}

/** Publish shell results the way the solve path does. */
function publishStresses(quadStresses: QuadStress[]) {
  resultsStore.setResults3D({
    displacements: [], reactions: [], elementForces: [], quadStresses,
  });
}

/** A 5 × 5 m slab quad at +3,00 carrying a surface load, on four columns. */
function buildSlabModel() {
  modelStore.clear();
  const base = [
    modelStore.addNode(0, 0, 0), modelStore.addNode(5, 0, 0),
    modelStore.addNode(5, 5, 0), modelStore.addNode(0, 5, 0),
  ];
  const top = [
    modelStore.addNode(0, 0, 3), modelStore.addNode(5, 0, 3),
    modelStore.addNode(5, 5, 3), modelStore.addNode(0, 5, 3),
  ];
  for (const n of base) modelStore.addSupport(n, 'fixed3d');
  for (let i = 0; i < 4; i++) modelStore.addElement(base[i], top[i], 'frame');
  const material = [...modelStore.model.materials.keys()][0];
  const quad = modelStore.addQuad([top[0], top[1], top[2], top[3]], material, 0.20);
  return { quad, top };
}

describe('detailingStore.generateFloors — the production command', () => {
  beforeEach(() => {
    modelStore.clear();
    detailingStore.clear();
  });

  it('explains itself rather than being silently inert with no shells', () => {
    modelStore.clear();
    const r = detailingStore.floorReadiness;
    expect(r.ready).toBe(false);
    expect(r.reasons.map((m) => m.key)).toContain('detailing.floorRun.noShells');
  });

  it('will not claim to be ready before the model is solved', () => {
    buildSlabModel();
    const r = detailingStore.floorReadiness;
    expect(r.ready).toBe(false);
    expect(r.shellCount).toBeGreaterThan(0);
    expect(r.reasons.map((m) => m.key)).toContain('detailing.floorRun.notSolved');
  });

  it('reads the shells out of the model, quads and plates alike', () => {
    const { quad } = buildSlabModel();
    expect(quad).toBeGreaterThan(0);
    expect(detailingStore.floorReadiness.shellCount).toBe(1);
  });

  it('produces assemblies with real bars from real geometry, seeding nothing', () => {
    const { quad } = buildSlabModel();
    modelStore.addSurfaceLoad3D(quad, 12);

    // Shell results are published through `resultsStore.setResults3D`, which is the same
    // setter the solve path uses — not a test-only hook. Everything below it (geometry,
    // loads, combinations, materials, the whole design chain) is the model's own.
    publishStresses([
      { elementId: quad, sigmaXx: 0, sigmaYy: 0, tauXy: 0, mx: 40, my: 30, mxy: 8, vonMises: 0 },
    ]);
    const result = detailingStore.generateFloors();

    expect(result).not.toBeNull();
    expect(result!.slabs).toHaveLength(1);
    expect(result!.assemblies.length).toBeGreaterThan(0);

    const bars = result!.assemblies.flatMap((a) => a.bars);
    expect(bars.length).toBeGreaterThan(0);
    expect(bars.some((b) => b.id.startsWith(`P${quad}-`))).toBe(true);
  });

  it('writes the assemblies onto the model, so they persist', () => {
    const { quad } = buildSlabModel();
    modelStore.addSurfaceLoad3D(quad, 12);
    publishStresses([
      { elementId: quad, sigmaXx: 0, sigmaYy: 0, tauXy: 0, mx: 40, my: 30, mxy: 8, vonMises: 0 },
    ]);
    detailingStore.generateFloors();
    expect(persistedIds().some((id) => id.startsWith('FLOOR-'))).toBe(true);
  });

  it('does not destroy beam assemblies when floors are generated', () => {
    const { quad } = buildSlabModel();
    modelStore.addSurfaceLoad3D(quad, 12);
    // A beam-line assembly already present, as `generate()` would have left it.
    detailingStore.setAssemblies([{
      id: 'BEAM-1', kind: 'beamLine', label: 'Beams', elementIds: [1],
      bars: [], marks: [], joints: [], conflicts: [], unsupported: [],
      detailingRevision: 1, demandRevision: 1, state: 'COORDINATED',
      maturity: 'IMPLEMENTED_PROVISIONAL',
      provenance: { edition: '2025', verifierId: '', trace: [], assumptions: [] },
    } as never]);

    publishStresses([
      { elementId: quad, sigmaXx: 0, sigmaYy: 0, tauXy: 0, mx: 40, my: 30, mxy: 8, vonMises: 0 },
    ]);
    detailingStore.generateFloors();

    const ids = persistedIds();
    expect(ids).toContain('BEAM-1');
    expect(ids.some((id) => id.startsWith('FLOOR-'))).toBe(true);
  });

  it('re-running replaces its own floor assemblies rather than accumulating them', () => {
    const { quad } = buildSlabModel();
    modelStore.addSurfaceLoad3D(quad, 12);
    publishStresses([
      { elementId: quad, sigmaXx: 0, sigmaYy: 0, tauXy: 0, mx: 40, my: 30, mxy: 8, vonMises: 0 },
    ]);
    detailingStore.generateFloors();
    const first = persistedIds().filter((id) => id.startsWith('FLOOR-')).length;
    detailingStore.generateFloors();
    const second = persistedIds().filter((id) => id.startsWith('FLOOR-')).length;
    expect(second).toBe(first);
  });

  it('factors the area load through the project combinations, not a nominal figure', () => {
    const { quad } = buildSlabModel();
    // 10 kPa dead on case 1. The default combination set factors D above 1,0, so the
    // factored load the shear check receives must exceed the load that was applied.
    modelStore.addSurfaceLoad3D(quad, 10, 1);
    publishStresses([
      { elementId: quad, sigmaXx: 0, sigmaYy: 0, tauXy: 0, mx: 40, my: 30, mxy: 8, vonMises: 0 },
    ]);
    const r = detailingStore.generateFloors();
    expect(r).not.toBeNull();
    const memo = r!.slabs[0].shear.memo;
    const qu = Number(/vu = ([\d.]+)/.exec(memo)?.[1] ?? '0');
    expect(qu).toBeGreaterThan(10);
  });

  it('does not claim members were re-verified when no verifier ran on them', () => {
    const { quad } = buildSlabModel();
    modelStore.addSurfaceLoad3D(quad, 12);
    publishStresses([
      { elementId: quad, sigmaXx: 0, sigmaYy: 0, tauXy: 0, mx: 40, my: 30, mxy: 8, vonMises: 0 },
    ]);
    const r = detailingStore.generateFloors();
    // Shell design does not go through the frame verifier. Claiming otherwise would
    // satisfy two constructibility conditions that nothing measured.
    const a = r!.assemblies[0];
    expect(a.constructibility.blocking).toContain('allMembersReverified');
    expect(a.state).not.toBe('CONSTRUCTIBLE');
  });
});
