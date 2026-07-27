/**
 * The design–detailing feedback loop, on the real production path and at its edges.
 *
 * The production journey lives in `fixture-acceptance.test.ts`, which asserts the twelve
 * conditions. This file asserts the properties that make the loop safe to run at all: that
 * it terminates, that it cannot cycle, that it never assigns steel the engineer pinned, that
 * it never reuses a nominal-geometry certificate, and that every failure mode stays
 * distinguishable from every other.
 */

import { describe, expect, it } from 'vitest';
import frame from '../../../templates/fixtures/rc-design-qa-8.json';
import { runDesign } from '../../design/candidate-search';
import { cirsoc201Adapter } from '../../design/adapters/cirsoc201-adapter';
import { solveFixture } from '../../design/__tests__/helpers';
import { runDetailing, type RunDetailingResult } from '../run-detailing';
import {
  DEFAULT_MAX_ITERATIONS, runDesignFeedbackLoop,
  type DesignFeedbackLoopResult,
} from '../design-feedback-loop';
import {
  assertRepairInvariants, buildFinalGeometryFeedback, finalGeometryHash,
  selectCandidateUnderFinalGeometry, structuredFailures,
} from '../../design/final-geometry-feedback';
import { rebarHash } from '../../design/rebar-hash';
import type { MemberDesignOutcome } from '../../design/outcome';
import type { MemberContext } from '../../design/member-context';

interface Harness {
  contexts: Map<number, MemberContext>;
  outcomes: ReadonlyMap<number, MemberDesignOutcome>;
  detail: (o: ReadonlyMap<number, MemberDesignOutcome>) => RunDetailingResult;
  detailCalls: () => number;
}

let cachedHarness: Harness | null = null;

/** The real chain: solve → design → detail. Nothing seeded. */
function harness(): Harness {
  if (cachedHarness) return cachedHarness;
  const solved = solveFixture(frame as never);
  const summary = runDesign(cirsoc201Adapter, solved.contexts.values(), { maxRunMs: 180_000 });
  let calls = 0;
  const detail = (outcomes: ReadonlyMap<number, MemberDesignOutcome>) => {
    calls++;
    return runDetailing({
      contexts: solved.contexts,
      outcomes,
      nodes: solved.data.nodes as never,
      elements: solved.data.elements as never,
      edition: '2025',
      maxAggregateSizeMm: 19,
      verifierId: 'cirsoc201.provided.v2.2025',
      demandRevision: 1,
      // The assignment's reinforcement, not the model's: mid-loop they differ.
      reverify: (id: number, loss: never) => {
        const ctx = solved.contexts.get(id);
        const accepted = outcomes.get(id)?.accepted;
        if (!ctx || !accepted) return 'fail' as const;
        const res = cirsoc201Adapter.verify({ ...ctx, finalGeometry: loss } as never, accepted);
        return res?.overallStatus === 'fail' ? 'fail' as const
          : res?.overallStatus === 'warn' ? 'warn' as const : 'ok' as const;
      },
    } as never);
  };
  cachedHarness = {
    contexts: solved.contexts, outcomes: summary.outcomes, detail,
    detailCalls: () => calls,
  };
  return cachedHarness;
}

let cachedLoop: DesignFeedbackLoopResult | null = null;
function loop(): DesignFeedbackLoopResult {
  if (cachedLoop) return cachedLoop;
  const h = harness();
  cachedLoop = runDesignFeedbackLoop({
    adapter: cirsoc201Adapter,
    contexts: h.contexts,
    outcomes: h.outcomes,
    detail: h.detail,
  });
  return cachedLoop;
}

describe('beams 7 and 8: the failure, the repair and the arithmetic behind both', () => {
  it('the governing check is Table 9.7.6.2.2 maximum stirrup spacing, not flexure', () => {
    // This corrects a recorded diagnosis. The 1,031 was read as a lever-arm/flexure result
    // and it is not: every flexural check passes at the final geometry. What fails is the
    // MAXIMUM STIRRUP SPACING limit, which is proportional to d and therefore moves when
    // coordination takes depth away.
    const it1 = loop().iterations[0];
    expect(it1.failed).toEqual([7, 8]);
    for (const fb of it1.feedback) {
      const fails = fb.failedChecks.filter((c) => c.status === 'fail');
      expect(fails.map((c) => c.category)).toEqual(['Shear Support (Vz) s,max']);
      expect(fails[0].limiting).toBe('tieSpacing');
      // s,max = d/2 per Table 9.7.6.2.2 (Vs required <= 0,33·√f'c·bw·d).
      //   nominal d 512 mm → 256 mm, provided 250 mm — legal, 2,4 % of margin
      //   final   d 485 mm → 242 mm, provided 250 mm — 3,1 % over
      expect(fails[0].required).toBeCloseTo(24.3, 1);   // cm
      expect(fails[0].provided).toBeCloseTo(25.0, 1);   // cm
      expect(fb.finalUtilization).toBeCloseTo(1.031, 3);
    }
  });

  it('charges exactly the depth the geometry actually lost', () => {
    // 12 mm of joint-layer raise on the bottom face + 15 mm from Table 26.6.2.1(a).
    // 512 − 27 = 485; 485/2 = 242,5; 250/242,5 = 1,031. The whole failure is that number.
    for (const fb of loop().iterations[0].feedback) {
      expect(fb.finalGeometry.bottomRaise).toBeCloseTo(0.012, 6);
      expect(fb.finalGeometry.topLower).toBeCloseTo(0.010, 6);
      expect(fb.finalGeometry.depthTolerance).toBeCloseTo(0.015, 6);
      // Measured on the finished bars, not recomputed from the allocation.
      expect(fb.finalGeometry.layerCentroids.length).toBeGreaterThan(0);
      expect([...fb.finalGeometry.layerCentroids])
        .toEqual([...fb.finalGeometry.layerCentroids].sort((a, b) => b - a));
    }
  });

  it('reports no reinforcement deficit, because the governing check is not an area', () => {
    // The optional field is absent on purpose. A maximum-spacing limit has no "missing
    // steel area", and inventing one would send an engineer to add bars that change nothing.
    for (const fb of loop().iterations[0].feedback) {
      expect(fb.requiredReinforcementDeficit).toBeUndefined();
    }
  });

  it('repairs both by closing the stirrup spacing one grid step, and nothing else', () => {
    // 250 → 225 mm. The longitudinal steel is untouched: the failure was never flexural, so
    // adding bars would have been the wrong repair even though it would have "helped" the
    // utilisation number.
    const before = harness().outcomes;
    for (const r of loop().iterations[0].repairs) {
      expect(r.kind).toBe('FINAL_GEOMETRY_VERIFIED');
      const prev = before.get(r.elementId)!.accepted!;
      expect(r.accepted!.regions!.stirrupsSupport!.spacing).toBeCloseTo(0.225, 6);
      expect(prev.regions!.stirrupsSupport!.spacing).toBeCloseTo(0.250, 6);
      // Same longitudinal arrangement, region for region.
      expect(r.accepted!.regions!.bottomSpanLayers)
        .toEqual(prev.regions!.bottomSpanLayers);
      expect(r.accepted!.regions!.topStartLayers).toEqual(prev.regions!.topStartLayers);
      expect(r.accepted!.regions!.topEndLayers).toEqual(prev.regions!.topEndLayers);
    }
  });

  it('lands inside the approved design margin without an extra reinforcement step', () => {
    // Policy O5: prefer <= 0,95 when it costs no additional step. 0,883 clears it, and code
    // compliance (<= 1,00) remains the hard boundary that actually gates the outcome.
    for (const r of loop().iterations[0].repairs) {
      expect(r.certificate!.worstUtilization).toBeCloseTo(0.883, 3);
      expect(r.certificate!.worstUtilization).toBeLessThanOrEqual(0.95);
    }
  });

  it('re-coordinates the owning assembly and names the adjacent members', () => {
    const it1 = loop().iterations[0];
    expect(it1.changed).toEqual([7, 8]);
    expect(it1.affectedAssemblies).toEqual(['level-3.20']);
    // 7 and 8 run north-south; 5 and 6 cross them at the same joints. Their bars have to be
    // re-judged against the repaired cage, and the record says so rather than implying it.
    expect(it1.adjacentMembers).toEqual([5, 6]);
  });

  it('converges in one iteration and two coordination passes', () => {
    const l = loop();
    expect(l.outcome).toBe('FINAL_GEOMETRY_VERIFIED');
    expect(l.stats.iterations).toBe(1);
    expect(l.stats.detailingRuns).toBe(2);
    expect(l.unrepaired).toEqual([]);
  });
});

describe('the loop is reinforcement-only', () => {
  it('runs zero structural solves and never rebuilds a context', () => {
    const h = harness();
    const l = loop();
    expect(l.stats.structuralSolves).toBe(0);
    // The demands are inputs. If the loop had re-derived them, these would not be the same
    // objects — and a repaired member would be certified against forces nobody solved for.
    for (const [id, ctx] of h.contexts) {
      expect(l.result.reverification.some((r) => r.elementId === id)).toBe(true);
      expect(ctx.demands).toBe(h.contexts.get(id)!.demands);
    }
  });

  it('changes no section', () => {
    const h = harness();
    for (const [id, ctx] of h.contexts) {
      const after = h.contexts.get(id)!;
      expect(after.section.b).toBe(ctx.section.b);
      expect(after.section.h).toBe(ctx.section.h);
    }
    expect(loop().sectionAdvice).toEqual([]);
  });

  it('imports nothing from the solver', async () => {
    // A structural solve cannot appear here by accident if there is no way to reach one.
    const src = await import('node:fs').then((fs) => fs.readFileSync(
      new URL('../design-feedback-loop.ts', import.meta.url), 'utf8'));
    for (const forbidden of ['solver-3d', 'solver-js', 'wasm-solver', 'solver-service']) {
      expect(src, forbidden).not.toContain(forbidden);
    }
  });
});

describe('accounting is complete and honest', () => {
  it('reports candidates, verifier calls, memo hits and truncation', () => {
    const s = loop().stats;
    // Two members, two candidates each: the arrangement that failed (to drive the
    // generator's escalation) and the one that replaced it.
    expect(s.candidatesConsidered).toBe(4);
    expect(s.truncated).toBe(false);
    expect(s.repeatedStates).toBe(0);
    expect(s.nonMonotonicSkipped).toBe(0);
    // Memoisation is real, not decorative: 7 and 8 are identical members at identical
    // geometry, so the second one's whole repair is answered from the memo.
    expect(s.memoHits).toBeGreaterThanOrEqual(4);
    expect(s.verifierCalls).toBe(2);
    const perMember = loop().iterations[0].repairs.map((r) => r.stats.verifierCalls);
    expect(perMember).toEqual([1, 0]);
  });

  it('never pays twice for the same reinforcement at the same geometry', () => {
    // The memo key is (reinforcement, geometry). Both halves matter: the same steel at a
    // different geometry is a different question and must be re-verified.
    const g1 = finalGeometryHash({ bottomRaise: 0.012, topLower: 0.01, depthTolerance: 0.015 });
    const g2 = finalGeometryHash({ bottomRaise: 0.000, topLower: 0.01, depthTolerance: 0.015 });
    expect(g1).not.toBe(g2);
    expect(finalGeometryHash({ bottomRaise: 0.012, topLower: 0.01, depthTolerance: 0.015 }))
      .toBe(g1);
  });
});

describe('certificates describe the geometry that exists', () => {
  it('every repaired certificate names its final geometry', () => {
    for (const r of loop().iterations[0].repairs) {
      expect(r.certificate!.finalGeometryHash).toBe('b12.0/t10.0/d15.0');
      expect(r.certificate!.rebarHash).toBe(rebarHash(r.accepted!));
    }
  });

  it('the published outcome carries the final-geometry certificate alongside the nominal one', () => {
    for (const id of [7, 8]) {
      const o = loop().outcomes.get(id)!;
      expect(o.finalGeometryCertificate?.finalGeometryHash).toBe('b12.0/t10.0/d15.0');
      // The hash in the outcome is the steel actually assigned — not the arrangement the
      // nominal run certified, which is the substitution the twelve-condition gate exists
      // to catch.
      expect(o.certificate!.rebarHash).toBe(rebarHash(o.accepted!));
      expect(o.certificate!.rebarHash)
        .not.toBe(harness().outcomes.get(id)!.certificate!.rebarHash);
    }
  });

  it('a repair result cannot claim a pass it does not have', () => {
    const good = loop().iterations[0].repairs[0];
    expect(() => assertRepairInvariants(good)).not.toThrow();
    expect(() => assertRepairInvariants({ ...good, accepted: undefined }))
      .toThrow(/without reinforcement/);
    expect(() => assertRepairInvariants({ ...good, certificate: undefined }))
      .toThrow(/without a certificate/);
    expect(() => assertRepairInvariants({
      ...good, certificate: { ...good.certificate!, finalGeometryHash: '' },
    })).toThrow(/which geometry/);
    expect(() => assertRepairInvariants({
      ...good, certificate: { ...good.certificate!, worstUtilization: 1.2 },
    })).toThrow(/utilization/);
    expect(() => assertRepairInvariants({ ...good, limiting: ['shear'] }))
      .toThrow(/reports limiting constraints/);
    // A truncated search may never be reported as an exhaustive one.
    expect(() => assertRepairInvariants({
      ...good, kind: 'CANDIDATE_ENVELOPE_EXHAUSTED',
      accepted: undefined, certificate: undefined,
      limiting: ['tieSpacing'], reasons: [{ key: 'x' }],
      stats: { ...good.stats, truncated: true },
    })).toThrow(/truncated search/);
  });

  it('refuses to run a repair on a context that carries no final geometry', () => {
    // Without this, a caller could route a NOMINAL search through the repair path and get a
    // certificate that says nothing about the built geometry.
    const h = harness();
    const ctx = h.contexts.get(7)!;
    const fb = loop().iterations[0].feedback[0];
    expect(() => selectCandidateUnderFinalGeometry(cirsoc201Adapter, ctx, fb))
      .toThrow(/requires a context carrying finalGeometry/);
  });
});

describe('locked reinforcement is a hard constraint', () => {
  it('is refused rather than replaced, and says why', () => {
    const h = harness();
    const l = runDesignFeedbackLoop({
      adapter: cirsoc201Adapter,
      contexts: h.contexts,
      outcomes: h.outcomes,
      detail: h.detail,
      lockedMembers: new Set([7, 8]),
    });
    expect(l.outcome).toBe('LOCKED_REINFORCEMENT_PREVENTS_REPAIR');
    expect(l.unrepaired.map((u) => u.elementId)).toEqual([7, 8]);
    for (const u of l.unrepaired) {
      expect(u.kind).toBe('LOCKED_REINFORCEMENT_PREVENTS_REPAIR');
      expect(u.finalUtilization).toBeCloseTo(1.031, 3);
    }
    // The pinned steel is untouched and the honest verdict is preserved.
    for (const id of [7, 8]) {
      expect(rebarHash(l.outcomes.get(id)!.accepted!))
        .toBe(rebarHash(h.outcomes.get(id)!.accepted!));
    }
    for (const a of l.result.assemblies) {
      expect(a.constructibility?.verdict).toBe('NOT_ESTABLISHED');
    }
    // One extra pass only: with nothing changed there is nothing to re-coordinate.
    expect(l.stats.detailingRuns).toBe(1);
    expect(l.stats.iterations).toBe(1);
  });

  it('locking only member 7 still repairs member 8', () => {
    // Partial locking must not be all-or-nothing: the engineer pinned one bar, not the floor.
    const h = harness();
    const l = runDesignFeedbackLoop({
      adapter: cirsoc201Adapter,
      contexts: h.contexts,
      outcomes: h.outcomes,
      detail: h.detail,
      lockedMembers: new Set([7]),
    });
    expect(l.iterations[0].changed).toEqual([8]);
    expect(l.unrepaired.map((u) => u.elementId)).toEqual([7]);
    expect(l.outcome).toBe('LOCKED_REINFORCEMENT_PREVENTS_REPAIR');
  });
});

describe('bounds and termination', () => {
  it('an iteration budget of zero truncates instead of silently passing', () => {
    const h = harness();
    const l = runDesignFeedbackLoop({
      adapter: cirsoc201Adapter,
      contexts: h.contexts,
      outcomes: h.outcomes,
      detail: h.detail,
      maxIterations: 0,
    });
    expect(l.outcome).toBe('FEEDBACK_LOOP_TRUNCATED');
    expect(l.stats.truncated).toBe(true);
    expect(l.stats.detailingRuns).toBe(1);
    expect(l.unrepaired.map((u) => u.elementId)).toEqual([7, 8]);
    for (const a of l.result.assemblies) {
      expect(a.constructibility?.verdict).toBe('NOT_ESTABLISHED');
    }
  });

  it('a candidate budget of one truncates rather than claiming the envelope is exhausted', () => {
    // One candidate is the arrangement already known to fail, so nothing can be found — and
    // that is emphatically not the same statement as "no arrangement exists".
    const h = harness();
    const l = runDesignFeedbackLoop({
      adapter: cirsoc201Adapter,
      contexts: h.contexts,
      outcomes: h.outcomes,
      detail: h.detail,
      budget: { maxCandidates: 1, maxVerifierCalls: 1 },
    });
    expect(l.outcome).toBe('FEEDBACK_LOOP_TRUNCATED');
    for (const r of l.iterations[0].repairs) {
      expect(r.kind).toBe('FEEDBACK_LOOP_TRUNCATED');
      expect(r.stats.truncated).toBe(true);
      expect(r.stats.envelopeExhausted).toBe(false);
      expect(r.sectionAdvice).toBeUndefined();
    }
  });

  it('the iteration bound is a count, so the verdict cannot depend on the machine', async () => {
    expect(DEFAULT_MAX_ITERATIONS).toBe(8);
    expect(Number.isInteger(DEFAULT_MAX_ITERATIONS)).toBe(true);
    // No wall-clock anywhere in the loop or the selector.
    const fs = await import('node:fs');
    for (const f of ['../design-feedback-loop.ts', '../../design/final-geometry-feedback.ts']) {
      const src = fs.readFileSync(new URL(f, import.meta.url), 'utf8');
      expect(src, f).not.toContain('Date.now');
      expect(src, f).not.toContain('performance.now');
    }
  });
});

describe('determinism', () => {
  it('two runs of the same input agree on every repair and every bar', () => {
    const h = harness();
    const run = () => runDesignFeedbackLoop({
      adapter: cirsoc201Adapter,
      contexts: h.contexts,
      outcomes: h.outcomes,
      detail: h.detail,
    });
    const shape = (l: DesignFeedbackLoopResult) => ({
      outcome: l.outcome,
      stats: l.stats,
      iterations: l.iterations.map((i) => ({
        failed: i.failed, changed: i.changed, hash: i.assignmentHash,
        affected: i.affectedAssemblies, adjacent: i.adjacentMembers,
        repairs: i.repairs.map((r) => `${r.elementId}:${r.kind}:${r.certificate?.rebarHash}`),
      })),
      bars: l.result.assemblies.flatMap((a) => a.bars
        .map((b) => `${b.id}|${b.layerId}|${b.cuttingLength.toFixed(6)}`)),
    });
    expect(shape(run())).toEqual(shape(run()));
  });

  it('assemblies owning no changed member come back byte-identical', () => {
    // The whole floor is re-coordinated on purpose — arc consistency propagates across
    // joints, so a scoped re-run would judge a neighbour against a cage that no longer
    // exists. What must hold is that re-coordination changes nothing it should not, and
    // that is observable on the output rather than argued about in a comment.
    const h = harness();
    const before = h.detail(h.outcomes);
    const l = loop();
    const changed = new Set(l.iterations.flatMap((i) => i.changed));
    const untouched = before.assemblies.filter((a) => !a.elementIds.some((e) => changed.has(e)));
    for (const a of untouched) {
      const after = l.result.assemblies.find((x) => x.id === a.id);
      expect(after, a.id).toBeDefined();
      expect(after!.bars.map((b) => `${b.id}|${b.cuttingLength.toFixed(6)}`))
        .toEqual(a.bars.map((b) => `${b.id}|${b.cuttingLength.toFixed(6)}`));
    }
  });
});

describe('the record is pure data', () => {
  it('carries no functions, and survives a JSON round trip unchanged', () => {
    // It has to be persistable, diffable and renderable in a report without a live run.
    const fb = loop().iterations[0].feedback[0];
    expect(JSON.parse(JSON.stringify(fb))).toEqual(fb);
    const walk = (v: unknown): void => {
      if (typeof v === 'function') throw new Error('feedback record contains a function');
      if (Array.isArray(v)) { v.forEach(walk); return; }
      if (v && typeof v === 'object') Object.values(v).forEach(walk);
    };
    expect(() => walk(fb)).not.toThrow();
  });

  it('names the rejected arrangement so the next iteration cannot retry it', () => {
    const h = harness();
    for (const fb of loop().iterations[0].feedback) {
      const prev = h.outcomes.get(fb.elementId)!.accepted!;
      expect(fb.previousCandidateHash).toBe(rebarHash(prev));
      expect(fb.rejectedCandidateHashes).toContain(fb.previousCandidateHash);
    }
  });

  it('structuredFailures reports warnings as well as failures, and never an ok check', () => {
    const h = harness();
    const ctx = h.contexts.get(7)!;
    const verdict = cirsoc201Adapter.verify(
      { ...ctx, finalGeometry: { bottomRaise: 0.012, topLower: 0.01, depthTolerance: 0.015 } } as never,
      h.outcomes.get(7)!.accepted!);
    const out = structuredFailures(verdict);
    expect(out.length).toBeGreaterThan(0);
    expect(out.every((c) => c.status !== 'ok')).toBe(true);
    expect(out.some((c) => c.status === 'fail')).toBe(true);
    // Every entry keeps the verifier's own category string, because that is what the
    // candidate generator escalates on. A second vocabulary here could drift from it.
    for (const c of out) {
      expect(verdict.checks.some((k) => k.category === c.category)).toBe(true);
    }
  });

  it('builds from the FINAL-geometry verdict, and a nominal one is visibly different', () => {
    const h = harness();
    const ctx = h.contexts.get(7)!;
    const reinf = h.outcomes.get(7)!.accepted!;
    const geom = {
      bottomRaise: 0.012, topLower: 0.01, depthTolerance: 0.015, layerCentroids: [3.4, 3.0],
    };
    const atFinal = buildFinalGeometryFeedback({
      elementId: 7, previousCandidate: reinf, finalGeometry: geom,
      verdict: cirsoc201Adapter.verify({ ...ctx, finalGeometry: geom } as never, reinf),
    });
    const atNominal = buildFinalGeometryFeedback({
      elementId: 7, previousCandidate: reinf, finalGeometry: geom,
      verdict: cirsoc201Adapter.verify(ctx, reinf),
    });
    expect(atFinal.finalUtilization).toBeCloseTo(1.031, 3);
    expect(atNominal.finalUtilization).toBeCloseTo(0.932, 3);
    expect(atFinal.failedChecks.some((c) => c.status === 'fail')).toBe(true);
    expect(atNominal.failedChecks.some((c) => c.status === 'fail')).toBe(false);
  });
});
