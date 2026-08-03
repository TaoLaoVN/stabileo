/**
 * edu-store.svelte.ts — Educational mode state.
 *
 * Centralises all edu-specific state (current exercise, answers,
 * verification, step completion) so it lives outside the shared stores
 * and can evolve independently of Basic / PRO modes.
 */

import type { EduExercise } from './exercises';
import type { AnalysisResults } from '../../lib/engine/types';

// ─── Types ─────────────────────────────────────────────────────────
export type VerifState = 'pending' | 'correct' | 'incorrect';
export type ReactionAnswer = Record<string, string>;

// ─── Singleton state ───────────────────────────────────────────────

let currentExercise = $state<EduExercise | null>(null);
let exerciseKey = $state(0);

/** Internal copy of solver results — edu owns its own reference */
let solvedResults = $state<AnalysisResults | null>(null);

/**
 * Node ids of the current exercise's model, in `addNode()` call order.
 *
 * `EduExercise.supports[].nodeIndex` indexes this array. Exercises are
 * authored against their own construction order while the model store assigns
 * ids from a counter shared with whatever was loaded before, so the two only
 * coincide by luck. Recorded by `EducativePanel` as it runs `exercise.build()`.
 */
let nodeIdsByIndex = $state<number[]>([]);

// ─── Public API ────────────────────────────────────────────────────

export const eduStore = {
  // ── Exercise lifecycle ────────────────────────────────────────
  get exercise() { return currentExercise; },
  get exerciseKey() { return exerciseKey; },

  get results() { return solvedResults; },
  set results(r: AnalysisResults | null) { solvedResults = r; },

  /** Node ids of the built model in `addNode()` order — see `nodeIdsByIndex`. */
  get nodeIdsByIndex(): readonly number[] { return nodeIdsByIndex; },

  loadExercise(ex: EduExercise, builtNodeIds: readonly number[] = []) {
    currentExercise = ex;
    exerciseKey++;
    solvedResults = null;
    nodeIdsByIndex = [...builtNodeIds];
  },

  clearExercise() {
    currentExercise = null;
    solvedResults = null;
    nodeIdsByIndex = [];
  },

  get hasExercise() { return currentExercise !== null; },
};
