/**
 * Project regulations store.
 *
 * Owns the role bindings, the revision vector, and the pending/applied transition that
 * makes "changing a load regulation must not silently relabel existing loads" enforceable
 * rather than aspirational.
 *
 * ── The transition ─────────────────────────────────────────────
 *
 * `choose()` stages a change as PENDING. Nothing downstream moves. The UI can then ask
 * `pendingConsequence()` what applying it would cost, show that to the user, and call
 * either `applyPending()` or `cancelPending()`.
 *
 * A load-affecting role never applies from the Design surface at all: `requestChange()`
 * returns a navigation intent so the Design panel can send the user to Loads, where the
 * before/after preview lives. The Design surface asks; Loads decides.
 *
 * Design-only roles (concrete, steel, …) apply in place, because the forces do not move
 * and there is nothing to preview.
 */

import { modelStore } from './model.svelte';
import {
  REGULATIONS_SCHEMA_VERSION, bindRole, defaultRegulations, findOption, isLoadAffecting,
  pendingRequiresLoadRegeneration, pendingRoles, regulationStamps, roleUsable,
  validateStack, type ProjectRegulations, type RegulationRole, type RoleBinding,
  type StackProblem, type StoredRegulations,
} from '../codes/roles';
import {
  applyChange, emptyRevisions, freshness, stamp,
  type ChangeKind, type ChangeConsequence, type RevisionStage, type RevisionVector,
  type StageStamp,
} from '../codes/revisions';

/** What the caller should do after `requestChange`. */
export type ChangeRequest =
  /** Applied immediately; nothing to preview. */
  | { kind: 'applied'; consequence: ChangeConsequence }
  /**
   * Staged as pending. The user must review it in Loads, because it changes what the
   * generated loads are and the before/after preview lives there.
   */
  | { kind: 'needsLoadReview'; role: RegulationRole; navigateTo: 'loads' }
  /** Refused, with the reason. */
  | { kind: 'refused'; problems: StackProblem[] };

function createRegulationsStore() {
  /** Set when a load-affecting change is staged, so the UI can show the banner. */
  let reviewRequested = $state<RegulationRole | null>(null);

  const stored = $derived<StoredRegulations>(
    modelStore.model.regulations
    ?? { version: REGULATIONS_SCHEMA_VERSION, roles: defaultRegulations() },
  );
  const roles = $derived<ProjectRegulations>(stored.roles);
  const revisions = $derived<RevisionVector>(modelStore.model.revisions ?? emptyRevisions());
  const validation = $derived(validateStack(roles));

  function writeRoles(next: ProjectRegulations): void {
    modelStore.model.regulations = { version: REGULATIONS_SCHEMA_VERSION, roles: next };
  }
  function writeRevisions(next: RevisionVector): void {
    modelStore.model.revisions = next;
  }

  return {
    get roles() { return roles; },
    get revisions() { return revisions; },
    get validation() { return validation; },
    get stamps() { return regulationStamps(roles); },
    get pending() { return pendingRoles(roles); },
    get pendingNeedsLoadRegeneration() { return pendingRequiresLoadRegeneration(roles); },
    get reviewRequested() { return reviewRequested; },

    binding(role: RegulationRole): RoleBinding { return roles[role]; },
    usable(role: RegulationRole): boolean { return roleUsable(roles, role); },

    /** Is a stamped output still valid? */
    fresh(s: StageStamp | null | undefined) { return freshness(s, revisions); },
    /** Stamp an output with the revisions it was produced against. */
    stampFor(stage: RevisionStage): StageStamp { return stamp(stage, revisions); },

    /**
     * Stage a role change WITHOUT applying it.
     *
     * Returns what the caller must do next. A load-affecting change is never applied from
     * here — the user has to see the before/after in Loads first.
     */
    requestChange(role: RegulationRole, adapterId: string): ChangeRequest {
      const opt = findOption(adapterId);
      if (!opt || opt.role !== role) {
        return { kind: 'refused', problems: [{
          severity: 'error', roles: [role],
          key: 'regulations.problem.unknownAdapter', params: { adapter: adapterId },
        }] };
      }

      const previous = roles[role];
      const next: ProjectRegulations = {
        ...roles,
        [role]: {
          ...bindRole(role, adapterId, {
            jurisdiction: previous.jurisdiction,
            adoption: previous.adoption,
            settings: previous.settings,
          }),
          state: 'pending',
        },
      };

      const v = validateStack(next);
      const blocking = v.problems.filter(
        (p) => p.severity === 'error' && p.roles.includes(role));
      if (blocking.length > 0) {
        return { kind: 'refused', problems: blocking };
      }

      writeRoles(next);

      if (isLoadAffecting(role)) {
        reviewRequested = role;
        return { kind: 'needsLoadReview', role, navigateTo: 'loads' };
      }

      // Design-only: the forces do not move, so apply in place.
      return { kind: 'applied', consequence: this.applyPending('designRegulation') };
    },

    /** What applying the staged change would cost. */
    pendingConsequence(): ChangeKind | null {
      const p = pendingRoles(roles);
      if (p.length === 0) return null;
      return p.some(isLoadAffecting) ? 'loadRegulation' : 'designRegulation';
    },

    /**
     * Commit every pending binding and invalidate exactly what the change kind says.
     *
     * `kind` is supplied by the caller because only it knows whether the loads were
     * actually regenerated — applying a load-regulation change without regenerating would
     * leave the model's loads inconsistent with its stated regulation.
     */
    applyPending(kind: ChangeKind): ChangeConsequence {
      const next = { ...roles };
      const rev = revisions;
      for (const role of pendingRoles(roles)) {
        next[role] = { ...next[role], state: 'applied', appliedAtRevision: rev.regulationConfig + 1 };
      }
      writeRoles(next);
      const { revisions: bumped, consequence } = applyChange(rev, kind);
      writeRevisions(bumped);
      reviewRequested = null;
      return consequence;
    },

    /** Discard staged bindings and leave the applied stack untouched. */
    cancelPending(): void {
      const next = { ...roles };
      for (const role of pendingRoles(roles)) {
        const prevId = next[role].appliedAtRevision !== null ? next[role].adapterId : null;
        next[role] = prevId
          ? { ...next[role], state: 'applied' }
          : { ...next[role], state: 'unset', adapterId: null, displayName: '', edition: '' };
      }
      writeRoles(next);
      reviewRequested = null;
    },

    /** Update role-specific settings. Marks the binding complete when told to. */
    configureRole(
      role: RegulationRole, settings: Record<string, unknown>, complete: boolean,
    ): void {
      writeRoles({
        ...roles,
        [role]: { ...roles[role], settings: { ...roles[role].settings, ...settings }, configComplete: complete },
      });
    },

    setJurisdiction(role: RegulationRole, jurisdiction: string, adoption: RoleBinding['adoption']): void {
      writeRoles({ ...roles, [role]: { ...roles[role], jurisdiction, adoption } });
    },

    /** Apply the same jurisdiction to every bound role — the usual case. */
    setJurisdictionForAll(jurisdiction: string, adoption: RoleBinding['adoption']): void {
      const next = { ...roles };
      for (const role of Object.keys(next) as RegulationRole[]) {
        if (next[role].adapterId) next[role] = { ...next[role], jurisdiction, adoption };
      }
      writeRoles(next);
    },

    /** Record a non-regulation change and invalidate accordingly. */
    noteChange(kind: ChangeKind): ChangeConsequence {
      const { revisions: bumped, consequence } = applyChange(revisions, kind);
      writeRevisions(bumped);
      return consequence;
    },

    clearReviewRequest(): void { reviewRequested = null; },
  };
}

export const regulationsStore = createRegulationsStore();
