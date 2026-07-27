/**
 * The CONSTRUCTIBLE gate.
 *
 * ── What went wrong ────────────────────────────────────────────────
 *
 * The coordination search reported `CONSTRUCTIBLE` when it found a complete assignment.
 * On the flagship that label sat on top of 7,246 prohibited physical overlaps, no
 * re-verification after the geometry moved, no placement-robustness check, and no
 * consumption of the lap geometry by anything downstream.
 *
 * The search was not lying about what it knew. It reasons about joint threading and
 * collinear transitions, it found an assignment, and that is a real result. The defect was
 * that "an assignment exists" and "this can be built" were the same word. They are
 * different claims with different evidence and different consequences: the first is an
 * intermediate search outcome, the second is a statement to an engineer who will pour
 * concrete against it.
 *
 * So the search now says `ASSIGNMENT_FOUND`, and constructibility is decided HERE, on the
 * materialised geometry, against twelve conditions that must ALL hold.
 *
 * ── Why it is data, not a boolean ──────────────────────────────────
 *
 * Every condition is reported with its own evidence, whether it passed or failed. A gate
 * that returns false and nothing else is a gate nobody can argue with, and the engineer
 * has to be able to see which of the twelve is blocking and by how much. A single failing
 * condition is enough to withhold the claim — and it must be NAMED, not summarised.
 *
 * Pure: no store, no runes, no i18n.
 */

import { msg, round, type EngineMessage } from '../../codes/message';

/** The twelve conditions, in the order they are evaluated and reported. */
export const CONSTRUCTIBILITY_CONDITIONS = [
  'completeEnvelope',
  'searchNotTruncated',
  'allMembersAssigned',
  'allTransitionsMaterialised',
  'noUnmaterialisedTransitions',
  'noProhibitedConflicts',
  'allMembersReverified',
  'certificatesMatchGeometry',
  'allSpacingCodeLegal',
  'allSpacingPlacementRobust',
  'noUnsupportedRule',
  'noStaleUpstreamRevision',
] as const;

export type ConstructibilityCondition = (typeof CONSTRUCTIBILITY_CONDITIONS)[number];

export interface ConditionResult {
  condition: ConstructibilityCondition;
  passed: boolean;
  /** How many items failed this condition. Zero when it passed. */
  failing: number;
  /** Translated at the boundary. States the measurement, not a verdict. */
  detail: EngineMessage;
}

/**
 * Everything the gate needs, measured from the materialised model.
 *
 * Deliberately all raw counts and flags rather than pre-digested booleans: a caller that
 * can pass `noProhibitedConflicts: true` can pass it wrongly, and the whole point of this
 * module is that the claim is checkable.
 */
export interface ConstructibilityFacts {
  /** Did the search cover the complete supported envelope (beams AND columns)? */
  completeEnvelope: boolean;
  /** Did any bound stop the search? */
  searchTruncated: boolean;
  /** Applicable members, and how many the search assigned a layout to. */
  applicableMembers: number;
  assignedMembers: number;
  /** Transitions the search selected, and how many produced real geometry. */
  selectedTransitions: number;
  materialisedTransitions: number;
  /** Transitions the search selected that the geometry could not build. */
  unmaterialisedTransitions: number;
  /** Physical bar-surface interpenetrations that remain unresolved. */
  prohibitedConflicts: number;
  /** Members whose final geometry was passed back through the authoritative verifier. */
  reverifiedMembers: number;
  /**
   * Members whose certificate hash matches the hash of the rebar actually in the model.
   *
   * A certificate issued against a layout that was later moved is worse than no
   * certificate: it is a correct-looking claim about geometry that no longer exists.
   */
  certificateHashMatches: number;
  /** Spacing assessments that failed the code minimum. */
  spacingNotCodeLegal: number;
  /** Spacing assessments that pass the code but not the project's placement margin. */
  spacingNotPlacementRobust: number;
  /** Rules the engine cannot represent and that apply to this model. */
  unsupportedRules: number;
  /** Assemblies whose upstream demand revision has moved on. */
  staleAssemblies: number;
}

export type ConstructibilityVerdict = 'CONSTRUCTIBLE' | 'CONFLICTED' | 'NOT_ESTABLISHED';

export interface ConstructibilityAssessment {
  verdict: ConstructibilityVerdict;
  conditions: ConditionResult[];
  /** The conditions that failed, in evaluation order. Empty iff CONSTRUCTIBLE. */
  blocking: ConstructibilityCondition[];
  summary: EngineMessage;
}

function cond(
  condition: ConstructibilityCondition, passed: boolean, failing: number,
  detail: EngineMessage,
): ConditionResult {
  return { condition, passed, failing, detail };
}

/**
 * Decide whether this detailing may be called constructible.
 *
 * All twelve or none. There is no partial credit and no "mostly": an engineer reading
 * CONSTRUCTIBLE is entitled to assume every one of these was checked.
 *
 * The distinction between the two failure verdicts is about what the engineer does next.
 * `CONFLICTED` means the geometry is wrong and there is something to fix. `NOT_ESTABLISHED`
 * means the geometry may well be fine but the work of proving it has not been done — an
 * unverified model is not a failing model, and reporting it as one sends the engineer
 * hunting for a defect that does not exist.
 */
export function assessConstructibility(f: ConstructibilityFacts): ConstructibilityAssessment {
  const conditions: ConditionResult[] = [
    cond('completeEnvelope', f.completeEnvelope, f.completeEnvelope ? 0 : 1,
      msg('detailing.constructible.envelope', {
        complete: f.completeEnvelope ? 1 : 0,
      })),
    cond('searchNotTruncated', !f.searchTruncated, f.searchTruncated ? 1 : 0,
      msg('detailing.constructible.truncated', { truncated: f.searchTruncated ? 1 : 0 })),
    cond('allMembersAssigned', f.assignedMembers >= f.applicableMembers,
      Math.max(0, f.applicableMembers - f.assignedMembers),
      msg('detailing.constructible.assigned', {
        assigned: f.assignedMembers, total: f.applicableMembers,
      })),
    cond('allTransitionsMaterialised',
      f.materialisedTransitions >= f.selectedTransitions,
      Math.max(0, f.selectedTransitions - f.materialisedTransitions),
      msg('detailing.constructible.materialised', {
        built: f.materialisedTransitions, selected: f.selectedTransitions,
      })),
    cond('noUnmaterialisedTransitions', f.unmaterialisedTransitions === 0,
      f.unmaterialisedTransitions,
      msg('detailing.constructible.unmaterialised', { n: f.unmaterialisedTransitions })),
    cond('noProhibitedConflicts', f.prohibitedConflicts === 0, f.prohibitedConflicts,
      msg('detailing.constructible.prohibited', { n: f.prohibitedConflicts })),
    cond('allMembersReverified', f.reverifiedMembers >= f.applicableMembers,
      Math.max(0, f.applicableMembers - f.reverifiedMembers),
      msg('detailing.constructible.reverified', {
        done: f.reverifiedMembers, total: f.applicableMembers,
      })),
    cond('certificatesMatchGeometry', f.certificateHashMatches >= f.applicableMembers,
      Math.max(0, f.applicableMembers - f.certificateHashMatches),
      msg('detailing.constructible.hashes', {
        matching: f.certificateHashMatches, total: f.applicableMembers,
      })),
    cond('allSpacingCodeLegal', f.spacingNotCodeLegal === 0, f.spacingNotCodeLegal,
      msg('detailing.constructible.codeLegal', { n: f.spacingNotCodeLegal })),
    cond('allSpacingPlacementRobust', f.spacingNotPlacementRobust === 0,
      f.spacingNotPlacementRobust,
      msg('detailing.constructible.placementRobust', { n: f.spacingNotPlacementRobust })),
    cond('noUnsupportedRule', f.unsupportedRules === 0, f.unsupportedRules,
      msg('detailing.constructible.unsupported', { n: f.unsupportedRules })),
    cond('noStaleUpstreamRevision', f.staleAssemblies === 0, f.staleAssemblies,
      msg('detailing.constructible.stale', { n: f.staleAssemblies })),
  ];

  const blocking = conditions.filter((c) => !c.passed).map((c) => c.condition);

  // A physical clash is a defect in the model. Everything else that blocks the gate is
  // work not yet done, and conflating the two sends the engineer looking for the wrong
  // thing entirely.
  const hasDefect = !conditions.find((c) => c.condition === 'noProhibitedConflicts')!.passed
    || !conditions.find((c) => c.condition === 'allSpacingCodeLegal')!.passed;

  const verdict: ConstructibilityVerdict = blocking.length === 0
    ? 'CONSTRUCTIBLE'
    : hasDefect ? 'CONFLICTED' : 'NOT_ESTABLISHED';

  return {
    verdict, conditions, blocking,
    summary: msg(
      verdict === 'CONSTRUCTIBLE'
        ? 'detailing.constructible.yes'
        : verdict === 'CONFLICTED'
          ? 'detailing.constructible.conflicted'
          : 'detailing.constructible.notEstablished',
      {
        passed: conditions.length - blocking.length,
        total: conditions.length,
        first: blocking.length > 0
          ? `detailing.constructible.cond.${blocking[0]}`
          : 'detailing.constructible.cond.none',
        conflicts: round(f.prohibitedConflicts, 0),
      },
    ),
  };
}

/**
 * The highest assembly state these facts can justify.
 *
 * The state ladder must never be climbed on an intermediate search result. A model with
 * thousands of interpenetrating bars is CONFLICTED whatever the search concluded, and this
 * is the single function that decides it.
 */
export function constructibilityState(
  a: ConstructibilityAssessment,
): 'COORDINATED' | 'CONSTRUCTIBLE' | 'CONFLICTED' {
  if (a.verdict === 'CONSTRUCTIBLE') return 'CONSTRUCTIBLE';
  if (a.verdict === 'CONFLICTED') return 'CONFLICTED';
  return 'COORDINATED';
}
