import { modelStore } from './model.svelte';
import { uiStore } from './ui.svelte';
import { resultsStore } from './results.svelte';
import { historyStore } from './history.svelte';
import { dsmStepsStore } from './dsmSteps.svelte';
import { tabManager } from './tabs.svelte';
import { tourStore } from './tour.svelte';
import { verificationStore } from './verification.svelte';
import { shouldProjectModelToXZ } from '../geometry/coordinate-system';
// Registering the design-code adapters at store-wiring time guarantees the registry
// is populated before any component queries it. Importing for side effects only.
import '../engine/design/adapters/cirsoc201-adapter';
import '../engine/design/adapters/unsupported-adapter';

// Wire model mutations to automatically clear stale results.
// This ensures results never persist after the model changes,
// regardless of whether liveCalc is ON or OFF.
//
// UNCONDITIONAL by design: the previous `if (hasAnyResults || hasResults)` guard was
// a micro-optimisation that made the analysis-revision counter conditional, which
// would let a mutation silently fail to advance it and leave a stale result reading
// as current.
modelStore._setOnMutation(() => {
  resultsStore.clear();
  verificationStore.invalidateAnalysis();
});

// A reinforcement transaction is NOT a model mutation: forces are unaffected, so
// results and retained demand data survive. Only the affected elements' cached
// provided-reinforcement verification is dropped, so they re-verify immediately from
// the retained demand with zero structural solves.
modelStore._setOnReinforcementCommit((written) => {
  verificationStore.invalidateElements(written);
});

// Every fresh-solve results publish (setResults3D / setCombinationResults3D) — even
// a plain re-solve with no structural mutation (a self-weight or axis-convention
// toggle) — advances the solve-generation counter. Retained MemberContexts are
// stamped with this at build time, so a re-solve that does NOT rebuild them (as
// live-calc.ts's auto-solve does) makes their display read 'stale' instead of
// silently presenting numbers computed from the superseded forces as current.
resultsStore._setOnResultsPublish(() => {
  verificationStore.bumpSolveGeneration();
});

// Let verificationStore read the current provided reinforcement without importing
// modelStore (which would create a circular dependency).
verificationStore._setReinforcementProvider(
  (elementId) => modelStore.elements.get(elementId)?.reinforcement,
);

// Let uiStore ask modelStore whether the current model is flat 2D, without
// importing modelStore directly (which would create a circular dependency).
uiStore._setModelFlatnessProvider(() => shouldProjectModelToXZ({
  nodes: modelStore.nodes.values(),
  supports: modelStore.supports.values(),
  loads: modelStore.loads,
  plateCount: modelStore.plates.size,
  quadCount: modelStore.quads.size,
}));

export { modelStore, uiStore, resultsStore, historyStore, dsmStepsStore, tabManager, tourStore, verificationStore };
