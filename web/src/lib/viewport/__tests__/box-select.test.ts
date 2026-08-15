/**
 * What a dragged rectangle takes.
 *
 * The reported defect was blunt: in Nodes, Supports and Loads mode, dragging in
 * the 2D viewport did nothing — not even a rectangle appeared. Only the
 * Elements branch ever started the drag, so three quarters of the selection
 * filter had no marquee at all.
 *
 * The fix is two parts and only one of them is visible. Starting the drag is
 * the visible half; deciding what the rectangle then TAKES is the half that has
 * to be right, and it is right or wrong per entity and per gesture. Eight
 * combinations, each with an inside, an outside and a straddling case, is
 * exactly the kind of thing nobody checks by hand in a browser.
 *
 * Screen coordinates throughout: y grows downward, as on a canvas.
 */

import { describe, it, expect } from 'vitest';
import { boxSelect, normaliseDrag, type BoxSelectModel, type ScreenRect } from '../box-select';

/**
 * A two-bay frame, one metre to ten pixels, y flipped like a canvas.
 *
 *   nodes 1..4 along the bottom at y = 0, nodes 5..6 on top at y = 3
 */
const NODES = [
  { id: 1, x: 0, y: 0 },
  { id: 2, x: 4, y: 0 },
  { id: 3, x: 8, y: 0 },
  { id: 4, x: 12, y: 0 },
  { id: 5, x: 0, y: 3 },
  { id: 6, x: 12, y: 3 },
];

const ELEMENTS = [
  { id: 1, nodeI: 1, nodeJ: 2 },
  { id: 2, nodeI: 2, nodeJ: 3 },
  { id: 3, nodeI: 3, nodeJ: 4 },
  { id: 4, nodeI: 1, nodeJ: 5 },   // vertical, left
  { id: 5, nodeI: 4, nodeJ: 6 },   // vertical, right
];

const SUPPORTS = [
  { id: 10, nodeId: 1 },
  { id: 11, nodeId: 4 },
];

const LOADS = [
  { type: 'nodal', data: { id: 100, nodeId: 5 } },
  { type: 'pointOnElement', data: { id: 101, elementId: 2, a: 2 } },   // midspan of 2
  { type: 'distributed', data: { id: 102, elementId: 1 } },            // whole member 1
  { type: 'distributed', data: { id: 103, elementId: 3, a: 3, b: 4 } },// last metre of 3
  { type: 'thermal', data: { id: 104, elementId: 4 } },                // the left column
];

const toScreen = (p: { x: number; y: number }) => ({ x: p.x * 10, y: 100 - p.y * 10 });

const model: BoxSelectModel = {
  nodes: NODES,
  elements: ELEMENTS,
  supports: SUPPORTS,
  loads: LOADS,
  getNode: (id) => NODES.find((n) => n.id === id),
  getElement: (id) => ELEMENTS.find((e) => e.id === id),
};

/** A rectangle from world coordinates, so the tests read in metres. */
const rectOf = (x0: number, y0: number, x1: number, y1: number): ScreenRect => {
  const a = toScreen({ x: x0, y: y0 });
  const b = toScreen({ x: x1, y: y1 });
  return {
    x1: Math.min(a.x, b.x), y1: Math.min(a.y, b.y),
    x2: Math.max(a.x, b.x), y2: Math.max(a.y, b.y),
  };
};

const run = (rect: ScreenRect, isWindow: boolean, mode: 'elements' | 'nodes' | 'supports' | 'loads') =>
  boxSelect({ rect, isWindow, kinds: [mode], model, toScreen });

describe('the gesture is decided by horizontal direction alone', () => {
  it('left to right is a window', () => {
    expect(normaliseDrag(10, 10, 90, 90).isWindow).toBe(true);
    // Up-and-to-the-right is still a window: the vertical direction says nothing.
    expect(normaliseDrag(10, 90, 90, 10).isWindow).toBe(true);
  });

  it('right to left is a crossing', () => {
    expect(normaliseDrag(90, 10, 10, 90).isWindow).toBe(false);
    expect(normaliseDrag(90, 90, 10, 10).isWindow).toBe(false);
  });

  it('normalises the corners whichever way it was drawn', () => {
    const a = normaliseDrag(90, 90, 10, 10).rect;
    const b = normaliseDrag(10, 10, 90, 90).rect;
    expect(a).toEqual(b);
  });
});

describe('nodes mode', () => {
  it('takes the nodes inside and nothing else', () => {
    const r = run(rectOf(-1, -1, 5, 1), true, 'nodes');
    expect([...r.nodes].sort()).toEqual([1, 2]);
    expect(r.elements.size).toBe(0);
    expect(r.supports.size).toBe(0);
    expect(r.loads.size).toBe(0);
  });

  it('answers the same for both gestures, because a node is a point', () => {
    const rect = rectOf(-1, -1, 5, 1);
    expect([...run(rect, true, 'nodes').nodes].sort())
      .toEqual([...run(rect, false, 'nodes').nodes].sort());
  });

  it('takes nothing when the rectangle is empty of nodes', () => {
    expect(run(rectOf(5, 1, 7, 2), true, 'nodes').nodes.size).toBe(0);
  });
});

describe('elements mode', () => {
  it('window takes only members entirely inside', () => {
    // Around members 1 and 2 and their three nodes, but only reaching x = 8.
    const r = run(rectOf(-1, -1, 8.5, 1), true, 'elements');
    expect([...r.elements].sort()).toEqual([1, 2]);
    expect([...r.nodes].sort()).toEqual([1, 2, 3]);
  });

  it('window rejects a member with one end outside', () => {
    // Covers node 3 but stops short of node 4, so member 3 straddles.
    const r = run(rectOf(7, -1, 10, 1), true, 'elements');
    expect(r.elements.has(3)).toBe(false);
    expect([...r.nodes]).toEqual([3]);
  });

  it('crossing takes a member it merely touches', () => {
    const r = run(rectOf(7, -1, 10, 1), false, 'elements');
    expect(r.elements.has(3)).toBe(true);
  });

  it('crossing takes a member passing straight through, with both ends outside', () => {
    // A small net in the middle of member 2: neither node 2 nor 3 is inside.
    const r = run(rectOf(5, -0.5, 7, 0.5), false, 'elements');
    expect(r.nodes.size).toBe(0);
    expect(r.elements.has(2)).toBe(true);
  });

  it('window does NOT take a member passing through with both ends outside', () => {
    const r = run(rectOf(5, -0.5, 7, 0.5), true, 'elements');
    expect(r.elements.size).toBe(0);
  });
});

describe('supports mode', () => {
  it('takes the support at a node inside the rectangle', () => {
    const r = run(rectOf(-1, -1, 2, 1), true, 'supports');
    expect([...r.supports]).toEqual([10]);
    // And nothing else: the highlight has to equal what a Delete would remove.
    expect(r.nodes.size).toBe(0);
    expect(r.elements.size).toBe(0);
  });

  it('takes both when the rectangle spans the whole base', () => {
    const r = run(rectOf(-1, -1, 13, 1), true, 'supports');
    expect([...r.supports].sort()).toEqual([10, 11]);
  });

  it('ignores a node that carries no support', () => {
    const r = run(rectOf(3, -1, 5, 1), true, 'supports');   // node 2, unsupported
    expect(r.supports.size).toBe(0);
  });
});

describe('loads mode', () => {
  it('takes a nodal load by its node', () => {
    const r = run(rectOf(-1, 2, 1, 4), true, 'loads');
    expect([...r.loads]).toEqual([100]);
  });

  it('takes a point load at its position along the member, not at the midspan of it', () => {
    // Member 2 runs x = 4..8 and the load sits at a = 2, i.e. x = 6. A
    // rectangle over x = 4..5 must NOT take it.
    expect(run(rectOf(3.9, -1, 5, 1), true, 'loads').loads.has(101)).toBe(false);
    expect(run(rectOf(5.5, -1, 6.5, 1), true, 'loads').loads.has(101)).toBe(true);
  });

  it('window takes a distributed load only when its whole run is inside', () => {
    // Load 102 covers all of member 1 (x = 0..4).
    expect(run(rectOf(-1, -1, 5, 1), true, 'loads').loads.has(102)).toBe(true);
    expect(run(rectOf(-1, -1, 3, 1), true, 'loads').loads.has(102)).toBe(false);
  });

  it('crossing takes a distributed load it only clips', () => {
    expect(run(rectOf(-1, -1, 3, 1), false, 'loads').loads.has(102)).toBe(true);
  });

  it('honours a partial load\'s own extent', () => {
    /*
     * Load 103 covers only the last metre of member 3 — x = 11..12, not the
     * whole 8..12. A window over the first half of that member must not take
     * it, which is the case that fails if the code uses the member instead of
     * the loaded stretch.
     */
    expect(run(rectOf(7.5, -1, 10, 1), true, 'loads').loads.has(103)).toBe(false);
    expect(run(rectOf(7.5, -1, 10, 1), false, 'loads').loads.has(103)).toBe(false);
    expect(run(rectOf(10.5, -1, 12.5, 1), true, 'loads').loads.has(103)).toBe(true);
  });

  it('treats a thermal load as the member it acts on', () => {
    // Load 104 is on the left column, x = 0, y = 0..3.
    expect(run(rectOf(-1, -1, 1, 4), true, 'loads').loads.has(104)).toBe(true);
    expect(run(rectOf(-1, 1, 1, 2), true, 'loads').loads.has(104)).toBe(false);
    expect(run(rectOf(-1, 1, 1, 2), false, 'loads').loads.has(104)).toBe(true);
  });

  it('takes nothing but loads', () => {
    const r = run(rectOf(-2, -2, 14, 5), true, 'loads');
    expect(r.loads.size).toBeGreaterThan(0);
    expect(r.nodes.size).toBe(0);
    expect(r.elements.size).toBe(0);
    expect(r.supports.size).toBe(0);
  });
});

describe('the mode filter is what keeps highlight and deletion in step', () => {
  const everything = rectOf(-2, -2, 14, 5);

  it('nodes mode fills only nodes', () => {
    const r = run(everything, true, 'nodes');
    expect(r.nodes.size).toBe(NODES.length);
    expect(r.elements.size + r.supports.size + r.loads.size).toBe(0);
  });

  it('supports mode fills only supports', () => {
    const r = run(everything, true, 'supports');
    expect(r.supports.size).toBe(SUPPORTS.length);
    expect(r.nodes.size + r.elements.size + r.loads.size).toBe(0);
  });

  it('loads mode fills only loads', () => {
    const r = run(everything, true, 'loads');
    expect(r.loads.size).toBe(LOADS.length);
    expect(r.nodes.size + r.elements.size + r.supports.size).toBe(0);
  });

  it('elements mode fills nodes and elements, as it always did', () => {
    const r = run(everything, true, 'elements');
    expect(r.nodes.size).toBe(NODES.length);
    expect(r.elements.size).toBe(ELEMENTS.length);
    expect(r.supports.size + r.loads.size).toBe(0);
  });
});

describe('degenerate input', () => {
  it('a missing node does not throw or select', () => {
    const broken: BoxSelectModel = {
      ...model,
      elements: [{ id: 99, nodeI: 1, nodeJ: 404 }],
      getElement: () => ({ nodeI: 1, nodeJ: 404 }),
    };
    const r = boxSelect({
      rect: rectOf(-2, -2, 14, 5), isWindow: false, kinds: ['elements'], model: broken, toScreen,
    });
    expect(r.elements.has(99)).toBe(false);
  });

  it('a zero-length member is ignored rather than dividing by zero', () => {
    const degenerate: BoxSelectModel = {
      ...model,
      loads: [{ type: 'distributed', data: { id: 200, elementId: 7 } }],
      elements: [{ id: 7, nodeI: 1, nodeJ: 1 }],
      getElement: () => ({ nodeI: 1, nodeJ: 1 }),
    };
    const r = boxSelect({
      rect: rectOf(-2, -2, 14, 5), isWindow: false, kinds: ['loads'], model: degenerate, toScreen,
    });
    expect(r.loads.size).toBe(0);
  });
});

describe('a model with depth', () => {
  /*
   * The 3D viewport passes the camera projection, so the third coordinate has
   * to survive the trip. It did not in the first draft: the signature took two
   * numbers, the caller flattened every node to z = 0, and a marquee on a tower
   * would have selected from whichever storey happened to project onto it.
   */
  const NODES_3D = [
    { id: 1, x: 0, y: 0, z: 0 },
    { id: 2, x: 0, y: 0, z: 10 },     // directly above node 1
    { id: 3, x: 6, y: 0, z: 0 },
  ];
  const ELEMENTS_3D = [{ id: 1, nodeI: 1, nodeJ: 2 }, { id: 2, nodeI: 1, nodeJ: 3 }];

  /** A projection that actually uses z, as a camera does. */
  const project = (p: { x: number; y: number; z?: number }) =>
    ({ x: p.x * 10, y: 100 - (p.z ?? 0) * 10 });

  const model3d: BoxSelectModel = {
    nodes: NODES_3D,
    elements: ELEMENTS_3D,
    supports: [{ id: 20, nodeId: 2 }],
    loads: [{ type: 'distributed', data: { id: 200, elementId: 1 } }],
    getNode: (id) => NODES_3D.find((n) => n.id === id),
    getElement: (id) => ELEMENTS_3D.find((e) => e.id === id),
  };

  const run3d = (rect: ScreenRect, isWindow: boolean, mode: 'elements' | 'nodes' | 'supports' | 'loads') =>
    boxSelect({ rect, isWindow, kinds: [mode], model: model3d, toScreen: project });

  it('separates two nodes that differ only in z', () => {
    // Around the TOP node: screen y = 0 for z = 10, y = 100 for z = 0.
    const top = { x1: -20, y1: -10, x2: 20, y2: 20 };
    expect([...run3d(top, true, 'nodes').nodes]).toEqual([2]);

    const bottom = { x1: -20, y1: 80, x2: 20, y2: 120 };
    expect([...run3d(bottom, true, 'nodes').nodes].sort()).toEqual([1]);
  });

  it('takes the support on the upper node and not the lower one', () => {
    const top = { x1: -20, y1: -10, x2: 20, y2: 20 };
    expect([...run3d(top, true, 'supports').supports]).toEqual([20]);
    const bottom = { x1: -20, y1: 80, x2: 20, y2: 120 };
    expect(run3d(bottom, true, 'supports').supports.size).toBe(0);
  });

  it('measures a load along the member in three dimensions', () => {
    // The column runs 10 m in z. A window over its whole projected height
    // takes the load; one over the bottom third does not.
    const whole = { x1: -20, y1: -10, x2: 20, y2: 120 };
    expect(run3d(whole, true, 'loads').loads.has(200)).toBe(true);

    const lower = { x1: -20, y1: 80, x2: 20, y2: 120 };
    expect(run3d(lower, true, 'loads').loads.has(200)).toBe(false);
    expect(run3d(lower, false, 'loads').loads.has(200)).toBe(true);
  });
});

describe('more than one kind at a time', () => {
  /*
   * With multi-kind selection on, one drag answers "the nodes AND the supports
   * of this storey" — which is the whole reason for the setting. The single
   * case is the same code path with a set of one, so this also pins that the
   * two cannot drift apart.
   */
  const many = (rect: ScreenRect, isWindow: boolean, kinds: string[]) =>
    boxSelect({ rect, isWindow, kinds: kinds as never, model, toScreen });

  it('takes nodes and supports in one sweep', () => {
    const r = many(rectOf(-1, -1, 13, 1), true, ['nodes', 'supports']);
    expect([...r.nodes].sort()).toEqual([1, 2, 3, 4]);
    expect([...r.supports].sort()).toEqual([10, 11]);
    expect(r.elements.size).toBe(0);
    expect(r.loads.size).toBe(0);
  });

  it('takes every kind when every kind is asked for', () => {
    const r = many(rectOf(-2, -2, 14, 5), true, ['nodes', 'elements', 'supports', 'loads']);
    expect(r.nodes.size).toBe(NODES.length);
    expect(r.elements.size).toBe(ELEMENTS.length);
    expect(r.supports.size).toBe(SUPPORTS.length);
    expect(r.loads.size).toBe(LOADS.length);
  });

  it('each kind keeps its own gesture rule in the mix', () => {
    // A crossing over the middle of member 2: the member is taken because the
    // rectangle touches it, and no node is, because none is inside.
    const r = many(rectOf(5, -0.5, 7, 0.5), false, ['nodes', 'elements']);
    expect(r.elements.has(2)).toBe(true);
    expect(r.nodes.size).toBe(0);
  });

  it('a set of one behaves exactly like the single-kind case', () => {
    const rect = rectOf(-1, -1, 5, 1);
    const single = run(rect, true, 'nodes');
    const asSet = many(rect, true, ['nodes']);
    expect([...asSet.nodes].sort()).toEqual([...single.nodes].sort());
    expect(asSet.elements.size).toBe(single.elements.size);
  });
});

/**
 * Every permutation, audited rather than sampled.
 *
 * Four kinds means fifteen non-empty combinations, and each behaves
 * differently under the two gestures — sixty behaviours per viewport, which is
 * past the point where writing them out one at a time proves anything. Listing
 * fifteen expected answers by hand mostly tests whether the author copied the
 * implementation into the expectations.
 *
 * So the audit is by PROPERTY, and the properties are chosen so that the
 * per-kind tests above — which do check concrete values — carry the whole
 * combined space:
 *
 *   * **Composition.** A set of kinds returns exactly the union of the same
 *     kinds run alone. This is the load-bearing one: if it holds, no
 *     permutation can do anything the four single cases do not already do,
 *     and those four are pinned to real numbers above.
 *   * **Isolation.** Nothing outside the asked-for kinds comes back. This is
 *     what keeps the highlight and the delete key in step — a marquee that
 *     quietly filled `selectedElements` would delete members nobody targeted.
 *   * **Window ⊆ crossing.** The same rectangle read as a net must take at
 *     least what it takes as a frame. A sign slip in the straddling test
 *     shows up here and nowhere else.
 *
 * Run against both projections, because the 2D viewport and the 3D camera are
 * the same geometry reached two ways, and "it works in 2D" was true of the
 * version that flattened every node to z = 0.
 */
describe('every permutation of kinds, in both viewports', () => {
  const KINDS = ['elements', 'nodes', 'supports', 'loads'] as const;
  type Kind = typeof KINDS[number];

  /** The fifteen non-empty subsets, built rather than typed out. */
  const PERMUTATIONS: Kind[][] = [];
  for (let mask = 1; mask < 16; mask++) {
    PERMUTATIONS.push(KINDS.filter((_, i) => mask & (1 << i)));
  }

  /*
   * `elements` deliberately brings the nodes with it: selecting a member and
   * not its ends leaves a highlight that looks broken, and the property
   * checks below would report that as a leak. Stated here as the contract it
   * is, so a future change to it fails loudly instead of being absorbed.
   */
  const impliedBy = (kinds: Kind[]): Set<Kind> => {
    const s = new Set<Kind>(kinds);
    if (s.has('elements')) s.add('nodes');
    return s;
  };

  /** A spread of rectangles: empty, full, partial, straddling, degenerate. */
  const RECTS: ScreenRect[] = [
    rectOf(-2, -2, 14, 5),        // everything
    rectOf(-1, -1, 5, 1),         // the left bay's feet
    rectOf(5, -0.5, 7, 0.5),      // a sliver across member 2, containing nothing
    rectOf(-1, 2, 13, 4),         // the top chord only
    rectOf(7, -1, 13, 4),         // the right half
    rectOf(20, 20, 30, 30),       // nowhere near the model
    rectOf(3.5, -0.5, 4.5, 0.5),  // tight around node 2
    rectOf(-1, -1, 13, 0.2),      // a thin band along the base
    { x1: 50, y1: 50, x2: 50, y2: 50 },       // degenerate: a point
    { x1: 0, y1: 0, x2: 1000, y2: 1000 },     // far larger than the model
  ];

  /** The same audit, over whichever projection is handed in. */
  const audit = (label: string, m: BoxSelectModel, project: typeof toScreen) => {
    const call = (rect: ScreenRect, isWindow: boolean, kinds: Kind[]) =>
      boxSelect({ rect, isWindow, kinds, model: m, toScreen: project });
    const ids = (s: Set<number>) => [...s].sort((a, b) => a - b);

    it(`${label}: a combination is the union of its parts`, () => {
      for (const rect of RECTS) {
        for (const isWindow of [true, false]) {
          for (const kinds of PERMUTATIONS) {
            const combined = call(rect, isWindow, kinds);
            const union = { nodes: new Set<number>(), elements: new Set<number>(),
              supports: new Set<number>(), loads: new Set<number>() };
            for (const k of kinds) {
              const one = call(rect, isWindow, [k]);
              for (const key of ['nodes', 'elements', 'supports', 'loads'] as const) {
                for (const id of one[key]) union[key].add(id);
              }
            }
            const where = `${kinds.join('+')} ${isWindow ? 'window' : 'crossing'} ${JSON.stringify(rect)}`;
            for (const key of ['nodes', 'elements', 'supports', 'loads'] as const) {
              expect(ids(combined[key]), `${key} — ${where}`).toEqual(ids(union[key]));
            }
          }
        }
      }
    });

    it(`${label}: nothing outside the asked-for kinds comes back`, () => {
      for (const rect of RECTS) {
        for (const isWindow of [true, false]) {
          for (const kinds of PERMUTATIONS) {
            const got = call(rect, isWindow, kinds);
            const allowed = impliedBy(kinds);
            for (const key of KINDS) {
              if (allowed.has(key)) continue;
              const where = `${kinds.join('+')} ${isWindow ? 'window' : 'crossing'}`;
              expect(got[key].size, `${key} leaked into ${where}`).toBe(0);
            }
          }
        }
      }
    });

    it(`${label}: a crossing takes everything its window takes`, () => {
      for (const rect of RECTS) {
        for (const kinds of PERMUTATIONS) {
          const win = call(rect, true, kinds);
          const cross = call(rect, false, kinds);
          for (const key of KINDS) {
            for (const id of win[key]) {
              expect(cross[key].has(id),
                `${key} ${id} taken by the window but not the crossing — ${kinds.join('+')}`).toBe(true);
            }
          }
        }
      }
    });

    it(`${label}: the same drag twice gives the same answer`, () => {
      for (const kinds of PERMUTATIONS) {
        const rect = RECTS[0];
        expect(ids(call(rect, true, kinds).elements)).toEqual(ids(call(rect, true, kinds).elements));
        expect(ids(call(rect, false, kinds).loads)).toEqual(ids(call(rect, false, kinds).loads));
      }
    });

    it(`${label}: order of the kinds does not change the answer`, () => {
      for (const rect of RECTS) {
        for (const kinds of PERMUTATIONS) {
          const a = call(rect, false, kinds);
          const b = call(rect, false, [...kinds].reverse());
          for (const key of KINDS) expect(ids(b[key]), key).toEqual(ids(a[key]));
        }
      }
    });
  };

  audit('2D', model, toScreen);

  /*
   * The same frame stood up into three dimensions and viewed at an angle, so
   * the projection mixes all three coordinates — a camera that ignored one of
   * them would still pass a test built on a plan or an elevation.
   */
  const NODES_ISO = NODES.map((n) => ({ ...n, z: n.id % 2 === 0 ? 2 : 0 }));
  const iso = (p: { x: number; y: number; z?: number }) => ({
    x: (p.x - (p.z ?? 0)) * 8 + 40,
    y: 100 - (p.y * 10 + (p.z ?? 0) * 4),
  });
  const modelIso: BoxSelectModel = {
    nodes: NODES_ISO,
    elements: ELEMENTS,
    supports: SUPPORTS,
    loads: LOADS,
    getNode: (id) => NODES_ISO.find((n) => n.id === id),
    getElement: (id) => ELEMENTS.find((e) => e.id === id),
  };

  audit('3D', modelIso, iso);

  it('covers all fifteen non-empty combinations', () => {
    // Guards the audit itself: a bad mask loop would make everything above
    // pass over a handful of cases and report full coverage.
    expect(PERMUTATIONS.length).toBe(15);
    expect(PERMUTATIONS.filter((p) => p.length === 1)).toHaveLength(4);
    expect(PERMUTATIONS.filter((p) => p.length === 4)).toHaveLength(1);
  });
});
