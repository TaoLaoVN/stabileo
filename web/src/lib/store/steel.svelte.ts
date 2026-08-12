/**
 * The metallic surface's state, kept apart from the concrete one on purpose.
 *
 * ── Why a separate store ───────────────────────────────────────────
 *
 * `verificationStore` holds the concrete pipeline's state: contexts, outcomes, the
 * code-check baseline, and the revision counters that decide when any of it is stale. Steel
 * has none of those things — no contexts, no outcomes, no baseline, because no metallic
 * authority exists to produce them — and putting a metallic slice inside it would mean
 * every consumer of `providedSummary`, `getDisplayStatus` and `hasResults` acquiring a
 * second material to reason about.
 *
 * Separate is also what was asked for: the states of steel and concrete stay separate.
 *
 * And practically: PR #125 is rewriting `verification.svelte.ts`. A new file collides with
 * nothing.
 *
 * ── It derives, it does not accumulate ─────────────────────────────
 *
 * There is nothing to cache. The inventory is a pure function of the model plus two
 * booleans, and it costs one pass over the elements — cheaper than the invalidation logic
 * that keeping a copy in sync would need. So this store holds no `$state` of its own beyond
 * the model version it reads, and cannot go stale.
 */

import { modelStore } from './model.svelte';
import { resultsStore } from './results.svelte';
import { regulationsStore } from './regulations.svelte';
import {
  buildSteelInventory, countByKind, totalSteelLength,
  type InventoryModel, type SteelInventory,
} from '../engine/steel/steel-inventory';
import { CIRSOC301_CAPABILITIES, STEEL_CAPABILITY_KEYS } from '../engine/design/adapters/cirsoc301-capabilities';
import { explainUnsupported, type UnsupportedNotice } from '../codes/capability';

function inventoryModel(): InventoryModel {
  return {
    nodes: modelStore.nodes as never,
    elements: modelStore.elements as never,
    sections: modelStore.sections as never,
    materials: modelStore.materials as never,
  };
}

function createSteelStore() {
  /**
   * Whether the project has bound a metallic design code AND it can produce something.
   *
   * Two separate questions, and only the second one gates a result. CIRSOC 301 is bindable
   * and experimental, so `binding('steel').adapterId` can be set while `roleUsable` is
   * false — which is exactly the state a steel project should be able to be in: the code is
   * declared, and the app still computes nothing under it.
   */
  function authorityBound(): boolean {
    return regulationsStore.usable('steel');
  }

  function steelDeclared(): boolean {
    return regulationsStore.binding('steel').adapterId !== null;
  }

  const inventory = $derived.by((): SteelInventory => {
    void modelStore.modelVersion;
    return buildSteelInventory(inventoryModel(), {
      hasDemands: resultsStore.results3D !== null && resultsStore.hasCombinations3D,
      authorityBound: authorityBound(),
      // PR #132's grade catalogue is not on this branch. When it lands, this is the one
      // call site that changes: pass `(id) => gradeById(id)?.family ?? null` mapped onto
      // `StructuralMaterialFamily`, and every inference in the app becomes a declaration.
      lookupGrade: undefined,
    });
  });

  return {
    get inventory() { return inventory; },
    get members() { return inventory.members; },
    get census() { return inventory.census; },
    get notices() { return inventory.notices; },
    get isEmpty() { return inventory.members.length === 0; },
    get emptyReason() { return inventory.emptyReason; },
    get anyInferred() { return inventory.anyInferred; },
    get countByKind() { return countByKind(inventory); },
    get totalLengthM() { return totalSteelLength(inventory); },

    /** True when the project names a metallic code at all, usable or not. */
    get steelCodeDeclared() { return steelDeclared(); },
    /** True when that code can actually produce a result. False everywhere today. */
    get steelCodeUsable() { return authorityBound(); },

    /**
     * What the bound metallic code cannot do, ready to render.
     *
     * Asked of the capability matrix rather than hardcoded in the panel, so the day an
     * adapter supports something the list shortens by itself.
     */
    get capabilityGaps(): UnsupportedNotice[] {
      const out: UnsupportedNotice[] = [];
      for (const key of STEEL_CAPABILITY_KEYS) {
        const notice = explainUnsupported(CIRSOC301_CAPABILITIES, key, ['verify']);
        if (notice) out.push(notice);
      }
      return out;
    },
  };
}

export const steelStore = createSteelStore();
