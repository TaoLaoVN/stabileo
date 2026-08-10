/**
 * Why 117 of the 119 beams in the flagship building carry no steel.
 *
 * ── The question this file answers ─────────────────────────────────
 *
 * Running the whole chain on `Edificio H.A. 7 pisos — PRO` and opening the 3-D workspace
 * shows every column reinforced, exactly two beams reinforced, and the rest drawn as bare
 * orange concrete. That picture has two completely different explanations and they demand
 * opposite responses:
 *
 *   - the design legitimately refused those members, and the viewer is telling the truth; or
 *   - the design produced steel and something between the document, the projection and the
 *     screen dropped it.
 *
 * Guessing is not allowed here — one of those answers is a limitation to be reported to the
 * engineer, the other is a defect to be fixed — so this audits every beam across all four
 * places its reinforcement could exist (the design outcome, the model's own record, the
 * DocumentModel, the SceneModel) and sorts them into the five categories that tell the
 * explanations apart.
 *
 * ── The answer, as measured ────────────────────────────────────────
 *
 *   117  refused by the biaxial capability gate (UNSUPPORTED / `limiting: ['biaxial']`)
 *     2  verified, detailed, and present in the scene (members 85 and 148)
 *     0  verified but with lost geometry
 *     0  verified but never detailed
 *     0  detailed but filtered out of the scene
 *     0  workflow errors
 *
 * So it is the first explanation. The secondary/primary moment ratio across the refused
 * beams runs from 0.105 to 2.66 against a 0.10 threshold, i.e. every refusal is a beam with
 * genuine bending about both axes, and a third of them bend HARDER about the secondary axis
 * than the primary one. Nothing is being hidden and nothing is filtered: the scene's own
 * `unreinforcedMembers` list is exactly the refused set, member for member.
 *
 * The threshold itself is deliberately NOT touched here, and neither is the verifier. What
 * changed alongside this file is that the workspace now says all of the above on screen
 * instead of leaving a reviewer to click through 117 members to discover it.
 *
 * These assertions are written to fail LOUDLY if the shape of the answer ever changes —
 * including if it improves. A drop in the refused count means the biaxial path started
 * covering beams, which is a deliberate act that should update this file, not a silent one.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { workspaceScene } from './helpers/workspace-scene';
import { modelStore } from '../../../store/model.svelte';
import { verificationStore } from '../../../store/verification.svelte';
import { memberKindOf } from '../../design/member-grouping';
import { reportElementStatus, summariseStatusReasons, type DesignOutcomeSummary } from '../element-status';
import { BIAXIAL_RATIO_THRESHOLD } from '../../design/design-axes';
import type { SceneModel } from '../scene-model';
import type { DocumentModel } from '../document-model';

/** One beam, across every place its reinforcement could exist. */
interface BeamRow {
  elementId: number;
  designRan: boolean;
  outcome: string;
  secondaryRatio: number | undefined;
  reasonKey: string;
  steelInRecord: boolean;
  barsInDocument: number;
  barsInScene: number;
  hasConcrete: boolean;
  flaggedUnreinforced: boolean;
}

type Category =
  | 'refused-biaxial'
  | 'verified-geometry-lost'
  | 'verified-not-detailed'
  | 'detailed-but-filtered'
  | 'workflow-error'
  | 'reinforced';

function categorise(r: BeamRow): Category {
  if (!r.designRan) return 'workflow-error';
  if (r.outcome === 'UNSUPPORTED' && r.reasonKey === 'design.reason.secondaryAxisUnchecked') {
    return 'refused-biaxial';
  }
  if (r.outcome === 'VERIFIED') {
    if (!r.hasConcrete) return 'verified-geometry-lost';
    if (r.barsInDocument === 0) return 'verified-not-detailed';
    if (r.barsInScene === 0) return 'detailed-but-filtered';
    return 'reinforced';
  }
  return 'workflow-error';
}

describe('beam reinforcement audit — pro-edificio-7p', () => {
  let rows: BeamRow[];
  let byCategory: Map<Category, BeamRow[]>;
  let scene: SceneModel;
  let doc: DocumentModel;

  beforeAll(async () => {
    const w = await workspaceScene('pro-edificio-7p');
    scene = w.scene;
    doc = w.doc;
    const m = modelStore.model;

    const barsInDocument = new Map<number, number>();
    for (const a of doc.assemblies) {
      for (const bar of a.bars) {
        for (const id of bar.ownerElementIds) {
          barsInDocument.set(id, (barsInDocument.get(id) ?? 0) + 1);
        }
      }
    }
    const barsInScene = new Map<number, number>();
    for (const b of scene.bars) {
      for (const id of b.elementIds) barsInScene.set(id, (barsInScene.get(id) ?? 0) + 1);
    }
    const withConcrete = new Set(scene.solids.flatMap((s) => s.elementIds));
    const unreinforced = new Set(scene.unreinforcedMembers);

    rows = [];
    for (const [id] of m.elements) {
      if (memberKindOf(m as never, id) !== 'beam') continue;
      const o = verificationStore.outcomeFor(id);
      rows.push({
        elementId: id,
        designRan: !!o,
        outcome: o?.outcome ?? '-',
        secondaryRatio: o?.axes?.secondaryRatio,
        reasonKey: o?.reasons?.[0]?.key ?? '',
        steelInRecord: !!m.elements.get(id)?.reinforcement,
        barsInDocument: barsInDocument.get(id) ?? 0,
        barsInScene: barsInScene.get(id) ?? 0,
        hasConcrete: withConcrete.has(id),
        flaggedUnreinforced: unreinforced.has(id),
      });
    }

    byCategory = new Map();
    for (const r of rows) {
      const c = categorise(r);
      const list = byCategory.get(c) ?? [];
      list.push(r);
      byCategory.set(c, list);
    }
  }, 600_000);

  const of = (c: Category): BeamRow[] => byCategory.get(c) ?? [];

  it('audits every beam in the model', () => {
    expect(rows.length).toBe(119);
    expect(rows.every((r) => r.designRan), 'the design run reached every beam').toBe(true);
  });

  it('accounts for every beam without steel as a biaxial refusal', () => {
    expect(of('refused-biaxial').length).toBe(117);
    expect(of('reinforced').length).toBe(2);
    expect(of('reinforced').map((r) => r.elementId)).toEqual([85, 148]);
    // The categories that would mean a defect rather than a limitation.
    expect(of('verified-geometry-lost')).toEqual([]);
    expect(of('verified-not-detailed')).toEqual([]);
    expect(of('detailed-but-filtered')).toEqual([]);
    expect(of('workflow-error')).toEqual([]);
  });

  it('refuses only beams that genuinely bend about both axes', () => {
    // Every refusal is above the published threshold — none of them is threshold noise, and
    // the spread is stated so a reader can see how far above it they are.
    const ratios = of('refused-biaxial').map((r) => r.secondaryRatio ?? 0);
    expect(Math.min(...ratios)).toBeGreaterThan(BIAXIAL_RATIO_THRESHOLD);
    expect(Math.max(...ratios)).toBeGreaterThan(1); // some bend harder about the secondary axis
    expect(of('refused-biaxial').every((r) => r.outcome === 'UNSUPPORTED')).toBe(true);
    // A refusal designs nothing, so no steel may exist anywhere for these members.
    for (const r of of('refused-biaxial')) {
      expect(r.steelInRecord, `member ${r.elementId} has no record steel`).toBe(false);
      expect(r.barsInDocument, `member ${r.elementId} has no document steel`).toBe(0);
      expect(r.barsInScene, `member ${r.elementId} has no scene steel`).toBe(0);
    }
  });

  it('draws every refused beam, and marks it unreinforced rather than dropping it', () => {
    // "Do not hide elements to disguise an error": a refused member keeps its concrete and is
    // named, so the count on screen matches the count in the model.
    for (const r of of('refused-biaxial')) {
      expect(r.hasConcrete, `member ${r.elementId} is drawn`).toBe(true);
      expect(r.flaggedUnreinforced, `member ${r.elementId} is reported unreinforced`).toBe(true);
    }
    // The scene's list and the audit's refusal set are the same set — no third population.
    expect([...scene.unreinforcedMembers].sort((a, b) => a - b))
      .toEqual(of('refused-biaxial').map((r) => r.elementId).sort((a, b) => a - b));
  });

  it('reaches the 3-D projection intact for the beams that were designed', () => {
    // The check that would catch a lost projection: document steel and scene steel agree on
    // WHICH members carry bars, for beams and columns alike.
    const inDoc = new Set<number>();
    for (const a of doc.assemblies) for (const b of a.bars) for (const id of b.ownerElementIds) inDoc.add(id);
    const inScene = new Set<number>();
    for (const b of scene.bars) for (const id of b.elementIds) inScene.add(id);
    const missingFrom3D = [...inDoc].filter((id) => !inScene.has(id)).sort((a, b) => a - b);
    expect(missingFrom3D, 'every member with steel in the document has steel in the scene').toEqual([]);
  });

  it('states the shared cause once, rather than 117 times', () => {
    const outcomes = new Map<number, DesignOutcomeSummary>();
    for (const [id] of modelStore.model.elements) {
      const o = verificationStore.outcomeFor(id);
      if (!o) continue;
      outcomes.set(id, {
        outcome: o.outcome,
        limiting: o.limiting,
        reasonKey: o.reasons?.[0]?.key,
        secondaryRatio: o.axes?.secondaryRatio,
      });
    }
    const groups = summariseStatusReasons(reportElementStatus(scene, outcomes).entries);
    const biaxial = groups.find((g) => g.reasonKey === 'design.reason.secondaryAxisUnchecked');
    expect(biaxial, 'the biaxial refusal is surfaced as one group').toBeTruthy();
    expect(biaxial!.status).toBe('UNSUPPORTED');
    expect(biaxial!.count).toBe(117);
    expect(biaxial!.ratioRange!.min).toBeGreaterThan(BIAXIAL_RATIO_THRESHOLD);
    // The group is a way IN: its ids are what the panel isolates on click.
    expect(biaxial!.elementIds.length).toBe(117);
  });
});
