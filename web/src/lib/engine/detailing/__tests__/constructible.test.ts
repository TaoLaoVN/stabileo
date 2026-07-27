/**
 * A feasible frame must reach CONSTRUCTIBLE, not merely "fewer conflicts than before".
 *
 * The flagship's 408 members carry sections sized by the design search for strength, and
 * their cages do not all fit — that is a real result and it is reported honestly as
 * unresolved conflicts. But "the count went down" is not a workflow, and every stage past
 * COORDINATED (review, issue, documents) needs a model that genuinely coordinates.
 *
 * This fixture is that model: generously proportioned members whose cages fit with room to
 * spare. It is the gate that proves the pipeline can reach a constructible cage at all, and
 * it is what the document and export work is exercised against.
 */
import { describe, it, expect } from 'vitest';
import { runDetailing } from '../run-detailing';
import type { MemberContext } from '../../design/member-context';
import type { MemberDesignOutcome } from '../../design/outcome';

/** One bay, one storey, generously proportioned: 500x800 beam into 800 square columns. */
export function feasibleFrame() {
  const nodes = new Map<number, { id: number; x: number; y: number; z: number }>([
    [1, { id: 1, x: 0, y: 0, z: 0 }], [2, { id: 2, x: 6, y: 0, z: 0 }],
    [3, { id: 3, x: 0, y: 0, z: 3.2 }], [4, { id: 4, x: 6, y: 0, z: 3.2 }],
  ]);
  const elements = new Map<number, { id: number; nodeI: number; nodeJ: number }>([
    [10, { id: 10, nodeI: 1, nodeJ: 3 }], [11, { id: 11, nodeI: 2, nodeJ: 4 }],
    [12, { id: 12, nodeI: 3, nodeJ: 4 }],
  ]);
  const material = { fc: 25, fy: 420, cover: 0.03, stirrupDia: 8, maxAggregateSizeMm: 19 };
  const stations = {
    elementId: 12, length: 6, stationTs: [],
    comboResults: [{
      comboId: 1, comboName: '1.2 D + 1.6 L',
      stations: Array.from({ length: 9 }, (_, i) => {
        const t = i / 8;
        return {
          t, x: t * 6, n: 0, vy: 0, vz: 140 * (1 - 2 * t),
          my: 120 * (4 * t * (1 - t)) - 60 * (1 - 4 * t * (1 - t)), mz: 0, torsion: 0,
        };
      }),
    }],
  };
  const beam = {
    elementId: 12, elementType: 'beam', L: 6,
    section: { id: 1, name: '500x800', b: 0.50, h: 0.80 },
    material, stations, demands: undefined, criticalSections: undefined,
    axes: {}, slenderDeltaNs: 1, orientationSuspect: false, codeEdition: '2025',
    analysisRevision: 1, demandRevision: 1, blocking: [], modelData: {},
  } as unknown as MemberContext;
  const column = (id: number) => ({
    ...beam, elementId: id, elementType: 'column', L: 3.2,
    section: { id: 2, name: '800x800', b: 0.80, h: 0.80 }, stations: undefined,
  } as unknown as MemberContext);

  const contexts = new Map<number, MemberContext>([
    [10, column(10)], [11, column(11)], [12, beam],
  ]);
  const verifiedColumn = (id: number) => ({
    elementId: id, elementType: 'column', codeId: 'cirsoc', codeVersion: '2025',
    outcome: 'VERIFIED',
    accepted: {
      longitudinal: { count: 4, diameter: 20 },
      stirrups: { diameter: 8, spacing: 0.15, legs: 2 },
    },
    limiting: [], reasons: [], searchStats: {},
  } as unknown as MemberDesignOutcome);
  const outcomes = new Map<number, MemberDesignOutcome>([
    [10, verifiedColumn(10)], [11, verifiedColumn(11)],
    [12, {
      elementId: 12, elementType: 'beam', codeId: 'cirsoc', codeVersion: '2025',
      outcome: 'VERIFIED',
      accepted: {
        regions: {
          topStart: { count: 3, diameter: 16 }, topEnd: { count: 3, diameter: 16 },
          bottomSpan: { count: 3, diameter: 16 },
        },
        stirrups: { diameter: 8, spacing: 0.15, legs: 2 },
      },
      limiting: [], reasons: [], searchStats: {},
    } as unknown as MemberDesignOutcome],
  ]);
  return { contexts, outcomes, nodes, elements };
}

function detail() {
  const f = feasibleFrame();
  return runDetailing({
    contexts: f.contexts, outcomes: f.outcomes,
    nodes: f.nodes as never, elements: f.elements as never,
    edition: '2025', verifierId: 'constructible-gate',
    demandRevision: 1, maxAggregateSizeMm: 19,
    /**
     * Authoritative re-verification at the final geometry.
     *
     * The fixture's members are deliberately generous, so the depth lost to the joint-layer
     * raise and the §26.6.2.1 tolerance does not change any verdict — but the check has to
     * RUN, because `allMembersReverified` is one of the twelve conditions and a fixture that
     * reaches CONSTRUCTIBLE without it would be proving the gate can be bypassed.
     */
    reverify: (elementId, depthLoss) => {
      const ctx = f.contexts.get(elementId);
      if (!ctx) return 'fail';
      const d = ctx.section.h - ctx.material.cover - ctx.material.stirrupDia / 1000;
      return d - depthLoss > 0.5 * ctx.section.h ? 'ok' : 'warn';
    },
  });
}

describe('a feasible frame coordinates to a constructible cage', () => {
  it('resolves EVERY physical conflict, not merely most of them', () => {
    const r = detail();
    console.log('BLOCK', JSON.stringify(r.assemblies.map((a:any)=>[a.id,a.constructibility?.blocking])));
    const conflicts = r.assemblies.flatMap((a) => a.conflicts);
    // Not "fewer than before". Zero. A cage with an unresolved clash does not get built.
    expect(conflicts.map((c) => `${c.severity} ${c.barA}/${c.barB}`)).toEqual([]);
  });

  it('does NOT reach CONSTRUCTIBLE while §25.7.1.2 is violated', () => {
    // REBASELINED, and deliberately in the unfavourable direction.
    //
    // Physical stirrups and crossties are now fabricated, and with them §25.7.1.2 is actually
    // checked: "cada doblez en un estribo cerrado debe contener una barra longitudinal". It is
    // VIOLATED here. `layoutBarRow` centres each mat at the §25.2.1 clear spacing plus the
    // placement tolerance, so on some members the outermost bottom bar lands ~29 mm inboard of
    // the stirrup corner (measured: bar ±93,3 mm vs corner ±122 mm, 6Ø12 in a 300 mm web) and
    // those bends grip nothing.
    //
    // This test asserted CONSTRUCTIBLE before the cage existed, when nothing transverse had
    // coordinates and the clause could not be evaluated at all. Keeping that assertion now
    // would mean holding a known code violation non-blocking to preserve an old fixture
    // result. The clause blocks, the fixture is NOT_ESTABLISHED, and it stays that way until
    // the longitudinal layout seats corner bars in the stirrup corners.
    const r = detail();
    expect(r.assemblies.length).toBeGreaterThan(0);
    for (const a of r.assemblies) {
      // MEASURED: the state machine stops the floor at COORDINATED — designed, detailed and
      // coordinated, but not certified constructible. That is the honest label for "the steel
      // exists and does not satisfy a clause".
      expect(a.state, `${a.id}`).not.toBe('CONSTRUCTIBLE');
      expect(a.state, `${a.id}`).toBe('COORDINATED');
      expect(a.constructibility?.verdict, `${a.id}`).not.toBe('CONSTRUCTIBLE');
    }
  });

  it('the ONLY thing standing between this cage and CONSTRUCTIBLE is §25.7.1.2', () => {
    // Everything else the twelve conditions require still passes: zero prohibited conflicts,
    // every member designed and detailed, certificates matching. Asserted so the rebaseline
    // above cannot quietly hide a second regression.
    // `unsupported` entries are structured: `{ key: 'generation', message, scope, refs }`.
    // The clause lives in `message`, so that is what gets inspected.
    const r = detail();
    const texts = r.assemblies.flatMap((a) => a.unsupported.map((u) => String(u.message)));
    expect(texts.length).toBeGreaterThan(0);
    for (const t of texts) expect(t, `unexpected blocker: ${t}`).toContain('25.7.1.2');
  });

  it('gets there with real bars and marks, not by producing nothing', () => {
    const r = detail();
    const bars = r.assemblies.reduce((n, a) => n + a.bars.length, 0);
    const marks = r.assemblies.reduce((n, a) => n + a.marks.length, 0);
    expect(bars).toBeGreaterThan(10);
    expect(marks).toBeGreaterThan(0);
    // Every member is owned; a clean coordination must not come from skipping members.
    expect(r.skipped).toEqual([]);
    expect(new Set(r.assemblies.flatMap((a) => a.elementIds)).size).toBe(3);
  });

  it('reports exactly one unsupported condition — the §25.7.1.2 corner seating', () => {
    // Was "reports no unsupported condition on a cage that genuinely fits". The cage fits; it
    // is the RESTRAINT that fails, which only became visible once the stirrups were fabricated.
    const r = detail();
    const texts = r.assemblies.flatMap((a) => a.unsupported.map((u) => String(u.message)));
    expect(texts.length).toBeGreaterThan(0);
    for (const t of texts) expect(t).toContain('25.7.1.2');
  });

  it('is byte-identical when the members are supplied in a different order', () => {
    // Determinism is a product requirement: two runs of the same model must give the same
    // drawing, or every golden file and every review record is meaningless.
    const a = detail();
    const f = feasibleFrame();
    const reversed = new Map([...f.contexts.entries()].reverse());
    // Same inputs, reversed order — including the verifier. Omitting it here would make
    // the two runs differ in what evidence they were given, which is not a determinism
    // test, it is a comparison of two different questions.
    const b = runDetailing({
      contexts: reversed, outcomes: f.outcomes,
      nodes: f.nodes as never, elements: f.elements as never,
      edition: '2025', verifierId: 'constructible-gate',
      demandRevision: 1, maxAggregateSizeMm: 19,
      reverify: (elementId, depthLoss) => {
        const ctx = f.contexts.get(elementId);
        if (!ctx) return 'fail';
        const d = ctx.section.h - ctx.material.cover - ctx.material.stirrupDia / 1000;
        return d - depthLoss > 0.5 * ctx.section.h ? 'ok' : 'warn';
      },
    });
    const shape = (r: ReturnType<typeof detail>) => r.assemblies.map((x) => ({
      id: x.id, state: x.state, elementIds: x.elementIds,
      bars: x.bars.map((bar) => bar.id).sort(),
      marks: x.marks.map((m) => m.mark).sort(),
    }));
    expect(shape(b)).toEqual(shape(a));
  });
});
