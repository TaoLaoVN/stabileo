/**
 * The reinforcement, as geometry you can orbit.
 *
 * ── What this module is and is not ─────────────────────────────────
 *
 * It is a renderer. It takes a `SceneModel` — already projected from the document, already
 * sampled, already carrying its marks — and turns it into Three.js objects. It decides
 * colours, tube radii and draw-call batching, and it decides nothing else. No bar position,
 * no clearance, no length. If a number appears on screen it came from the document.
 *
 * That division is why the scene model is a separate, pure module: everything worth testing
 * about WHAT is shown is testable without WebGL, and this file only has to be right about
 * how it looks.
 *
 * ── Why the tubes are built by hand ────────────────────────────────
 *
 * `THREE.TubeGeometry` re-samples its curve at equal arc length. Handed a bar polyline it
 * would place its rings wherever it liked, which on a 135° stirrup hook — five sample points
 * inside 25 mm — means the hook is smoothed away or missed. The bars in this model were
 * sampled by `samplePath` at a chord tolerance chosen so the collision checker measures the
 * real bend; re-sampling them here would throw that away and, worse, would make the picture
 * disagree with the check.
 *
 * So the tube walks the polyline's own vertices, one ring per vertex, with a parallel
 * transport frame. Parallel transport rather than a Frenet frame because a Frenet frame flips
 * its normal through an inflection and spins wildly where curvature vanishes — which is most
 * of a reinforcing bar, since a straight run has no defined normal at all.
 *
 * ── Why the geometry is merged ─────────────────────────────────────
 *
 * A floor is thousands of bars. One mesh per bar is thousands of draw calls and a viewport
 * that stutters before the model is interesting. Bars are merged into one buffer per colour
 * category, and the mapping from a picked triangle back to its bar is kept alongside — so
 * the batching stays invisible to the user, who can still click a stirrup and be told which
 * mark it is.
 */

import * as THREE from 'three';
import type {
  SceneBar, SceneModel, SceneSolid,
} from '../engine/detailing/scene-model';

// ─── Palette ─────────────────────────────────────────────────────

export const REBAR_COLORS = {
  longitudinal: 0x3d7dd8,
  transverse: 0xe8913c,
  /** A bar named by an unresolved conflict. Overrides its role colour. */
  conflicted: 0xe0444a,
  concrete: 0x9aa4b0,
  /**
   * Concrete with no steel in it.
   *
   * A distinct colour rather than a subtler shade of the same grey, because this is not a
   * variation on "concrete" — it is a member the app could not design, and it has to read as
   * a problem from across the room.
   */
  unreinforced: 0xd4762a,
  conflictMarker: 0xff2d55,
  selected: 0xffd400,
} as const;

/** The categories bars are batched into. One merged mesh each. */
export type RebarCategory = 'longitudinal' | 'transverse' | 'conflicted';

function categoryOf(b: SceneBar): RebarCategory {
  return b.conflicted ? 'conflicted' : b.role;
}

// ─── Tube geometry ───────────────────────────────────────────────

/**
 * Ring positions and normals along a polyline, using a parallel transport frame.
 *
 * Exported for testing: the frame is the one thing here that can be subtly wrong in a way no
 * screenshot reveals — a twisting tube still looks like a bar.
 */
export function transportFrames(points: readonly THREE.Vector3[]): {
  tangents: THREE.Vector3[]; normals: THREE.Vector3[]; binormals: THREE.Vector3[];
} {
  const n = points.length;
  const tangents: THREE.Vector3[] = [];
  for (let i = 0; i < n; i++) {
    const a = points[Math.max(0, i - 1)];
    const b = points[Math.min(n - 1, i + 1)];
    const t = new THREE.Vector3().subVectors(b, a);
    // A zero tangent means two coincident samples. Inheriting the previous one keeps the
    // frame continuous rather than producing a NaN ring that renders as a black spike.
    if (t.lengthSq() < 1e-20) t.copy(tangents[i - 1] ?? new THREE.Vector3(1, 0, 0));
    tangents.push(t.normalize());
  }

  // Seed the normal with any axis not parallel to the first tangent.
  const t0 = tangents[0];
  const seed = Math.abs(t0.z) < 0.9
    ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0);
  const normals: THREE.Vector3[] = [
    new THREE.Vector3().crossVectors(t0, seed).normalize(),
  ];
  const binormals: THREE.Vector3[] = [
    new THREE.Vector3().crossVectors(t0, normals[0]).normalize(),
  ];

  for (let i = 1; i < n; i++) {
    // Rotate the previous normal by the same rotation that takes t[i-1] to t[i]. Where the
    // tangent does not turn, the normal does not move — which is the property a Frenet frame
    // lacks and the reason a straight run does not spin.
    const prev = tangents[i - 1];
    const cur = tangents[i];
    const axis = new THREE.Vector3().crossVectors(prev, cur);
    const nrm = normals[i - 1].clone();
    if (axis.lengthSq() > 1e-20) {
      axis.normalize();
      const angle = Math.acos(Math.min(1, Math.max(-1, prev.dot(cur))));
      nrm.applyAxisAngle(axis, angle);
    }
    // Re-orthogonalise against the tangent so drift cannot accumulate over a long bar.
    nrm.addScaledVector(cur, -nrm.dot(cur)).normalize();
    normals.push(nrm);
    binormals.push(new THREE.Vector3().crossVectors(cur, nrm).normalize());
  }

  return { tangents, normals, binormals };
}

/**
 * Append one bar's tube to the buffers being accumulated.
 *
 * Returns the number of triangles written, so the caller can record which range of the
 * merged mesh belongs to which bar.
 */
function appendTube(
  points: readonly THREE.Vector3[], radius: number, radial: number,
  pos: number[], nor: number[], idx: number[],
): number {
  const n = points.length;
  if (n < 2) return 0;
  const { normals, binormals } = transportFrames(points);
  const base = pos.length / 3;

  for (let i = 0; i < n; i++) {
    for (let j = 0; j < radial; j++) {
      const a = (j / radial) * Math.PI * 2;
      const cx = Math.cos(a);
      const sy = Math.sin(a);
      const nx = normals[i].x * cx + binormals[i].x * sy;
      const ny = normals[i].y * cx + binormals[i].y * sy;
      const nz = normals[i].z * cx + binormals[i].z * sy;
      pos.push(points[i].x + nx * radius, points[i].y + ny * radius, points[i].z + nz * radius);
      nor.push(nx, ny, nz);
    }
  }

  let tris = 0;
  for (let i = 0; i < n - 1; i++) {
    for (let j = 0; j < radial; j++) {
      const j1 = (j + 1) % radial;
      const a = base + i * radial + j;
      const b = base + i * radial + j1;
      const c = base + (i + 1) * radial + j1;
      const d = base + (i + 1) * radial + j;
      idx.push(a, b, c, a, c, d);
      tris += 2;
    }
  }
  return tris;
}

// ─── Concrete prisms ─────────────────────────────────────────────

/**
 * A prism from a convex base polygon and a sweep vector.
 *
 * Fan-triangulated, which is correct for the convex bases this model produces — rectangular
 * members, rectangular pads, rectangular panels. A concave base would need a real
 * triangulator, and would be silently wrong here; nothing in the detailing engine produces
 * one, and if something ever does, it needs its own case rather than a fan that folds.
 */
function appendPrism(
  base: readonly THREE.Vector3[], extrude: THREE.Vector3,
  pos: number[], nor: number[], idx: number[],
): void {
  const n = base.length;
  if (n < 3) return;
  const top = base.map((p) => p.clone().add(extrude));

  const pushFace = (pts: THREE.Vector3[]) => {
    const a = new THREE.Vector3().subVectors(pts[1], pts[0]);
    const b = new THREE.Vector3().subVectors(pts[2], pts[0]);
    const nv = new THREE.Vector3().crossVectors(a, b).normalize();
    const first = pos.length / 3;
    for (const p of pts) {
      pos.push(p.x, p.y, p.z);
      nor.push(nv.x, nv.y, nv.z);
    }
    for (let i = 1; i < pts.length - 1; i++) idx.push(first, first + i, first + i + 1);
  };

  pushFace([...base].reverse());
  pushFace(top);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    pushFace([base[i], base[j], top[j], top[i]]);
  }
}

// ─── The group ───────────────────────────────────────────────────

/** Where a picked triangle came from. */
export interface BarRange { barId: string; firstTri: number; triCount: number }

export interface RebarSceneOptions {
  /**
   * Multiplier on the true bar radius.
   *
   * 1 is the truth and is the default. A Ø8 stirrup is 8 mm across in a 6 m beam and reads as
   * a hairline; the option exists so a user can exaggerate to see a cage, and it is an
   * explicit choice rather than a fudge baked into the geometry.
   */
  diameterScale?: number;
  /** Sides per tube. Six reads as round at the scale bars are viewed and costs little. */
  radialSegments?: number;
  /** Draw the concrete. Off gives the bare cage. */
  showConcrete?: boolean;
  /** Draw a marker at each unresolved conflict. */
  showConflicts?: boolean;
}

export interface RebarScene {
  group: THREE.Group;
  /** Merged bar meshes, by category, with the map back to individual bars. */
  bars: Array<{ category: RebarCategory; mesh: THREE.Mesh; ranges: BarRange[] }>;
  /** Which bar a raycast hit, or null when the hit was concrete or a marker. */
  barIdAt(mesh: THREE.Object3D, faceIndex: number | undefined): string | null;
  dispose(): void;
}

const DEFAULTS = { diameterScale: 1, radialSegments: 6 };

export function createRebarScene(
  scene: SceneModel, options: RebarSceneOptions = {},
): RebarScene {
  const radial = Math.max(3, options.radialSegments ?? DEFAULTS.radialSegments);
  const scale = options.diameterScale ?? DEFAULTS.diameterScale;
  const group = new THREE.Group();
  group.name = 'rebar-scene';

  const byCategory = new Map<RebarCategory, SceneBar[]>();
  for (const b of scene.bars) {
    const c = categoryOf(b);
    const list = byCategory.get(c);
    if (list) list.push(b); else byCategory.set(c, [b]);
  }

  const bars: RebarScene['bars'] = [];
  const disposables: Array<{ dispose(): void }> = [];

  for (const [category, list] of byCategory) {
    const pos: number[] = [];
    const nor: number[] = [];
    const idx: number[] = [];
    const ranges: BarRange[] = [];
    let tri = 0;

    for (const b of list) {
      const pts = b.polyline.map((p) => new THREE.Vector3(p.x, p.y, p.z));
      const written = appendTube(pts, (b.diameterMm / 2000) * scale, radial, pos, nor, idx);
      if (written === 0) continue;
      ranges.push({ barId: b.barId, firstTri: tri, triCount: written });
      tri += written;
    }
    if (ranges.length === 0) continue;

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geom.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    geom.setIndex(idx);
    geom.computeBoundingSphere();

    const mat = new THREE.MeshStandardMaterial({
      color: REBAR_COLORS[category], roughness: 0.55, metalness: 0.35,
    });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.name = `rebar-${category}`;
    mesh.userData.rebarCategory = category;
    group.add(mesh);
    disposables.push(geom, mat);
    bars.push({ category, mesh, ranges });
  }

  /**
   * Concrete, in two batches: the reinforced and the not.
   *
   * Two meshes rather than one, so the unreinforced members can carry their own colour and
   * a higher opacity. They are the exception the user needs to see, and a translucent grey
   * indistinguishable from every other member would bury them again.
   */
  if (options.showConcrete !== false && scene.solids.length > 0) {
    for (const reinforced of [true, false]) {
      const subset = (scene.solids as SceneSolid[]).filter((s) => s.reinforced === reinforced);
      if (subset.length === 0) continue;

      const pos: number[] = [];
      const nor: number[] = [];
      const idx: number[] = [];
      for (const s of subset) {
        appendPrism(
          s.base.map((p) => new THREE.Vector3(p.x, p.y, p.z)),
          new THREE.Vector3(s.extrude.x, s.extrude.y, s.extrude.z),
          pos, nor, idx);
      }
      if (pos.length === 0) continue;

      const geom = new THREE.BufferGeometry();
      geom.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geom.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
      geom.setIndex(idx);
      geom.computeBoundingSphere();
      const mat = new THREE.MeshStandardMaterial({
        color: reinforced ? REBAR_COLORS.concrete : REBAR_COLORS.unreinforced,
        // Translucent and not depth-writing, because the entire point of this view is to see
        // the steel THROUGH the concrete. Opaque concrete would hide the feature.
        transparent: true,
        opacity: reinforced ? 0.22 : 0.45,
        depthWrite: false,
        side: THREE.DoubleSide, roughness: 0.95, metalness: 0,
      });
      const mesh = new THREE.Mesh(geom, mat);
      mesh.name = reinforced ? 'rebar-concrete' : 'rebar-concrete-unreinforced';
      mesh.renderOrder = 1;
      group.add(mesh);
      disposables.push(geom, mat);
    }
  }

  // ── Conflict markers ──────────────────────────────────────────
  if (options.showConflicts !== false && scene.conflicts.length > 0) {
    const geom = new THREE.SphereGeometry(1, 10, 8);
    const mat = new THREE.MeshBasicMaterial({
      color: REBAR_COLORS.conflictMarker, transparent: true, opacity: 0.75,
    });
    const marks = new THREE.InstancedMesh(geom, mat, scene.conflicts.length);
    marks.name = 'rebar-conflicts';
    const m = new THREE.Matrix4();
    scene.conflicts.forEach((c, i) => {
      /**
       * Sized by the shortfall, floored so a marker is always visible.
       *
       * A 2 mm interpenetration and a 40 mm one are different problems, and a fixed-size dot
       * says they are the same. The floor exists because a marker scaled to a real 2 mm
       * shortfall is invisible, and an invisible warning is not a warning.
       */
      const shortfall = Math.max(0, c.required - c.clearance);
      const r = Math.max(0.02, Math.min(0.12, shortfall * 1.5));
      m.makeScale(r, r, r).setPosition(c.at.x, c.at.y, c.at.z);
      marks.setMatrixAt(i, m);
    });
    marks.instanceMatrix.needsUpdate = true;
    group.add(marks);
    disposables.push(geom, mat);
  }

  return {
    group,
    bars,
    barIdAt(mesh, faceIndex) {
      if (faceIndex === undefined) return null;
      const entry = bars.find((b) => b.mesh === mesh);
      if (!entry) return null;
      // Ranges are in ascending, contiguous triangle order, so a binary search is exact.
      let lo = 0;
      let hi = entry.ranges.length - 1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const r = entry.ranges[mid];
        if (faceIndex < r.firstTri) hi = mid - 1;
        else if (faceIndex >= r.firstTri + r.triCount) lo = mid + 1;
        else return r.barId;
      }
      return null;
    },
    dispose() {
      for (const d of disposables) d.dispose();
      group.clear();
    },
  };
}

/**
 * A camera framing for the scene's bounds.
 *
 * Returned as data rather than applied, so the caller owns its own camera and this module
 * stays free of one.
 *
 * ── Why the aspect ratio is an argument ────────────────────────────
 *
 * `fov` is the VERTICAL field of view. A framing computed from it alone fits the scene's
 * height and says nothing about its width, which is fine on a square canvas and wrong on
 * every other one — and this panel lives in a column far wider than it is tall, where a beam
 * line runs off both sides while the picture looks correctly framed vertically.
 *
 * So the horizontal half-angle is derived from the vertical one and the aspect, and the
 * distance is whichever of the two demands more. A caller that does not know its aspect yet
 * gets the square answer, which is the conservative one.
 */
export function frameBounds(
  scene: SceneModel, fovDeg = 50, aspect = 1,
): { centre: THREE.Vector3; distance: number } | null {
  if (!scene.bounds) return null;
  const { min, max } = scene.bounds;
  const centre = new THREE.Vector3(
    (min.x + max.x) / 2, (min.y + max.y) / 2, (min.z + max.z) / 2);
  const span = Math.max(max.x - min.x, max.y - min.y, max.z - min.z, 0.5);

  const halfV = (fovDeg * Math.PI) / 360;
  const halfH = Math.atan(Math.tan(halfV) * Math.max(aspect, 1e-6));
  const distance = (span / 2) / Math.tan(Math.min(halfV, halfH)) * 1.35;
  return { centre, distance };
}
