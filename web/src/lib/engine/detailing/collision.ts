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
  // 10 mm is the usual placement tolerance for cages assembled off-site and lowered in.
  placement: 0.010,
  requiredClear: 0.025,
  marginalBand: 0.005,
};

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
): CollisionResult {
  const raw = bars.map((path) => samplePath(path));
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
      const required = requiredClearFor
        ? requiredClearFor(a.path, b.path)
        : tolerances.requiredClear;

      let worst: { clearance: number; at: Point3 } | null = null;

      for (let m = 0; m + 1 < a.points.length; m++) {
        for (let n = 0; n + 1 < b.points.length; n++) {
          narrowPhaseTests++;
          const { distance, at } = segmentDistance(
            a.points[m], a.points[m + 1], b.points[n], b.points[n + 1]);
          // Surface to surface, less the placement tolerance.
          const clearance = distance - a.radius - b.radius - tolerances.placement;
          if (worst === null || clearance < worst.clearance) worst = { clearance, at };
        }
      }
      if (worst === null) continue;

      const shortfall = required - worst.clearance;
      if (shortfall <= 0) continue;

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
