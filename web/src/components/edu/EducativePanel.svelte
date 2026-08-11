<script lang="ts">
  import { modelStore, resultsStore, uiStore } from '../../lib/store';
  import { getExerciseSections, type EduExercise } from './exercises';
  import EduExerciseView from './EduExerciseView.svelte';
  import { t } from '../../lib/i18n';
  import { solveForEdu } from './edu-solver';
  import { eduStore } from './edu-store.svelte';
  import ExerciseAuthor from './ExerciseAuthor.svelte';
  import { buildFromSpec, evaluateAnswer, type EduExerciseSpec } from './exercise-spec';
  import { stressContext } from './exercise-stress';
  import { loadLibrary, removeFromLibrary, saveToLibrary, fromShareLink } from './exercise-library';

  /** Teacher-authored exercises, restored from the library on mount.
   *  `authoring` lives in the store because the shell mounts the drawing
   *  tools off it — see edu-store. */
  let editingSpec = $state<EduExerciseSpec | null>(null);
  /** The draft a teacher is looking at as a student — going back returns to
   *  the form with the same draft, not to the exercise list. */
  let previewingSpec = $state<EduExerciseSpec | null>(null);
  let library = $state<EduExerciseSpec[]>([]);
  let linkNotice = $state('');

  $effect(() => {
    library = loadLibrary();
    /*
     * A link hands over ONE exercise, so it opens it.
     *
     * It used to drop the exercise into the library and leave the student on
     * the list, looking for the thing they had just been sent among a dozen
     * built-in ones. The link is the teacher saying "solve this"; the window
     * says the same from the first frame, and `markHandout` is what tells the
     * rest of the shell that this is a student's workspace and not a browsing
     * session.
     */
    const shared = fromShareLink(location.hash);
    if (shared) {
      if (shared.ok) {
        const { library: next } = saveToLibrary(shared.exercise);
        library = next;
        history.replaceState(null, '', location.pathname + location.search);
        eduStore.markHandout();
        loadExercise(specToExercise(shared.exercise));
      } else {
        linkNotice = shared.error;
      }
    }
  });

  const customExercises = $derived(library.map(specToExercise));

  function handleAuthored(spec: EduExerciseSpec) {
    const { library: next } = saveToLibrary(spec);
    library = next;
    eduStore.authoring = false;
    editingSpec = null;
  }

  function editExercise(spec: EduExerciseSpec) {
    editingSpec = spec;
    eduStore.authoring = true;
  }

  function deleteExercise(id: string) {
    library = removeFromLibrary(id);
  }

  /** Adapt an authored spec to the shape the exercise view consumes. */
  function specToExercise(spec: EduExerciseSpec): EduExercise {
    return {
      id: spec.id,
      title: spec.title,
      description: spec.description,
      difficulty: spec.difficulty,
      category: spec.category,
      solverType: spec.solverType,
      build: (api) => buildFromSpec(spec.model, api),
      supports: spec.supports,
      // The stress resolver is built once per exercise, not per question: it
      // meshes and solves the section, which is far too costly to repeat.
      characteristics: spec.characteristics.map((c) => ({
        label: c.label, unit: c.unit,
        getCorrect: (f) => evaluateAnswer(c.answer, f, stressContext(spec.model.profile, spec.model.fy)) ?? 0,
      })),
      diagramQuestions: spec.diagramQuestions.map((q) => ({
        question: q.question, unit: q.unit,
        getCorrect: (f) => evaluateAnswer(q.answer, f, stressContext(spec.model.profile, spec.model.fy)) ?? 0,
      })),
      kinematicQuestion: spec.kinematicQuestion,
      diagramShapeQuestions: spec.diagramShapeQuestions,
      sectionData: spec.sectionData,
    };
  }

  const sections = $derived(getExerciseSections());

  // No listener registration here any more: `live-calc.runGlobalSolve()` calls
  // `solveForEdu()` directly in edu mode, so a solve dispatched before this
  // panel mounts is no longer silently dropped.

  function loadExercise(ex: EduExercise) {
    modelStore.clear();
    resultsStore.clear();

    // Build the exercise structure via the shared model store.
    // Node ids are recorded in call order: `supports[].nodeIndex` indexes this
    // array, not the model's ids (the store's id counter is shared with
    // whatever was loaded before this exercise).
    const builtNodeIds: number[] = [];
    ex.build({
      addNode: (x, y) => {
        const id = modelStore.addNode(x, y);
        builtNodeIds.push(id);
        return id;
      },
      addElement: (nI, nJ) => modelStore.addElement(nI, nJ),
      addSupport: (nodeId, type) => modelStore.addSupport(nodeId, type),
      addNodalLoad: (nodeId, fx, fy, mz) => modelStore.addNodalLoad(nodeId, fx, fy, mz ?? 0),
      addDistributedLoad: (elementId, qI, qJ) => modelStore.addDistributedLoad(elementId, qI, qJ),
    });

    // Track in edu store
    eduStore.loadExercise(ex, builtNodeIds);

    // Solve internally (results stored but hidden from viewport)
    setTimeout(() => solveForEdu(), 100);

    // Zoom to fit
    setTimeout(() => {
      const canvas = document.querySelector('.viewport-container canvas') as HTMLCanvasElement | null;
      if (canvas && modelStore.nodes.size > 0) {
        uiStore.zoomToFit(modelStore.nodes.values(), canvas.width, canvas.height);
      }
    }, 150);
  }

  /** Open a draft the way a student will get it, without saving it first. */
  function previewAsStudent(spec: EduExerciseSpec) {
    previewingSpec = spec;
    editingSpec = spec;
    eduStore.authoring = false;
    loadExercise(specToExercise(spec));
  }

  function goBack() {
    eduStore.clearExercise();
    // Coming back from a preview returns to the form that opened it.
    if (previewingSpec) {
      previewingSpec = null;
      eduStore.authoring = true;
      modelStore.clear();
      resultsStore.clear();
      return;
    }
    // Leaving the exercise ends the handout: from here the window is a normal
    // Education session again, with the list and the mode switcher back.
    eduStore.markBrowsing();
    modelStore.clear();
    resultsStore.clear();
  }
</script>

<div class="edu-panel">
  {#if eduStore.authoring}
    <ExerciseAuthor
      onclose={() => { eduStore.authoring = false; editingSpec = null; }}
      onsaved={handleAuthored}
      onpreview={previewAsStudent}
      editing={editingSpec}
    />
  {:else if !eduStore.hasExercise}
    <div class="edu-welcome">
      <h2>{t('edu.title')}</h2>
      <p class="edu-subtitle">{t('edu.subtitle')}</p>

      {#each sections as section}
        {#if section.exercises.length > 0}
          <div class="exercise-section">
            <h3 class="section-title">{section.title}</h3>
            <div class="exercise-list">
              {#each section.exercises as ex}
                <button class="exercise-card" onclick={() => loadExercise(ex)}>
                  <div class="exercise-header">
                    <span class="exercise-title">{ex.title}</span>
                    <span class="difficulty difficulty-{ex.difficulty}">
                      {t('edu.' + ex.difficulty)}
                    </span>
                  </div>
                  <p class="exercise-desc">{ex.description}</p>
                </button>
              {/each}
            </div>
          </div>
        {/if}
      {/each}

      {#if linkNotice}
        <p class="edu-link-notice">{linkNotice}</p>
      {/if}

      {#if library.length > 0}
        <div class="exercise-section">
          <h3 class="section-title">{t('edu.author.mine')}</h3>
          <div class="exercise-list">
            {#each library as spec, i}
              <div class="exercise-card-wrap">
                <button class="exercise-card" onclick={() => loadExercise(customExercises[i])}>
                  <div class="exercise-header">
                    <span class="exercise-title">{spec.title}</span>
                    <span class="difficulty difficulty-{spec.difficulty}">{t('edu.' + spec.difficulty)}</span>
                  </div>
                  <p class="exercise-desc">{spec.description}</p>
                </button>
                <div class="card-actions">
                  <button class="card-act" onclick={() => editExercise(spec)}>{t('edu.author.edit')}</button>
                  <button class="card-act del" onclick={() => deleteExercise(spec.id)}>{t('edu.author.delete')}</button>
                </div>
              </div>
            {/each}
          </div>
        </div>
      {/if}

      <div class="edu-footer">
        <p>{t('edu.moreExercises')}</p>
        <!-- Authoring lives beside the exercise list, not behind a setting:
             a teacher looking for "how do I make one of these" looks here. -->
        <button class="edu-author-btn" onclick={() => (eduStore.authoring = true)}>
          {t('edu.author.open')}
        </button>
      </div>
    </div>
  {:else}
    <div class="edu-exercise-container">
      <div class="edu-topbar">
        <button class="edu-back-btn" onclick={goBack}>
          {t('edu.back')}
        </button>
        <span class="edu-exercise-name">{eduStore.exercise!.title}</span>
      </div>

      {#key eduStore.exerciseKey}
        <EduExerciseView exercise={eduStore.exercise!} />
      {/key}
    </div>
  {/if}
</div>

<style>
  .edu-panel {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: #16213e;
    color: #ddd;
    overflow-y: auto;
  }

  .edu-welcome {
    padding: 24px 20px;
  }

  .edu-welcome h2 {
    font-size: 1.3rem;
    color: #4ecdc4;
    margin: 0 0 4px;
  }

  .edu-subtitle {
    font-size: 0.82rem;
    color: #888;
    margin: 0 0 20px;
  }

  .exercise-section {
    margin-bottom: 20px;
  }

  .section-title {
    font-size: 0.82rem;
    font-weight: 600;
    color: #4ecdc4;
    margin: 0 0 10px;
    padding-bottom: 6px;
    border-bottom: 1px solid #1a3a5a;
    text-transform: uppercase;
    letter-spacing: 0.03em;
  }

  .exercise-list {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .exercise-card {
    text-align: left;
    background: #0f2840;
    border: 1px solid #1a4a7a;
    border-radius: 8px;
    padding: 14px 16px;
    cursor: pointer;
    transition: all 0.15s;
  }

  .exercise-card:hover {
    background: #1a3860;
    border-color: #4ecdc4;
  }

  .exercise-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 6px;
  }

  .exercise-title {
    font-size: 0.85rem;
    font-weight: 600;
    color: #eee;
  }

  .difficulty {
    font-size: 0.65rem;
    font-weight: 600;
    padding: 2px 8px;
    border-radius: 10px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .difficulty-easy {
    background: #1a3a2a;
    color: #4caf50;
  }

  .difficulty-medium {
    background: #3a3a1a;
    color: #f0a500;
  }

  .difficulty-hard {
    background: #3a1a1a;
    color: #e94560;
  }

  .exercise-desc {
    font-size: 0.75rem;
    color: #999;
    margin: 0;
    line-height: 1.4;
  }

  .exercise-card-wrap { position: relative; }
  .card-actions {
    display: flex; gap: 6px; justify-content: flex-end;
    margin: -4px 4px 6px 0;
  }
  .card-act {
    background: none; border: none; color: #777;
    font-size: 0.66rem; cursor: pointer; padding: 2px 4px;
  }
  .card-act:hover { color: #4ecdc4; }
  .card-act.del:hover { color: #c66; }
  .edu-link-notice {
    background: rgba(78,205,196,0.08); border-left: 2px solid #4ecdc4;
    padding: 6px 9px; color: #9fbfbc; font-size: 0.72rem; border-radius: 3px;
  }

  .edu-author-btn {
    background: none; border: 1px solid #4ecdc4; color: #4ecdc4;
    padding: 5px 14px; border-radius: 3px; cursor: pointer;
    font-size: 0.78rem; margin-top: 8px;
  }
  .edu-author-btn:hover { background: rgba(78,205,196,0.1); }

  .edu-footer {
    margin-top: 24px;
    padding: 10px 16px;
  }

  .edu-footer p {
    font-size: 0.68rem;
    color: #555;
    margin: 0;
    text-align: center;
    font-style: italic;
  }

  .edu-exercise-container {
    display: flex;
    flex-direction: column;
    height: 100%;
  }

  .edu-topbar {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 12px;
    background: #0a1a30;
    border-bottom: 1px solid #1a4a7a;
    flex-shrink: 0;
  }

  .edu-back-btn {
    background: none;
    border: 1px solid #334;
    color: #888;
    padding: 4px 10px;
    border-radius: 4px;
    font-size: 0.72rem;
    cursor: pointer;
    transition: all 0.15s;
  }

  .edu-back-btn:hover {
    color: #4ecdc4;
    border-color: #4ecdc4;
  }

  .edu-exercise-name {
    font-size: 0.75rem;
    font-weight: 500;
    color: #aaa;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
