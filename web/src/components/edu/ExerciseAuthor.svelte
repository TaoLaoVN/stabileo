<script lang="ts">
  /**
   * Authoring an exercise from inside Stabileo.
   *
   * A teacher draws the structure with the tools that already exist, then
   * comes here to say what to ask about it. Nothing is typed into a file, and
   * nothing is written in a programming language.
   *
   * The structure itself gets no editor here on purpose: the app IS a
   * structural editor, and building a second, worse one inside a side panel
   * would be the wrong instinct. This captures what is on the canvas.
   */
  import { modelStore } from '../../lib/store';
  import { t } from '../../lib/i18n';
  import { captureModel, toFile, fromFile, type CaptureWarning } from './exercise-capture';
  import { lintExercise, evaluateAnswer, type AnswerSpec, type EduExerciseSpec, type ForceKind } from './exercise-spec';
  import { solveForEdu } from './edu-solver';
  import { resultsStore } from '../../lib/store';

  interface Props {
    onclose: () => void;
    onload: (ex: EduExerciseSpec) => void;
  }
  let { onclose, onload }: Props = $props();

  // ── Metadata ───────────────────────────────────────────────
  let title = $state('');
  let description = $state('');
  let difficulty = $state<'easy' | 'medium' | 'hard'>('easy');
  let category = $state<'statics' | 'strength' | 'advanced'>('statics');
  let kinematic = $state<'none' | 'isostatic' | 'hyperstatic'>('none');
  let degree = $state(1);

  // ── Captured structure ─────────────────────────────────────
  let captured = $state<ReturnType<typeof captureModel> | null>(null);
  let warnings = $state<CaptureWarning[]>([]);

  function capture() {
    const r = captureModel(modelStore.model);
    captured = r;
    warnings = r.warnings;
    if (r.spec && askReactions.length === 0) {
      // Pre-fill a reaction question per support, which is what almost every
      // statics exercise asks first. The teacher can remove them.
      askReactions = r.spec.supports.map((s) => ({
        node: s.node,
        label: `${t('edu.author.reactionAt')} ${s.node + 1}`,
        dofs: s.type === 'fixed' ? ['Rx', 'Ry', 'M'] : s.type === 'pinned' ? ['Rx', 'Ry'] : ['Ry'],
      }));
    }
  }

  // ── Questions ──────────────────────────────────────────────
  let askReactions = $state<Array<{ node: number; label: string; dofs: Array<'Rx' | 'Ry' | 'M'> }>>([]);
  let characteristics = $state<Array<{ label: string; unit: string; force: ForceKind; scope: 'all' | 'element'; element: number }>>([]);
  let diagramQs = $state<Array<{ question: string; unit: string; force: ForceKind; element: number; t: number }>>([]);

  function addCharacteristic() {
    characteristics = [...characteristics, { label: 'Mmax', unit: 'kN·m', force: 'moment', scope: 'all', element: 0 }];
  }
  function addDiagramQ() {
    diagramQs = [...diagramQs, { question: '', unit: 'kN·m', force: 'moment', element: 0, t: 0 }];
  }

  function answerOf(c: { force: ForceKind; scope: string; element: number }): AnswerSpec {
    return c.scope === 'all'
      ? { kind: 'maxAbs', force: c.force }
      : { kind: 'maxAbs', force: c.force, elements: [c.element] };
  }

  /** Assemble what the teacher has declared into a full exercise. */
  const draft = $derived.by((): EduExerciseSpec | null => {
    if (!captured?.spec) return null;
    return {
      id: title.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'exercise',
      title: title.trim() || t('edu.author.untitled'),
      description: description.trim(),
      difficulty,
      category,
      model: captured.spec,
      supports: askReactions.map((r) => ({ label: r.label, nodeIndex: r.node, dofs: r.dofs })),
      characteristics: characteristics.map((c) => ({ label: c.label, unit: c.unit, answer: answerOf(c) })),
      diagramQuestions: diagramQs.map((q) => ({
        question: q.question,
        unit: q.unit,
        answer: { kind: 'at', force: q.force, element: q.element, t: q.t },
      })),
      kinematicQuestion:
        kinematic === 'none'
          ? undefined
          : { classification: kinematic, degree: kinematic === 'hyperstatic' ? degree : undefined },
    };
  });

  const problems = $derived(draft ? lintExercise(draft) : []);

  // ── Preview ────────────────────────────────────────────────
  //
  // The single most useful thing an authoring tool can show: what the students
  // will be marked against. A teacher who sees a wrong number here catches the
  // mistake now instead of in front of a class.
  let previewed = $state<Array<{ label: string; value: number | null; unit: string }> | null>(null);

  function preview() {
    solveForEdu();
    const forces = resultsStore.results?.elementForces ?? null;
    if (!forces || !draft) {
      previewed = null;
      return;
    }
    previewed = [
      ...draft.characteristics.map((c) => ({
        label: c.label,
        value: evaluateAnswer(c.answer, forces),
        unit: c.unit,
      })),
      ...draft.diagramQuestions.map((q) => ({
        label: q.question || t('edu.author.diagramQuestion'),
        value: evaluateAnswer(q.answer, forces),
        unit: q.unit,
      })),
    ];
  }

  // ── Saving and opening ─────────────────────────────────────
  function download() {
    if (!draft) return;
    const blob = new Blob([toFile(draft)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${draft.id}.stabileo-ej.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  let importError = $state('');
  function openFile(e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    file.text().then((text) => {
      const r = fromFile(text);
      if (!r.ok) {
        importError = r.error;
        return;
      }
      importError = '';
      onload(r.exercise);
    });
  }

  const elementCount = $derived(captured?.spec?.elements.length ?? 0);
</script>

<div class="author">
  <div class="author-head">
    <h3>{t('edu.author.title')}</h3>
    <button class="author-close" onclick={onclose}>&#x2715;</button>
  </div>

  <p class="author-intro">{t('edu.author.intro')}</p>

  <!-- 1 · The structure, read from the canvas -->
  <section>
    <h4>1 · {t('edu.author.structure')}</h4>
    <button class="btn-primary" onclick={capture}>{t('edu.author.capture')}</button>
    {#if captured?.spec}
      <p class="summary">
        {captured.spec.nodes.length} {t('edu.author.nodes')} ·
        {captured.spec.elements.length} {t('edu.author.elements')} ·
        {captured.spec.supports.length} {t('edu.author.supports')}
      </p>
    {/if}
    {#each warnings as w}
      <p class="warn">⚠ {w.detail}</p>
    {/each}
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
    </section>

    <!-- 3 · What to ask -->
    <section>
      <h4>3 · {t('edu.author.questions')}</h4>

      <div class="qgroup">
        <span class="qlabel">{t('edu.author.reactions')}</span>
        {#each askReactions as r, i}
          <div class="row">
            <input type="text" bind:value={r.label} />
            {#each ['Rx', 'Ry', 'M'] as dof}
              <label class="chk">
                <input type="checkbox" checked={r.dofs.includes(dof as never)}
                  onchange={(e) => {
                    const on = e.currentTarget.checked;
                    r.dofs = on ? [...r.dofs, dof as never] : r.dofs.filter((d) => d !== dof);
                    askReactions = [...askReactions];
                  }} />
                {dof}
              </label>
            {/each}
            <button class="btn-del" onclick={() => (askReactions = askReactions.filter((_, k) => k !== i))}>✕</button>
          </div>
        {/each}
      </div>

      <div class="qgroup">
        <span class="qlabel">{t('edu.author.characteristics')}</span>
        {#each characteristics as c, i}
          <div class="row">
            <input type="text" bind:value={c.label} placeholder="Mmax" />
            <input type="text" class="unit" bind:value={c.unit} />
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
            <button class="btn-del" onclick={() => (characteristics = characteristics.filter((_, k) => k !== i))}>✕</button>
          </div>
        {/each}
        <button class="btn-add" onclick={addCharacteristic}>+ {t('edu.author.add')}</button>
      </div>

      <div class="qgroup">
        <span class="qlabel">{t('edu.author.diagramQuestions')}</span>
        {#each diagramQs as q, i}
          <div class="row">
            <input type="text" bind:value={q.question} placeholder={t('edu.author.questionText')} />
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
            <button class="btn-del" onclick={() => (diagramQs = diagramQs.filter((_, k) => k !== i))}>✕</button>
          </div>
        {/each}
        <button class="btn-add" onclick={addDiagramQ}>+ {t('edu.author.add')}</button>
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

    <!-- 4 · What the students will be marked against -->
    <section>
      <h4>4 · {t('edu.author.check')}</h4>
      <button class="btn-primary" onclick={preview}>{t('edu.author.solveAndShow')}</button>
      {#if previewed}
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
      {#each problems as p}
        <p class="warn">⚠ {p}</p>
      {/each}
    </section>

    <!-- 5 · Keep it -->
    <section>
      <h4>5 · {t('edu.author.save')}</h4>
      <button class="btn-primary" onclick={download} disabled={problems.length > 0}>
        {t('edu.author.download')}
      </button>
      {#if problems.length > 0}
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
  .author { padding: 12px 14px; color: #ddd; font-size: 0.8rem; overflow-y: auto; }
  .author-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; }
  .author-head h3 { margin: 0; font-size: 0.95rem; color: #4ecdc4; }
  .author-close { background: none; border: none; color: #888; cursor: pointer; font-size: 0.9rem; }
  .author-intro { color: #999; font-size: 0.72rem; line-height: 1.45; margin: 0 0 12px; }
  section { border-top: 1px solid #2a2a2a; padding: 10px 0; }
  h4 { margin: 0 0 8px; font-size: 0.78rem; color: #bbb; font-weight: 600; }
  label { display: block; margin-bottom: 6px; font-size: 0.72rem; color: #999; }
  label input[type='text'], label textarea, label select { width: 100%; margin-top: 2px; }
  input[type='text'], input[type='number'], textarea, select {
    background: #1c1c1c; border: 1px solid #333; color: #ddd;
    padding: 3px 6px; border-radius: 3px; font-size: 0.74rem;
  }
  .row { display: flex; gap: 6px; align-items: center; margin-bottom: 5px; flex-wrap: wrap; }
  .row > label { margin: 0; flex: 1; }
  .row input[type='text'] { flex: 1; min-width: 90px; }
  .unit { width: 60px; flex: none !important; }
  .num { width: 54px; }
  .chk { display: flex; align-items: center; gap: 3px; margin: 0; font-size: 0.7rem; }
  .qgroup { margin-bottom: 10px; }
  .qlabel { display: block; font-size: 0.7rem; color: #777; text-transform: uppercase; letter-spacing: 0.04em; margin-bottom: 4px; }
  .btn-primary {
    background: #4ecdc4; border: none; color: #111; font-weight: 600;
    padding: 5px 12px; border-radius: 3px; cursor: pointer; font-size: 0.75rem;
  }
  .btn-primary:disabled { background: #333; color: #666; cursor: not-allowed; }
  .btn-add { background: none; border: 1px dashed #444; color: #888; padding: 3px 8px; border-radius: 3px; cursor: pointer; font-size: 0.7rem; }
  .btn-del { background: none; border: none; color: #a55; cursor: pointer; font-size: 0.7rem; }
  .summary { color: #4ecdc4; font-size: 0.72rem; margin: 6px 0 0; font-family: monospace; }
  .warn { color: #d9a441; font-size: 0.7rem; line-height: 1.4; margin: 5px 0 0; }
  .hint { color: #777; font-size: 0.68rem; margin: 5px 0 0; line-height: 1.4; }
  .preview { width: 100%; margin-top: 8px; border-collapse: collapse; }
  .preview td { padding: 3px 4px; border-bottom: 1px solid #262626; font-size: 0.72rem; }
  .preview .val { text-align: right; font-family: monospace; color: #4ecdc4; }
  .preview .val.bad { color: #d9a441; }
  .open-section { border-top: 1px solid #2a2a2a; }
</style>
