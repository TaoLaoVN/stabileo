/**
 * Bar-to-bar collision detection with a broad-phase spatial index.
 *
 * The question this answers is the one a section check cannot: "will this cage actually
 * assemble on site?" Two Ø25 bars whose centrelines pass 20 mm apart both satisfy every
 * strength check and physically cannot both exist.
 *
 * Design decisions worth stating:
 *
 *   * A bar is treated as a swept capsule around its sampled centreline, not as a line.
 *     Clearance is measured surface to surface, which is what the code's clear-spacing
 *     rules and a steel fixer both mean.
 *
 *   * Bars that share an owner element and the same role and layer are NOT exempt from
 *     checking. The layout code is exactly what this is meant to catch.
 *
 *   * A collision is reported with the pair, the location and the shortfall, never as a
 *     bare boolean. "There is a clash" is not actionable; "these two bars are 12 mm
 *     apart at x = 2.35 m and need 25 mm" is.
 *
 *   * When the engine cannot resolve a clash it emits an explicit unresolved conflict.
 *     Silently dropping a bar to make the cage fit would be inventing a design.
 *
 * Complexity: the broad phase is a uniform spatial hash, so the pair test is
 * O(n · k) with k the local density rather than O(n²). On a joint with 40 incident bars
 * that is the difference between 1600 and roughly 200 narrow-phase tests.
 *
 * Pure: no store, no runes.
 */

import type { BarPath, Point3 } from '../../codes/cirsoc201/bar-geometry';
import { samplePath } from '../../codes/cirsoc201/bar-geometry';
import type { PairClass, PairClassification } from './classify';

export interface CollisionTolerances {
  /**
   * Fabrication and placement tolerance, m. Bars are never where the drawing says, so
   * a clearance check that assumes they are will pass cages that do not assemble.
   * Subtracted from the available clearance.
   */
  placement: number;
  /** Required clear distance between bar surfaces, m. Comes from the code spacing rule. */
  requiredClear: number;
  /** Clearances closer than this to the requirement are reported as marginal, not failed. */
  marginalBand: number;
}

export const DEFAULT_TOLERANCES: CollisionTolerances = {
  // ZERO by default. CIRSOC's minimum clear spacing IS the construction requirement, and
  // the regulation prescribes no further margin between parallel bars. A hardcoded 10 mm
  // here was silently deducted from every measured clearance, so a cage drawn exactly at
  // the code minimum failed its own check by that amount — every pair, every model.
  // A project that wants a more conservative cage raises `placement`; nothing has to argue
  // the default back down to what the code says.
  placement: 0,
  requiredClear: 0.025,
  marginalBand: 0.005,
};

/**
 * Chord tolerance for the collision sampler, m.
 *
 * ── Why it is not `samplePath`'s 5 mm default ──────────────────────
 *
 * The narrow phase tests straight segments between consecutive samples, so an arc is only
 * ever as accurate as the polyline standing in for it, and every chord cuts INSIDE the true
 * curve. At the 5 mm default a 135° stirrup hook on a Ø8 bar (r = 20 mm) is sampled as TWO
 * chords of 67,5°, each dipping `r(1 − cos 33,75°) = 3,37 mm` inside the bend.
 *
 * That error lands directly in the clearance. Measured on `rc-design-qa-8`: a column corner
 * bar seated in a joint tie's bend — designed contact, true clearance +0,08 mm under dense
 * resampling — was reported as interpenetrating by 3,17 mm, eight times over. The steel was
 * right and the ruler was wrong.
 *
 * The default was harmless while `samplePath` interpolated arcs linearly, because the whole
 * arc was already replaced by its chord and no tolerance could have helped. Once arcs became
 * real geometry the sampling tolerance became a real measurement error, so it is set here to
 * half a millimetre: below any fabrication tolerance, and a quarter of `CONTACT_ALLOWANCE`,
 * so it can never manufacture a contact or a clash on its own.
 */
export const COLLISION_CHORD_TOLERANCE = 0.0005;

export type ConflictSeverity = 'overlap' | 'clearance' | 'marginal';

export interface BarConflict {
  severity: ConflictSeverity;
  barA: string;
  barB: string;
  /** Midpoint between the two closest surface points, in model coordinates. */
  at: Point3;
  /** Surface-to-surface distance, m. Negative means the bars physically overlap. */
  clearance: number;
  /** Clearance the rule demanded at this point, m. */
  required: number;
  /** How far short, m. Always positive for a reported conflict. */
  shortfall: number;
  /** Element ids involved, for routing the conflict to a member in the UI. */
  elementIds: number[];
  /**
   * What the pair IS. Set when a classifier was supplied; without one every pair is
   * measured against a single rule, which is how ~11,000 "conflicts" on the flagship
   * turned out to include beam bars held to the column rule and crossing bars held to a
   * spacing rule that governs bars running alongside each other.
   */
  pairClass?: PairClass;
  /** i18n key naming the class, for the conflict list. */
  classLabelKey?: string;
}

interface SampledBar {
  path: BarPath;
  /** Chord-accurate samples. The narrow phase is exact on these segments. */
  points: Point3[];
  /**
   * The same polyline densified to one cell. Used ONLY to populate the spatial hash, so
   * a long segment occupies every cell it passes through. Feeding these to the narrow
   * phase instead would multiply the exact segment tests by ~50x for no added accuracy.
   */
  hashPoints: Point3[];
  radius: number;
}

// ─── Broad phase ─────────────────────────────────────────────────

class SpatialHash {
  private readonly cells = new Map<string, number[]>();

  constructor(private readonly cell: number) {}

  private key(x: number, y: number, z: number): string {
    return `${Math.floor(x / this.cell)},${Math.floor(y / this.cell)},${Math.floor(z / this.cell)}`;
  }

  insert(index: number, p: Point3): void {
    const k = this.key(p.x, p.y, p.z);
    const bucket = this.cells.get(k);
    if (bucket) {
      if (bucket[bucket.length - 1] !== index) bucket.push(index);
    } else {
      this.cells.set(k, [index]);
    }
  }

  /** Candidate indices in the 27 cells around a point. */
  near(p: Point3): Set<number> {
    const out = new Set<number>();
    const cx = Math.floor(p.x / this.cell);
    const cy = Math.floor(p.y / this.cell);
    const cz = Math.floor(p.z / this.cell);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          const bucket = this.cells.get(`${cx + dx},${cy + dy},${cz + dz}`);
          if (bucket) for (const i of bucket) out.add(i);
        }
      }
    }
    return out;
  }
}

/**
 * Insert intermediate points so no gap exceeds `maxGap`.
 *
 * The narrow phase tests segments and is exact regardless; this exists purely so the
 * broad phase cannot miss a candidate pair. Points are added on the straight chord
 * between existing samples, which is where the bar already is for straight segments and
 * within the sampling chord error for arcs.
 */
function densify(points: readonly Point3[], maxGap: number): Point3[] {
  if (points.length === 0) return [];
  const out: Point3[] = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const d = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
    const n = Math.max(1, Math.ceil(d / maxGap));
    for (let k = 1; k <= n; k++) {
      const t = k / n;
      out.push({
        x: a.x + (b.x - a.x) * t,
        y: a.y + (b.y - a.y) * t,
        z: a.z + (b.z - a.z) * t,
      });
    }
  }
  return out;
}

// ─── Narrow phase ────────────────────────────────────────────────

/** Unit direction of the sampled segment starting at `i`, or undefined if degenerate. */
function tangent(points: readonly Point3[], i: number): Point3 | undefined {
  const p = points[i];
  const q = points[i + 1];
  if (!p || !q) return undefined;
  const d = { x: q.x - p.x, y: q.y - p.y, z: q.z - p.z };
  const L = Math.hypot(d.x, d.y, d.z);
  return L < 1e-12 ? undefined : { x: d.x / L, y: d.y / L, z: d.z / L };
}

/** Squared distance between two segments, plus the midpoint of the closest approach. */
function segmentDistance(
  p1: Point3, q1: Point3, p2: Point3, q2: Point3,
): { distance: number; at: Point3 } {
  const d1 = { x: q1.x - p1.x, y: q1.y - p1.y, z: q1.z - p1.z };
  const d2 = { x: q2.x - p2.x, y: q2.y - p2.y, z: q2.z - p2.z };
  const r = { x: p1.x - p2.x, y: p1.y - p2.y, z: p1.z - p2.z };
  const a = d1.x * d1.x + d1.y * d1.y + d1.z * d1.z;
  const e = d2.x * d2.x + d2.y * d2.y + d2.z * d2.z;
  const f = d2.x * r.x + d2.y * r.y + d2.z * r.z;

  const EPS = 1e-12;
  let s = 0;
  let t = 0;

  if (a <= EPS && e <= EPS) {
    // Both degenerate to points.
    s = 0; t = 0;
  } else if (a <= EPS) {
    s = 0;
    t = Math.max(0, Math.min(1, f / e));
  } else {
    const c = d1.x * r.x + d1.y * r.y + d1.z * r.z;
    if (e <= EPS) {
      t = 0;
      s = Math.max(0, Math.min(1, -c / a));
    } else {
      const b = d1.x * d2.x + d1.y * d2.y + d1.z * d2.z;
      const denom = a * e - b * b;
      s = denom > EPS ? Math.max(0, Math.min(1, (b * f - c * e) / denom)) : 0;
      t = (b * s + f) / e;
      if (t < 0) { t = 0; s = Math.max(0, Math.min(1, -c / a)); }
      else if (t > 1) { t = 1; s = Math.max(0, Math.min(1, (b - c) / a)); }
    }
  }

  const c1 = { x: p1.x + d1.x * s, y: p1.y + d1.y * s, z: p1.z + d1.z * s };
  const c2 = { x: p2.x + d2.x * t, y: p2.y + d2.y * t, z: p2.z + d2.z * t };
  return {
    distance: Math.hypot(c1.x - c2.x, c1.y - c2.y, c1.z - c2.z),
    at: { x: (c1.x + c2.x) / 2, y: (c1.y + c2.y) / 2, z: (c1.z + c2.z) / 2 },
  };
}

export interface CollisionResult {
  conflicts: BarConflict[];
  /** Bars checked. */
  barCount: number;
  /** Segment-pair tests actually performed. */
  narrowPhaseTests: number;
  /**
   * Bar pairs that reached the narrow phase. This is the number that measures the broad
   * phase: against n bars the naive count is n(n-1)/2.
   */
  barPairsTested: number;
  /** True when nothing worse than `marginal` was found. */
  constructible: boolean;
}

/**
 * Detect collisions in an assembly of bars.
 *
 * `requiredClearFor` lets the caller supply the code rule per pair, because the
 * requirement is not constant: two column longitudinal bars need
 * `max(40 mm, 1.5 d_b, 4/3 d_agg)` while a stirrup passing a main bar needs only
 * physical clearance. Defaults to the flat `tolerances.requiredClear`.
 */
export function detectCollisions(
  bars: readonly BarPath[],
  tolerances: CollisionTolerances = DEFAULT_TOLERANCES,
  requiredClearFor?: (a: BarPath, b: BarPath) => number,
  /**
   * Classifies a pair given whether their surfaces interpenetrate. When supplied it
   * REPLACES `requiredClearFor` and can also declare a pair not reportable at all —
   * required containment and orthogonal crossings are relationships, not defects.
   */
  classifyFor?: (
    a: BarPath, b: BarPath, surfaceClearance: number,
    /**
     * Unit tangents of the two bars AT the closest approach.
     *
     * Whether two bars "run alongside each other" is a local question, and for anything but a
     * straight bar the whole-path chord does not answer it. A closed stirrup's first and last
     * points are its two hook tips, a few centimetres apart at one corner, so its end-to-end
     * direction is a 45° diagonal that describes no part of the bar. Measured: that made every
     * stirrup read as parallel to the column bars it crosses at a joint, and eight crossings
     * were held to §25.2.3's 40 mm column spacing instead of being recognised as crossings.
     */
    tangentA?: Point3, tangentB?: Point3,
  ) => PairClassification,
): CollisionResult {
  const raw = bars.map((path) => samplePath(path, COLLISION_CHORD_TOLERANCE));
  const maxRadius = bars.reduce((m, b) => Math.max(m, b.diameterMm / 2000), 0);

  // Cell size: comfortably larger than the biggest interaction distance, so the 27-cell
  // neighbourhood is guaranteed to contain every candidate.
  const cell = Math.max(0.05, 2 * maxRadius + tolerances.requiredClear + tolerances.placement + 0.02);

  const sampled: SampledBar[] = bars.map((path, i) => ({
    path,
    points: raw[i],
    // Densified so no two consecutive points are further apart than one cell. Without
    // this the hash indexes only the endpoints of a segment, and a 2 m straight bar is
    // invisible to the broad phase everywhere between them — another bar could pass
    // clean through its middle and never be tested.
    hashPoints: densify(raw[i], cell),
    radius: path.diameterMm / 2000,
  }));

  const hash = new SpatialHash(cell);
  for (let i = 0; i < sampled.length; i++) {
    for (const p of sampled[i].hashPoints) hash.insert(i, p);
  }

  const conflicts = new Map<string, BarConflict>();
  let narrowPhaseTests = 0;
  let barPairsTested = 0;

  for (let i = 0; i < sampled.length; i++) {
    const a = sampled[i];
    const candidates = new Set<number>();
    for (const p of a.hashPoints) {
      for (const j of hash.near(p)) if (j > i) candidates.add(j);
    }
    barPairsTested += candidates.size;

    for (const j of candidates) {
      const b = sampled[j];
      let worst: {
        clearance: number; at: Point3; surface: number; m: number; n: number;
      } | null = null;

      for (let m = 0; m + 1 < a.points.length; m++) {
        for (let n = 0; n + 1 < b.points.length; n++) {
          narrowPhaseTests++;
          const { distance, at } = segmentDistance(
            a.points[m], a.points[m + 1], b.points[n], b.points[n + 1]);
          // `surface` is the true geometry; `clearance` also carries the placement
          // tolerance. The classifier must see only the former — a tolerance allowance is
          // not interpenetration, and treating it as one turns every tie point into a clash.
          const surface = distance - a.radius - b.radius;
          const clearance = surface - tolerances.placement;
          if (worst === null || clearance < worst.clearance) {
            worst = { clearance, at, surface, m, n };
          }
        }
      }
      if (worst === null) continue;

      // Classify BEFORE judging. The class decides the rule and whether a shortfall is a
      // defect at all; a tie around its own longitudinals is not a clash.
      const cls = classifyFor?.(a.path, b.path, worst.surface,
        tangent(a.points, worst.m), tangent(b.points, worst.n));
      if (cls && !cls.reportable) continue;
      const required = cls
        ? cls.requiredClear
        : requiredClearFor
          ? requiredClearFor(a.path, b.path)
          : tolerances.requiredClear;

      const shortfall = required - worst.clearance;
      // A micron of floating-point dust is not a clearance violation. A pair drawn to
      // exactly the code minimum computes to 0.024999999999999998 against 0.025 and would
      // otherwise be reported against the very requirement it satisfies — which, now that
      // the default additional margin is zero, is the commonest case in the model rather
      // than an edge case.
      if (shortfall <= 1e-9) continue;

      const severity: ConflictSeverity =
        worst.clearance < 0 ? 'overlap'
          : shortfall <= tolerances.marginalBand ? 'marginal'
            : 'clearance';

      // Canonicalise the pair by id, not by iteration index: keying on (i, j) made the
      // reported barA/barB depend on the order the caller happened to supply the bars,
      // which would make every golden drawing and schedule input-order sensitive.
      const [idA, idB] = [a.path.id, b.path.id].sort();
      const key = `${idA}|${idB}`;
      conflicts.set(key, {
        severity,
        barA: idA,
        barB: idB,
        at: worst.at,
        clearance: +worst.clearance.toFixed(5),
        required: +required.toFixed(5),
        pairClass: cls?.pairClass,
        classLabelKey: cls?.labelKey,
        shortfall: +shortfall.toFixed(5),
        elementIds: [...new Set([...a.path.ownerElementIds, ...b.path.ownerElementIds])].sort((x, y) => x - y),
      });
    }
  }

  const list = [...conflicts.values()].sort((x, y) =>
    // Deterministic: worst first, then by bar id, so golden outputs are stable.
    y.shortfall - x.shortfall || x.barA.localeCompare(y.barA) || x.barB.localeCompare(y.barB));

  return {
    conflicts: list,
    barCount: bars.length,
    narrowPhaseTests,
    barPairsTested,
    constructible: list.every((c) => c.severity === 'marginal'),
  };
}

/**
 * Check that every bar sits inside the concrete, respecting cover.
 *
 * A bar that clears every other bar and pokes out of the section is still not buildable,
 * and this is the check that catches a hook turned the wrong way.
 */
export interface CoverBreach {
  barId: string;
  at: Point3;
  /** Distance from the bar surface to the nearest section face, m. Negative = outside. */
  actualCover: number;
  requiredCover: number;
  elementIds: number[];
}

export interface SectionPrism {
  elementId: number;
  /** Section corners in the plane normal to the member axis, as (u, v) half-extents. */
  halfWidth: number;
  halfHeight: number;
  /** Member axis origin and unit direction. */
  origin: Point3;
  axis: Point3;
  /** Unit vectors spanning the section plane. */
  uAxis: Point3;
  vAxis: Point3;
  requiredCover: number;
}

function dot(a: Point3, b: Point3): number { return a.x * b.x + a.y * b.y + a.z * b.z; }
function sub(a: Point3, b: Point3): Point3 { return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }; }

/** Cover breaches for bars against the prism of the member they belong to. */
export function checkCover(
  bars: readonly BarPath[], prisms: readonly SectionPrism[],
): CoverBreach[] {
  const byElement = new Map<number, SectionPrism>();
  for (const p of prisms) byElement.set(p.elementId, p);
  const out: CoverBreach[] = [];

  for (const bar of bars) {
    for (const elementId of bar.ownerElementIds) {
      const prism = byElement.get(elementId);
      if (!prism) continue;
      const r = bar.diameterMm / 2000;
      let worst: { cover: number; at: Point3 } | null = null;

      for (const p of samplePath(bar)) {
        const rel = sub(p, prism.origin);
        const u = dot(rel, prism.uAxis);
        const v = dot(rel, prism.vAxis);
        const t = dot(rel, prism.axis);
        // Only judge points that lie within the member's own length. A continuous bar
        // legitimately leaves the prism at a support, and flagging that would report a
        // breach on every coordinated bar.
        if (t < -1e-9) continue;
        const coverU = prism.halfWidth - Math.abs(u) - r;
        const coverV = prism.halfHeight - Math.abs(v) - r;
        const cover = Math.min(coverU, coverV);
        if (worst === null || cover < worst.cover) worst = { cover, at: p };
      }

      if (worst && worst.cover < prism.requiredCover - 1e-6) {
        out.push({
          barId: bar.id,
          at: worst.at,
          actualCover: +worst.cover.toFixed(5),
          requiredCover: prism.requiredCover,
          elementIds: [elementId],
        });
      }
    }
  }
  return out.sort((a, b) => a.actualCover - b.actualCover || a.barId.localeCompare(b.barId));
}
