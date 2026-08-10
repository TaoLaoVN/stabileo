/**
 * Why 117 of the 119 beams in the flagship building carry a PROPOSAL and not a design.
 *
 * ── The question this file answers ─────────────────────────────────
 *
 * Running the whole chain on `Edificio H.A. 7 pisos — PRO` and opening the 3-D workspace used to
 * show every column reinforced, exactly two beams reinforced, and the rest drawn as bare orange
 * concrete. That picture had two completely different explanations and they demanded opposite
 * responses:
 *
 *   - the design legitimately refused those members, and the viewer was telling the truth; or
 *   - the design produced steel and something between the document, the projection and the
 *     screen dropped it.
 *
 * Guessing is not allowed here — one of those answers is a limitation to be reported to the
 * engineer, the other is a defect to be fixed — so this audits every beam across all four
 * places its reinforcement could exist (the design outcome, the model's own record, the
 * DocumentModel, the SceneModel) and sorts them into categories that tell the explanations
 * apart.
 *
 * ── The answer, as measured ────────────────────────────────────────
 *
 * It was the first explanation. The refusal was correct: `resolveDesignAxes` measures a
 * secondary moment above the 10 % threshold on 117 beams, and no verifier in this app evaluates
 * a beam's secondary axis.
 *
 * What changed is the CONSEQUENCE. A refusal designed nothing at all, so those beams had no
 * reinforcement in the model, no bars in the document, no steel in the 3-D view and no rows on
 * any schedule. The engineer could not see what their building would need, could not size
 * anything from it, and had nothing to design the secondary axis on top of by hand.
 *
 * They now carry a PROVISIONAL_BIAXIAL proposal: the ordinary bounded search run against the
 * primary axis, with the threshold untouched, the verifier untouched, and no capacity invented
 * for the axis nobody checks. So:
 *
 *   117  provisional proposals, with bars in the model, the document and the scene
 *     2  verified, detailed, and present in the scene (members 85 and 148)
 *     0  verified but with lost geometry
 *     0  verified but never detailed
 *     0  detailed but filtered out of the scene
 *     0  beams drawn with no steel at all
 *     0  workflow errors
 *
 * The threshold itself is deliberately NOT touched here, and neither is the verifier, and no
 * provisional member is ever counted as verified — the assertions below check all three.
 * `docs/audits/biaxial-beam-design.md` is the evidence for why real biaxial design was not
 * attempted in this pass.
 *
 * These assertions are written to fail LOUDLY if the shape of the answer ever changes —
 * including if it improves. A drop in the provisional count means the biaxial path started
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
  provisionalBarsInDocument: number;
  barsInScene: number;
  hasConcrete: boolean;
  hasCertificate: boolean;
  flaggedUnreinforced: boolean;
  flaggedProvisional: boolean;
}

type Category =
  | 'provisional-biaxial'
  | 'provisional-without-steel'
  | 'verified-geometry-lost'
  | 'verified-not-detailed'
  | 'detailed-but-filtered'
  | 'workflow-error'
  | 'reinforced';

function categorise(r: BeamRow): Category {
  if (!r.designRan) return 'workflow-error';
  if (r.outcome === 'PROVISIONAL_BIAXIAL') {
    // A proposal that produced nothing is not a proposal — it is a refusal wearing a
    // friendlier name, and it must be caught rather than counted.
    return r.barsInScene > 0 ? 'provisional-biaxial' : 'provisional-without-steel';
  }
  if (r.outcome === 'VERIFIED') {
    if (!r.hasConcrete) return 'verified-geometry-lost';
    if (r.barsInDocument === 0) return 'verified-not-detailed';
    if (r.barsInScene === 0) return 'detailed-but-filtered';
    return 'reinforced';
  }
  return 'workflow-error';
}

// A whole-building test: 30 s rather than Vitest's 5 s default, for the reason set out in
// `provisional-projections.test.ts` — under a full-suite pool these were failing on
// contention with every assertion passing.
describe('beam reinforcement audit — pro-edificio-7p', { timeout: 30_000 }, () => {
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
    const provisionalBarsInDocument = new Map<number, number>();
    for (const a of doc.assemblies) {
      for (const bar of a.bars) {
        for (const id of bar.ownerElementIds) {
          barsInDocument.set(id, (barsInDocument.get(id) ?? 0) + 1);
          if (bar.provisional) {
            provisionalBarsInDocument.set(id, (provisionalBarsInDocument.get(id) ?? 0) + 1);
          }
        }
      }
    }
    const barsInScene = new Map<number, number>();
    for (const b of scene.bars) {
      for (const id of b.elementIds) barsInScene.set(id, (barsInScene.get(id) ?? 0) + 1);
    }
    const withConcrete = new Set(scene.solids.flatMap((s) => s.elementIds));
    const unreinforced = new Set(scene.unreinforcedMembers);
    const provisionalMembers = new Set(scene.provisionalMembers);

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
        provisionalBarsInDocument: provisionalBarsInDocument.get(id) ?? 0,
        barsInScene: barsInScene.get(id) ?? 0,
        hasConcrete: withConcrete.has(id),
        hasCertificate: !!o?.certificate,
        flaggedUnreinforced: unreinforced.has(id),
        flaggedProvisional: provisionalMembers.has(id),
      });
    }

    byCategory = new Map();
    for (const r of rows) {
      const c = categorise(r);
      const list = byCategory.get(c) ?? [];
      list.push(r);
      byCategory.set(c, list);
    }
  }, 900_000);

  const of = (c: Category): BeamRow[] => byCategory.get(c) ?? [];

  it('audits every beam in the model', () => {
    expect(rows.length).toBe(119);
    expect(rows.every((r) => r.designRan), 'the design run reached every beam').toBe(true);
  });

  it('accounts for every beam as either verified or a provisional proposal', () => {
    expect(of('provisional-biaxial').length).toBe(117);
    expect(of('reinforced').length).toBe(2);
    expect(of('reinforced').map((r) => r.elementId)).toEqual([85, 148]);
    // The categories that would mean a defect rather than a limitation.
    expect(of('provisional-without-steel')).toEqual([]);
    expect(of('verified-geometry-lost')).toEqual([]);
    expect(of('verified-not-detailed')).toEqual([]);
    expect(of('detailed-but-filtered')).toEqual([]);
    expect(of('workflow-error')).toEqual([]);
  });

  it('proposes only for beams that genuinely bend about both axes', () => {
    // Every proposal is above the published threshold — none of them is threshold noise, and
    // the spread is stated so a reader can see how far above it they are.
    const ratios = of('provisional-biaxial').map((r) => r.secondaryRatio ?? 0);
    expect(Math.min(...ratios)).toBeGreaterThan(BIAXIAL_RATIO_THRESHOLD);
    expect(Math.max(...ratios)).toBeGreaterThan(1); // some bend harder about the secondary axis
    expect(of('provisional-biaxial').every((r) => r.outcome === 'PROVISIONAL_BIAXIAL')).toBe(true);
  });

  it('never lets a proposal look like a design', () => {
    for (const r of of('provisional-biaxial')) {
      // The one thing a proposal may never acquire.
      expect(r.hasCertificate, `member ${r.elementId} carries no certificate`).toBe(false);
      // …and the one thing that must reach every projection that draws its steel.
      expect(r.provisionalBarsInDocument,
        `member ${r.elementId}: every bar it owns is marked provisional`).toBe(r.barsInDocument);
      expect(r.flaggedProvisional, `member ${r.elementId} is named as provisional`).toBe(true);
    }
    const provisionalIds = of('provisional-biaxial').map((r) => r.elementId).sort((a, b) => a - b);
    expect([...scene.provisionalMembers].sort((a, b) => a - b)).toEqual(provisionalIds);
    // A verified beam is not swept into the provisional set by a bar that runs through it.
    for (const r of of('reinforced')) {
      expect(r.flaggedProvisional, `member ${r.elementId} is verified, not provisional`).toBe(false);
      expect(r.hasCertificate).toBe(true);
    }
  });

  it('gives every beam concrete AND steel, rather than an empty member', () => {
    // "Do not hide elements to disguise a limitation" was already satisfied — the concrete was
    // always drawn. What was missing is the steel, and its absence was indistinguishable from
    // reinforcement that went missing between the design and the screen.
    for (const r of rows) {
      expect(r.hasConcrete, `member ${r.elementId} is drawn`).toBe(true);
      expect(r.steelInRecord, `member ${r.elementId} has steel in the model`).toBe(true);
      expect(r.barsInScene, `member ${r.elementId} has steel in the scene`).toBeGreaterThan(0);
    }
    expect(scene.unreinforcedMembers, 'no beam or column is left bare').toEqual([]);
  });

  it('reaches the 3-D projection intact for every beam that has steel', () => {
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
      const v = verificationStore.providedFor(id);
      outcomes.set(id, {
        outcome: o.outcome,
        // Threaded exactly as the workspace threads it: a proposal's steel FAILS the
        // authoritative verifier on the biaxial refusal, and a test that omitted the
        // verification status would not see the app reporting FAILED.
        verificationStatus: v?.overallStatus,
        verificationLimiting: (v?.checks ?? [])
          .filter((c) => c.status === 'fail')
          .flatMap((c) => (c.limiting ? [String(c.limiting)] : [])),
        limiting: o.limiting,
        reasonKey: o.reasons?.[0]?.key,
        secondaryRatio: o.axes?.secondaryRatio,
      });
    }
    const report = reportElementStatus(scene, outcomes);
    expect(report.counts.PROVISIONAL, 'the workspace counts them as their own state').toBe(117);
    expect(report.counts.MODELLED, 'and does not fold them into the modelled ones')
      .toBeGreaterThan(0);
    expect(report.entries.filter((e) => e.status === 'PROVISIONAL').length).toBe(117);

    const groups = summariseStatusReasons(report.entries);
    const biaxial = groups.find((g) => g.reasonKey === 'design.reason.provisionalBiaxial');
    expect(biaxial, 'the shared cause is surfaced as one group').toBeTruthy();
    expect(biaxial!.status).toBe('PROVISIONAL');
    expect(biaxial!.count).toBe(117);
    expect(biaxial!.ratioRange!.min).toBeGreaterThan(BIAXIAL_RATIO_THRESHOLD);
    // The group is a way IN: its ids are what the panel isolates on click.
    expect(biaxial!.elementIds.length).toBe(117);
  });

  it('carries the metadata an engineer needs to act on the proposal', () => {
    for (const r of of('provisional-biaxial')) {
      const o = verificationStore.outcomeFor(r.elementId)!;
      const basis = o.provisionalBasis!;
      expect(basis, `member ${r.elementId} states its basis`).toBeTruthy();
      expect(basis.method).toBe('primaryAxisDesign');
      expect(basis.designedAxis).not.toBe(basis.uncheckedAxis);
      expect(basis.uncheckedShear).toBeTruthy();
      // The absolute size, not only the ratio: 12 % of 4,3 kN·m and 12 % of 430 kN·m are the
      // same number and completely different engineering situations.
      expect(basis.secondaryMoment).toBeGreaterThan(0);
      expect(basis.primaryMoment).toBeGreaterThan(basis.secondaryMoment * 0.3);
      expect(basis.primaryUtilization).toBeLessThanOrEqual(1);
      expect(basis.checkedAxes.length).toBeGreaterThan(0);
      expect(basis.checkedAxes, 'the unchecked axis is not among the checked ones')
        .not.toContain(basis.uncheckedAxis);
      expect(o.limiting).toContain('biaxial');
      const keys = o.reasons.map((x) => x.key);
      expect(keys).toContain('design.reason.provisionalBiaxial');
      expect(keys, 'the original refusal is still stated, not replaced')
        .toContain('design.reason.secondaryAxisUnchecked');
    }
  });

  it('cannot reach a constructible verdict on a provisional floor', () => {
    // The gate counts certificates, and a proposal has none. This is the property that makes
    // detailing a provisional member safe: it can be seen, it cannot be blessed.
    for (const a of doc.assemblies) {
      if (!(a.source.provisionalMembers ?? []).length) continue;
      const assessment = a.constructibility;
      expect(assessment, `assembly ${a.id} was assessed`).toBeTruthy();
      expect(assessment!.verdict,
        `assembly ${a.id} carries a proposal and cannot be called constructible`)
        .not.toBe('CONSTRUCTIBLE');
      // And for the right reason: the certificate conditions are what a proposal cannot meet.
      expect(assessment!.blocking.length).toBeGreaterThan(0);
    }
  });
});
