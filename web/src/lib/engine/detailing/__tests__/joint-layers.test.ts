/**
 * Orthogonal joint-layer allocation.
 *
 * The clause finding these tests encode: §25.2.1 and §25.2.2 are written for "barras
 * PARALELAS". Nothing in §25.2 prescribes a clear distance between bars that cross. So
 * perpendicular beam bars may touch — and that is precisely why the 6,136 flagship
 * overlaps were not a spacing problem. They were centrelines passing through each other,
 * which no clause, tolerance or project decision permits.
 */

import { describe, expect, it } from 'vitest';
import {
  allocateLayers, crossingSeparation, depthAfterRaise,
  type LineForLayering, type LineCrossing,
} from '../joint-layers';

function line(id: string, dx: number, dy: number, bar = 16, ids = [1]): LineForLayering {
  return { lineId: id, elementIds: ids, direction: { x: dx, y: dy }, maxBarMm: bar };
}

describe('what the code actually requires at a crossing', () => {
  it('two crossing bars need exactly their radii, because they may touch', () => {
    // Ø16 and Ø16: 8 + 8 = 16 mm centre to centre. Surfaces in contact, zero clear.
    expect(crossingSeparation(16, 16).separation).toBeCloseTo(0.016, 9);
  });

  it('unequal bars need the sum of their own radii, not twice the larger', () => {
    expect(crossingSeparation(20, 12).separation).toBeCloseTo(0.016, 9);
  });

  it('cites §25.2.1 as the clause it is NOT applying to the crossing', () => {
    // The provenance has to record which rule was consulted and found inapplicable,
    // or a reviewer cannot tell a considered decision from an oversight.
    expect(crossingSeparation(16, 16).refs[0].clause).toBe('25.2.1');
  });

  it('the project margin adds to the separation and is never negative', () => {
    expect(crossingSeparation(16, 16, 0.010).separation).toBeCloseTo(0.026, 9);
    expect(crossingSeparation(16, 16, -5).separation).toBeCloseTo(0.016, 9);
  });

  it('zero margin still means touching, never coincident', () => {
    expect(crossingSeparation(12, 12, 0).separation).toBeGreaterThan(0);
  });
});

describe('allocation on an orthogonal grid', () => {
  const grid = {
    lines: [line('line-000001', 1, 0), line('line-000002', 0, 1)],
    crossings: [{ a: 'line-000001', b: 'line-000002', jointId: 'n1' }] as LineCrossing[],
    edition: '2025' as const,
  };

  it('separates two crossing lines into different ranks', () => {
    const a = allocateLayers(grid);
    expect(a.byLine.get('line-000001')!.rank)
      .not.toBe(a.byLine.get('line-000002')!.rank);
  });

  it('two ranks suffice for a grid', () => {
    expect(allocateLayers(grid).ranks).toBe(2);
  });

  it('leaves nothing unresolved', () => {
    expect(allocateLayers(grid).unresolved).toEqual([]);
  });

  it('rank 0 keeps its full effective depth', () => {
    const a = allocateLayers(grid);
    const rank0 = [...a.byLine.values()].find((x) => x.rank === 0)!;
    expect(rank0.bottomRaise).toBe(0);
  });

  it('rank 1 is raised by exactly the crossing separation', () => {
    const a = allocateLayers(grid);
    const rank1 = [...a.byLine.values()].find((x) => x.rank === 1)!;
    expect(rank1.bottomRaise).toBeCloseTo(0.016, 9);
  });

  it('top bars drop by the same amount bottom bars rise', () => {
    const a = allocateLayers(grid);
    for (const v of a.byLine.values()) expect(v.topLower).toBeCloseTo(v.bottomRaise, 12);
  });

  it('parallel lines that never cross may share a rank', () => {
    // Three parallel lines, no crossings: stacking them would throw away lever arm for
    // nothing.
    const a = allocateLayers({
      lines: [line('line-000001', 1, 0), line('line-000002', 1, 0), line('line-000003', 1, 0)],
      crossings: [], edition: '2025',
    });
    expect(a.ranks).toBe(1);
    expect([...a.byLine.values()].every((v) => v.bottomRaise === 0)).toBe(true);
  });
});

describe('determinism', () => {
  const lines = [
    line('line-000003', 0, 1), line('line-000001', 1, 0), line('line-000002', 0, 1),
  ];
  const crossings: LineCrossing[] = [
    { a: 'line-000001', b: 'line-000003', jointId: 'n1' },
    { a: 'line-000001', b: 'line-000002', jointId: 'n2' },
  ];

  it('the same floor gives the same allocation whatever order it arrives in', () => {
    const a = allocateLayers({ lines, crossings, edition: '2025' });
    const b = allocateLayers({
      lines: [...lines].reverse(), crossings: [...crossings].reverse(), edition: '2025',
    });
    for (const [id, v] of a.byLine) {
      expect(b.byLine.get(id)!.rank).toBe(v.rank);
      expect(b.byLine.get(id)!.bottomRaise).toBeCloseTo(v.bottomRaise, 12);
    }
  });

  it('a self-crossing is ignored rather than making the graph unsatisfiable', () => {
    const a = allocateLayers({
      lines: [line('line-000001', 1, 0)],
      crossings: [{ a: 'line-000001', b: 'line-000001', jointId: 'n1' }],
      edition: '2025',
    });
    expect(a.unresolved).toEqual([]);
  });
});

describe('when the section runs out of room', () => {
  /** Four lines all crossing each other needs four ranks; cap it at two. */
  const clique = ['line-000001', 'line-000002', 'line-000003', 'line-000004'];
  const crossings: LineCrossing[] = [];
  for (let i = 0; i < clique.length; i++) {
    for (let j = i + 1; j < clique.length; j++) {
      crossings.push({ a: clique[i], b: clique[j], jointId: `n${i}${j}` });
    }
  }

  it('reports the crossings it could not separate instead of pretending', () => {
    const a = allocateLayers({
      lines: clique.map((id) => line(id, 1, 0)), crossings, edition: '2025', maxRanks: 2,
    });
    expect(a.unresolved.length).toBeGreaterThan(0);
    expect(a.unresolved[0].reason.key).toBe('detailing.layers.exhausted');
  });

  it('names the joint, so the engineer knows where to look', () => {
    const a = allocateLayers({
      lines: clique.map((id) => line(id, 1, 0)), crossings, edition: '2025', maxRanks: 2,
    });
    expect(a.unresolved[0].jointId).toMatch(/^n\d+$/);
  });
});

describe('raising steel costs lever arm', () => {
  it('the effective depth drops by exactly the raise', () => {
    expect(depthAfterRaise(0.60, 0.016)).toBeCloseTo(0.584, 9);
  });

  it('a rank-0 line loses nothing', () => {
    expect(depthAfterRaise(0.60, 0)).toBe(0.60);
  });

  it('never credits depth for a negative raise', () => {
    expect(depthAfterRaise(0.60, -0.02)).toBe(0.60);
  });
});

describe('liveness — the allocator must be reached with real crossings', () => {
  it('a grid with crossings produces at least one raised line', () => {
    // If this ever reads zero, the allocation is running on an empty crossing graph and
    // every line is silently rank 0 — which is exactly the state that produced 6,136
    // interpenetrating bars while looking like it had been coordinated.
    const a = allocateLayers({
      lines: [line('line-000001', 1, 0), line('line-000002', 0, 1)],
      crossings: [{ a: 'line-000001', b: 'line-000002', jointId: 'n1' }],
      edition: '2025',
    });
    expect([...a.byLine.values()].filter((v) => v.bottomRaise > 0).length).toBeGreaterThan(0);
  });
});
