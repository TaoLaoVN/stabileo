/**
 * The manifest, produced from the real production chain.
 *
 * Every assertion here starts from the committed `.ded` project and runs the production
 * analysis, design and detailing commands. Nothing is injected — not the assembly, not the
 * cage, not the manifest — because the claim being tested is that the exporter describes what
 * production actually produced, and a seeded assembly would test only the serialiser.
 *
 * The measured facts this fixture reaches, which the assertions below pin:
 *
 *   8 column dowels Ø16 · 6 starter ties Ø6 · 14 bars · 2 marks · 38 arcs, all with exact
 *   centres · 12 prohibited-overlap conflicts · footing 2,00 × 2,00 × 0,50 m at −1,20 m ·
 *   column 0,40 × 0,40 m, element 1
 *
 * They are asserted as exact numbers on purpose. A range would pass if the derivation quietly
 * changed, and the whole point of the fixture is that it does not.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { createHash } from 'node:crypto';
import { modelStore } from '../../store/model.svelte';
import { buildFootingCadHandoff } from '../../store/rc-cad-export';
import { validateRcCadHandoff } from '../rc-cad-handoff-validate';
import { serializeRcCadHandoff, rcCadHandoffFilename } from '../rc-cad-handoff';
import {
  CODE_COLUMN_COVER_OUT_OF_SCOPE, CODE_FOOTING_MAT_NOT_MODELED, CODE_NO_CONTAINMENT_CHECKER,
  type RcCadHandoffV1,
} from '../rc-cad-handoff-types';
import { runProductionChain, fixtureText, keyTranslate } from './rc-cad-chain';

const FOOTING_ID = 1;
const COLUMN_ELEMENT_ID = 1;

let doc: RcCadHandoffV1;
let json: string;

beforeAll(async () => {
  await runProductionChain();
  const out = buildFootingCadHandoff(FOOTING_ID, keyTranslate);
  if (!out.ok) {
    throw new Error(`export refused: ${JSON.stringify(out.refusals)} ${JSON.stringify(out.invalid)}`);
  }
  doc = out.handoff;
  json = out.json;
}, 180_000);

const body = (role: string) => doc.concrete.bodies.find((b) => b.role === role)!;
const check = (id: string) => doc.checks.find((c) => c.checkId === id)!;

describe('envelope and provenance', () => {
  it('declares its schema, units and coordinate system explicitly', () => {
    expect(doc.schema).toBe('RcCadHandoffV1');
    expect(doc.schemaVersion).toBe(1);
    expect(doc.units).toEqual({ length: 'm', angle: 'deg', barDiameter: 'mm', mass: 'kg' });
    expect(doc.coordinateSystem).toEqual({ up: 'Z', handedness: 'right' });
  });

  it('carries the revisions a consumer needs to detect staleness', () => {
    // Not merely present: the detailing and demand revisions must be the assembly's own, so a
    // manifest cannot look fresh against an assembly it was not built from.
    const assembly = (modelStore.model.detailing?.assemblies ?? [])
      .find((a) => (a.families ?? []).some((r) => r.ownerId === `F${FOOTING_ID}`))!;
    expect(doc.revisions.detailing).toBe(assembly.detailingRevision);
    expect(doc.revisions.demand).toBe(assembly.demandRevision);
    expect(doc.revisions.entity).toBe(modelStore.model.footings.get(FOOTING_ID)!.revision);
  });

  it('names its subject and the production certificate it was built under', () => {
    expect(doc.subject).toMatchObject({ kind: 'footing', entityId: FOOTING_ID, name: 'Z1' });
    expect(doc.subject.elementIds).toEqual([COLUMN_ELEMENT_ID]);
    expect(doc.certificate.maturity).toBe('IMPLEMENTED_PROVISIONAL');
    expect(doc.certificate.verifierId).toBe('cirsoc201.provided.v2.2025');
    expect(doc.certificate.codeEdition).toBe('2025');
  });
});

describe('concrete components, extracted from production entities', () => {
  it('extracts the footing pad from the persisted footing, not from a re-derivation', () => {
    const f = modelStore.model.footings.get(FOOTING_ID)!;
    const pad = body('footing');
    expect(pad.source).toEqual({
      kind: 'footing', id: f.id, name: f.name, revision: f.revision,
    });
    expect(pad.shape).toEqual({
      kind: 'box', B: f.B, L: f.L, height: f.thickness,
      centre: { x: 0, y: 0, z: f.foundingElevation + f.thickness / 2 },
      rotationDeg: f.rotationDeg,
    });
    // The pad is whole. Nothing about it is a cut plane.
    expect(pad.truncatedFaces).toEqual([]);
  });

  it('takes the column footprint from the referenced element’s own section', () => {
    const el = modelStore.model.elements.get(COLUMN_ELEMENT_ID)!;
    const sec = modelStore.model.sections.get(el.sectionId)!;
    const stub = body('supportedColumn');
    expect(stub.source).toEqual({
      kind: 'element', id: COLUMN_ELEMENT_ID, sectionName: sec.name,
    });
    expect(stub.elementId).toBe(COLUMN_ELEMENT_ID);
    // 0,40 × 0,40 m because the section says so — never a generic column size.
    expect(stub.shape.B).toBe(sec.b);
    expect(stub.shape.L).toBe(sec.h);
    expect(stub.shape.B).toBe(0.4);
  });

  it('derives the stub extent from the footing top and the real cage, and declares the cut', () => {
    const f = modelStore.model.footings.get(FOOTING_ID)!;
    const footingTopZ = f.foundingElevation + f.thickness;
    const stub = body('supportedColumn');
    const base = stub.shape.centre.z - stub.shape.height / 2;
    const top = stub.shape.centre.z + stub.shape.height / 2;

    // BASE: the same expression the production dowel generator used as `footingTopZ`.
    expect(base).toBeCloseTo(footingTopZ, 12);
    expect(base).toBeCloseTo(-0.7, 12);

    // TOP: the highest point of the cage's steel, and no higher. Every bar is inside it.
    const barTop = Math.max(...doc.reinforcement.bars.flatMap(
      (b) => b.segments.flatMap((s) => [s.start.z, s.end.z]).map((z) => z + b.diameterMm / 2000)));
    expect(top).toBeGreaterThanOrEqual(barTop);
    // Never past the real column: element 1 runs to z = 3,20 m, and the stub stops far below.
    const el = modelStore.model.elements.get(COLUMN_ELEMENT_ID)!;
    const columnTopZ = Math.max(
      modelStore.model.nodes.get(el.nodeI)?.z ?? 0, modelStore.model.nodes.get(el.nodeJ)?.z ?? 0);
    expect(top).toBeLessThan(columnTopZ);

    // And the truncation is DECLARED, with the numbers, rather than left to be noticed.
    expect(stub.truncatedFaces).toEqual(['top']);
    expect(stub.derivation?.code).toBe('COLUMN_STUB_TRUNCATED_AT_CAGE_TOP');
    expect(stub.derivation?.params).toMatchObject({ base: -0.7, element: COLUMN_ELEMENT_ID });
  });

  it('records that the analysis model’s column base sits above the footing top', () => {
    // A real discontinuity in this project: element 1 starts at z = 0 while the footing top is
    // at z = −0,70 m. The stub is taken from the footing top because that is where production
    // put the bars, and the 0,70 m gap is stated rather than smoothed over.
    const a = doc.assumptions.find((n) => n.code === 'COLUMN_ELEMENT_BASE_ABOVE_FOOTING_TOP');
    expect(a, 'the gap is declared').toBeTruthy();
    expect(a!.params).toMatchObject({ base: 0, top: -0.7, gap: 0.7 });
  });

  it('preserves both identities and their shared coordinate system', () => {
    const [pad, stub] = [body('footing'), body('supportedColumn')];
    expect(pad.bodyId).not.toBe(stub.bodyId);
    // One frame: the stub sits directly over the pad's plan centre, in the same axes.
    expect(stub.shape.centre.x).toBe(pad.shape.centre.x);
    expect(stub.shape.centre.y).toBe(pad.shape.centre.y);
    expect(stub.shape.rotationDeg).toBe(pad.shape.rotationDeg);
  });
});

describe('the footing-to-column interface', () => {
  const iface = () => doc.concrete.interfaces[0];

  it('is a single concrete-to-concrete contact between the two components', () => {
    expect(doc.concrete.interfaces).toHaveLength(1);
    expect(iface().kind).toBe('concreteToConcrete');
    expect(iface().participants).toEqual({
      belowBodyId: body('footing').bodyId, aboveBodyId: body('supportedColumn').bodyId,
    });
  });

  it('sits exactly where the two solids meet, with the column’s footprint', () => {
    const pad = body('footing');
    const stub = body('supportedColumn');
    expect(iface().geometry.elevation).toBeCloseTo(pad.shape.centre.z + pad.shape.height / 2, 12);
    expect(iface().geometry.elevation)
      .toBeCloseTo(stub.shape.centre.z - stub.shape.height / 2, 12);
    expect(iface().geometry.B).toBe(stub.shape.B);
    expect(iface().geometry.L).toBe(stub.shape.L);
  });

  it('is INTERNAL, so it is never mistaken for an exposed cover face', () => {
    expect(iface().exposure).toBe('internal');
  });

  it('declares the bar penetration as intentional, and it includes every dowel', () => {
    const passage = iface().intentionalBarPassage!;
    const dowelIds = doc.assembly.families.find((x) => x.kind === 'columnDowel')!.barIds;
    for (const id of dowelIds) expect(passage.barIds).toContain(id);
    expect(passage.reasonKey).toBe('footing.cad.interface.intentionalPassage');
    // The clause that makes it intentional, not a bare assertion.
    expect(passage.clauseRefs?.map((c) => c.clause)).toContain('16.3.4');
  });

  it('classifies the penetration as intended rather than as a finding', () => {
    // The load-bearing negative: no check anywhere reports a crossing bar as a failure.
    const crossing = new Set(iface().intentionalBarPassage!.barIds);
    for (const c of doc.checks) {
      for (const fnd of c.findings ?? []) {
        const involves = [fnd.barIdA, fnd.barIdB].some((id) => id && crossing.has(id));
        if (!involves) continue;
        // A crossing bar may still appear in a BAR-TO-BAR finding — that is a different
        // property. What must never appear is a cover or containment finding against it.
        expect(['barCollision', 'barClearSpacing']).toContain(c.checkKind);
      }
    }
    const coverAndContainment = doc.checks.filter(
      (c) => c.checkKind === 'concreteCover' || c.checkKind === 'reinforcementContainment');
    for (const c of coverAndContainment) expect(c.findings ?? []).toHaveLength(0);
  });
});

describe('transfer-cage classification', () => {
  it('is a footingTransferCage and says so as a value', () => {
    expect(doc.assembly.kind).toBe('footingTransferCage');
    expect(doc.assembly.completeness).toBe('partialConnectionOnly');
    expect(doc.assembly.descriptionKey).toBe('footing.cad.assembly.description');
  });

  it('splits the cage into exactly the two production families', () => {
    const kinds = doc.assembly.families.map((f) => f.kind).sort();
    expect(kinds).toEqual(['columnDowel', 'starterTie']);
    const dowels = doc.assembly.families.find((f) => f.kind === 'columnDowel')!;
    const ties = doc.assembly.families.find((f) => f.kind === 'starterTie')!;
    expect(dowels.barIds).toHaveLength(8);
    expect(ties.barIds).toHaveLength(6);
    expect(dowels.purposeKey).toBe('footing.cad.family.columnDowel');
    expect(ties.purposeKey).toBe('footing.cad.family.starterTie');
  });

  it('gives every bar a family, and every bar exactly one', () => {
    const byFamily = new Map<string, number>();
    for (const f of doc.assembly.families) {
      for (const id of f.barIds) byFamily.set(id, (byFamily.get(id) ?? 0) + 1);
    }
    for (const b of doc.reinforcement.bars) {
      expect(byFamily.get(b.id), `bar ${b.id} family count`).toBe(1);
      expect(b.familyId).toBeTruthy();
    }
  });

  it('carries the production diameters, marks and cutting lengths', () => {
    const dowels = doc.reinforcement.bars.filter((b) => b.role === 'longitudinal');
    const ties = doc.reinforcement.bars.filter((b) => b.role === 'transverse');
    expect(dowels).toHaveLength(8);
    expect(ties).toHaveLength(6);
    expect(new Set(dowels.map((b) => b.diameterMm))).toEqual(new Set([16]));
    expect(new Set(ties.map((b) => b.diameterMm))).toEqual(new Set([6]));
    for (const b of doc.reinforcement.bars) {
      expect(b.cuttingLength, `bar ${b.id} cutting length`).toBeGreaterThan(0);
      expect(b.mark, `bar ${b.id} mark`).toBeTruthy();
      expect(b.ownerElementIds).toEqual([COLUMN_ELEMENT_ID]);
    }
    expect(doc.reinforcement.marks).toHaveLength(2);
    for (const m of doc.reinforcement.marks) {
      expect(m.quantity).toBe(m.barIds.length);
    }
    expect(doc.reinforcement.marks.map((m) => m.quantity).sort((a, b) => a - b)).toEqual([6, 8]);
  });
});

describe('bar and arc geometry', () => {
  it('serialises every arc with its exact centre and claims no approximation', () => {
    const arcs = doc.reinforcement.bars.flatMap((b) => b.segments.filter((s) => s.kind === 'arc'));
    expect(arcs).toHaveLength(38);
    for (const s of arcs) {
      // The centre is what makes a 3-D arc reconstructable at all: start, end, radius and
      // sweep are satisfied by two centres in any plane, and the plane itself is free.
      expect(s.centre, 'arc centre').toBeTruthy();
      expect(s.radius!).toBeGreaterThan(0);
      expect(s.arcApproximated).toBeUndefined();
      for (const v of [s.centre!.x, s.centre!.y, s.centre!.z]) expect(Number.isFinite(v)).toBe(true);
    }
  });

  it('keeps every coordinate finite and every segment length positive', () => {
    for (const b of doc.reinforcement.bars) {
      expect(b.segments.length).toBeGreaterThan(0);
      for (const s of b.segments) {
        expect(s.length).toBeGreaterThan(0);
        for (const p of [s.start, s.end]) {
          for (const v of [p.x, p.y, p.z]) expect(Number.isFinite(v)).toBe(true);
        }
        if (s.kind === 'straight') {
          expect(s.radius).toBeUndefined();
          expect(s.centre).toBeUndefined();
        }
      }
    }
  });

  it('carries the production hook geometry rather than synthesising one', () => {
    // Every bar in this cage is hooked, and for two different reasons: the dowels turn 90° over
    // the bottom mat because the straight development length does not fit in a 500 mm footing,
    // and the closed starter ties carry 135° seismic hooks at their lap. The manifest emits the
    // geometry each one actually has and never invents a hook for a bar that has none.
    const hooked = doc.reinforcement.bars.filter((b) => b.startTreatment.kind === 'hook');
    expect(hooked).toHaveLength(doc.reinforcement.bars.length);
    for (const b of hooked) {
      expect(b.startTreatment.hook, `bar ${b.id} hook geometry`).toBeTruthy();
      expect((b.startTreatment.hook as { angle?: number }).angle).toBeGreaterThan(0);
    }
    const dowels = doc.reinforcement.bars.filter((b) => b.role === 'longitudinal');
    expect(dowels).toHaveLength(8);
    for (const b of dowels) {
      expect((b.startTreatment.hook as { angle?: number }).angle, `dowel ${b.id}`).toBe(90);
    }
    // The mark shapes name the two hook patterns, from production, not from this test.
    expect(doc.reinforcement.marks.map((m) => m.shape).sort())
      .toEqual(['LH90', 'UH135H135']);
  });

  it('keeps every bar inside the concrete it belongs to', () => {
    const pad = body('footing');
    const stub = body('supportedColumn');
    const padBottom = pad.shape.centre.z - pad.shape.height / 2;
    const stubTop = stub.shape.centre.z + stub.shape.height / 2;
    for (const b of doc.reinforcement.bars) {
      const r = b.diameterMm / 2000;
      const zs = b.segments.flatMap((s) => [s.start.z, s.end.z]);
      expect(Math.min(...zs) - r, `bar ${b.id} above the footing underside`)
        .toBeGreaterThanOrEqual(padBottom);
      expect(Math.max(...zs) + r, `bar ${b.id} below the stub top`).toBeLessThanOrEqual(stubTop);
    }
  });
});

describe('authoritative Stabileo results are preserved, not recomputed', () => {
  it('exports the production collision verdict with its own classification', () => {
    const collision = check(`check:barCollision:footing:${FOOTING_ID}`);
    expect(collision.authority).toBe('stabileo');
    expect(collision.evaluationStatus).toBe('EVALUATED');
    expect(collision.consumerObservationPolicy).toBe('MAY_CROSS_CHECK');
    // Twelve real prohibited overlaps: the eight dowel hooks turn toward the column centre and
    // interfere at the bottom of the footing. This is a genuine production finding and the
    // manifest reports it rather than smoothing it into a pass.
    expect(collision.findings).toHaveLength(12);
    for (const f of collision.findings!) {
      expect(f.pairClass).toBe('prohibitedOverlap');
      expect(f.severity).toBe('overlap');
      expect(f.shortfall!).toBeGreaterThan(0);
      expect(f.unit).toBe('m');
      expect(f.elementIds).toEqual([COLUMN_ELEMENT_ID]);
    }
  });

  it('matches the assembly’s own conflicts exactly, pair for pair', () => {
    const assembly = (modelStore.model.detailing?.assemblies ?? [])
      .find((a) => (a.families ?? []).some((r) => r.ownerId === `F${FOOTING_ID}`))!;
    const fromAssembly = assembly.conflicts
      .map((c) => `${c.barA}|${c.barB}|${c.clearance}|${c.required}`).sort();
    const fromManifest = doc.checks
      .flatMap((c) => c.findings ?? [])
      .map((f) => `${f.barIdA}|${f.barIdB}|${f.measured}|${f.required}`).sort();
    expect(fromManifest).toEqual(fromAssembly);
  });

  it('keeps clear spacing as a separate evaluated check with the code-derived rules', () => {
    const spacing = check(`check:barClearSpacing:footing:${FOOTING_ID}`);
    expect(spacing.authority).toBe('stabileo');
    expect(spacing.evaluationStatus).toBe('EVALUATED');
    // Evaluated with no findings is a real result: every reported pair was a prohibited
    // overlap, judged before any spacing clause applied.
    expect(spacing.findings).toHaveLength(0);

    const rules = doc.requirements.clearSpacing.filter((r) => r.appliesToRolePair);
    expect(rules.length).toBeGreaterThan(0);
    for (const r of rules) {
      expect(r.category).toBe('codeDerived');
      expect(r.distance).toBeGreaterThan(0);
      // The clause the number came from, so a consumer measures against a cited requirement.
      expect(r.provenance.clauseRefs?.length).toBeGreaterThan(0);
      expect(r.provenance.source).toContain('minClearSpacingFor');
    }
    // §25.2.3 for two Ø16 column bars: the 40 mm absolute floor governs.
    const columnRule = rules.find((r) => r.appliesToRolePair!.memberKind === 'column')!;
    expect(columnRule.distance).toBeCloseTo(0.04, 12);
    expect(columnRule.appliesToRolePair!.governedBy).toBe('absoluteFloor');
  });

  it('never re-derives a pair classification it did not measure', () => {
    // Per-pair entries exist only for pairs Stabileo actually reported. Reconstructing a class
    // for the other pairs would need the collision detector's closest-approach data, and
    // guessing it is how a second implementation starts disagreeing with the first.
    const pairs = doc.requirements.clearSpacing.filter((r) => r.barIdA);
    expect(pairs).toHaveLength(12);
    for (const p of pairs) expect(p.reportable).toBe(true);
  });
});

describe('cover and containment honesty', () => {
  it('exports the footing’s own cover value, never a hard-coded 50 mm', () => {
    const f = modelStore.model.footings.get(FOOTING_ID)!;
    expect(doc.requirements.cover).toHaveLength(1);
    const req = doc.requirements.cover[0];
    expect(req.distance).toBe(f.cover);
    expect(req.category).toBe('placementInput');
    expect(req.provenance.source).toContain('Footing.cover');
    // The model does not distinguish faces, so no face is claimed.
    expect(req.surface).toBeUndefined();
  });

  it('scopes the footing cover requirement to the footing alone', () => {
    const req = doc.requirements.cover[0];
    const stubId = body('supportedColumn').bodyId;
    expect(req.appliesToBodyIds).toEqual([body('footing').bodyId]);
    expect(req.appliesToBodyIds).not.toContain(stubId);
    expect(req.measurementScope.withinBodyId).toBe(body('footing').bodyId);
    // And the interface is excluded, so an internal contact is not measured as a free face.
    expect(req.measurementScope.excludeInterfaceIds)
      .toEqual([doc.concrete.interfaces[0].interfaceId]);
    expect(req.measurementScope.excludeTruncatedFaces).toBe(true);
  });

  it('limits the requirement to bars that actually have material inside the footing', () => {
    const req = doc.requirements.cover[0];
    const footingTopZ = doc.concrete.interfaces[0].geometry.elevation;
    const scoped = new Set(req.appliesToBarIds);
    for (const b of doc.reinforcement.bars) {
      const dipsIn = b.segments.some((s) => s.start.z < footingTopZ || s.end.z < footingTopZ);
      expect(scoped.has(b.id), `bar ${b.id} in footing scope`).toBe(dipsIn);
    }
    // All eight dowels, plus the starter tie that straddles the footing top.
    expect(scoped.size).toBe(9);
  });

  it('reports footing containment as NOT_EVALUATED, with a mandatory reason', () => {
    const containment = check(`check:reinforcementContainment:footing:${FOOTING_ID}`);
    expect(containment.authority).toBe('none');
    expect(containment.evaluationStatus).toBe('NOT_EVALUATED');
    expect(containment.notEvaluatedCode).toBe(CODE_NO_CONTAINMENT_CHECKER);
    expect(containment.notEvaluatedReason?.length).toBeGreaterThan(0);
    expect(containment.findings ?? []).toHaveLength(0);
    // A consumer may measure it — and must label the result as not comparable.
    expect(containment.consumerObservationPolicy).toBe('MAY_OBSERVE_NOT_COMPARABLE');
  });

  it('reports footing cover as NOT_EVALUATED while still stating the requirement', () => {
    const cover = check(`check:concreteCover:footing:${FOOTING_ID}`);
    expect(cover.authority).toBe('none');
    expect(cover.evaluationStatus).toBe('NOT_EVALUATED');
    expect(cover.consumerObservationPolicy).toBe('MAY_OBSERVE_NOT_COMPARABLE');
    expect(cover.requirementIds).toEqual([doc.requirements.cover[0].requirementId]);
  });

  it('does not evaluate column cover, and attaches no requirement to the stub', () => {
    const cover = check(`check:concreteCover:column:${COLUMN_ELEMENT_ID}`);
    expect(cover.authority).toBe('none');
    expect(cover.evaluationStatus).toBe('NOT_EVALUATED');
    expect(cover.notEvaluatedCode).toBe(CODE_COLUMN_COVER_OUT_OF_SCOPE);
    // OUT_OF_SCOPE, not MAY_OBSERVE: the consumer must not measure this at all here.
    expect(cover.consumerObservationPolicy).toBe('OUT_OF_SCOPE');
    expect(cover.requirementIds).toEqual([]);
    expect(cover.scope?.bodyIds).toEqual([body('supportedColumn').bodyId]);
  });

  it('gives each concrete component its own cover status', () => {
    // The structural reason this matters: without a per-body check, a component nobody
    // evaluated inherits another's status by omission.
    const covers = doc.checks.filter((c) => c.checkKind === 'concreteCover');
    expect(covers).toHaveLength(2);
    for (const b of doc.concrete.bodies) {
      expect(covers.some((c) => (c.scope?.bodyIds ?? []).includes(b.bodyId)), b.bodyId).toBe(true);
    }
  });

  it('never reports a pass for anything Stabileo did not evaluate', () => {
    for (const c of doc.checks) {
      if (c.evaluationStatus !== 'NOT_EVALUATED') continue;
      expect(c.authority).toBe('none');
      expect(c.findings ?? []).toHaveLength(0);
      expect(c.consumerObservationPolicy).not.toBe('MAY_CROSS_CHECK');
    }
  });
});

describe('unsupported conditions', () => {
  it('declares that footing mat geometry is not modelled', () => {
    const n = doc.unsupported.find((x) => x.code === CODE_FOOTING_MAT_NOT_MODELED);
    expect(n, 'the mat condition is present').toBeTruthy();
    expect(n!.messageKey).toBe('footing.cad.unsupported.matGeometry');
    expect(n!.bodyIds).toEqual([body('footing').bodyId]);
  });

  it('declares the containment and column-cover limitations too', () => {
    const codes = doc.unsupported.map((n) => n.code);
    expect(codes).toContain(CODE_NO_CONTAINMENT_CHECKER);
    expect(codes).toContain(CODE_COLUMN_COVER_OUT_OF_SCOPE);
  });

  it('never claims complete footing reinforcement', () => {
    expect(doc.assembly.completeness).not.toBe('completeFootingReinforcement');
    expect(JSON.stringify(doc)).not.toContain('completeFootingReinforcement');
  });

  it('records the assumed aggregate size as assumed', () => {
    // No concrete in the fixture states one, and 20 mm is not a regulatory default.
    const n = doc.assumptions.find((x) => x.code === 'MAX_AGGREGATE_SIZE_ASSUMED');
    expect(n!.params).toMatchObject({ mm: 20 });
  });
});

describe('identity and validation', () => {
  it('passes both its own validation layers', () => {
    const v = validateRcCadHandoff(doc);
    expect(v.schema, 'schema violations').toEqual([]);
    expect(v.semantic, 'semantic violations').toEqual([]);
  });

  it('keeps every id unique and every reference resolving', () => {
    const ids = [
      ...doc.concrete.bodies.map((b) => b.bodyId),
      ...doc.concrete.interfaces.map((i) => i.interfaceId),
      ...doc.reinforcement.bars.map((b) => b.id),
      ...doc.assembly.families.map((f) => f.familyId),
      ...doc.checks.map((c) => c.checkId),
      ...doc.requirements.cover.map((r) => r.requirementId),
      ...doc.requirements.clearSpacing.map((r) => r.requirementId),
    ];
    expect(new Set(ids).size, 'no duplicate identifiers').toBe(ids.length);
  });

  it('derives ids from production identity rather than array position', () => {
    expect(body('footing').bodyId).toBe(`body:footing:${FOOTING_ID}`);
    expect(body('supportedColumn').bodyId).toBe(`body:column:${COLUMN_ELEMENT_ID}`);
    expect(doc.concrete.interfaces[0].interfaceId)
      .toBe(`iface:footing:${FOOTING_ID}:column:${COLUMN_ELEMENT_ID}`);
  });
});

describe('determinism', () => {
  it('produces identical bytes twice from one model state', () => {
    const a = buildFootingCadHandoff(FOOTING_ID, keyTranslate);
    const b = buildFootingCadHandoff(FOOTING_ID, keyTranslate);
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(a.json).toBe(b.json);
    expect(sha256(a.json)).toBe(sha256(b.json));
  });

  it('re-deriving from a fresh production chain reproduces every value but the revision', async () => {
    await runProductionChain();
    const again = buildFootingCadHandoff(FOOTING_ID, keyTranslate);
    expect(again.ok).toBe(true);
    if (!again.ok) return;

    // The REVISION legitimately differs, and that is the revision graph working rather than a
    // determinism failure: `verificationStore.demandRevision` is a monotonic counter, so a
    // second design run in the same process genuinely puts the model at a later demand. A
    // manifest that reported the same revision for two different runs would be the bug.
    expect(again.handoff.revisions.demand).toBeGreaterThan(doc.revisions.demand);

    // Everything the CAD side consumes — geometry, families, requirements, verdicts — is
    // byte-identical. That is the determinism claim that matters.
    const strip = (d: RcCadHandoffV1) => {
      const { revisions: _revisions, ...rest } = JSON.parse(JSON.stringify(d)) as RcCadHandoffV1;
      return JSON.stringify(rest);
    };
    expect(strip(again.handoff)).toBe(strip(doc));
  }, 180_000);

  it('sorts every object key, so insertion order is not part of the contract', () => {
    const walk = (v: unknown, path: string): void => {
      if (Array.isArray(v)) { v.forEach((x, i) => walk(x, `${path}/${i}`)); return; }
      if (!v || typeof v !== 'object') return;
      const keys = Object.keys(v as object);
      expect(keys, `keys at ${path}`).toEqual([...keys].sort());
      for (const k of keys) walk((v as Record<string, unknown>)[k], `${path}/${k}`);
    };
    walk(JSON.parse(json), '');
    expect(json.endsWith('\n')).toBe(true);
  });

  it('names the file from identity and revisions, with no timestamp', () => {
    const name = rcCadHandoffFilename(doc);
    expect(name).toBe(`rc-cad-handoff-Z1-det${doc.revisions.detailing}-dem${doc.revisions.demand}.json`);
    expect(name).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  it('re-serialising the parsed document reproduces the same bytes', () => {
    expect(serializeRcCadHandoff(JSON.parse(json) as RcCadHandoffV1)).toBe(json);
  });
});

describe('fixture-to-manifest reconciliation', () => {
  it('reports the fixture checksum this manifest was derived from', () => {
    // Pinned so a fixture edit cannot silently change what the manifest describes.
    expect(sha256(fixtureText()))
      .toBe('15ce4e150919bf8f91ef1e3fae36dcde584b770fea45861465742654153e3e79');
  });

  it('every geometric input traces back to a value in the restored project', () => {
    const f = modelStore.model.footings.get(FOOTING_ID)!;
    const el = modelStore.model.elements.get(COLUMN_ELEMENT_ID)!;
    const sec = modelStore.model.sections.get(el.sectionId)!;
    const node = modelStore.model.nodes.get(f.nodeId)!;
    const pad = body('footing');
    const stub = body('supportedColumn');
    expect([pad.shape.B, pad.shape.L, pad.shape.height]).toEqual([f.B, f.L, f.thickness]);
    expect([stub.shape.B, stub.shape.L]).toEqual([sec.b, sec.h]);
    expect([pad.shape.centre.x, pad.shape.centre.y]).toEqual([node.x, node.y]);
    expect(doc.requirements.cover[0].distance).toBe(f.cover);
    expect(doc.concrete.interfaces[0].geometry.elevation)
      .toBeCloseTo(f.foundingElevation + f.thickness, 12);
  });
});

function sha256(s: string): string {
  return createHash('sha256').update(s, 'utf8').digest('hex');
}
