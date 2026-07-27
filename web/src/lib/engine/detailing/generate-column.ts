/**
 * Column-stack generation and beam-column joint coordination.
 *
 * A column stack is not a list of independent columns. Its bars run through floors, its
 * splices must sit in the permitted zone, its section may change between storeys, and at
 * every level it shares the joint with two to four beams whose top and bottom bars have
 * to pass through the same 400 mm cube. Designing each lift alone produces a set of
 * cages that cannot be assembled.
 *
 * ── Normative content (CIRSOC 201-2025) ────────────────────────
 *
 * §10.7.4  longitudinal bars offset by a change of section — the slope of the inclined
 *          portion shall not exceed 1 in 6, the portions above and below the offset are
 *          parallel to the column axis, and horizontal support must be provided by ties
 *          placed within 150 mm of the bend.
 * §10.7.5  splices of longitudinal reinforcement — lap, mechanical or welded.
 * §10.7.6  transverse reinforcement — ties enclosing the longitudinal bars, spacing not
 *          exceeding the least of 16·d_b(long), 48·d_b(tie) and the least column
 *          dimension.
 * §25.5    splice lengths.
 * §15.2    beam-column joints — the joint must be confined and the beam bars developed.
 *
 * ── Layer allocation at a joint ────────────────────────────────
 *
 * Two beams framing in perpendicular to each other cannot both put their top bars at the
 * same depth: one set has to sit under the other. The allocation is deterministic — by
 * descending beam depth, then by element id — so the same floor always produces the same
 * drawing. Arbitrary allocation would make every golden test unstable and, worse, would
 * make two runs of the same model produce two different bar schedules.
 *
 * Pure: no store, no runes.
 */

import {
  buildStraightBarWithHooks, standardHook, type BarPath, type Point3,
} from '../../codes/cirsoc201/bar-geometry';
import { minClearSpacingColumn } from '../../codes/cirsoc201/spacing';
import { clause, type ClauseRef, type RegulationEdition } from '../../codes/regulation';

// ─── Column stacks ───────────────────────────────────────────────

export interface ColumnLift {
  elementId: number;
  /** Base elevation of this lift, m. */
  baseZ: number;
  /** Top elevation, m. */
  topZ: number;
  b: number;
  h: number;
  /** Plan centre of the column at this lift. Moves when the section is offset. */
  centre: { x: number; y: number };
  /** Longitudinal bars chosen for this lift. */
  bars: { count: number; diameterMm: number };
  /** Tie diameter, mm. */
  tieDia: number;
  cover: number;
}

export interface ColumnStackInput {
  stackId: string;
  /** Lifts ordered bottom to top. */
  lifts: ColumnLift[];
  fc: number;
  fy: number;
  maxAggregateSizeMm: number;
  edition: RegulationEdition;
  /** Lap-splice length for a bar of the given diameter, m. */
  lapSplice: (diameterMm: number) => number;
  /** Depth of the beams framing in at each level, m, keyed by lift index (the joint above). */
  beamDepthAtTop: Map<number, number>;
  /** True when the top lift terminates at roof level and needs a hooked termination. */
  roofTermination: boolean;
  /**
   * Plan offsets for the longitudinal bars, relative to the lift centre.
   *
   * Supplied by the coordination search, which chooses the cage ARRANGEMENT — where the
   * non-corner face bars sit — as one of its variables. Evenly spreading them, which is
   * what this function does on its own, leaves narrow channels between column bars and can
   * make a large beam bar impossible to thread; clustering them toward the corners at the
   * §25.2.3 minimum opens a wide central channel and is equally legal.
   *
   * Absent, the even distribution below is used, which keeps every existing caller and
   * every golden test unchanged.
   */
  barPositions?: ReadonlyArray<{ x: number; y: number }>;
}

export type TransitionKind = 'none' | 'countChange' | 'diameterChange' | 'offset' | 'sectionChange';

export interface ColumnTransition {
  /** Index of the lift BELOW the transition. */
  liftIndex: number;
  z: number;
  kinds: TransitionKind[];
  /** Offset slope, run over rise, when `kinds` includes 'offset'. */
  offsetSlope?: number;
  /** True when the offset slope exceeds the §10.7.4 limit of 1 in 6. */
  offsetExceedsLimit?: boolean;
  /** Bars that cannot continue and must be spliced or terminated. */
  discontinued: number;
  note: string;
  refs: ClauseRef[];
}


/**
 * Clear distance between one face's hook tier and the next, m.
 *
 * NOT a chosen number. Two hook extensions in adjacent tiers run alongside each other, so
 * they are exactly what §25.2.3 governs: parallel longitudinal bars in a column, needing
 * max(40 mm, 1,5db, 4/3 dagg) between them.
 *
 * It was 5 mm — enough to stop the extensions interpenetrating and nowhere near enough to
 * satisfy the clause. The collision checker was right to report it: 36 conflicts on the QA
 * fixture, every one at 5 mm clear against a 40 mm requirement. Separating steel so that it
 * no longer overlaps is not the same as separating it legally.
 */
function hookTierGap(diameterMm: number, edition: RegulationEdition, dagg: number): number {
  return minClearSpacingColumn(edition, {
    barDiameterMm: diameterMm, maxAggregateSizeMm: dagg,
  }).minClear;
}

/**
 * Which face a column bar belongs to, and which way its roof hook turns.
 *
 * ── The defect this replaces ───────────────────────────────────────
 *
 * Every roof hook used to turn along ±x: `hookNormal: { x: -Math.sign(p.x) || 1, y: 0 }`.
 * So every bar on one face pointed its 12db extension along the SAME line at the SAME
 * elevation, and adjacent bars simply overlapped. On the flagship two Ø20 bars on the
 * y = −211 face ran from x = −141 to 99 and from x = −71 to 169, two millimetres apart in
 * z. That is 214 prohibited overlaps, and none of them was a crank: §10.7.4 offset bars
 * never entered into it, because the bars are straight.
 *
 * ── The rule ───────────────────────────────────────────────────────
 *
 * A bar's hook turns inward perpendicular to the face it sits on, so every extension on
 * one face is parallel to its neighbours and offset from them by the bar spacing. That
 * alone fixes same-face overlap.
 *
 * It does not fix opposite and adjacent faces: a −y bar's extension runs +y, a +y bar's
 * runs −y, and in a 400 mm column two 240 mm extensions on the same line still meet. So
 * each face also gets its own elevation tier. Within a tier all extensions are parallel
 * and never meet; across tiers they are at different heights and cannot.
 *
 * Corner bars sit on two faces and are assigned to exactly one, deterministically: the
 * face they are closer to, ties broken by face order. A corner bar must not be counted
 * twice or left out.
 */
function faceOf(
  p: { x: number; y: number }, halfB: number, halfH: number,
): { tier: number; inward: Point3 } {
  // Distance to each face, in face order: −y, +x, +y, −x.
  const d = [
    Math.abs(p.y + halfH),
    Math.abs(p.x - halfB),
    Math.abs(p.y - halfH),
    Math.abs(p.x + halfB),
  ];
  const inward: Point3[] = [
    { x: 0, y: 1, z: 0 }, { x: -1, y: 0, z: 0 },
    { x: 0, y: -1, z: 0 }, { x: 1, y: 0, z: 0 },
  ];
  let best = 0;
  for (let i = 1; i < 4; i++) if (d[i] < d[best] - 1e-9) best = i;
  return { tier: best, inward: inward[best] };
}

/** §10.7.4 — the maximum slope of an offset bent bar, expressed as run/rise. */
export const MAX_OFFSET_SLOPE = 1 / 6;

/** Detect what changes between consecutive lifts. */
export function detectTransitions(input: ColumnStackInput): ColumnTransition[] {
  const out: ColumnTransition[] = [];
  const c = (id: string, label?: string) => clause('cirsoc-201', input.edition, id, label);

  for (let i = 0; i + 1 < input.lifts.length; i++) {
    const lo = input.lifts[i];
    const hi = input.lifts[i + 1];
    const kinds: TransitionKind[] = [];
    const refs: ClauseRef[] = [];
    const notes: string[] = [];

    if (lo.bars.count !== hi.bars.count) {
      kinds.push('countChange');
      notes.push(`La cantidad de barras pasa de ${lo.bars.count} a ${hi.bars.count}.`);
    }
    if (lo.bars.diameterMm !== hi.bars.diameterMm) {
      kinds.push('diameterChange');
      notes.push(`El diámetro pasa de Ø${lo.bars.diameterMm} a Ø${hi.bars.diameterMm}.`);
    }
    if (lo.b !== hi.b || lo.h !== hi.h) {
      kinds.push('sectionChange');
      notes.push(`La sección pasa de ${lo.b}×${lo.h} a ${hi.b}×${hi.h} m.`);
    }

    const dx = hi.centre.x - lo.centre.x;
    const dy = hi.centre.y - lo.centre.y;
    const shift = Math.hypot(dx, dy);
    let offsetSlope: number | undefined;
    let offsetExceedsLimit: boolean | undefined;

    if (shift > 1e-9) {
      kinds.push('offset');
      // The bend is made within the joint depth; with no beam the lift height is used.
      const rise = input.beamDepthAtTop.get(i) ?? (lo.topZ - lo.baseZ);
      offsetSlope = rise > 0 ? shift / rise : Infinity;
      offsetExceedsLimit = offsetSlope > MAX_OFFSET_SLOPE + 1e-9;
      refs.push(c('10.7.4', 'barras longitudinales dobladas por cambio de sección'));
      notes.push(
        `El eje se desplaza ${(shift * 1000).toFixed(0)} mm sobre una altura de ` +
        `${(rise * 1000).toFixed(0)} mm: pendiente 1 en ${(1 / (offsetSlope || 1e-9)).toFixed(1)}.` +
        (offsetExceedsLimit
          ? ' EXCEDE el límite de 1 en 6 del artículo 10.7.4: las barras no pueden ' +
            'acodarse y deben empalmarse con barras de espera separadas.'
          : ' Dentro del límite de 1 en 6; se acodan las barras y se colocan estribos a ' +
            'menos de 150 mm del doblado.'));
    }

    if (kinds.length === 0) {
      out.push({
        liftIndex: i, z: lo.topZ, kinds: ['none'], discontinued: 0,
        note: 'Sin cambios: las barras continúan.', refs: [],
      });
      continue;
    }

    out.push({
      liftIndex: i, z: lo.topZ, kinds,
      offsetSlope, offsetExceedsLimit,
      discontinued: Math.max(0, lo.bars.count - hi.bars.count),
      note: notes.join(' '),
      refs: [...refs, c('10.7.5', 'empalmes de la armadura longitudinal')],
    });
  }
  return out;
}

export interface SpliceZone {
  liftIndex: number;
  /** Splice start elevation, m. */
  from: number;
  to: number;
  diameterMm: number;
  /** Bars spliced in this zone; the rest are staggered into the alternate zone. */
  barCount: number;
  /** Stagger group: 0 spliced low, 1 spliced high. */
  staggerGroup: 0 | 1;
  refs: ClauseRef[];
}

/**
 * Place lap splices just above each floor, staggered in two groups.
 *
 * Splicing every bar at the same section concentrates the whole transfer in one plane.
 * Staggering half the bars by one lap length is standard practice and is what the
 * drawing has to show.
 */
export function planSplices(input: ColumnStackInput): SpliceZone[] {
  const out: SpliceZone[] = [];
  const ref = clause('cirsoc-201', input.edition, '25.5', 'empalmes por yuxtaposición');

  for (let i = 1; i < input.lifts.length; i++) {
    const lift = input.lifts[i];
    const lap = input.lapSplice(lift.bars.diameterMm);
    const half = Math.floor(lift.bars.count / 2);
    // Group 0 starts at the lift base; group 1 starts one lap higher.
    out.push({
      liftIndex: i, from: lift.baseZ, to: lift.baseZ + lap,
      diameterMm: lift.bars.diameterMm, barCount: half, staggerGroup: 0, refs: [ref],
    });
    out.push({
      liftIndex: i, from: lift.baseZ + lap, to: lift.baseZ + 2 * lap,
      diameterMm: lift.bars.diameterMm, barCount: lift.bars.count - half,
      staggerGroup: 1, refs: [ref],
    });
  }
  return out;
}

/** §10.7.6.2 — tie spacing: least of 16·d_b(long), 48·d_b(tie), least column dimension. */
export function tieSpacing(
  longDiameterMm: number, tieDiameterMm: number, leastDimension: number,
  edition: RegulationEdition,
): { spacing: number; governedBy: '16db' | '48dbe' | 'leastDimension'; refs: ClauseRef[] } {
  const a = 16 * longDiameterMm / 1000;
  const b = 48 * tieDiameterMm / 1000;
  const cands: Array<[number, '16db' | '48dbe' | 'leastDimension']> =
    [[a, '16db'], [b, '48dbe'], [leastDimension, 'leastDimension']];
  cands.sort((x, y) => x[0] - y[0]);
  return {
    spacing: cands[0][0],
    governedBy: cands[0][1],
    refs: [clause('cirsoc-201', edition, edition === '2025' ? '10.7.6.2' : '7.10.5',
      'separación de la armadura transversal')],
  };
}

export interface GeneratedColumnStack {
  bars: BarPath[];
  transitions: ColumnTransition[];
  splices: SpliceZone[];
  ties: Array<{ liftIndex: number; from: number; to: number; spacing: number; diameterMm: number }>;
  trace: string[];
  refs: ClauseRef[];
  unsupported: string[];
}

/** Generate the physical bars for a whole column stack. */
export function generateColumnStack(input: ColumnStackInput): GeneratedColumnStack {
  const trace: string[] = [];
  const unsupported: string[] = [];
  const bars: BarPath[] = [];
  const refs: ClauseRef[] = [];
  const ties: GeneratedColumnStack['ties'] = [];

  const transitions = detectTransitions(input);
  const splices = planSplices(input);

  for (const t of transitions) {
    trace.push(`Nivel +${t.z.toFixed(2)} m: ${t.note}`);
    refs.push(...t.refs);
    if (t.offsetExceedsLimit) {
      unsupported.push(
        `El acodamiento en +${t.z.toFixed(2)} m excede la pendiente 1 en 6 del artículo ` +
        '10.7.4. Requiere barras de espera separadas, que no se generan automáticamente.');
    }
  }

  for (let i = 0; i < input.lifts.length; i++) {
    const lift = input.lifts[i];
    const spacing = minClearSpacingColumn(input.edition, {
      barDiameterMm: lift.bars.diameterMm, maxAggregateSizeMm: input.maxAggregateSizeMm,
    });
    refs.push(...spacing.refs);

    const inset = lift.cover + lift.tieDia / 1000 + lift.bars.diameterMm / 2000;
    const halfB = lift.b / 2 - inset;
    const halfH = lift.h / 2 - inset;

    // Perimeter positions, corners first then faces, deterministic — unless the
    // coordination search chose an arrangement, in which case that is the cage.
    let positions: Array<{ x: number; y: number }>;
    // The coordinated arrangement is taken only if it is actually usable: the right
    // NUMBER of bars, and no two of them in the same place.
    //
    // Both guards earned their place. The override used to map the whole array rather
    // than the first `count`, so a longer list silently added bars the design never
    // called for; and it never checked for repeats, so a list carrying a position twice
    // put two bars on one point — which reads downstream as a bar interpenetrating
    // itself, not as the missing bar it actually is.
    const chosen = input.barPositions?.slice(0, lift.bars.count) ?? null;
    const chosenDistinct = chosen !== null
      && chosen.length === lift.bars.count
      && new Set(chosen.map((p) => `${Math.round(p.x * 1e5)}:${Math.round(p.y * 1e5)}`)).size
        === chosen.length;
    if (chosen && chosenDistinct) {
      positions = chosen.map((p) => ({ x: p.x, y: p.y }));
    } else {
      if (chosen && chosen.length === lift.bars.count) {
        unsupported.push(
          `La disposición coordinada de ${lift.bars.count}Ø${lift.bars.diameterMm} ` +
          `repite posiciones; se usa la disposición perimetral generada.`);
      }
      positions = [
        { x: -halfB, y: -halfH }, { x: halfB, y: -halfH },
        { x: halfB, y: halfH }, { x: -halfB, y: halfH },
      ];
      const extra = Math.max(0, lift.bars.count - 4);
      for (let k = 0; k < extra; k++) {
        const t = (k + 1) / (extra + 1);
        positions.push(k % 2 === 0
          ? { x: -halfB + 2 * halfB * t, y: -halfH }
          : { x: -halfB + 2 * halfB * t, y: halfH });
      }
    }

    // §25.2.3: the perimeter has to actually HOLD them.
    //
    // This was unchecked, and the flagship contains columns whose certified bar count is
    // 24Ø12 — which this loop happily drew at 20 mm pitch, an 8 mm clear distance against
    // the 40 mm the article requires. An illegal cage is bad on its own; it also blocks
    // every beam framing into that joint, which is how 120 beams came to be reported as
    // impossible to thread by a search that was being handed geometry no one would build.
    //
    // The count and diameter are certified and are NOT changed here. When they will not fit
    // legally, that is a real inadequacy of the section and is reported as one.
    let tightest = Infinity;
    for (let a = 0; a < positions.length; a++) {
      for (let bIdx = a + 1; bIdx < positions.length; bIdx++) {
        tightest = Math.min(tightest, Math.hypot(
          positions[a].x - positions[bIdx].x,
          positions[a].y - positions[bIdx].y) - lift.bars.diameterMm / 1000);
      }
    }
    if (Number.isFinite(tightest) && tightest < spacing.minClear - 1e-9) {
      unsupported.push(
        `Tramo ${i}: ${lift.bars.count}Ø${lift.bars.diameterMm} no entran en el perímetro ` +
        `de ${(lift.b * 1000).toFixed(0)}×${(lift.h * 1000).toFixed(0)} mm respetando la ` +
        `separación libre mínima de ${(spacing.minClear * 1000).toFixed(0)} mm ` +
        `(art. ${input.edition === '2025' ? '25.2.3' : '7.6.3'}): la disposición alcanza ` +
        `${(tightest * 1000).toFixed(0)} mm. Se requiere agrandar la sección, reducir el ` +
        'número de barras o usar haces.');
      trace.push(
        `Tramo ${i}: separación libre ${(tightest * 1000).toFixed(0)} mm < ` +
        `${(spacing.minClear * 1000).toFixed(0)} mm requerida.`);
    }

    // Bars run the lift height, plus the lap above unless this is the top lift.
    const isTop = i === input.lifts.length - 1;
    const lap = input.lapSplice(lift.bars.diameterMm);
    const topZ = isTop ? lift.topZ : lift.topZ + lap;
    const roofHook = isTop && input.roofTermination ? 90 : undefined;
    if (roofHook) {
      refs.push(...standardHook(lift.bars.diameterMm, 90, 'longitudinal', input.edition).refs);
      trace.push('Terminación en cubierta: las barras longitudinales rematan con gancho a 90°.');
    }

    for (let k = 0; k < Math.min(positions.length, lift.bars.count); k++) {
      const p = positions[k];
      const face = roofHook ? faceOf(p, halfB, halfH) : null;
      // Each face's hooks get their own elevation, so extensions that run along the same
      // axis never share a plane. See `faceOf` and `HOOK_TIER_GAP`.
      const tierLift = face
        ? face.tier * (lift.bars.diameterMm / 1000
          + hookTierGap(lift.bars.diameterMm, input.edition, input.maxAggregateSizeMm ?? 19))
        : 0;
      const start: Point3 = { x: lift.centre.x + p.x, y: lift.centre.y + p.y, z: lift.baseZ };
      const end: Point3 = {
        x: lift.centre.x + p.x, y: lift.centre.y + p.y, z: topZ - tierLift,
      };
      bars.push(buildStraightBarWithHooks({
        id: `${input.stackId}-L${i}-v${k}`,
        diameterMm: lift.bars.diameterMm, role: 'longitudinal',
        start, end,
        axis: { x: 0, y: 0, z: 1 },
        // Roof hooks turn inward, PERPENDICULAR TO THE BAR'S OWN FACE.
        hookNormal: face ? face.inward : { x: 1, y: 0, z: 0 },
        endHook: roofHook,
        ownerElementIds: [lift.elementId], edition: input.edition,
      }));
    }

    const ts = tieSpacing(lift.bars.diameterMm, lift.tieDia, Math.min(lift.b, lift.h), input.edition);
    refs.push(...ts.refs);
    ties.push({
      liftIndex: i, from: lift.baseZ, to: lift.topZ,
      spacing: ts.spacing, diameterMm: lift.tieDia,
    });
    trace.push(
      `Tramo ${i}: ${lift.bars.count}Ø${lift.bars.diameterMm}, estribos Ø${lift.tieDia} cada ` +
      `${(ts.spacing * 1000).toFixed(0)} mm (gobierna ${ts.governedBy}).`);
  }

  return { bars, transitions, splices, ties, trace, refs, unsupported };
}

// ─── Joint coordination ──────────────────────────────────────────

export type JointKind = 'interior' | 'exterior' | 'corner' | 'roof';

export interface IncidentBeamAtJoint {
  elementId: number;
  /** Plan direction of the beam axis, unit vector. */
  direction: { x: number; y: number };
  /** Overall beam depth, m. */
  depth: number;
  /** Top bar diameter, mm. */
  topDiameterMm: number;
  /** True when the beam continues past the joint. */
  continuous: boolean;
}

export interface JointCoordination {
  kind: JointKind;
  /** Number of beams framing in, in plan. */
  beamCount: number;
  /** Layer index per beam: 0 is the outermost (highest) top-bar layer. */
  layers: Array<{ elementId: number; layer: number; topOffset: number }>;
  /** True when the joint is confined by transverse beams per §15.2.8. */
  confined: boolean;
  /** Beam bars requiring a hooked anchorage because they do not continue. */
  hookedAnchorages: number[];
  trace: string[];
  refs: ClauseRef[];
  unsupported: string[];
}

/**
 * Classify a joint from how many beams frame in and whether a column continues above.
 *
 * A roof joint is one with no column above: its beam top bars must hook down into the
 * joint because there is nothing to continue into.
 */
export function classifyJoint(beamCount: number, columnAbove: boolean): JointKind {
  if (!columnAbove) return 'roof';
  if (beamCount >= 4) return 'interior';
  if (beamCount === 3) return 'exterior';
  return 'corner';
}

/**
 * Allocate top-bar layers so perpendicular beams do not occupy the same depth.
 *
 * Deterministic: deepest beam first (it has the most to lose from being pushed down),
 * ties broken by element id. Arbitrary allocation would make two runs of the same model
 * produce two different schedules.
 */
export function allocateBeamLayers(
  beams: readonly IncidentBeamAtJoint[], cover: number, tieDia: number,
): JointCoordination['layers'] {
  // Group by plan axis: beams on the same axis share a layer, perpendicular ones stack.
  const axisKey = (b: IncidentBeamAtJoint) =>
    Math.abs(b.direction.x) >= Math.abs(b.direction.y) ? 'X' : 'Y';

  const axes = [...new Set(beams.map(axisKey))].sort();
  const order = axes
    .map((ax) => ({
      ax,
      members: beams.filter((b) => axisKey(b) === ax)
        .sort((p, q) => q.depth - p.depth || p.elementId - q.elementId),
    }))
    // The axis carrying the deepest beam gets the outer layer.
    .sort((a, b) =>
      (b.members[0]?.depth ?? 0) - (a.members[0]?.depth ?? 0) || a.ax.localeCompare(b.ax));

  const out: JointCoordination['layers'] = [];
  let offset = cover + tieDia / 1000;
  order.forEach((group, layer) => {
    const dia = Math.max(...group.members.map((m) => m.topDiameterMm)) / 1000;
    for (const m of group.members) {
      out.push({ elementId: m.elementId, layer, topOffset: offset + dia / 2 });
    }
    offset += dia + 0.025;   // §25.2.2 clear distance between layers
  });
  return out.sort((a, b) => a.layer - b.layer || a.elementId - b.elementId);
}

/**
 * Coordinate one beam-column joint.
 *
 * §15.2.8 confinement: a joint is confined when beams frame in on all four faces and
 * each beam covers at least three quarters of the joint face. With fewer than four
 * beams the joint is not confined, which reduces its shear strength — see the joint
 * shear module's Table 15.4.2.3 lookup.
 */
export function coordinateJoint(opts: {
  beams: readonly IncidentBeamAtJoint[];
  columnAbove: boolean;
  columnB: number;
  columnH: number;
  cover: number;
  tieDia: number;
  edition: RegulationEdition;
}): JointCoordination {
  const trace: string[] = [];
  const unsupported: string[] = [];
  const refs: ClauseRef[] = [
    clause('cirsoc-201', opts.edition, '15.2', 'nudos viga-columna'),
  ];

  const kind = classifyJoint(opts.beams.length, opts.columnAbove);
  const layers = allocateBeamLayers(opts.beams, opts.cover, opts.tieDia);

  const confined = opts.beams.length >= 4;
  refs.push(clause('cirsoc-201', opts.edition, '15.2.8', 'confinamiento por vigas transversales'));

  const hookedAnchorages = opts.beams.filter((b) => !b.continuous).map((b) => b.elementId);

  trace.push(
    `Nudo ${kind} con ${opts.beams.length} viga(s). ` +
    `${confined ? 'Confinado' : 'No confinado'} según 15.2.8.`);
  const byLayer = new Map<number, number[]>();
  for (const l of layers) {
    const g = byLayer.get(l.layer);
    if (g) g.push(l.elementId); else byLayer.set(l.layer, [l.elementId]);
  }
  for (const [layer, ids] of [...byLayer.entries()].sort((a, b) => a[0] - b[0])) {
    trace.push(`Capa ${layer}: elemento(s) ${ids.join(', ')}.`);
  }
  if (hookedAnchorages.length > 0) {
    trace.push(
      `Vigas que no continúan (${hookedAnchorages.join(', ')}): la armadura superior ` +
      'requiere anclaje con gancho dentro del nudo.');
  }
  if (kind === 'roof') {
    trace.push('Nudo de cubierta: sin columna superior, las barras de viga rematan dentro del nudo.');
  }
  if (opts.beams.length > 4) {
    unsupported.push(
      `El nudo recibe ${opts.beams.length} vigas en planta. La asignación de capas está ` +
      'definida para hasta cuatro vigas en dos ejes ortogonales; por encima de eso la ' +
      'distribución no se genera automáticamente.');
  }

  return { kind, beamCount: opts.beams.length, layers, confined, hookedAnchorages, trace, refs, unsupported };
}
