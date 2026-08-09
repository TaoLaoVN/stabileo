/**
 * The scene must show everything the detailing actually produced.
 *
 * ── The regression this file exists to make impossible ─────────────
 *
 * A 7-storey building rendered 12 705 bars and looked convincingly full. It was missing
 * every column tie in the model — 8 251 pieces — because `generateColumnStack` returns its
 * ties as a ZONE SCHEDULE (lift, extent, spacing, diameter) and never as geometry, and the
 * column path appended only `gen.bars`. Nothing was wrong with the scene: it faithfully
 * projected a document that did not contain the steel.
 *
 * "Lots of bars" and "all the bars" look identical in a cage, which is why this cannot be a
 * visual check. Every assertion below is a COUNT, taken either against the detailing source
 * or against a floor the count cannot fall through.
 *
 * ── Why the assertions are shaped as floors, not equalities ────────
 *
 * Bar counts move whenever a spacing rule, a section or a demand changes, and a test pinned
 * to 8 251 would fail on every legitimate improvement while catching nothing. What must never
 * happen is a FAMILY going to zero, or a whole role disappearing, so the floors are set where
 * only a structural loss can breach them.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { modelStore } from '../../store/model.svelte';
import { resultsStore } from '../../store/results.svelte';
import { detailingStore } from '../../store/detailing.svelte';
import { designRunStore } from '../../store/design-run.svelte';
import { verificationStore } from '../../store/verification.svelte';
import { deserializeProject } from '../../store/file';
import { isSolverReady } from '../../engine/wasm-solver';
import {
  buildSceneModel, filterScene, summariseScene, classifyPiece,
  type SceneModel,
} from '../../engine/detailing/scene-model';
import { membersFromModel } from '../../engine/detailing/member-geometry';
import type { DocumentModel } from '../../engine/detailing/document-model';
import '../../engine/design/adapters/cirsoc201-adapter';
import '../../engine/design/adapters/unsupported-adapter';

interface Built { doc: DocumentModel; scene: SceneModel }

/** Run the production chain and project the scene the workspace projects. */
async function build(load: () => void | Promise<void>): Promise<Built> {
  modelStore.clear();
  resultsStore.clear();
  detailingStore.clear();
  designRunStore.resetMarks();
  verificationStore.clear();

  await load();
  expect(isSolverReady(), 'real WASM solver, not the Vite stub').toBe(true);
  const solved = await modelStore.solveCombinations3DParallel(true, false, true);
  expect(typeof solved).not.toBe('string');
  const r = solved as { perCase: Map<number, never>; perCombo: Map<number, never>; envelope: never };
  resultsStore.setCombinationResults3D(r.perCase as never, r.perCombo as never, r.envelope as never);

  designRunStore.computeDemands();
  designRunStore.runCodeCheck();
  designRunStore.designAll();
  detailingStore.generate({ verifierId: 'cirsoc201.provided.v2.2025' });
  detailingStore.generateFloors({ verifierId: 'cirsoc201.provided.v2.2025' });

  const doc = detailingStore.buildDocument({ author: 'scene', at: '2026-08-08T00:00:00Z' });
  expect(doc, 'the chain produced a document').toBeTruthy();

  const { members } = membersFromModel({
    elementIds: [...modelStore.model.elements.keys()],
    nodes: [...modelStore.model.nodes.values()],
    elements: [...modelStore.model.elements.values()],
    sections: [...modelStore.model.sections.values()],
  });
  return { doc: doc!, scene: buildSceneModel(doc!, { members }) };
}

const example = (name: string) => () => modelStore.loadExample(name);

function familyOf(s: ReturnType<typeof summariseScene>, family: string) {
  return s.byFamily.find((f) => f.family === family)
    ?? { family, solids: 0, longitudinal: 0, transverse: 0 };
}

// ─── The 7-storey building ───────────────────────────────────────

describe('the 7-storey building is more than column longitudinals', () => {
  let built: Built;
  beforeEach(async () => { built = await build(example('pro-edificio-7p')); }, 120_000);

  it('carries transverse steel, and a lot of it', async () => {
    /**
     * The exact regression. Before column ties were materialised this model had 39 transverse
     * pieces in total, every one of them a JOINT tie from a different producer, against 12 650
     * longitudinals. A scene that is 99,7 % longitudinal bars is a scene missing its cages.
     */
    const s = summariseScene(built.scene);
    const transverse = built.scene.bars.filter((b) => b.role === 'transverse').length;
    expect(transverse, 'transverse pieces in the whole model').toBeGreaterThan(1000);
    expect(transverse / s.barCount, 'transverse share').toBeGreaterThan(0.1);
  });

  it('gives its columns BOTH longitudinal bars and ties', async () => {
    const col = familyOf(summariseScene(built.scene), 'column');
    expect(col.solids, 'column solids').toBeGreaterThan(50);
    expect(col.longitudinal, 'column longitudinals').toBeGreaterThan(500);
    // The one that was zero. A column with bars and no ties is not a designed column.
    expect(col.transverse, 'column ties').toBeGreaterThan(1000);
  });

  it('shows its beams, slabs and walls as concrete', async () => {
    const s = summariseScene(built.scene);
    expect(familyOf(s, 'beam').solids, 'beam solids').toBeGreaterThan(50);
    expect(familyOf(s, 'slab').solids, 'slab solids').toBeGreaterThan(10);
    expect(familyOf(s, 'wall').solids, 'wall solids').toBeGreaterThan(5);
  });

  it('shows the reinforcement its slabs and walls actually generate', async () => {
    // Both families produce real bars — `generateSlabBars` and `generateWallBars` — and both
    // were reaching the scene already. A floor under them catches a wiring loss.
    const s = summariseScene(built.scene);
    expect(familyOf(s, 'slab').longitudinal, 'slab bars').toBeGreaterThan(1000);
    expect(familyOf(s, 'wall').longitudinal, 'wall bars').toBeGreaterThan(50);
  });

  it('reports beams honestly when their design was refused', async () => {
    /**
     * On this model 117 of 119 beams are refused by the verifier's secondary-axis refusal, so
     * they carry no steel. That is a design outcome, not a scene gap, and the test asserts the
     * HONEST shape: the concrete is present and the absence of steel is reported.
     *
     * It deliberately does not require beam bars here. Requiring them would only be
     * satisfiable by inventing reinforcement the design never calculated.
     */
    expect(built.scene.unreinforcedMembers.length).toBeGreaterThan(50);
    const beamSolids = built.scene.solids.filter((s) => s.kind === 'beam');
    expect(beamSolids.some((s) => !s.reinforced), 'refused beams are drawn').toBe(true);
  });
});

// ─── Nothing is lost between the document and the scene ──────────

describe('every detailed bar reaches the scene', () => {
  for (const name of ['pro-edificio-7p', 'rc-qa-diagnostic']) {
    it(`${name}: the scene holds exactly the document's bars`, async () => {
      const { doc, scene } = await build(example(name));
      const inDoc = doc.assemblies.flatMap((a) => a.bars).map((b) => b.id).sort();
      expect(scene.bars.map((b) => b.barId).sort()).toEqual(inDoc);
    }, 120_000);

    it(`${name}: the scene's counts reconcile with the detailing source`, async () => {
      const { doc, scene } = await build(example(name));
      const s = summariseScene(scene);
      const source = doc.assemblies.flatMap((a) => a.bars);
      expect(s.barCount).toBe(source.length);
      expect(s.byFamily.reduce((n, f) => n + f.longitudinal + f.transverse, 0))
        .toBe(source.length);
      expect(s.byFamily.reduce((n, f) => n + f.solids, 0)).toBe(scene.solids.length);
      // Roles are carried, never recomputed.
      expect(s.byFamily.reduce((n, f) => n + f.transverse, 0))
        .toBe(source.filter((b) => b.role === 'transverse').length);
    }, 120_000);
  }
});

// ─── Frame members get all four families of steel ────────────────

describe('a model whose beams design shows every frame family', () => {
  it('rc-qa-diagnostic has column and beam steel, longitudinal and transverse', async () => {
    /**
     * The 7-storey model cannot prove this: its beams are refused, so beam steel does not
     * exist to be shown. A model whose beams DO design is what distinguishes "the scene drops
     * beam bars" from "the design produced none".
     */
    const { scene } = await build(example('rc-qa-diagnostic'));
    const s = summariseScene(scene);
    expect(familyOf(s, 'column').longitudinal).toBeGreaterThan(0);
    expect(familyOf(s, 'column').transverse).toBeGreaterThan(0);
    expect(familyOf(s, 'beam').longitudinal).toBeGreaterThan(0);
    expect(familyOf(s, 'beam').transverse).toBeGreaterThan(0);
  }, 120_000);
});

// ─── Foundations ─────────────────────────────────────────────────

describe('a footing brings its own steel into the same scene', () => {
  it('mats, dowels and starter ties are all present', async () => {
    /**
     * `pro-edificio-7p` has no footings at all, so it cannot cover this. The committed
     * project does: it is the one the CAD handoff was built from.
     */
    const FIXTURE = new URL('../__fixtures__/rc-footing-cad-poc.ded.json', import.meta.url);
    const { scene } = await build(() => {
      expect(deserializeProject(readFileSync(FIXTURE, 'utf8'))).toBe(true);
    });

    const footingBars = scene.bars.filter((b) => b.family === 'footing');
    expect(footingBars.length, 'footing steel').toBeGreaterThan(0);
    expect(footingBars.some((b) => b.role === 'longitudinal'), 'mats and dowels').toBe(true);
    expect(footingBars.some((b) => b.role === 'transverse'), 'starter ties').toBe(true);
    expect(scene.solids.some((s) => s.kind === 'footing'), 'the pad itself').toBe(true);
  }, 120_000);
});

// ─── The column cage, piece by piece ─────────────────────────────

describe('column transverse steel is classified, not lumped together', () => {
  let built: Built;
  beforeEach(async () => { built = await build(example('pro-edificio-7p')); }, 120_000);

  it('tells a closed tie from a crosstie from a joint tie', () => {
    /**
     * `role` calls all 8 212 pieces "transverse", which is how the cage read as an
     * undifferentiated thicket and drew the QA comment "these do not look like stirrups". A
     * closed hoop and a single-leg crosstie are different pieces under different sub-clauses.
     */
    const kinds = new Set(built.scene.bars.map((b) => b.piece));
    expect(kinds.has('closedTie'), 'closed column ties').toBe(true);
    expect(kinds.has('crosstie'), 'column crossties').toBe(true);
    expect(kinds.has('jointTie') || kinds.has('jointCrosstie'), 'joint cage').toBe(true);
    // And they are never confused: a crosstie is never reported as a closed tie.
    for (const b of built.scene.bars) {
      if (b.barId.includes('crosstie')) {
        expect(b.piece === 'crosstie' || b.piece === 'jointCrosstie', b.barId).toBe(true);
      }
    }
  });

  it('does not duplicate the lift cage inside the joint band', () => {
    // The lift ties stop below the beams; the joint cage fills that band. Two cages at one
    // elevation would be double steel and every pair would clash.
    const lift = built.scene.bars.filter((b) => b.piece === 'closedTie' || b.piece === 'crosstie');
    const joint = built.scene.bars.filter((b) => b.piece === 'jointTie' || b.piece === 'jointCrosstie');
    expect(lift.length).toBeGreaterThan(0);
    expect(joint.length).toBeGreaterThan(0);
    // Distinct producers, distinct id namespaces — never the same piece counted twice.
    expect(lift.filter((b) => joint.some((j) => j.barId === b.barId))).toEqual([]);
  });

  it('gives every crosstie a bar to brace, in the cage it belongs to', () => {
    // A crosstie whose hooks embrace nothing is the piece §25.3.5(d) forbids, and the shape
    // an over-eager generator produces. Every one must own the member whose cage it is in.
    const cross = built.scene.bars.filter((b) => b.piece === 'crosstie');
    expect(cross.length).toBeGreaterThan(0);
    for (const b of cross.slice(0, 200)) {
      expect(b.elementIds.length, b.barId).toBeGreaterThan(0);
      expect(b.ownerScope).toBe('frame');
    }
  });

  it('classifies from the producer’s naming, so the schedule agrees', () => {
    const source = built.doc.assemblies.flatMap((a) => a.bars);
    for (const bar of source.slice(0, 500)) {
      const inScene = built.scene.bars.find((b) => b.barId === bar.id)!;
      expect(inScene.piece, bar.id).toBe(classifyPiece(bar));
    }
  });
});

// ─── Owner identity across two id spaces ─────────────────────────

describe('shell ids and frame ids are not confused', () => {
  it('does not credit a column with a slab panel that shares its number', async () => {
    /**
     * Frame members are 1…203 and quads are 1…77 in this model, so every quad id is also a
     * frame element id. Before `ownerScope`, 11 340 slab bars and 234 wall bars counted as
     * steel belonging to columns — and a column with no reinforcement could report MODELLED
     * because a slab bar had claimed its number.
     */
    const { scene } = await build(example('pro-edificio-7p'));
    for (const b of scene.bars) {
      expect(b.ownerScope, b.barId).toBe(b.family ? 'family' : 'frame');
    }
    // A member's `reinforced` flag counts frame steel only.
    const frameOwners = new Set(
      scene.bars.filter((b) => b.ownerScope === 'frame').flatMap((b) => b.elementIds));
    for (const s of scene.solids) {
      if (s.kind !== 'beam' && s.kind !== 'column') continue;
      expect(s.reinforced, s.id).toBe(s.elementIds.some((id) => frameOwners.has(id)));
    }
  }, 120_000);
});

// ─── Families the model does not contain ─────────────────────────

describe('a family with no members is stated, not silently empty', () => {
  it('the 7-storey model has no footings, and the scene says so by having none', async () => {
    /**
     * Distinguishing "not in this model" from "lost in the scene" is the whole point. This
     * fixture genuinely contains zero footings — `model.footings.size === 0` — so a footing
     * solid appearing here would mean the scene invented one.
     */
    const { scene } = await build(example('pro-edificio-7p'));
    expect(modelStore.model.footings.size).toBe(0);
    expect(scene.solids.filter((s) => s.kind === 'footing')).toEqual([]);
    expect(scene.solids.filter((s) => s.kind === 'pedestal')).toEqual([]);
  }, 120_000);
});

// ─── Toggles ─────────────────────────────────────────────────────

describe('each layer switch filters its own family and no other', () => {
  it('every family can be hidden alone, taking its steel and nothing else', async () => {
    const { scene } = await build(example('pro-edificio-7p'));
    const present = [...new Set(scene.solids.map((s) => s.kind))];
    expect(present.length).toBeGreaterThan(1);

    for (const hidden of present) {
      const kept = present.filter((k) => k !== hidden);
      const out = filterScene(scene, { solidKinds: kept });
      // The hidden family is gone, concrete and steel alike.
      expect(out.solids.some((s) => s.kind === hidden), `${hidden} solids`).toBe(false);
      // And every other family is untouched.
      for (const k of kept) {
        expect(out.solids.filter((s) => s.kind === k).length,
          `${k} survives hiding ${hidden}`)
          .toBe(scene.solids.filter((s) => s.kind === k).length);
      }
    }
  }, 120_000);

  it('hiding reinforcement never removes a piece of concrete', async () => {
    const { scene } = await build(example('pro-edificio-7p'));
    const shell = filterScene(scene, { hideBars: true });
    expect(shell.bars).toEqual([]);
    expect(shell.solids.length).toBe(scene.solids.length);
  }, 120_000);
});

// ─── The controls cannot produce a false picture ─────────────────

describe('the view stays honest under its own controls', () => {
  it('hiding reinforcement leaves the concrete standing', async () => {
    const { scene } = await build(example('rc-qa-diagnostic'));
    const shell = filterScene(scene, { hideBars: true });
    expect(shell.bars).toEqual([]);
    expect(shell.solids.length).toBe(scene.solids.length);
    expect(shell.bounds).not.toBeNull();
  }, 120_000);

  it('re-projecting the same document gives the same scene', async () => {
    // Closing and reopening the workspace rebuilds from the same document. If that produced a
    // different scene, everything the user had inspected would silently shift under them.
    const { doc } = await build(example('rc-qa-diagnostic'));
    const { members } = membersFromModel({
      elementIds: [...modelStore.model.elements.keys()],
      nodes: [...modelStore.model.nodes.values()],
      elements: [...modelStore.model.elements.values()],
      sections: [...modelStore.model.sections.values()],
    });
    expect(buildSceneModel(doc, { members })).toEqual(buildSceneModel(doc, { members }));
  }, 120_000);

  it('keeps every bar attached to a member that is in the scene', async () => {
    /**
     * Selection reports a bar's parent member, and the list focuses the camera on it. A bar
     * whose owners are all absent from the scene would report a parent that cannot be found
     * or focused — a dead end the user has no way to interpret.
     */
    const { scene } = await build(example('rc-qa-diagnostic'));
    const known = new Set(scene.solids.flatMap((s) => s.elementIds));
    const orphans = scene.bars.filter((b) => !b.elementIds.some((id) => known.has(id)));
    expect(orphans.map((b) => b.barId)).toEqual([]);
  }, 120_000);
});
