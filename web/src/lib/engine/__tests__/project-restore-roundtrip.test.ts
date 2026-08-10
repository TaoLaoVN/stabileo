/**
 * Save → reload → restore → calculate, on a real project.
 *
 * ── The failure this file exists to keep dead ───────────────────────
 *
 * Opening `Edificio H.A. 7 pisos — PRO`, reloading, pressing Restaurar and then Calcular
 * produced two errors and no results:
 *
 *   Error al resolver 3D: Failed to execute 'postMessage' on 'Worker':
 *   [object Array] could not be cloned.
 *
 *   Error en caso 3D "Superimposed dead (screed+finish+partitions)":
 *   Parse error: Error: invalid type: unit value, expected a sequence
 *
 * Three independent defects, all on the restore path, none of them in the solver:
 *
 *  1. `buildSolverInput3D` passed `constraints` and every shell's `nodes` list into the wire
 *     BY REFERENCE. Read off a reactive store those are proxies, and structured clone rejects
 *     a proxy outright — so `worker.postMessage` threw on EVERY solve of any model carrying a
 *     constraint, restored or not. The parallel path caught it and fell back to the sequential
 *     solver, which produced correct results, so the worker pool had silently stopped being
 *     used at all. (Measured on this building: 2.4 s sequential vs 478 ms across the pool.)
 *
 *  2. `restore()` copied each family one level deep, so a snapshot read out of `$state` — which
 *     is what the autosave banner and the tab manager both hold — put its nested PROXY arrays
 *     into the live model, where they outlived the load and reached the wire from a second
 *     direction.
 *
 *  3. `migrateConstraint` wrote `dofs: mapDofs(raw.dofs)` for a rigid link, materialising an
 *     explicit `dofs: undefined` on the (normal) constraints that carry no `dofs`. Rust spells
 *     that field `#[serde(default)] dofs: Vec<usize>`, and `#[serde(default)]` covers a MISSING
 *     field, not a present one holding a unit value — hence "expected a sequence". The named
 *     load case was not special: it was simply the first one the per-case fallback tried.
 *
 * The assertions below are therefore about the three invariants, not about the two messages:
 * the restored project is load-case-equivalent, every payload the worker would receive is
 * structured-cloneable, and the restored model solves to the same numbers.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { modelStore } from '../../store/model.svelte';
import { serializeProject } from '../../store/file';
import { buildSolverInput3D } from '../solver-service';
import { input3DToWireObject, findUncloneablePath, isSolverReady, solve3D } from '../wasm-solver';
import type { Load, LoadCase } from '../../store/model.svelte';

const EXAMPLE = 'pro-edificio-7p';

/**
 * The snapshot as the restore path actually receives it: every object and array wrapped in a
 * Proxy.
 *
 * Two production callers hold a parsed project in `$state` before handing it to `restore()` —
 * the autosave banner and the tab manager — and Svelte hands a DEEP PROXY back out. A proxy is
 * an exotic object, which is precisely what structured clone refuses.
 *
 * A plain `$state` holder cannot stand in for that here: compiled for the server, which is how
 * Vitest builds these modules, `$state` is the identity function and proxies nothing. So the
 * condition is reproduced directly. That is not a weaker test — the defect was never about
 * Svelte specifically, it was about `restore()` adopting nested objects it does not own.
 */
function deepProxy<T>(value: T, depth = 0): T {
  if (value === null || typeof value !== 'object' || depth > 12) return value;
  if (Array.isArray(value)) {
    return new Proxy(value.map((v) => deepProxy(v, depth + 1)), {}) as unknown as T;
  }
  const inner: Record<string, unknown> = {};
  for (const k of Object.keys(value as Record<string, unknown>)) {
    inner[k] = deepProxy((value as Record<string, unknown>)[k], depth + 1);
  }
  return new Proxy(inner, {}) as unknown as T;
}

/** The per-case load payload, in a form two runs can be compared by. */
function loadFingerprint(loads: Load[], cases: LoadCase[]): string {
  return cases
    .map((lc) => {
      const mine = loads
        .filter((l) => (l.data.caseId ?? 1) === lc.id)
        .map((l) => `${l.type}:${JSON.stringify(l.data)}`)
        .sort();
      return `#${lc.id}/${lc.type}/${lc.name}\n${mine.join('\n')}`;
    })
    .join('\n--\n');
}

/** Every wire the worker pool would be sent for this model, one per load case. */
function perCaseWires(): Array<{ name: string; wire: Record<string, unknown> }> {
  const m = modelStore.model;
  return m.loadCases.map((lc) => {
    const caseModel = { ...m, loads: m.loads.filter((l) => (l.data.caseId ?? 1) === lc.id) };
    const input = buildSolverInput3D(caseModel as never, lc.type === 'D', false);
    return { name: lc.name, wire: input3DToWireObject(input!) };
  });
}

describe('project restore round-trip', () => {
  let beforeFingerprint: string;
  let beforeCases: number;
  let restoredOk = false;

  beforeAll(async () => {
    await modelStore.loadExample(EXAMPLE);
    expect(isSolverReady(), 'real WASM solver, not the Vite stub').toBe(true);
    beforeFingerprint = loadFingerprint(modelStore.model.loads, modelStore.model.loadCases);
    beforeCases = modelStore.model.loadCases.length;

    // Save exactly as autosave does, reload exactly as the banner does: the parsed
    // payload is reactive (hence proxied) before `restore()` ever sees it.
    const stored = JSON.parse(serializeProject());
    modelStore.restore(deepProxy(stored.snapshot));
    restoredOk = true;
  }, 300_000);

  it('restores every load case with its loads intact', () => {
    expect(restoredOk).toBe(true);
    expect(modelStore.model.loadCases.length).toBe(beforeCases);
    expect(loadFingerprint(modelStore.model.loads, modelStore.model.loadCases))
      .toBe(beforeFingerprint);
  });

  it('never converts a stored sequence into a unit value', () => {
    // A rigid link with no stored `dofs` must come back with NO `dofs` key at all —
    // an own property holding `undefined` is what serde rejects.
    const rigid = modelStore.model.constraints.filter((c) => c.type === 'rigidLink');
    expect(rigid.length, 'the example carries rigid links to migrate').toBeGreaterThan(0);
    for (const c of rigid) {
      if ('dofs' in c) expect(Array.isArray((c as { dofs?: unknown }).dofs)).toBe(true);
    }
    // Diaphragms must still carry their slave-node sequence.
    for (const c of modelStore.model.constraints) {
      if (c.type === 'diaphragm') {
        expect(Array.isArray((c as { slaveNodes?: unknown }).slaveNodes)).toBe(true);
        expect((c as { slaveNodes: number[] }).slaveNodes.length).toBeGreaterThan(0);
      }
    }
  });

  it('leaves no foreign reactive proxy inside the restored model', () => {
    // The model is the shared source for the scene projection, the sheets and the exporters,
    // not only for the solver — so a proxy adopted here is a hazard for all of them, and
    // `restore()` is where it has to be stopped. Asserted on the families whose nested
    // arrays/objects are only ever copied one level deep.
    for (const [id, q] of modelStore.model.quads) {
      expect(findUncloneablePath(q, `quad(${id})`), 'quad is plain data').toBeNull();
    }
    for (const [id, p] of modelStore.model.plates) {
      expect(findUncloneablePath(p, `plate(${id})`), 'plate is plain data').toBeNull();
    }
    expect(findUncloneablePath(modelStore.model.constraints, 'constraints')).toBeNull();
    expect(findUncloneablePath(modelStore.model.loads, 'loads')).toBeNull();
    for (const [id, e] of modelStore.model.elements) {
      expect(findUncloneablePath(e, `element(${id})`), 'element is plain data').toBeNull();
    }
  });

  it('produces a structured-cloneable payload even when the model holds a proxy', () => {
    // The wire is the LAST common point before both consumers (structured clone and
    // serde-wasm-bindgen), so it must not depend on every upstream producer having been
    // careful. A proxy planted directly in the model must not reach the worker.
    const m = modelStore.model;
    const quadId = [...m.quads.keys()][0];
    const quad = m.quads.get(quadId)!;
    const plainNodes = [...quad.nodes];
    quad.nodes = new Proxy(plainNodes, {}) as typeof quad.nodes;
    const conservedConstraints = m.constraints;
    m.constraints = new Proxy(conservedConstraints, {}) as typeof m.constraints;
    try {
      const input = buildSolverInput3D({ ...m, loads: [] } as never, false, false);
      const wire = input3DToWireObject(input!);
      expect(findUncloneablePath(wire)).toBeNull();
      expect(() => structuredClone(wire)).not.toThrow();
    } finally {
      quad.nodes = plainNodes as typeof quad.nodes;
      m.constraints = conservedConstraints;
    }
  });

  it('produces a structured-cloneable payload for every load case', () => {
    const wires = perCaseWires();
    expect(wires.length).toBe(beforeCases);
    for (const { name, wire } of wires) {
      const offender = findUncloneablePath(wire, `case(${name})`);
      expect(offender, `payload for "${name}" must be structured-cloneable`).toBeNull();
      // The guarantee the worker actually depends on, exercised directly.
      expect(() => structuredClone(wire)).not.toThrow();
    }
  });

  it('solves every restored load case', () => {
    const m = modelStore.model;
    for (const lc of m.loadCases) {
      const caseModel = { ...m, loads: m.loads.filter((l) => (l.data.caseId ?? 1) === lc.id) };
      const input = buildSolverInput3D(caseModel as never, lc.type === 'D', false);
      expect(input, `case "${lc.name}" builds an input`).toBeTruthy();
      const r = solve3D(input!);
      expect(r.displacements.length, `case "${lc.name}" solved`).toBeGreaterThan(0);
      for (const d of r.displacements) {
        expect(Number.isFinite(d.ux + d.uy + d.uz)).toBe(true);
      }
    }
  }, 300_000);
});

describe('findUncloneablePath', () => {
  it('names the field rather than the value', () => {
    const wire = {
      nodes: { 1: { id: 1, x: 0, y: 0, z: 0 } },
      quads: { 7: { id: 7, nodes: new Proxy([1, 2, 3, 4], {}), thickness: 0.2 } },
      constraints: [],
    };
    expect(findUncloneablePath(wire)).toBe('input.quads.7.nodes');
  });

  it('returns null for a payload that clones', () => {
    expect(findUncloneablePath({ a: [1, 2], b: { c: 'x' } })).toBeNull();
  });
});
