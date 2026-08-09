<script lang="ts">
  /**
   * Authoring an exercise from inside Stabileo.
   *
   * A teacher draws the structure with the tools that already exist, then says
   * here what to ask about it. Nothing is typed into a file and nothing is
   * written in a programming language.
   *
   * The structure gets no editor in this panel on purpose: the app IS a
   * structural editor, and building a second, worse one inside a sidebar would
   * be the wrong instinct. This reads the canvas.
   */
  import { modelStore, resultsStore } from '../../lib/store';
  import { t } from '../../lib/i18n';
  import { captureModel, toFile, fromFile, type CaptureWarning } from './exercise-capture';
  import {
    lintExercise, evaluateAnswer,
    type AnswerSpec, type EduExerciseSpec, type ForceKind, type StressMeasure,
  } from './exercise-spec';
  import { stressContext } from './exercise-stress';
  import { saveToLibrary, toShareLink } from './exercise-library';
  import { solveForEdu } from './edu-solver';
  import { ALL_PROFILES } from '../../lib/data/steel-profiles';
  import { EXERCISE_EXAMPLES, fromExample, fromFileDed, fromShareUrl, hasDrawnModel } from './exercise-source';

  interface Props {
    onclose: () => void;
    onsaved: (ex: EduExerciseSpec) => void;
    /** An exercise being edited, or null when starting fresh. */
    editing?: EduExerciseSpec | null;
  }
  let { onclose, onsaved, editing = null }: Props = $props();

  // ── Metadata ───────────────────────────────────────────────
  let title = $state(editing?.title ?? '');
  let description = $state(editing?.description ?? '');
  let difficulty = $state<'easy' | 'medium' | 'hard'>(editing?.difficulty ?? 'easy');
  let category = $state<'statics' | 'strength' | 'advanced'>(editing?.category ?? 'statics');
  let kinematic = $state<'none' | 'isostatic' | 'hyperstatic'>(
    editing?.kinematicQuestion?.classification ?? 'none',
  );
  let degree = $state(editing?.kinematicQuestion?.degree ?? 1);
  let profile = $state(editing?.model.profile ?? '');
  let fy = $state(editing?.model.fy ?? 235);

  // ── The structure ──────────────────────────────────────────
  let captured = $state<ReturnType<typeof captureModel> | null>(
    editing ? { spec: editing.model, warnings: [] } : null,
  );
  let warnings = $state<CaptureWarning[]>([]);

  // ── Where the structure comes from ─────────────────────────
  //
  // Four routes, because switching from Basic to Educational does not carry
  // the model across: a teacher who just built a frame arrives here with an
  // empty canvas. All four end with a model in the store, which `capture()`
  // then reads.
  let sourceTab = $state<'draw' | 'example' | 'file' | 'link'>('draw');
  let exampleId = $state(EXERCISE_EXAMPLES[0].id);
  let shareUrl = $state('');
  let sourceError = $state('');
  let sourceBusy = $state(false);

  async function useExample() {
    sourceBusy = true;
    const r = await fromExample(exampleId);
    sourceBusy = false;
    sourceError = r.ok ? '' : t('edu.author.errExample');
    if (r.ok) capture();
  }

  async function useFile(e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    sourceBusy = true;
    const r = await fromFileDed(file);
    sourceBusy = false;
    sourceError = r.ok ? '' : sourceMessage(r.error);
    if (r.ok) capture();
  }

  function useLink() {
    const r = fromShareUrl(shareUrl);
    sourceError = r.ok ? '' : sourceMessage(r.error);
    if (r.ok) capture();
  }

  /** Error codes to sentences, exhaustively, so none can reach a teacher raw. */
  function sourceMessage(code: string): string {
    switch (code) {
      case 'errFileRead': return t('edu.author.errFileRead');
      case 'errNotDed': return t('edu.author.errNotDed');
      case 'errEmptyLink': return t('edu.author.errEmptyLink');
      case 'errNotShareLink': return t('edu.author.errNotShareLink');
      case 'errLinkBroken': return t('edu.author.errLinkBroken');
      default: return t('edu.author.errExample');
    }
  }

  function capture() {
    const r = captureModel(modelStore.model);
    captured = r;
    warnings = r.warnings;
    if (r.spec && askReactions.length === 0) {
      // One reaction question per support, pre-filled from that support's own
      // degrees of freedom — what a statics exercise asks first. Removable.
      askReactions = r.spec.supports.map((s, i) => ({
        node: s.node,
        label: `${t('edu.author.reactionAt')} ${String.fromCharCode(65 + i)}`,
        dofs: s.type === 'fixed' ? ['Rx', 'Ry', 'M'] : s.type === 'pinned' ? ['Rx', 'Ry'] : ['Ry'],
      }));
    }
  }

  // ── Questions ──────────────────────────────────────────────
  type CharRow = { label: string; unit: string; source: 'force' | 'stress'; force: ForceKind; measure: StressMeasure; scope: 'all' | 'element'; element: number; t: number };

  let askReactions = $state<Array<{ node: number; label: string; dofs: Array<'Rx' | 'Ry' | 'M'> }>>(
    editing?.supports.map((s) => ({ node: s.nodeIndex, label: s.label, dofs: [...s.dofs] })) ?? [],
  );
  let characteristics = $state<CharRow[]>(
    editing?.characteristics.map((c) => fromAnswer(c.label, c.unit, c.answer)) ?? [],
  );
  let diagramQs = $state<Array<{ question: string; unit: string; force: ForceKind; element: number; t: number }>>(
    editing?.diagramQuestions.map((q) => ({
      question: q.question, unit: q.unit,
      force: q.answer.kind === 'at' ? q.answer.force : 'moment',
      element: q.answer.kind === 'at' ? q.answer.element : 0,
      t: q.answer.kind === 'at' ? q.answer.t : 0,
    })) ?? [],
  );
  let shapeQs = $state<Array<{ diagram: 'N' | 'V' | 'M'; correct: 'zero' | 'constant' | 'linear' | 'quadratic' }>>(
    editing?.diagramShapeQuestions?.map((q) => ({ ...q })) ?? [],
  );
  let givens = $state<Array<{ label: string; value: string }>>(
    editing?.sectionData?.map((d) => ({ ...d })) ?? [],
  );

  /** Reverse the answer→row mapping so editing an exercise shows what it says. */
  function fromAnswer(label: string, unit: string, a: AnswerSpec): CharRow {
    const base: CharRow = { label, unit, source: 'force', force: 'moment', measure: 'sigmaMax', scope: 'all', element: 0, t: 0 };
    if (a.kind === 'maxAbs') return { ...base, force: a.force, scope: a.elements ? 'element' : 'all', element: a.elements?.[0] ?? 0 };
    if (a.kind === 'stress') return { ...base, source: 'stress', measure: a.measure, element: a.element, t: a.t };
    return base;
  }

  function answerOf(c: CharRow): AnswerSpec {
    if (c.source === 'stress') {
      return { kind: 'stress', measure: c.measure, element: c.element, t: c.t };
    }
    return c.scope === 'all'
      ? { kind: 'maxAbs', force: c.force }
      : { kind: 'maxAbs', force: c.force, elements: [c.element] };
  }

  const addChar = () => (characteristics = [...characteristics, { label: 'Mmax', unit: 'kN·m', source: 'force', force: 'moment', measure: 'sigmaMax', scope: 'all', element: 0, t: 0 }]);
  const addDiagram = () => (diagramQs = [...diagramQs, { question: '', unit: 'kN·m', force: 'moment', element: 0, t: 0 }]);
  const addShape = () => (shapeQs = [...shapeQs, { diagram: 'M', correct: 'linear' }]);
  const addGiven = () => (givens = [...givens, { label: '', value: '' }]);

  /** Everything declared, assembled into one exercise. */
  const draft = $derived.by((): EduExerciseSpec | null => {
    if (!captured?.spec) return null;
    const slug = title.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    return {
      // Editing keeps the original id, so saving replaces rather than clones.
      id: editing?.id ?? (slug || `exercise-${Date.now()}`),
      title: title.trim() || t('edu.author.untitled'),
      description: description.trim(),
      difficulty,
      category,
      model: {
        ...captured.spec,
        profile: profile.trim() || undefined,
        fy: profile.trim() ? fy : undefined,
      },
      supports: askReactions.map((r) => ({ label: r.label, nodeIndex: r.node, dofs: r.dofs })),
      characteristics: characteristics.map((c) => ({ label: c.label, unit: c.unit, answer: answerOf(c) })),
      diagramQuestions: diagramQs.map((q) => ({
        question: q.question, unit: q.unit,
        answer: { kind: 'at', force: q.force, element: q.element, t: q.t },
      })),
      kinematicQuestion: kinematic === 'none' ? undefined
        : { classification: kinematic, degree: kinematic === 'hyperstatic' ? degree : undefined },
      diagramShapeQuestions: shapeQs.length ? shapeQs : undefined,
      sectionData: givens.filter((g) => g.label.trim()).length ? givens.filter((g) => g.label.trim()) : undefined,
    };
  });

  const problems = $derived(draft ? lintExercise(draft) : []);
  const hasQuestions = $derived(
    (draft?.supports.length ?? 0) + (draft?.characteristics.length ?? 0) +
    (draft?.diagramQuestions.length ?? 0) + (draft?.diagramShapeQuestions?.length ?? 0) > 0,
  );

  // ── Preview ────────────────────────────────────────────────
  //
  // The most useful thing an authoring tool can show: what a class will be
  // marked against. A teacher who sees a wrong number catches it now.
  let previewed = $state<Array<{ label: string; value: number | null; unit: string }> | null>(null);
  let previewNote = $state('');

  function preview() {
    if (!draft) return;
    solveForEdu();
    const forces = resultsStore.results?.elementForces ?? null;
    if (!forces) {
      previewed = null;
      previewNote = t('edu.author.solveFailed');
      return;
    }
    const ctx = stressContext(draft.model.profile, draft.model.fy);
    previewNote = '';
    previewed = [
      ...draft.characteristics.map((c) => ({ label: c.label, value: evaluateAnswer(c.answer, forces, ctx), unit: c.unit })),
      ...draft.diagramQuestions.map((q) => ({
        label: q.question || t('edu.author.diagramQuestion'),
        value: evaluateAnswer(q.answer, forces, ctx),
        unit: q.unit,
      })),
    ];
  }

  // ── Saving ─────────────────────────────────────────────────
  let saveMsg = $state('');
  let shareLink = $state('');

  function save() {
    if (!draft) return;
    const { ok } = saveToLibrary(draft);
    saveMsg = ok ? t('edu.author.saved') : t('edu.author.saveFailed');
    if (ok) onsaved(draft);
  }

  function download() {
    if (!draft) return;
    const blob = new Blob([toFile(draft)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${draft.id}.stabileo-ej.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function share() {
    if (!draft) return;
    shareLink = toShareLink(draft, location.origin + location.pathname);
    navigator.clipboard?.writeText(shareLink).catch(() => {});
  }

  let importError = $state('');
  function openFile(e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    file.text().then((text) => {
      const r = fromFile(text);
      if (!r.ok) { importError = r.error; return; }
      importError = '';
      onsaved(r.exercise);
    });
  }

  const elementCount = $derived(captured?.spec?.elements.length ?? 0);
  const profileNames = $derived(ALL_PROFILES.map((p) => p.name));
</script>

<div class="author">
  <div class="author-head">
    <h3>{editing ? t('edu.author.editTitle') : t('edu.author.title')}</h3>
    <button class="author-close" onclick={onclose} aria-label={t('edu.back')}>&#x2715;</button>
  </div>
  <p class="author-intro">{t('edu.author.intro')}</p>

  <!-- 1 · Where the structure comes from -->
  <section>
    <h4>1 · {t('edu.author.structure')}</h4>

    <!-- Written out rather than looped over a key list: a translation key
         assembled by concatenation cannot be found by searching for it. -->
    <div class="source-tabs">
      <button class="src-tab" class:active={sourceTab === 'draw'}
        onclick={() => { sourceTab = 'draw'; sourceError = ''; }}>{t('edu.author.srcDraw')}</button>
      <button class="src-tab" class:active={sourceTab === 'example'}
        onclick={() => { sourceTab = 'example'; sourceError = ''; }}>{t('edu.author.srcExample')}</button>
      <button class="src-tab" class:active={sourceTab === 'file'}
        onclick={() => { sourceTab = 'file'; sourceError = ''; }}>{t('edu.author.srcFile')}</button>
      <button class="src-tab" class:active={sourceTab === 'link'}
        onclick={() => { sourceTab = 'link'; sourceError = ''; }}>{t('edu.author.srcLink')}</button>
    </div>

    {#if sourceTab === 'draw'}
      <p class="hint">{t('edu.author.drawHint')}</p>
      <button class="btn-primary" onclick={capture} disabled={!hasDrawnModel()}>
        {t('edu.author.capture')}
      </button>
      {#if !hasDrawnModel()}<p class="hint">{t('edu.author.nothingDrawn')}</p>{/if}
    {:else if sourceTab === 'example'}
      <p class="hint">{t('edu.author.exampleHint')}</p>
      <div class="row">
        <select bind:value={exampleId}>
          {#each EXERCISE_EXAMPLES as ex}<option value={ex.id}>{t(ex.nameKey)}</option>{/each}
        </select>
        <button class="btn-primary" onclick={useExample} disabled={sourceBusy}>
          {t('edu.author.load')}
        </button>
      </div>
    {:else if sourceTab === 'file'}
      <p class="hint">{t('edu.author.fileHint')}</p>
      <input type="file" accept=".ded,.json" onchange={useFile} />
    {:else}
      <p class="hint">{t('edu.author.linkHint')}</p>
      <div class="row">
        <input type="text" bind:value={shareUrl} placeholder="https://stabileo.com/#data=..." />
        <button class="btn-primary" onclick={useLink}>{t('edu.author.load')}</button>
      </div>
    {/if}

    {#if sourceError}<p class="warn">⚠ {sourceError}</p>{/if}

    {#if captured?.spec}
      <p class="summary">
        {captured.spec.nodes.length} {t('edu.author.nodes')} ·
        {captured.spec.elements.length} {t('edu.author.elements')} ·
        {captured.spec.supports.length} {t('edu.author.supports')}
      </p>
    {/if}
    {#each warnings as w}<p class="warn">⚠ {w.detail}</p>{/each}
  </section>

  {#if captured?.spec}
    <!-- 2 · What it is -->
    <section>
      <h4>2 · {t('edu.author.about')}</h4>
      <label>{t('edu.author.exTitle')}<input type="text" bind:value={title} /></label>
      <label>{t('edu.author.exDesc')}<textarea rows="2" bind:value={description}></textarea></label>
      <div class="row">
        <label>{t('edu.author.difficulty')}
          <select bind:value={difficulty}>
            <option value="easy">{t('edu.easy')}</option>
            <option value="medium">{t('edu.medium')}</option>
            <option value="hard">{t('edu.hard')}</option>
          </select>
        </label>
        <label>{t('edu.author.category')}
          <select bind:value={category}>
            <option value="statics">{t('edu.sectionStatics')}</option>
            <option value="strength">{t('edu.sectionStrength')}</option>
            <option value="advanced">{t('edu.sectionAdvanced')}</option>
          </select>
        </label>
      </div>
      <label>{t('edu.author.profile')}
        <input type="text" list="edu-profiles" bind:value={profile} placeholder={t('edu.author.profileNone')} />
      </label>
      <datalist id="edu-profiles">
        {#each profileNames as n}<option value={n}></option>{/each}
      </datalist>
      {#if profile.trim()}
        <label>fy (MPa)<input type="number" bind:value={fy} /></label>
      {:else}
        <p class="hint">{t('edu.author.profileHint')}</p>
      {/if}
    </section>

    <!-- 3 · The data the student is given -->
    <section>
      <h4>3 · {t('edu.author.givens')}</h4>
      {#each givens as g, i}
        <div class="row">
          <input type="text" bind:value={g.label} placeholder="E" />
          <input type="text" bind:value={g.value} placeholder="200 000 MPa" />
          <button class="btn-del" onclick={() => (givens = givens.filter((_, k) => k !== i))} aria-label="✕">✕</button>
        </div>
      {/each}
      <button class="btn-add" onclick={addGiven}>+ {t('edu.author.add')}</button>
    </section>

    <!-- 4 · What to ask -->
    <section>
      <h4>4 · {t('edu.author.questions')}</h4>

      <div class="qgroup">
        <span class="qlabel">{t('edu.author.reactions')}</span>
        {#each askReactions as r, i}
          <div class="row">
            <input type="text" bind:value={r.label} />
            {#each ['Rx', 'Ry', 'M'] as dof}
              <label class="chk">
                <input type="checkbox" checked={r.dofs.includes(dof as never)}
                  onchange={(e) => {
                    r.dofs = e.currentTarget.checked
                      ? [...r.dofs, dof as never]
                      : r.dofs.filter((d) => d !== dof);
                    askReactions = [...askReactions];
                  }} />{dof}
              </label>
            {/each}
            <button class="btn-del" onclick={() => (askReactions = askReactions.filter((_, k) => k !== i))} aria-label="✕">✕</button>
          </div>
        {/each}
      </div>

      <div class="qgroup">
        <span class="qlabel">{t('edu.author.characteristics')}</span>
        {#each characteristics as c, i}
          <div class="row">
            <input type="text" bind:value={c.label} placeholder="Mmax" />
            <input type="text" class="unit" bind:value={c.unit} />
            <select bind:value={c.source}>
              <option value="force">{t('edu.author.internalForce')}</option>
              <option value="stress" disabled={!profile.trim()}>{t('edu.author.stress')}</option>
            </select>
            {#if c.source === 'force'}
              <select bind:value={c.force}>
                <option value="moment">M</option><option value="shear">V</option><option value="axial">N</option>
              </select>
              <select bind:value={c.scope}>
                <option value="all">{t('edu.author.wholeStructure')}</option>
                <option value="element">{t('edu.author.oneMember')}</option>
              </select>
              {#if c.scope === 'element'}
                <input type="number" class="num" min="1" max={elementCount} value={c.element + 1}
                  onchange={(e) => (c.element = Math.max(0, Number(e.currentTarget.value) - 1))} />
              {/if}
            {:else}
              <select bind:value={c.measure}>
                <option value="sigmaMax">σmax</option>
                <option value="sigmaMin">σmin</option>
                <option value="tauMax">τmax</option>
                <option value="vonMises">von Mises</option>
              </select>
              <input type="number" class="num" min="1" max={elementCount} value={c.element + 1}
                onchange={(e) => (c.element = Math.max(0, Number(e.currentTarget.value) - 1))} />
              <select bind:value={c.t}>
                <option value={0}>{t('edu.author.atStart')}</option>
                <option value={0.5}>{t('edu.author.atMid')}</option>
                <option value={1}>{t('edu.author.atEnd')}</option>
              </select>
            {/if}
            <button class="btn-del" onclick={() => (characteristics = characteristics.filter((_, k) => k !== i))} aria-label="✕">✕</button>
          </div>
        {/each}
        <button class="btn-add" onclick={addChar}>+ {t('edu.author.add')}</button>
      </div>

      <div class="qgroup">
        <span class="qlabel">{t('edu.author.diagramQuestions')}</span>
        {#each diagramQs as q, i}
          <div class="row">
            <input type="text" bind:value={q.question} placeholder={t('edu.author.questionText')} />
            <input type="text" class="unit" bind:value={q.unit} />
            <select bind:value={q.force}>
              <option value="moment">M</option><option value="shear">V</option><option value="axial">N</option>
            </select>
            <input type="number" class="num" min="1" max={elementCount} value={q.element + 1}
              onchange={(e) => (q.element = Math.max(0, Number(e.currentTarget.value) - 1))} />
            <select bind:value={q.t}>
              <option value={0}>{t('edu.author.atStart')}</option>
              <option value={0.5}>{t('edu.author.atMid')}</option>
              <option value={1}>{t('edu.author.atEnd')}</option>
            </select>
            <button class="btn-del" onclick={() => (diagramQs = diagramQs.filter((_, k) => k !== i))} aria-label="✕">✕</button>
          </div>
        {/each}
        <button class="btn-add" onclick={addDiagram}>+ {t('edu.author.add')}</button>
      </div>

      <div class="qgroup">
        <span class="qlabel">{t('edu.author.shapes')}</span>
        {#each shapeQs as s, i}
          <div class="row">
            <select bind:value={s.diagram}>
              <option value="N">N</option><option value="V">V</option><option value="M">M</option>
            </select>
            <select bind:value={s.correct}>
              <option value="zero">{t('edu.shape.zero')}</option>
              <option value="constant">{t('edu.shape.constant')}</option>
              <option value="linear">{t('edu.shape.linear')}</option>
              <option value="quadratic">{t('edu.shape.quadratic')}</option>
            </select>
            <button class="btn-del" onclick={() => (shapeQs = shapeQs.filter((_, k) => k !== i))} aria-label="✕">✕</button>
          </div>
        {/each}
        <button class="btn-add" onclick={addShape}>+ {t('edu.author.add')}</button>
      </div>

      <div class="qgroup">
        <span class="qlabel">{t('edu.author.kinematic')}</span>
        <div class="row">
          <select bind:value={kinematic}>
            <option value="none">{t('edu.author.dontAsk')}</option>
            <option value="isostatic">{t('edu.isostatic')}</option>
            <option value="hyperstatic">{t('edu.hyperstatic')}</option>
          </select>
          {#if kinematic === 'hyperstatic'}
            <input type="number" class="num" min="1" bind:value={degree} />
          {/if}
        </div>
      </div>
    </section>

    <!-- 5 · What the class will be marked against -->
    <section>
      <h4>5 · {t('edu.author.check')}</h4>
      <button class="btn-primary" onclick={preview}>{t('edu.author.solveAndShow')}</button>
      {#if previewNote}<p class="warn">⚠ {previewNote}</p>{/if}
      {#if previewed}
        {#if previewed.length === 0}
          <p class="hint">{t('edu.author.nothingToCheck')}</p>
        {:else}
          <table class="preview">
            <tbody>
              {#each previewed as p}
                <tr>
                  <td>{p.label}</td>
                  <td class="val" class:bad={p.value === null}>
                    {p.value === null ? t('edu.author.cannotEvaluate') : `${p.value.toFixed(3)} ${p.unit}`}
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
          <p class="hint">{t('edu.author.previewHint')}</p>
        {/if}
      {/if}
      {#each problems as p}<p class="warn">⚠ {p}</p>{/each}
      {#if !hasQuestions}<p class="warn">⚠ {t('edu.author.noQuestions')}</p>{/if}
    </section>

    <!-- 6 · Keep it -->
    <section>
      <h4>6 · {t('edu.author.save')}</h4>
      <div class="row">
        <button class="btn-primary" onclick={save} disabled={problems.length > 0 || !hasQuestions}>
          {t('edu.author.saveToLibrary')}
        </button>
        <button class="btn-ghost" onclick={download} disabled={problems.length > 0}>{t('edu.author.download')}</button>
        <button class="btn-ghost" onclick={share} disabled={problems.length > 0}>{t('edu.author.share')}</button>
      </div>
      {#if saveMsg}<p class="ok">{saveMsg}</p>{/if}
      {#if shareLink}
        <p class="hint">{t('edu.author.linkCopied')}</p>
        <input class="link" type="text" readonly value={shareLink} />
      {/if}
      {#if problems.length > 0 || !hasQuestions}
        <p class="hint">{t('edu.author.fixFirst')}</p>
      {/if}
    </section>
  {/if}

  <section class="open-section">
    <h4>{t('edu.author.openExisting')}</h4>
    <input type="file" accept=".json" onchange={openFile} />
    {#if importError}<p class="warn">⚠ {importError}</p>{/if}
  </section>
</div>

<style>
  .author { padding: 12px 14px; color: #ddd; font-size: 0.8rem; overflow-y: auto; height: 100%; }
  .author-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; }
  .author-head h3 { margin: 0; font-size: 0.95rem; color: #4ecdc4; }
  .author-close { background: none; border: none; color: #888; cursor: pointer; font-size: 0.9rem; }
  .author-intro { color: #999; font-size: 0.72rem; line-height: 1.45; margin: 0 0 12px; }
  .source-tabs { display: flex; gap: 4px; margin-bottom: 8px; flex-wrap: wrap; }
  .src-tab {
    background: #1c1c1c; border: 1px solid #333; color: #999;
    padding: 3px 9px; border-radius: 3px; cursor: pointer; font-size: 0.71rem;
  }
  .src-tab:hover { border-color: #4ecdc4; color: #ddd; }
  .src-tab.active { background: #4ecdc4; border-color: #4ecdc4; color: #111; font-weight: 600; }
  section { border-top: 1px solid #2a2a2a; padding: 10px 0; }
  h4 { margin: 0 0 8px; font-size: 0.78rem; color: #bbb; font-weight: 600; }
  label { display: block; margin-bottom: 6px; font-size: 0.72rem; color: #999; }
  label input[type='text'], label input[type='number'], label textarea, label select { width: 100%; margin-top: 2px; }
  input[type='text'], input[type='number'], textarea, select {
    background: #1c1c1c; border: 1px solid #333; color: #ddd;
    padding: 3px 6px; border-radius: 3px; font-size: 0.74rem;
  }
  .row { display: flex; gap: 6px; align-items: center; margin-bottom: 5px; flex-wrap: wrap; }
  .row > label { margin: 0; flex: 1; }
  .row input[type='text'] { flex: 1; min-width: 80px; }
  .unit { width: 62px; flex: none !important; }
  .num { width: 52px; }
  .chk { display: flex; align-items: center; gap: 3px; margin: 0; font-size: 0.7rem; }
  .qgroup { margin-bottom: 10px; }
  .qlabel { display: block; font-size: 0.7rem; color: #777; text-transform: uppercase; letter-spacing: 0.04em; margin-bottom: 4px; }
  .btn-primary {
    background: #4ecdc4; border: none; color: #111; font-weight: 600;
    padding: 5px 12px; border-radius: 3px; cursor: pointer; font-size: 0.75rem;
  }
  .btn-primary:disabled { background: #333; color: #666; cursor: not-allowed; }
  .btn-ghost {
    background: none; border: 1px solid #444; color: #aaa;
    padding: 5px 10px; border-radius: 3px; cursor: pointer; font-size: 0.73rem;
  }
  .btn-ghost:disabled { color: #555; border-color: #2c2c2c; cursor: not-allowed; }
  .btn-add { background: none; border: 1px dashed #444; color: #888; padding: 3px 8px; border-radius: 3px; cursor: pointer; font-size: 0.7rem; }
  .btn-del { background: none; border: none; color: #a55; cursor: pointer; font-size: 0.7rem; }
  .summary { color: #4ecdc4; font-size: 0.72rem; margin: 6px 0 0; font-family: monospace; }
  .warn { color: #d9a441; font-size: 0.7rem; line-height: 1.4; margin: 5px 0 0; }
  .ok { color: #4ecdc4; font-size: 0.72rem; margin: 6px 0 0; }
  .hint { color: #777; font-size: 0.68rem; margin: 5px 0 0; line-height: 1.4; }
  .link { width: 100%; margin-top: 4px; font-size: 0.65rem; font-family: monospace; }
  .preview { width: 100%; margin-top: 8px; border-collapse: collapse; }
  .preview td { padding: 3px 4px; border-bottom: 1px solid #262626; font-size: 0.72rem; }
  .preview .val { text-align: right; font-family: monospace; color: #4ecdc4; }
  .preview .val.bad { color: #d9a441; }
  .open-section { border-top: 1px solid #2a2a2a; }
</style>
