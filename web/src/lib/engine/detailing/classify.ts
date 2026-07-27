/**
 * Classify what a bar pair actually IS before deciding whether it is a problem.
 *
 * ── Why this exists ────────────────────────────────────────────────
 *
 * The collision detector asked one question of every pair — "are these two bars at least
 * X apart?" — with a single X supplied by the caller. On the 408-member flagship that
 * produced ~11,000 conflicts, and inspection showed most of them were not conflicts:
 *
 *   * Every longitudinal-to-longitudinal pair was measured against the COLUMN rule
 *     (§25.2.3: max(40 mm, 1.5 db, 4/3 d_agg)), because the caller selected `beam` only
 *     when one of the bars was transverse — and stirrups are not emitted as bar paths at
 *     all. Beam bars were being held to 40 mm where §25.2.1 asks for 25 mm.
 *
 *   * Bars in different LAYERS of the same face were measured against the in-layer rule
 *     instead of §25.2.2's 25 mm between layers, so a correctly detailed two-layer group
 *     reported a violation.
 *
 *   * A beam bar crossing a column bar at ninety degrees was measured as though the two
 *     had to stand apart. They do not: crossing bars touch and are tied. What matters
 *     there is whether they physically interpenetrate.
 *
 * So the pair is classified first, and the class decides both the rule and whether a
 * shortfall is a defect at all. Required containment — a tie around the bars it confines —
 * is never a collision. Prohibited overlap is never explained away by tolerance.
 *
 * Pure: no store, no runes, no i18n.
 */

import type { BarPath, Point3 } from '../../codes/cirsoc201/bar-geometry';
import {
  minClearBetweenLayers, minClearSpacingColumn, minClearSpacingInLayer,
} from '../../codes/cirsoc201/spacing';
import { clause, type ClauseRef, type RegulationEdition } from '../../codes/regulation';

/**
 * What relationship two bars are in.
 *
 * The order matters: the first matching class wins, and they are arranged from "not a
 * conflict by construction" through to "physically impossible".
 */
export type PairClass =
  /**
   * A transverse bar enclosing longitudinal bars it is there to confine. A stirrup touches
   * the bars it holds — that is its job — so this is never reported.
   */
  | 'requiredContainment'
  /**
   * Non-parallel bars crossing. They are tied in contact; the code's clear-spacing rules
   * govern bars running alongside each other, not bars crossing. Only interpenetration
   * matters, and it is reported as `prohibitedOverlap`.
   */
  | 'orthogonalCrossing'
  /** Parallel bars in the same layer of the same face: §25.2.1 or §25.2.3. */
  | 'sameLayerSpacing'
  /** Parallel bars in different layers of the same face: §25.2.2, 25 mm. */
  | 'betweenLayerSpacing'
  /** Parallel bars belonging to different members meeting at a joint or support. */
  | 'crossMemberSpacing'
  /**
   * Two halves of a lap splice, §25.5.1.2 or §25.5.1.3.
   *
   * A lap is a DETAIL, and it is the one place in the code where two parallel bars are
   * meant to run alongside each other close enough to touch. Judging the pair by §25.2.1
   * clear spacing reports the detail as the defect — which is exactly what happened to
   * every materialised lap in the flagship before this class existed.
   *
   * A contact lap has no spacing requirement at all: the bars are supposed to be in
   * contact. A non-contact lap has a MAXIMUM, not a minimum — §25.5.1.3 bounds how far
   * apart the two halves may drift, and that is checked against `maxOffset`, not here.
   */
  | 'spliceLap'
  /** Bar surfaces interpenetrate. Never acceptable, never tolerance-adjusted. */
  | 'prohibitedOverlap';

export interface PairClassification {
  pairClass: PairClass;
  /** Clear distance the class demands, m. Zero means contact is acceptable. */
  requiredClear: number;
  /** True when a shortfall against `requiredClear` should be reported at all. */
  reportable: boolean;
  /** The clause the requirement comes from. Empty for classes with no spacing rule. */
  refs: ClauseRef[];
  /** i18n key naming the class, for the conflict UI. */
  labelKey: string;
}

export interface ClassificationContext {
  edition: RegulationEdition;
  maxAggregateSizeMm: number;
  /** Member kind per element id, so a beam bar is judged by the beam rule. */
  memberKindOf: (elementId: number) => 'beam' | 'column' | 'wall' | 'slab' | undefined;
  /** Layer index per bar id, when the generator recorded one. */
  layerOf?: (barId: string) => number | undefined;
  /**
   * Are these two bars the two halves of a materialised lap?
   *
   * Supplied only after `materialiseLaps` has run. Before materialisation nothing is a
   * lap, and the classifier must not pretend otherwise — an unmaterialised schedule is a
   * compatibility claim, not steel.
   */
  isLapPair?: (aId: string, bId: string) => 'contact' | 'nonContact' | undefined;
}

/** Unit direction of a bar, first point to last. */
export function barDirection(bar: BarPath): Point3 {
  const a = bar.segments[0]?.start;
  const b = bar.segments[bar.segments.length - 1]?.end;
  if (!a || !b) return { x: 1, y: 0, z: 0 };
  const d = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
  const L = Math.hypot(d.x, d.y, d.z);
  return L < 1e-9 ? { x: 1, y: 0, z: 0 } : { x: d.x / L, y: d.y / L, z: d.z / L };
}

/**
 * How parallel two bars are, 1 = collinear direction, 0 = perpendicular.
 *
 * The threshold below is deliberately generous: a bar at 20° to another is still running
 * "alongside" it for spacing purposes, and only a genuinely transverse crossing is exempt.
 */
export function parallelism(a: BarPath, b: BarPath): number {
  const u = barDirection(a);
  const v = barDirection(b);
  return Math.abs(u.x * v.x + u.y * v.y + u.z * v.z);
}

/** Above this the bars are treated as running alongside each other. */
export const PARALLEL_THRESHOLD = 0.5;

/** Two bars share a member when any owner element is common to both. */
export function sharesMember(a: BarPath, b: BarPath): boolean {
  return a.ownerElementIds.some((id) => b.ownerElementIds.includes(id));
}

/**
 * Which member rule governs a pair.
 *
 * When the two bars belong to different member kinds — a beam bar meeting a column bar at
 * a joint — the stricter of the two applies. That is the conservative reading and it is
 * also what a detailer does: the congested case sets the rule.
 */
function governingKind(
  a: BarPath, b: BarPath, ctx: ClassificationContext,
): 'beam' | 'column' | 'wall' | 'slab' {
  const kinds = [...a.ownerElementIds, ...b.ownerElementIds]
    .map(ctx.memberKindOf)
    .filter((k): k is NonNullable<typeof k> => k !== undefined);
  if (kinds.length === 0) return 'beam';
  // Column spacing is the strictest of the four, so its presence governs.
  return kinds.includes('column') ? 'column' : kinds[0];
}

function spacingFor(
  a: BarPath, b: BarPath, ctx: ClassificationContext,
): { minClear: number; refs: ClauseRef[] } {
  const inputs = {
    barDiameterMm: Math.max(a.diameterMm, b.diameterMm),
    maxAggregateSizeMm: ctx.maxAggregateSizeMm,
  };
  const kind = governingKind(a, b, ctx);
  const r = kind === 'column'
    ? minClearSpacingColumn(ctx.edition, inputs)
    : minClearSpacingInLayer(ctx.edition, inputs);
  return { minClear: r.minClear, refs: r.refs };
}

/**
 * Bars that are MEANT to touch may touch.
 *
 * A tie around its longitudinals and a slab mat's crossing bars are in contact by design,
 * so their surface distance is about zero. Only a real interpenetration — centrelines
 * driven into each other, as when a beam bar runs straight through a column bar — is a
 * defect. This is the depth past contact at which that becomes true.
 */
export const CONTACT_ALLOWANCE = 0.002;

/**
 * Classify one pair.
 *
 * `surfaceClearance` is the measured surface-to-surface distance WITHOUT any placement
 * tolerance, in metres. Negative means the surfaces interpenetrate.
 *
 * ── Order matters ──────────────────────────────────────────────────
 *
 * The contact relationships are tested BEFORE interpenetration, not after. Checking
 * "do they overlap?" first classifies every tie point and every slab-mat crossing as a
 * prohibited overlap, because bars that are tied together do touch — that is what tying
 * means. A whole floor of orthogonal slab mat reported as eleven thousand impossibilities
 * is what that ordering produces.
 */
export function classifyPair(
  a: BarPath, b: BarPath, ctx: ClassificationContext, surfaceClearance: number,
): PairClassification {
  const interpenetrates = surfaceClearance < -CONTACT_ALLOWANCE;

  // 1. A tie or stirrup around the bars it confines is doing its job. It touches them.
  const oneTransverse = a.role === 'transverse' || b.role === 'transverse';
  const bothTransverse = a.role === 'transverse' && b.role === 'transverse';
  if (oneTransverse && !bothTransverse && sharesMember(a, b)) {
    return {
      pairClass: 'requiredContainment', requiredClear: 0, reportable: false, refs: [],
      labelKey: 'detailing.pairClass.requiredContainment',
    };
  }

  // 2. Crossing bars are tied in contact. Clear spacing governs bars running ALONGSIDE
  //    each other; for a crossing the only question is whether they interpenetrate.
  if (parallelism(a, b) < PARALLEL_THRESHOLD) {
    return {
      pairClass: interpenetrates ? 'prohibitedOverlap' : 'orthogonalCrossing',
      requiredClear: 0,
      reportable: interpenetrates,
      refs: [],
      labelKey: interpenetrates
        ? 'detailing.pairClass.prohibitedOverlap'
        : 'detailing.pairClass.orthogonalCrossing',
    };
  }

  // 3. The two halves of a lap. §25.5.1.2 puts them in contact ON PURPOSE.
  const lap = ctx.isLapPair?.(a.id, b.id);
  if (lap) {
    return {
      pairClass: 'spliceLap',
      requiredClear: 0,
      // Interpenetration is still wrong: touching is contact, sharing a centreline is not
      // a lap, it is two bars drawn on top of one another.
      reportable: interpenetrates,
      refs: [clause('cirsoc-201', ctx.edition,
        lap === 'contact' ? '25.5.1.2' : '25.5.1.3',
        lap === 'contact'
          ? 'empalmes por yuxtaposición en contacto'
          : 'separación transversal de empalmes sin contacto')],
      labelKey: interpenetrates
        ? 'detailing.pairClass.prohibitedOverlap'
        : 'detailing.pairClass.spliceLap',
    };
  }

  // 4. Parallel bars that interpenetrate. No rule makes this acceptable.
  if (interpenetrates) {
    return {
      pairClass: 'prohibitedOverlap', requiredClear: 0, reportable: true, refs: [],
      labelKey: 'detailing.pairClass.prohibitedOverlap',
    };
  }

  // 5. Parallel and clear of each other. Same face, different layers is §25.2.2.
  const la = ctx.layerOf?.(a.id);
  const lb = ctx.layerOf?.(b.id);
  if (sharesMember(a, b) && la !== undefined && lb !== undefined && la !== lb) {
    const layer = minClearBetweenLayers(ctx.edition);
    return {
      pairClass: 'betweenLayerSpacing', requiredClear: layer.minClear, reportable: true,
      refs: layer.refs, labelKey: 'detailing.pairClass.betweenLayerSpacing',
    };
  }

  const s = spacingFor(a, b, ctx);
  return {
    pairClass: sharesMember(a, b) ? 'sameLayerSpacing' : 'crossMemberSpacing',
    requiredClear: s.minClear,
    reportable: true,
    refs: s.refs,
    labelKey: sharesMember(a, b)
      ? 'detailing.pairClass.sameLayerSpacing'
      : 'detailing.pairClass.crossMemberSpacing',
  };
}
