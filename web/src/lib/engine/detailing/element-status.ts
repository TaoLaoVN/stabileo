/**
 * What the app is actually able to say about each member, in one word.
 *
 * ── Why this is its own module ─────────────────────────────────────
 *
 * Two halves of the answer live in two places that must not be merged. The SCENE knows
 * whether a member has steel in it, and it knows that because it is a projection of the
 * document — it reads nothing else and must keep reading nothing else. The DESIGN RUN knows
 * whether the member was verified, refused, or never reached, and that lives on an outcome
 * the document does not carry.
 *
 * Joining them inside the scene would make the projection depend on live design state.
 * Joining them inside a Svelte component would make the rule untestable and would let two
 * screens answer the same question differently. So the join happens here: pure, given both
 * halves explicitly, returning one status per element.
 *
 * ── Why "has steel" is not the whole answer ────────────────────────
 *
 * Because "no steel" has at least four different causes and they need different actions:
 *
 *   - the design was refused              → change the section, or design by hand
 *   - a required check is not implemented → nothing you do to the section will help
 *   - the member was never evaluated      → run the design
 *   - the member was designed but has no
 *     modellable geometry (a wall with no
 *     start/end, whose checks are real
 *     and whose bar schedule cannot exist) → supply the geometry
 *
 * A view that collapses those into "grey" is a view that cannot be acted on, and one that
 * omits them — which is what this app did before — is worse.
 *
 * Pure: no store, no runes, no i18n, no DOM.
 */

import type { SceneModel } from './scene-model';

/** The seven states the workspace distinguishes, worst last. */
export type ElementStatus =
  /** Designed, verified, and physical bars exist in the document. */
  | 'MODELLED'
  /** Verified, but no bar geometry was produced — the checks stand, the schedule cannot. */
  | 'DESIGNED_NOT_MODELLED'
  /**
   * Bars exist and are a PROPOSAL: the primary axis was designed and verified, the secondary
   * axis is not evaluated by any verifier in this app.
   *
   * Deliberately its own state and not a shade of MODELLED. The two look identical in a
   * viewport — concrete with steel inside it — and mean opposite things to somebody about to
   * issue a drawing, so they may never share a colour, a count or a filter.
   */
  | 'PROVISIONAL'
  /** A required check is not implemented for this member. No arrangement can pass. */
  | 'UNSUPPORTED'
  /** The design ran and could not find a passing arrangement. */
  | 'REFUSED'
  /** The verification ran and the member does not pass. */
  | 'FAILED'
  /** No design outcome exists for this member at all. */
  | 'NOT_EVALUATED';

/**
 * Ordered by how much the user needs to look at it, not alphabetically.
 *
 * The workspace lists and colours in this order, so the states that need attention are never
 * buried under the ones that do not.
 */
export const ELEMENT_STATUS_ORDER: readonly ElementStatus[] = [
  'FAILED', 'UNSUPPORTED', 'REFUSED', 'PROVISIONAL', 'DESIGNED_NOT_MODELLED',
  'NOT_EVALUATED', 'MODELLED',
];

/**
 * States whose members must never be presented as finished work.
 *
 * One list, consumed by the viewport legend, the drawing sheets, the schedule and the report,
 * so "not for construction" cannot be true on one projection and forgotten on another.
 */
export const NOT_FOR_CONSTRUCTION_STATUSES: readonly ElementStatus[] = [
  'FAILED', 'UNSUPPORTED', 'REFUSED', 'PROVISIONAL',
];

/** The half of the answer that comes from the design run, per element. */
export interface DesignOutcomeSummary {
  /** The outcome kind, verbatim. Absent means the member was never designed. */
  outcome?: 'VERIFIED' | 'PROVISIONAL_BIAXIAL' | 'SECTION_INADEQUATE'
    | 'DEMAND_UNAVAILABLE' | 'SEARCH_EXHAUSTED' | 'UNSUPPORTED';
  /**
   * Whether the member's provided reinforcement passes verification, when that ran.
   *
   * `none` and `notRun` both mean "no verdict" and are treated as such: only `fail` changes
   * the status, and it changes it to FAILED. Reading absence as a pass is how a member with
   * no verification comes to look verified.
   */
  verificationStatus?: 'ok' | 'warn' | 'fail' | 'notRun' | 'none';
  /** The constraints that stopped it, for the reason line. */
  limiting?: readonly string[];
  /**
   * Translation key of the design's own first reason, e.g. `design.reason.secondaryAxisUnchecked`.
   *
   * The KEY, not the sentence: 117 members refused for one shared cause must be recognisable
   * as one cause, and the rendered sentences differ from each other (they carry the member id
   * and its own ratio). Grouping on rendered text would produce 117 groups of one.
   */
  reasonKey?: string;
  /**
   * `secondaryRatio` from the design axes, when the run resolved them.
   *
   * Carried so a grouped reason can state the RANGE it covers. "117 members refused" invites
   * the suspicion that the threshold is being tripped by numerical noise; "between 11 % and
   * 266 % of the primary moment" answers that on sight, and answers it with the model's own
   * numbers rather than with reassurance.
   */
  secondaryRatio?: number;
}

export interface ElementStatusEntry {
  elementId: number;
  status: ElementStatus;
  /** True when the scene holds at least one bar owned by this element. */
  hasSteel: boolean;
  /** What the design run said, carried through unchanged. */
  outcome?: DesignOutcomeSummary['outcome'];
  limiting: readonly string[];
  /** The design's own reason key, carried through unchanged. */
  reasonKey?: string;
  /** Secondary/primary moment ratio, carried through unchanged. */
  secondaryRatio?: number;
}

/**
 * One cause, and every member it accounts for.
 *
 * ── Why the workspace needs this and not just counts ───────────────
 *
 * On the 7-storey example the design refuses 117 of the 119 beams, all for the SAME reason:
 * the verifier does not implement the biaxial check, and every one of those beams carries
 * real bending about both axes. The workspace already held that sentence — but only per
 * member, and only while that member was selected. So the screen said "UNSUPPORTED 117",
 * which reads as 117 separate problems, or as a broken viewer, and the user's next move was
 * to click 117 members to find out it was one problem all along.
 *
 * The distinction this makes possible is the one the whole investigation turned on: a
 * legitimate, uniform limitation of the biaxial design path is a very different report from
 * 117 members whose steel went missing somewhere between the design and the screen. Stating
 * the shared cause and the span of ratios behind it is what lets a reviewer tell them apart
 * without opening a single member.
 */
export interface StatusReasonGroup {
  status: ElementStatus;
  /** Translation key shared by every member in the group. */
  reasonKey: string;
  count: number;
  /** Ascending. The workspace uses these to isolate the group in the viewport. */
  elementIds: number[];
  /** Span of `secondaryRatio` across the group, when any member carried one. */
  ratioRange?: { min: number; max: number };
}

/**
 * Group a report's members by (state, reason), commonest first.
 *
 * Members whose outcome carried no reason are omitted rather than bucketed under a
 * placeholder: a group called "unknown" is not a cause and would dilute the ones that are.
 * They remain visible in the per-state counts, which are computed from every member.
 */
export function summariseStatusReasons(
  entries: readonly ElementStatusEntry[],
): StatusReasonGroup[] {
  const byKey = new Map<string, StatusReasonGroup>();
  for (const e of entries) {
    if (!e.reasonKey) continue;
    const k = `${e.status}::${e.reasonKey}`;
    let g = byKey.get(k);
    if (!g) {
      g = { status: e.status, reasonKey: e.reasonKey, count: 0, elementIds: [] };
      byKey.set(k, g);
    }
    g.count += 1;
    g.elementIds.push(e.elementId);
    if (typeof e.secondaryRatio === 'number') {
      g.ratioRange = g.ratioRange
        ? { min: Math.min(g.ratioRange.min, e.secondaryRatio), max: Math.max(g.ratioRange.max, e.secondaryRatio) }
        : { min: e.secondaryRatio, max: e.secondaryRatio };
    }
  }
  const groups = [...byKey.values()];
  for (const g of groups) g.elementIds.sort((a, b) => a - b);
  // Commonest first, then by state severity, then by key — a total order, so the panel does
  // not reshuffle between renders of the same model.
  return groups.sort((a, b) =>
    b.count - a.count
    || ELEMENT_STATUS_ORDER.indexOf(a.status) - ELEMENT_STATUS_ORDER.indexOf(b.status)
    || a.reasonKey.localeCompare(b.reasonKey));
}

/**
 * Decide one member's status.
 *
 * Deliberately pessimistic in the same way `documentReadiness` is: a member only reaches
 * MODELLED when BOTH halves agree — verified by the design AND carrying steel in the
 * document. Everything else names the specific gap rather than falling through to a generic
 * "not ready".
 */
export function statusOf(
  hasSteel: boolean, summary: DesignOutcomeSummary | undefined,
): ElementStatus {
  /**
   * A failing verification outranks everything below it.
   *
   * Checked first because a member can carry steel, have a VERIFIED design outcome from an
   * earlier run, and still fail verification now — an edit to the section or the loads does
   * exactly that. Reporting MODELLED there would show a green member the app knows is not.
   */
  if (summary?.verificationStatus === 'fail') return 'FAILED';

  if (!summary?.outcome) {
    /**
     * No outcome, but steel exists.
     *
     * Reachable for footing, slab and wall steel, which is produced by the floor design run
     * rather than by the member design run and therefore has no per-element outcome. Calling
     * that NOT_EVALUATED would be false — the family record and its certificate are the
     * evidence — so the presence of steel is taken at face value here and the family
     * certificate remains the authority on whether it may be built.
     */
    return hasSteel ? 'MODELLED' : 'NOT_EVALUATED';
  }

  switch (summary.outcome) {
    case 'PROVISIONAL_BIAXIAL':
      /**
       * A proposal with no bars is not a proposal.
       *
       * `proposeOnPrimaryAxis` only returns PROVISIONAL_BIAXIAL when the primary-axis search
       * verified something, so steel should always exist — but if it did not survive
       * detailing, saying PROVISIONAL over an empty member would claim geometry the user
       * cannot see. UNSUPPORTED is what that member actually is.
       */
      return hasSteel ? 'PROVISIONAL' : 'UNSUPPORTED';
    case 'UNSUPPORTED':
      return 'UNSUPPORTED';
    case 'SECTION_INADEQUATE':
    case 'SEARCH_EXHAUSTED':
      return 'REFUSED';
    case 'DEMAND_UNAVAILABLE':
      return 'NOT_EVALUATED';
    case 'VERIFIED':
      // Verified and no bars: the checks are real and the despiece does not exist. A wall
      // with no start/end reaches exactly this state, and the floor run says so out loud.
      return hasSteel ? 'MODELLED' : 'DESIGNED_NOT_MODELLED';
  }
}

export interface ElementStatusReport {
  entries: ElementStatusEntry[];
  /** How many members are in each state, in `ELEMENT_STATUS_ORDER`. */
  counts: Record<ElementStatus, number>;
  /** The states actually present, worst first — what a filter should offer. */
  present: ElementStatus[];
}

/**
 * Status for every member the scene draws.
 *
 * The scene's solids are the population, not the design outcomes: a member the design never
 * reached still has concrete on screen and still needs a state. Driving it the other way
 * would reintroduce the original bug, where the members without outcomes were the ones that
 * vanished.
 */
export function reportElementStatus(
  scene: SceneModel,
  outcomes: ReadonlyMap<number, DesignOutcomeSummary>,
): ElementStatusReport {
  const steelOf = new Set(scene.bars.flatMap((b) => b.elementIds));
  const seen = new Set<number>();
  const entries: ElementStatusEntry[] = [];

  for (const s of scene.solids) {
    for (const id of s.elementIds) {
      if (seen.has(id)) continue;
      seen.add(id);
      const summary = outcomes.get(id);
      const hasSteel = steelOf.has(id) || s.reinforced;
      entries.push({
        elementId: id,
        status: statusOf(hasSteel, summary),
        hasSteel,
        outcome: summary?.outcome,
        limiting: summary?.limiting ?? [],
        reasonKey: summary?.reasonKey,
        secondaryRatio: summary?.secondaryRatio,
      });
    }
  }
  entries.sort((a, b) => a.elementId - b.elementId);

  const counts = {
    MODELLED: 0, DESIGNED_NOT_MODELLED: 0, PROVISIONAL: 0, UNSUPPORTED: 0,
    REFUSED: 0, FAILED: 0, NOT_EVALUATED: 0,
  } as Record<ElementStatus, number>;
  for (const e of entries) counts[e.status] += 1;

  return {
    entries,
    counts,
    present: ELEMENT_STATUS_ORDER.filter((s) => counts[s] > 0),
  };
}
