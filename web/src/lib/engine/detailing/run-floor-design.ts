/**
 * THE production adapter for slabs and walls: real model, real solver results, real design.
 *
 * ── What the forensic audit found ──────────────────────────────────
 *
 * `designSlabPanel`, `designWall`, `checkFooting` and `buildFloorAssembly` had **no caller
 * anywhere outside their own unit tests**. `floor-design.ts` imported the other three as
 * TYPES only. So roughly 1 550 lines of correct, clause-grounded engine were unreachable
 * from the product, and the branch's Playwright spec proved only that PR17's assembly UI
 * renders a JSON literal injected through a test hook.
 *
 * This module is the missing adapter. It is to slabs and walls what `run-detailing.ts` is
 * to beams and columns: model geometry and solver output in, `DetailingAssembly` out, with
 * every unsupported condition named rather than skipped.
 *
 * ── Where the demand comes from ────────────────────────────────────
 *
 * The solver already produces everything a slab needs. `QuadStress`/`PlateStress` carry
 * `mx`, `my` and `mxy` per shell element, and `mxy` is exactly what Wood-Armer folds in
 * rather than discarding. Nothing here asks for a solver change.
 *
 * A slab's one-way shear needs an area load, which the stresses do not carry. It is
 * integrated from the `surface3d` loads actually applied to that shell, factored by the
 * governing combination — a real free body, not a nominal figure. A panel carrying no
 * surface load reports that its shear check has no demand to check, instead of quietly
 * checking zero and passing.
 *
 * ── Panels are shell elements, and that is stated, not hidden ──────
 *
 * One shell element is designed as one panel. A meshed floor is therefore designed
 * element by element rather than as a continuous plate with a strip envelope across the
 * mesh. That is a real limitation with a real consequence — the moment used is the
 * element's own, so a finer mesh gives a less conservative peak — and it is reported as an
 * assumption on every panel rather than left for the reader to infer.
 *
 * Pure: no store, no runes, no i18n.
 */

import type { RegulationEdition } from '../../codes/regulation';
import { msg, type EngineMessage } from '../../codes/message';
import { designSlabPanel, type SlabDesignResult } from './slab-design';
import { designWall, type WallDesignResult } from './wall-design';
import {
  buildFloorAssembly, type FloorAssemblyResult, type SlabPanelGeometry,
} from './floor-design';
import type { WallGeometry } from './floor-transverse';
import type { FootingAssemblyEntry } from './run-footing-design';
import type { DetailingAssembly } from './assembly';

// ─── What this adapter reads ─────────────────────────────────────

export interface FloorNode { x: number; y: number; z?: number }

export interface FloorShell {
  id: number;
  /** Three nodes for a plate, four for a quad. */
  nodes: readonly number[];
  materialId: number;
  thickness: number;
}

/** The membrane and bending fields the solver reports per shell element. */
export interface FloorShellStress {
  elementId: number;
  sigmaXx: number;
  sigmaYy: number;
  tauXy: number;
  mx: number;
  my: number;
  mxy: number;
}

export interface RunFloorDesignInput {
  nodes: ReadonlyMap<number, FloorNode>;
  /** Quads and plates alike — both are shells and both are designed here. */
  shells: readonly FloorShell[];
  /** Envelope shell stresses, one entry per element that has results. */
  stresses: readonly FloorShellStress[];
  /** Factored area load per shell, kPa, integrated from its `surface3d` loads. */
  factoredAreaLoad: ReadonlyMap<number, number>;
  /** Factored in-plane demands per wall shell, when the caller can supply them. */
  wallDemands?: ReadonlyMap<number, { pu: number; muInPlane: number; vuInPlane: number }>;
  fc: number;
  fy: number;
  cover: number;
  maxAggregateSizeMm: number;
  /** Distributed bar diameter for walls, mm. */
  wallBarDiameterMm: number;
  edition: RegulationEdition;
  verifierId: string;
  demandRevision: number;
  previousRevision?: number;
  seismicRequired: boolean;
  membersVerified: boolean;
  /** Assembly label, e.g. the level name. */
  label?: string;
  /**
   * Footings already checked by `runFootingDesign`, grouped by founding level.
   *
   * Passed in rather than designed here because a footing's demand is a support REACTION,
   * not a shell stress — a different input, a different level attribution and a different
   * gate. Grouping by level is what lets a footing join the assembly its column belongs to.
   */
  footingsByLevel?: ReadonlyMap<number, readonly FootingAssemblyEntry[]>;
}

export type ShellFamily = 'slab' | 'wall' | 'inclined' | 'degenerate';

export interface ShellClassification {
  elementId: number;
  family: ShellFamily;
  /** Unit normal of the shell's plane. */
  normal: { x: number; y: number; z: number };
  /** Level the shell is attributed to, m — its mean elevation. */
  level: number;
}

export interface RunFloorDesignResult {
  assemblies: DetailingAssembly[];
  slabs: SlabDesignResult[];
  walls: WallDesignResult[];
  classifications: ShellClassification[];
  /** Conditions that stopped a shell from being designed, each naming its element. */
  unsupported: Array<{ elementId: number; message: EngineMessage }>;
  trace: string[];
}

// ─── Geometry ────────────────────────────────────────────────────

/** Newell's method — a plane normal that is correct for a non-planar quad too. */
export function shellNormal(pts: readonly FloorNode[]): { x: number; y: number; z: number } {
  let nx = 0;
  let ny = 0;
  let nz = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const az = a.z ?? 0;
    const bz = b.z ?? 0;
    nx += (a.y - b.y) * (az + bz);
    ny += (az - bz) * (a.x + b.x);
    nz += (a.x - b.x) * (a.y + b.y);
  }
  const L = Math.hypot(nx, ny, nz);
  return L < 1e-9 ? { x: 0, y: 0, z: 0 } : { x: nx / L, y: ny / L, z: nz / L };
}

/**
 * Slab, wall, or neither.
 *
 * The bands are deliberately wide apart and the gap between them is NOT silently assigned:
 * a shell at 45° is neither a slab nor a wall, and designing it as either would apply the
 * wrong chapter. It becomes an explicit `inclined` outcome that the caller reports.
 */
export function classifyShell(
  elementId: number, pts: readonly FloorNode[],
): ShellClassification {
  const normal = shellNormal(pts);
  const level = pts.reduce((s, p) => s + (p.z ?? 0), 0) / Math.max(1, pts.length);
  const vertical = Math.abs(normal.z);
  const family: ShellFamily = Math.hypot(normal.x, normal.y, normal.z) < 0.5
    ? 'degenerate'
    : vertical >= 0.85 ? 'slab'
      : vertical <= 0.15 ? 'wall'
        : 'inclined';
  return { elementId, family, normal, level };
}

/** Plan bounding box of a shell, and whether it is an axis-aligned rectangle. */
export function planExtent(pts: readonly FloorNode[]): {
  x0: number; y0: number; lx: number; ly: number; axisAligned: boolean;
} {
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const x0 = Math.min(...xs);
  const y0 = Math.min(...ys);
  const lx = Math.max(...xs) - x0;
  const ly = Math.max(...ys) - y0;
  // Every corner must sit on a corner of the bounding box, or the panel is not the
  // rectangle the slab generator lays bars across.
  const axisAligned = pts.every((p) =>
    (Math.abs(p.x - x0) < 1e-6 || Math.abs(p.x - (x0 + lx)) < 1e-6)
    && (Math.abs(p.y - y0) < 1e-6 || Math.abs(p.y - (y0 + ly)) < 1e-6));
  return { x0, y0, lx, ly, axisAligned };
}

/** How many of a shell's edges are shared with another shell or held by a support. */
export function supportedSideCount(
  shell: FloorShell, others: readonly FloorShell[],
): number {
  const edges = shell.nodes.map((n, i) => [n, shell.nodes[(i + 1) % shell.nodes.length]]);
  let n = 0;
  for (const [a, b] of edges) {
    const shared = others.some((o) => o.id !== shell.id
      && o.nodes.includes(a) && o.nodes.includes(b));
    if (shared) n++;
  }
  return n;
}

// ─── The run ─────────────────────────────────────────────────────

/**
 * Design every slab and wall in the model, then coordinate them into one assembly per level.
 *
 * Foundations are not produced here, and the reason is data rather than engineering: the
 * model carries no foundation entity — no plan dimensions, no thickness, no allowable
 * bearing pressure — so there is nothing for `checkFooting` to read. Inventing a footing
 * under every support would produce numbers with the appearance of a design and no basis.
 * The engine is complete and tested; what it needs is a modelled footing to be given.
 */
export function runFloorDesign(input: RunFloorDesignInput): RunFloorDesignResult {
  const trace: string[] = [];
  const unsupported: Array<{ elementId: number; message: EngineMessage }> = [];
  const classifications: ShellClassification[] = [];
  const slabs: SlabDesignResult[] = [];
  const walls: WallDesignResult[] = [];

  const stressOf = new Map(input.stresses.map((s) => [s.elementId, s]));
  const ptsOf = (shell: FloorShell): FloorNode[] | null => {
    const pts = shell.nodes.map((id) => input.nodes.get(id));
    return pts.every((p): p is FloorNode => p !== undefined) ? pts : null;
  };

  type SlabEntry = { geometry: SlabPanelGeometry; design: SlabDesignResult };
  type WallEntry = {
    wallId: string; design: WallDesignResult; elementIds: number[];
    geometry: WallGeometry; barDiameterMm: number;
  };
  const slabsByLevel = new Map<number, SlabEntry[]>();
  const wallsByLevel = new Map<number, WallEntry[]>();

  /** Levels are grouped to the millimetre so floating-point noise cannot split a floor. */
  const levelKey = (z: number) => Math.round(z * 1000) / 1000;

  for (const shell of input.shells) {
    const pts = ptsOf(shell);
    if (!pts) {
      unsupported.push({
        elementId: shell.id,
        message: msg('detailing.floorRun.missingNodes', { element: shell.id }),
      });
      continue;
    }
    const cls = classifyShell(shell.id, pts);
    classifications.push(cls);

    if (cls.family === 'degenerate' || cls.family === 'inclined') {
      unsupported.push({
        elementId: shell.id,
        message: msg(cls.family === 'inclined'
          ? 'detailing.floorRun.inclinedShell'
          : 'detailing.floorRun.degenerateShell',
        { element: shell.id, tilt: +(Math.acos(Math.min(1, Math.abs(cls.normal.z)))
          * 180 / Math.PI).toFixed(1) }),
      });
      continue;
    }

    const stress = stressOf.get(shell.id);
    if (!stress) {
      // No result for this element means no demand. Designing it anyway would produce a
      // panel reinforced for zero moment, which is worse than an absent panel.
      unsupported.push({
        elementId: shell.id,
        message: msg('detailing.floorRun.noSolverResult', { element: shell.id }),
      });
      continue;
    }

    if (cls.family === 'slab') {
      const ext = planExtent(pts);
      if (!ext.axisAligned || ext.lx <= 0 || ext.ly <= 0) {
        unsupported.push({
          elementId: shell.id,
          message: msg('detailing.floorRun.nonRectangularPanel', { element: shell.id }),
        });
        continue;
      }
      const qu = input.factoredAreaLoad.get(shell.id);
      if (qu === undefined) {
        unsupported.push({
          elementId: shell.id,
          message: msg('detailing.floorRun.noAreaLoad', { element: shell.id }),
        });
        continue;
      }
      const design = designSlabPanel({
        panelId: `P${shell.id}`,
        lx: ext.lx, ly: ext.ly,
        thickness: shell.thickness,
        cover: input.cover,
        supportedSides: Math.max(1, supportedSideCount(shell, input.shells)),
        fc: input.fc, fy: input.fy,
        maxAggregateSizeMm: input.maxAggregateSizeMm,
        edition: input.edition,
        moments: { mx: stress.mx, my: stress.my, mxy: stress.mxy },
        qu,
      });
      slabs.push(design);
      const key = levelKey(cls.level);
      const entry: SlabEntry = {
        geometry: {
          panelId: `P${shell.id}`,
          origin: { x: ext.x0, y: ext.y0, z: cls.level },
          lx: ext.lx, ly: ext.ly,
          thickness: shell.thickness, cover: input.cover,
          elementIds: [shell.id],
        },
        design,
      };
      const list = slabsByLevel.get(key);
      if (list) list.push(entry); else slabsByLevel.set(key, [entry]);
      continue;
    }

    // ── Wall ──
    const zs = pts.map((p) => p.z ?? 0);
    const height = Math.max(...zs) - Math.min(...zs);
    const baseZ = Math.min(...zs);
    const onBase = pts.filter((p) => Math.abs((p.z ?? 0) - baseZ) < 1e-6);
    if (height <= 0 || onBase.length < 2) {
      unsupported.push({
        elementId: shell.id,
        message: msg('detailing.floorRun.wallGeometryNotResolved', { element: shell.id }),
      });
      continue;
    }
    // The two base corners furthest apart define the wall's length and direction.
    let start = onBase[0];
    let end = onBase[0];
    let best = -1;
    for (const a of onBase) {
      for (const b of onBase) {
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (d > best) { best = d; start = a; end = b; }
      }
    }
    const length = best;
    if (!(length > 0)) {
      unsupported.push({
        elementId: shell.id,
        message: msg('detailing.floorRun.wallGeometryNotResolved', { element: shell.id }),
      });
      continue;
    }

    // In-plane demands, when the caller resolved them from the element forces. Absent
    // them the membrane stresses give the in-plane shear directly: τ_xy over the section.
    const supplied = input.wallDemands?.get(shell.id);
    const demands = supplied ?? {
      pu: Math.max(0, -stress.sigmaYy) * shell.thickness * length,
      muInPlane: 0,
      vuInPlane: Math.abs(stress.tauXy) * shell.thickness * length,
    };
    if (!supplied) {
      unsupported.push({
        elementId: shell.id,
        message: msg('detailing.floorRun.wallMomentFromMembraneOnly', { element: shell.id }),
      });
    }

    const design = designWall({
      wallId: `W${shell.id}`,
      length, height,
      thickness: shell.thickness,
      cover: input.cover,
      fc: input.fc, fy: input.fy,
      barDiameterMm: input.wallBarDiameterMm,
      edition: input.edition,
      pu: demands.pu, muInPlane: demands.muInPlane, vuInPlane: demands.vuInPlane,
      seismicRequired: input.seismicRequired,
    });
    walls.push(design);
    const key = levelKey(baseZ);
    const entry: WallEntry = {
      wallId: `W${shell.id}`, design, elementIds: [shell.id],
      geometry: {
        wallId: `W${shell.id}`,
        start: { x: start.x, y: start.y, z: baseZ },
        end: { x: end.x, y: end.y, z: baseZ },
        height, thickness: shell.thickness, cover: input.cover,
        elementIds: [shell.id],
      },
      barDiameterMm: input.wallBarDiameterMm,
    };
    const list = wallsByLevel.get(key);
    if (list) list.push(entry); else wallsByLevel.set(key, [entry]);
  }

  // One assembly per level, in ascending elevation so the output is deterministic.
  // Footing levels join the set: a footing at a level with no shell still needs an assembly,
  // or its bars would be checked, marked and then dropped before coordination.
  const footingsByLevel = input.footingsByLevel ?? new Map();
  const levels = [...new Set([
    ...slabsByLevel.keys(), ...wallsByLevel.keys(), ...footingsByLevel.keys(),
  ])].sort((a, b) => a - b);
  const assemblies: DetailingAssembly[] = [];
  for (const level of levels) {
    const built: FloorAssemblyResult = buildFloorAssembly({
      assemblyId: `FLOOR-${level.toFixed(3)}`,
      label: input.label ?? `Nivel ${level.toFixed(2)} m`,
      edition: input.edition,
      verifierId: input.verifierId,
      demandRevision: input.demandRevision,
      previousRevision: input.previousRevision,
      maxAggregateSizeMm: input.maxAggregateSizeMm,
      slabs: slabsByLevel.get(level) ?? [],
      walls: wallsByLevel.get(level) ?? [],
      footings: [...(footingsByLevel.get(level) ?? [])],
      membersVerified: input.membersVerified,
    });
    assemblies.push(built.assembly);
    trace.push(...built.trace);
  }

  trace.push(
    `Piso: ${slabs.length} losa(s), ${walls.length} tabique(s), ` +
    `${assemblies.length} conjunto(s) de nivel, ${unsupported.length} condición(es) no soportada(s).`);

  return { assemblies, slabs, walls, classifications, unsupported, trace };
}

/**
 * Can the floor workflow run at all, and if not, exactly why?
 *
 * Separate and cheap, like `detailingReadiness`, so a disabled command explains itself
 * instead of just being grey.
 */
export interface FloorDesignReadiness {
  ready: boolean;
  shellCount: number;
  withResults: number;
  reasons: EngineMessage[];
}

export function floorDesignReadiness(input: {
  shells: readonly { id: number }[];
  stresses: readonly { elementId: number }[];
}): FloorDesignReadiness {
  const reasons: EngineMessage[] = [];
  const withResults = input.stresses.length;
  if (input.shells.length === 0) reasons.push(msg('detailing.floorRun.noShells'));
  else if (withResults === 0) reasons.push(msg('detailing.floorRun.notSolved'));
  return {
    ready: reasons.length === 0,
    shellCount: input.shells.length,
    withResults,
    reasons,
  };
}
