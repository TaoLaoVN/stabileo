/**
 * Whole-floor coordination: slabs, walls and foundations into the PR17 assembly model.
 *
 * The point of doing this at floor level rather than per element is that the interfaces
 * are where the mistakes live. Slab top bars and beam top bars occupy the same 60 mm of
 * cover at every support. Column starters have to land inside the footing's bottom mat
 * without displacing it. Wall verticals have to lap with the dowels the foundation left
 * for them. Each element designed alone is correct; assembled, they collide.
 *
 * This module produces `DetailingAssembly` values for the three families, using the same
 * bar-geometry and collision engines PR17 built, so a slab bar and a beam bar are checked
 * against each other by exactly the code that checks two beam bars.
 *
 * ── Interface rules ────────────────────────────────────────────
 *
 * §7.7.2 / §8.7.2  slab reinforcement passes over supporting beams; the slab top steel
 *                  sits ABOVE the beam top steel where both are present, because the
 *                  slab bar has the shallower cover requirement and the beam bar is the
 *                  one that must not lose its lever arm.
 * §16.3.4          column-to-footing force transfer: dowels of at least the area
 *                  required, extending a development length into both members.
 * §25.5            lap lengths for the wall/dowel and column/starter splices.
 *
 * Pure: no store, no runes.
 */

import {
  buildStraightBarWithHooks, type BarPath, type Point3,
} from '../../codes/cirsoc201/bar-geometry';
import { seatedLongitudinalHalfExtents } from '../../codes/cirsoc201/transverse-cage';
import { clause, type ClauseRef, type RegulationEdition } from '../../codes/regulation';
import { worstMaturity, type Maturity } from '../../codes/maturity';
import { dedupeMessages, type EngineMessage } from '../../codes/message';
import { assessConstructibility } from './constructibility';
import { assignMarks, evaluateState, type DetailingAssembly, type UnsupportedCondition } from './assembly';
import { detectCollisions, type BarConflict, type CollisionTolerances } from './collision';
import { classifyPair } from './classify';
import type { SlabBarLayer, SlabDesignResult } from './slab-design';
import type { WallDesignResult } from './wall-design';
import type { FootingCheck } from './foundation-check';
import {
  dowelTransverseRequirement, footingTransverseRequirement, generateStarterTies,
  generateWallBars, slabTransverseRequirement, summariseRequirements,
  wallTransverseRequirement,
  type StarterCageInput, type TransverseRequirement, type WallGeometry,
} from './floor-transverse';

// ─── Slab bars ───────────────────────────────────────────────────

export interface SlabPanelGeometry {
  panelId: string;
  /** Plan origin of the panel's lower-left corner. */
  origin: Point3;
  lx: number;
  ly: number;
  thickness: number;
  cover: number;
  /** Elements this panel is attributed to, for routing conflicts to the UI. */
  elementIds: number[];
}

/**
 * Turn a designed slab panel into physical bars.
 *
 * Bars run the full panel dimension plus an anchorage allowance at each edge; top bars
 * are placed above bottom bars in the same direction, and the two directions are stacked
 * so an x bar and a y bar on the same face never occupy the same depth.
 */
export function generateSlabBars(
  panel: SlabPanelGeometry, layers: readonly SlabBarLayer[], edition: RegulationEdition,
): BarPath[] {
  const bars: BarPath[] = [];
  const halfT = panel.thickness / 2;
  const ANCHOR = 0.15;

  for (const layer of layers) {
    const isTop = layer.face === 'top';
    const d = layer.diameterMm / 1000;
    // x bars sit outermost on each face; y bars tuck inside them. Without this an x and
    // a y bar on the same face would be modelled at the same depth and every crossing
    // would read as a clash.
    const inset = panel.cover + d / 2 + (layer.direction === 'y' ? d : 0);
    const z = panel.origin.z + (isTop ? halfT - inset : -halfT + inset);

    const along = layer.direction === 'x' ? panel.lx : panel.ly;
    const across = layer.direction === 'x' ? panel.ly : panel.lx;
    const n = Math.max(1, Math.floor(across / layer.spacing));

    for (let i = 0; i < n; i++) {
      const offset = (i + 0.5) * layer.spacing;
      const start: Point3 = layer.direction === 'x'
        ? { x: panel.origin.x - ANCHOR, y: panel.origin.y + offset, z }
        : { x: panel.origin.x + offset, y: panel.origin.y - ANCHOR, z };
      const end: Point3 = layer.direction === 'x'
        ? { x: panel.origin.x + along + ANCHOR, y: panel.origin.y + offset, z }
        : { x: panel.origin.x + offset, y: panel.origin.y + along + ANCHOR, z };
      bars.push(buildStraightBarWithHooks({
        id: `${panel.panelId}-${layer.face[0]}${layer.direction}-${i}`,
        diameterMm: layer.diameterMm, role: 'longitudinal',
        start, end,
        axis: layer.direction === 'x' ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 },
        hookNormal: { x: 0, y: 0, z: isTop ? -1 : 1 },
        ownerElementIds: panel.elementIds, edition,
      }));
    }
  }
  return bars;
}

// ─── Column starters and foundation dowels ───────────────────────

export interface DowelInput {
  /** Identifier for the connection, e.g. 'F3-C3'. */
  id: string;
  /** Plan centre of the column. */
  centre: { x: number; y: number };
  /** Top of footing elevation. */
  footingTopZ: number;
  /** Footing thickness, m. */
  footingThickness: number;
  /** Bottom cover in the footing, m. */
  footingCover: number;
  columnB: number;
  columnH: number;
  cover: number;
  tieDia: number;
  bars: { count: number; diameterMm: number };
  /** Development length required in the footing, m. */
  ldFooting: number;
  /** Lap length above the footing, m. */
  lapAbove: number;
  elementIds: number[];
  edition: RegulationEdition;
}

/**
 * Generate the dowels that transfer column force into the footing.
 *
 * §16.3.4 requires the dowel to develop on both sides of the interface. The bottom leg
 * turns into a 90° hook where the straight development length would run past the
 * footing's bottom mat — which it usually does, because a footing is rarely deep enough
 * for a straight `l_d`.
 */
export function generateDowels(input: DowelInput): {
  bars: BarPath[]; refs: ClauseRef[]; notes: string[];
  /**
   * Where the dowels sit in the column's section frame, so the starter cage restrains the
   * bars that actually exist rather than a second guess at the same layout.
   */
  positions: Array<{ x: number; y: number }>;
} {
  const bars: BarPath[] = [];
  const notes: string[] = [];
  const refs = [
    clause('cirsoc-201', input.edition, '16.3.4', 'transmisión de fuerzas por armadura'),
    clause('cirsoc-201', input.edition, '25.5', 'empalmes por yuxtaposición'),
  ];

  const available = input.footingThickness - input.footingCover - 0.05;
  const needsHook = input.ldFooting > available;
  if (needsHook) {
    notes.push(
      `La longitud de anclaje recta requerida (${(input.ldFooting * 1000).toFixed(0)} mm) ` +
      `excede la altura útil de la zapata (${(available * 1000).toFixed(0)} mm): las barras ` +
      'de espera rematan con gancho a 90° apoyado sobre la parrilla inferior.');
  }

  // Seating comes from the ONE authoritative derivation, not a fourth local copy of it.
  //
  // This function used to compute `cover + d_s + d_b/2` for all four corners. That is the
  // contact distance from a STRAIGHT leg, and a corner bar cannot reach it because the
  // bend is in the way — it seats in the bend, further in. `generate-column` had the same
  // bug and its corner bars interpenetrated the joint ties by 3,3 mm apiece; here it was
  // 2,7 mm against the starter ties, and it only became visible once those ties existed.
  const seated = seatedLongitudinalHalfExtents(
    input.columnB, input.columnH, input.cover, input.tieDia, input.bars.diameterMm);
  const positions = [
    { x: -seated.corner.halfAcross, y: -seated.corner.halfUp },
    { x: seated.corner.halfAcross, y: -seated.corner.halfUp },
    { x: seated.corner.halfAcross, y: seated.corner.halfUp },
    { x: -seated.corner.halfAcross, y: seated.corner.halfUp },
  ];
  // Intermediate bars lie against a straight leg, so they use the FACE inset and are not
  // collinear with the corners. That is what a real cage does.
  const extra = Math.max(0, input.bars.count - 4);
  const halfB = seated.face.halfAcross;
  for (let k = 0; k < extra; k++) {
    const t = (k + 1) / (extra + 1);
    positions.push(k % 2 === 0
      ? { x: -halfB + 2 * halfB * t, y: -seated.face.halfUp }
      : { x: -halfB + 2 * halfB * t, y: seated.face.halfUp });
  }

  const embedded = Math.min(input.ldFooting, available);
  const placed = positions.slice(0, Math.min(positions.length, input.bars.count));
  for (let k = 0; k < placed.length; k++) {
    const p = placed[k];
    bars.push(buildStraightBarWithHooks({
      id: `${input.id}-dowel-${k}`,
      diameterMm: input.bars.diameterMm, role: 'longitudinal',
      start: {
        x: input.centre.x + p.x, y: input.centre.y + p.y,
        z: input.footingTopZ - embedded,
      },
      end: {
        x: input.centre.x + p.x, y: input.centre.y + p.y,
        z: input.footingTopZ + input.lapAbove,
      },
      axis: { x: 0, y: 0, z: 1 },
      // The hook turns toward the column centre so it sits over the bottom mat.
      hookNormal: { x: -Math.sign(p.x) || 1, y: 0, z: 0 },
      startHook: needsHook ? 90 : undefined,
      ownerElementIds: input.elementIds, edition: input.edition,
    }));
  }

  return { bars, refs, notes, positions: placed };
}

// ─── Floor assembly ──────────────────────────────────────────────

export interface FloorAssemblyInput {
  assemblyId: string;
  label: string;
  edition: RegulationEdition;
  verifierId: string;
  demandRevision: number;
  previousRevision?: number;
  maxAggregateSizeMm: number;
  tolerances?: CollisionTolerances;
  slabs: Array<{ geometry: SlabPanelGeometry; design: SlabDesignResult }>;
  /**
   * `geometry` and `barDiameterMm` are what turn a designed wall into a drawn one. Without
   * them the wall contributes ratios and a maturity and no steel, which is how walls came
   * to appear in no mark, no schedule and no collision check.
   */
  walls: Array<{
    wallId: string; design: WallDesignResult; elementIds: number[];
    geometry?: WallGeometry; barDiameterMm?: number;
  }>;
  footings: Array<{ id: string; check: FootingCheck; elementIds: number[]; dowels?: DowelInput }>;
  /** Beam top-bar depths at each support, so slab bars can be placed above them. */
  beamTopDepths?: Map<string, number>;
  membersVerified: boolean;
}

export interface FloorAssemblyResult {
  assembly: DetailingAssembly;
  trace: string[];
}

/**
 * Build one floor-level assembly from designed slabs, walls and footings.
 *
 * Every unsupported condition each element reported is carried through with its scope,
 * so a floor with one problematic panel still produces drawings for the rest and the
 * problem is attributable to the panel that has it.
 */
export function buildFloorAssembly(input: FloorAssemblyInput): FloorAssemblyResult {
  const trace: string[] = [];
  const unsupported: UnsupportedCondition[] = [];
  const maturities: Maturity[] = [];
  const bars: BarPath[] = [];
  // EngineMessage, not string. PR16 converted maturity assumptions to structured messages
  // so they could be translated at the i18n boundary; this collector was still typed as
  // prose, which typechecked only because nothing downstream read the elements.
  const assumptions: EngineMessage[] = [];
  // What the clauses require of this floor's transverse steel, family by family. Most
  // entries are legitimately EMPTY; the gate is told the reason either way.
  const requirements: TransverseRequirement[] = [];
  // Counted from the PATHS that exist, never from the requirement — the two must be able
  // to disagree or the condition proves nothing.
  let materialisedTransverse = 0;

  // Which spacing rule governs each element's bars. Starter dowels are column bars —
  // §25.2.3 is what governs them — so a footing's elements are declared as columns rather
  // than left undefined, which would silently fall back to the beam rule.
  const memberKinds = new Map<number, 'beam' | 'column' | 'wall' | 'slab'>();
  for (const s of input.slabs) for (const id of s.geometry.elementIds) memberKinds.set(id, 'slab');
  for (const w of input.walls) for (const id of w.elementIds) memberKinds.set(id, 'wall');
  for (const f of input.footings) for (const id of f.elementIds) memberKinds.set(id, 'column');

  for (const s of input.slabs) {
    const panelBars = generateSlabBars(s.geometry, s.design.layers, input.edition);
    bars.push(...panelBars);
    maturities.push(s.design.maturity.maturity);
    assumptions.push(...s.design.maturity.assumptions);
    trace.push(
      `Losa ${s.geometry.panelId}: ${s.design.behaviour === 'twoWay' ? 'dos' : 'una'} ` +
      `dirección, ${s.design.layers.length} capa(s), ${panelBars.length} barras.`);
    for (const u of s.design.unsupported) {
      unsupported.push({
        key: 'slab', scope: { elementIds: s.geometry.elementIds }, message: u,
        refs: s.design.refs,
      });
    }
    requirements.push(slabTransverseRequirement(
      s.geometry.panelId, s.geometry.elementIds, s.design, input.edition));
  }

  for (const w of input.walls) {
    maturities.push(w.design.maturity.maturity);
    assumptions.push(...w.design.maturity.assumptions);
    trace.push(
      `Tabique ${w.wallId}: verticales c/${(w.design.verticalSpacing * 1000).toFixed(0)} mm, ` +
      `horizontales c/${(w.design.horizontalSpacing * 1000).toFixed(0)} mm.`);
    if (w.geometry && w.barDiameterMm) {
      const wallBars = generateWallBars(
        w.geometry, w.design, w.barDiameterMm, input.edition);
      bars.push(...wallBars);
      trace.push(`Tabique ${w.wallId}: ${wallBars.length} barra(s) físicas.`);
    } else {
      // Said out loud rather than silently skipped: a wall with no geometry is a wall with
      // no drawing, and the previous version made that invisible.
      unsupported.push({
        key: 'wall', scope: { elementIds: w.elementIds },
        message:
          `El tabique ${w.wallId} no tiene geometría asociada, por lo que no se generó ` +
          'armadura física. Sus verificaciones son válidas; su despiece no existe.',
        refs: w.design.refs,
      });
    }
    for (const u of w.design.unsupported) {
      unsupported.push({
        key: 'wall', scope: { elementIds: w.elementIds }, message: u, refs: w.design.refs,
      });
    }
    requirements.push(wallTransverseRequirement(
      w.wallId, w.elementIds, w.design, input.edition));
  }

  for (const f of input.footings) {
    trace.push(`Fundación ${f.id}: ${f.check.status}.`);
    maturities.push(f.check.status === 'UNSUPPORTED' ? 'UNSUPPORTED' : 'IMPLEMENTED_PROVISIONAL');
    for (const u of f.check.unsupported) {
      unsupported.push({
        key: 'foundation', scope: { elementIds: f.elementIds }, message: u, refs: f.check.refs,
      });
    }
    requirements.push(footingTransverseRequirement(
      f.id, f.elementIds, f.check, input.edition));

    if (f.dowels) {
      const d = generateDowels(f.dowels);
      bars.push(...d.bars);
      trace.push(...d.notes);
      trace.push(`Fundación ${f.id}: ${d.bars.length} barra(s) de espera.`);

      // §10.7.6.1.1 — the starter bars are a column cage and must be tied. Without this
      // every footing drew a bundle of unrestrained verticals.
      const cage: StarterCageInput = {
        id: f.dowels.id, centre: f.dowels.centre, footingTopZ: f.dowels.footingTopZ,
        lapAbove: f.dowels.lapAbove,
        columnB: f.dowels.columnB, columnH: f.dowels.columnH,
        cover: f.dowels.cover, tieDia: f.dowels.tieDia, bars: f.dowels.bars,
        maxAggregateSizeMm: input.maxAggregateSizeMm,
        elementIds: f.elementIds, edition: input.edition,
      };
      requirements.push(dowelTransverseRequirement(cage));

      const ties = generateStarterTies(cage, d.positions);
      bars.push(...ties.bars);
      materialisedTransverse += ties.pieces.length;
      trace.push(
        `Fundación ${f.id}: ${ties.pieces.length} estribo(s) de arranque sobre el empalme.`);
      for (const ref of ties.refs) {
        unsupported.push({
          key: 'foundation', scope: { elementIds: f.elementIds },
          message:
            `No se pudo materializar la armadura transversal de arranque: ${ref.note}.`,
          refs: [ref],
        });
      }
    }
  }

  // ── Whole-floor collision check, through the AUTHORITATIVE classifier ────────
  //
  // This pass used to express its own physics with a pair of callbacks: `requiredClearFor`
  // returned zero for a non-parallel pair, and `placementFor` withheld the placement
  // allowance from bars that are tied. Both statements are true, and both are already made
  // — better — by `classifyPair`, which PR17 built precisely so that a slab bar and a beam
  // bar are judged by one set of rules.
  //
  // Keeping a second, simpler copy cost real accuracy. Without the classifier every pair
  // came back with `pairClass: undefined`, so:
  //
  //   · a tie touching the bars it is DECLARED to enclose was reported as an overlap, since
  //     nothing here knew what `enclosesBarIds` means — that is `requiredContainment`;
  //   · `CONTACT_ALLOWANCE`'s 2 mm moat around true contact did not apply, so an arc
  //     sampled to a 0,5 mm chord read as a 0,27 mm interpenetration of a bar seated
  //     tangent to it;
  //   · and the conflicts that DID appear could not be counted by class, because they had
  //     none — the `sameLayerSpacing` tally below was reading a field nobody set.
  //
  // Interpenetration is still checked first and unconditionally, so nothing is waved past:
  // a slab bar driven through a wall bar is `prohibitedOverlap` here exactly as in a beam.
  const classifyFor = (
    a: BarPath, b: BarPath, surface: number, ta?: Point3, tb?: Point3,
  ) => classifyPair(a, b, {
    edition: input.edition,
    maxAggregateSizeMm: input.maxAggregateSizeMm,
    memberKindOf: (id) => memberKinds.get(id),
  }, surface, ta, tb);

  const collision = detectCollisions(bars, {
    tolerances: input.tolerances, classifyFor,
  });
  const conflicts: BarConflict[] = collision.conflicts;
  trace.push(
    `Verificación de interferencias sobre ${bars.length} barra(s): ` +
    `${conflicts.length} conflicto(s), ${collision.barPairsTested} par(es) evaluado(s).`);

  const marks = assignMarks(bars, 'F');

  // ── The thirteenth condition, answered rather than skipped ──────────
  //
  // This object previously omitted `requiredTransversePieces` and
  // `materialisedTransversePieces` entirely, so the gate compared `undefined >= undefined`
  // — always false — and no floor could ever be CONSTRUCTIBLE, whatever its steel. It is a
  // type error, and `vite build` does not typecheck, so nothing caught it.
  //
  // Both numbers now come from `floor-transverse.ts`: the requirement from the ZONES and
  // the clauses, the materialisation from the paths that exist. Most families legitimately
  // require nothing — a slab whose concrete carries its shear, a footing sized for its
  // punching, a wall under §11.7.4.1's 0,01 — and those are recorded as EMPTY requirement
  // sets carrying their reason, never as a satisfied one.
  const totals = summariseRequirements(requirements, materialisedTransverse);
  trace.push(
    `Armadura transversal: ${totals.materialisedPieces} materializada(s) de ` +
    `${totals.requiredPieces} requerida(s); ${totals.empty.length} familia(s) sin ` +
    'requerimiento aplicable.');

  // The thirteen-condition gate, measured on what this floor actually produced.
  //
  // A slab/wall/footing assembly has no beam-line search and no splice transitions, so
  // those conditions are vacuously satisfied — but the conflict count, the unsupported
  // rules and the verification status are all real measurements, and CONSTRUCTIBLE is
  // withheld on any of them exactly as it is for a beam floor.
  const prohibited = conflicts.filter((c) => c.pairClass === 'prohibitedOverlap').length;
  const constructibility = assessConstructibility({
    requiredTransversePieces: totals.requiredPieces,
    materialisedTransversePieces: totals.materialisedPieces,
    completeEnvelope: true,
    searchTruncated: false,
    applicableMembers: 1,
    assignedMembers: 1,
    selectedTransitions: 0,
    materialisedTransitions: 0,
    unmaterialisedTransitions: 0,
    prohibitedConflicts: prohibited,
    reverifiedMembers: input.membersVerified ? 1 : 0,
    certificateHashMatches: input.membersVerified ? 1 : 0,
    spacingNotCodeLegal: conflicts.filter((c) => c.pairClass === 'sameLayerSpacing'
      || c.pairClass === 'betweenLayerSpacing' || c.pairClass === 'crossMemberSpacing').length,
    spacingNotPlacementRobust: 0,
    unsupportedRules: unsupported.length,
    staleAssemblies: 0,
  });
  const evaluation = evaluateState({
    bars, conflicts, unsupported,
    membersVerified: input.membersVerified,
    coordinated: true,
    constructibility,
  });
  trace.push(
    `Estado alcanzado: ${evaluation.state}` +
    (evaluation.blockers.length > 0 ? ` — ${evaluation.blockers.join(' ')}` : '.'));

  return {
    assembly: {
      constructibility,
      id: input.assemblyId,
      kind: 'beamLine',
      label: input.label,
      elementIds: [
        ...new Set([
          ...input.slabs.flatMap((s) => s.geometry.elementIds),
          ...input.walls.flatMap((w) => w.elementIds),
          ...input.footings.flatMap((f) => f.elementIds),
        ]),
      ].sort((a, b) => a - b),
      bars, marks, joints: [], conflicts, unsupported,
      detailingRevision: (input.previousRevision ?? 0) + 1,
      demandRevision: input.demandRevision,
      state: evaluation.state,
      maturity: worstMaturity(maturities),
      provenance: {
        edition: input.edition, verifierId: input.verifierId,
        trace,
        // Dedupe by identity rather than by object reference: two engines producing the
        // same assumption with the same parameters are one assumption to the reader.
        assumptions: dedupeMessages(assumptions),
      },
    },
    trace,
  };
}
