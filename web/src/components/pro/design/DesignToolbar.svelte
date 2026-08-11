<script lang="ts">
  /**
   * Design command bar: three explicit commands plus Design all, honest counts and
   * the banner stack.
   *
   * The single old "Run Design" button conflated check + generate + accept, and the
   * accept step mutated every un-detailed member with no undo entry.
   */
  import { t, tp } from '../../../lib/i18n';
  import { verificationStore } from '../../../lib/store';
  import { designRunStore } from '../../../lib/store/design-run.svelte';
  import { regulationsStore } from '../../../lib/store/regulations.svelte';
  import { te } from '../../../lib/i18n/engine-text';
  import { bindingLabel } from '../../../lib/codes/roles';
  import { detailingStore } from '../../../lib/store/detailing.svelte';
  import { detailingAuthor } from '../../../lib/store/detailing-author.svelte';
  import { diagnosticsWarning } from '../../../lib/store/diagnostics-warning.svelte';
  import { canOpenRebar3D, openRebar3D, rebar3DAssemblyCount } from '../../../lib/store/rebar-open';
  import OutcomeBadge from './OutcomeBadge.svelte';

  interface Props {
    selectedCount: number;
    hasResults: boolean;
    hasCombinations: boolean;
    editedCount: number;
    onComputeDemands: () => void;
    onCodeCheck: () => void;
    onAutoDesignSelected: () => void;
    onAutoDesignUndesigned: () => void;
    onDesignAll: () => void;
    onReviewChanges: () => void;
    onRevertEdits: () => void;
    onShowOrientation: () => void;
    /** Where the diagnostics chip goes. Owned by the panel, which knows how to switch tabs. */
    onOpenDiagnostics: () => void;
  }
  let {
    selectedCount, hasResults, hasCombinations, editedCount,
    onComputeDemands, onCodeCheck, onAutoDesignSelected, onAutoDesignUndesigned,
    onDesignAll, onReviewChanges, onRevertEdits, onShowOrientation,
    onOpenDiagnostics,
  }: Props = $props();

  let autoMenuOpen = $state(false);

  // ─── Ver modelo 3D ──────────────────────────────────────────────
  let opening3d = $state(false);
  let open3dError = $state<string | null>(null);
  const canOpen3d = $derived(canOpenRebar3D());
  const assemblyCount = $derived(rebar3DAssemblyCount());

  /**
   * Build the document and open the workspace.
   *
   * `opening3d` is held across a frame on purpose. The build is synchronous and can take a
   * noticeable moment on a large model, so without yielding first the browser never paints the
   * pending state and the button looks like it did nothing — the exact complaint that put this
   * command on the main row in the first place.
   */
  async function open3d() {
    open3dError = null;
    opening3d = true;
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    try {
      const res = openRebar3D({
        author: detailingAuthor.resolve(t('detailing.doc.unnamedAuthor')),
        at: new Date().toISOString(),
      });
      if (!res.ok) open3dError = t('detailing.doc.noCoordinated');
    } finally {
      opening3d = false;
    }
  }

  /**
   * The concrete design code in force, and why it might not be.
   *
   * There is no selector here any more. This bar used to carry a dropdown listing the whole
   * adapter registry — which showed "CIRSOC 201" twice, because the 2025 and 2005 adapters
   * share a display name, and offered the 2005 edition whose official text is not supplied
   * with this app. Worse, it wrote its own state: the code check, the candidate search and
   * detailing read it, while Project Regulations bound a `concrete` role that reached only
   * part of detailing. The two could disagree.
   *
   * Project Regulations is the one selector. This is a read-out of what it chose.
   */
  const concreteBinding = $derived(regulationsStore.binding('concrete'));
  const concreteProblem = $derived(regulationsStore.concreteDesignProblem());
  const concreteReady = $derived(regulationsStore.concreteDesignCode() !== null);
  // `bindingLabel` is the same labeller Project Regulations uses, so the read-out and the
  // selector can never print the regulation differently.
  const concreteLabel = $derived(te(bindingLabel(concreteBinding)));

  /** Open the Project Regulations disclosure and put the caret in it. */
  function openRegulations() {
    const panel = document.querySelector('[data-testid="code-settings-disclosure"]');
    if (panel instanceof HTMLDetailsElement) panel.open = true;
    document.querySelector('[data-testid="project-regulations"]')
      ?.scrollIntoView({ block: 'nearest' });
    (document.querySelector('[data-testid="project-regulations"] select') as HTMLElement | null)
      ?.focus();
  }

  const counts = $derived(verificationStore.providedSummary);
  const run = $derived(verificationStore.runSummary);
  const busy = $derived(designRunStore.running);
  // No usable concrete code means no design. Gating beats defaulting: silently falling back
  // to CIRSOC would verify a project against rules it never chose.
  const canDesign = $derived(hasResults && hasCombinations && !busy && concreteReady);
  const orientCount = $derived(verificationStore.orientationSuspectCount);
  const provisionalCount = $derived(designRunStore.provisionalIds.size);

  // ── Detailing ──
  // The audit's headline finding was that the detailing engines had no production caller.
  // This is it: a visible command, enabled exactly when the prerequisites hold, and when
  // it is not, saying which members are in the way and how many.
  const detailingReady = $derived(detailingStore.readiness);
  const hasDetailing = $derived(detailingStore.assemblies.length > 0);
  const detailingBusy = $derived(detailingStore.generating);

  /** Precise prerequisites, so a disabled button is never a dead end. */
  const detailingBlockers = $derived(
    detailingReady.prerequisites.map((p) => tp(p.key, { n: p.count,
      ids: p.elementIds.slice(0, 6).join(', ') })).join(' '),
  );

  function generateDetailing() {
    detailingStore.generate();
  }


</script>

<div class="toolbar" data-testid="design-toolbar">
  <div class="cmd-row">
    <!-- A read-out, not a selector. The regulation is chosen in Project Regulations. -->
    <span class="code-indicator" data-testid="active-concrete-code"
          class:unbound={!concreteReady}>
      <span class="code-role">{t('design.code.role')}</span>
      <span class="code-name">{concreteLabel}</span>
    </span>

    {#if !concreteReady && concreteProblem}
      <span class="code-gate" role="alert" data-testid="concrete-code-gate">
        {te(concreteProblem)}
        <button class="code-gate-link" data-testid="goto-project-regulations"
                onclick={openRegulations}>{t('design.code.openRegulations')}</button>
      </span>
    {/if}

    <button class="cmd" data-testid="cmd-compute-demands" onclick={onComputeDemands}
            disabled={!hasResults || busy}>{t('design.cmd.computeDemands')}</button>
    <button class="cmd" data-testid="cmd-code-check" onclick={onCodeCheck}
            disabled={!canDesign}>{t('design.cmd.codeCheck')}</button>

    <div class="split">
      <button class="cmd cmd-primary" data-testid="cmd-autodesign" onclick={onAutoDesignSelected}
              disabled={!canDesign || selectedCount === 0}>
        {t('design.cmd.autoDesignSelected')}{selectedCount > 0 ? ` (${selectedCount})` : ''}
      </button>
      <button class="cmd cmd-caret" data-testid="cmd-autodesign-menu"
              aria-haspopup="menu" aria-expanded={autoMenuOpen}
              aria-label={t('design.cmd.autoDesign')}
              onclick={() => (autoMenuOpen = !autoMenuOpen)} disabled={!canDesign}>▾</button>
      {#if autoMenuOpen}
        <div class="menu" role="menu" data-testid="autodesign-menu">
          <button role="menuitem" data-testid="cmd-autodesign-undesigned"
                  onclick={() => { autoMenuOpen = false; onAutoDesignUndesigned(); }}>
            {t('design.cmd.autoDesignUndesigned')}
          </button>
        </div>
      {/if}
    </div>

    <button class="cmd cmd-all" data-testid="cmd-design-all" onclick={onDesignAll}
            disabled={!canDesign}>{t('design.cmd.designAll')}</button>

    <button class="cmd cmd-detailing" data-testid="cmd-generate-detailing"
            onclick={generateDetailing}
            disabled={!detailingReady.ready || detailingBusy || busy}
            title={detailingReady.ready ? '' : detailingBlockers}>
      {detailingBusy
        ? t('detailing.cmd.generating')
        : hasDetailing ? t('detailing.cmd.regenerate') : t('detailing.cmd.generate')}
    </button>

    <!--
      `Ver modelo 3D` — the RESULT of everything to its left, and until PR20 it was reachable
      only from inside the detailing disclosure, two levels below the commands that produce it.

      It is the same operation as the button that stays down there: both call `openRebar3D`, so
      the cage on screen is a projection of the same document instance the report, the schedule
      and the drawings render. It is disabled — not hidden — while there is nothing to draw, and
      says so, because a command that vanishes teaches nobody what it needs.
    -->
    <button
      class="cmd cmd-3d"
      data-testid="cmd-open-3d"
      onclick={open3d}
      disabled={!canOpen3d || opening3d || detailingBusy}
      title={canOpen3d ? '' : t('detailing.scene.openBlocked')}
    >
      <span aria-hidden="true">◫</span>
      {opening3d ? t('detailing.scene.opening') : t('detailing.scene.openMain')}
      {#if canOpen3d}
        <span class="cmd-3d-count" data-testid="cmd-open-3d-count">{assemblyCount}</span>
      {/if}
    </button>

    {#if busy}
      <button class="cmd cmd-cancel" data-testid="cmd-cancel" onclick={() => designRunStore.cancel()}>
        {t('design.cmd.cancel')}
      </button>
    {/if}

    <!--
      The model-diagnostics warning, at the RIGHT of this row rather than down the side of the
      panel — see `diagnostics-warning.svelte.ts` for when it is allowed to appear at all. It is
      a chip, not a column: it takes one line's height and gives the rest back.
    -->
    {#if diagnosticsWarning.visible}
      <button
        class="cmd-diag"
        data-testid="design-diagnostics-warning"
        onclick={() => { diagnosticsWarning.markSeen(); onOpenDiagnostics(); }}
        title={t('pro.fixBeforeSolve')}
      >
        <span aria-hidden="true">⚠</span>
        {tp('pro.diagWarnChip', { n: diagnosticsWarning.count })}
      </button>
    {/if}
  </div>

  {#if open3dError}
    <p class="open3d-error" role="alert" data-testid="cmd-open-3d-error">{open3dError}</p>
  {/if}

  <!-- Why the command is unavailable, in the open, with counts. -->
  {#if !detailingReady.ready && detailingBlockers}
    <p class="detailing-blockers" data-testid="detailing-prerequisites">
      {detailingBlockers}
    </p>
  {/if}

  <label class="detailing-auto" data-testid="detailing-auto-label">
    <input type="checkbox" data-testid="detailing-auto"
           checked={detailingStore.autoGenerate}
           onchange={(e) => detailingStore.setAutoGenerate(e.currentTarget.checked)} />
    {t('detailing.cmd.autoAfterDesign')}
  </label>

  {#if busy && designRunStore.progress}
    {@const p = designRunStore.progress}
    <div class="progress" role="status" aria-live="polite" data-testid="design-progress">
      <div class="progress-bar"><div class="progress-fill" style="width:{(p.done / Math.max(p.total, 1)) * 100}%"></div></div>
      <span class="progress-text">{tp('design.cmd.progress', { done: p.done, total: p.total, verified: p.verified })}</span>
    </div>
  {/if}

  <!-- Honest counts: non-passing states are NEVER folded into "verified". -->
  <div class="counts" data-testid="design-counts" aria-live="polite">
    <span class="count" data-testid="summary-count-total">{tp('design.counts.total', { n: counts.total })}</span>
    <span class="count c-ok" data-testid="summary-count-verified">✓ {counts.ok} {t('design.counts.verified')}</span>
    <span class="count c-warn" data-testid="summary-count-warn">⚠ {counts.warn} {t('design.counts.warn')}</span>
    <span class="count c-fail" data-testid="summary-count-fail">✗ {counts.fail} {t('design.counts.fail')}</span>
    <!--
      Beside `fail`, and no longer inside it.

      These members' steel does fail the authoritative verifier — by construction, on the
      biaxial refusal the outcome already declares. Reporting that as "✗ N no verifica" put
      twenty-two red crosses on the bar that meant "we did not look" next to crosses that mean
      "we looked and it does not hold". Same glyph, opposite claims.

      Always rendered, like every other display chip, so "0 provisional" is a visible zero
      rather than an absent count: the run-outcome chips below hide at zero, these do not.
    -->
    <span class="count c-prov" data-testid="summary-count-provisional">◐ {counts.provisional} {t('design.counts.provisional')}</span>
    <span class="count c-unavail" data-testid="summary-count-unavailable">○ {counts.unavailable} {t('design.counts.unavailable')}</span>
    <span class="count c-stale" data-testid="summary-count-stale">⌛ {counts.stale} {t('design.counts.stale')}</span>
    {#if run}
      <span class="count-sep">|</span>
      {#if run.sectionInadequate > 0}
        <span class="count c-sect" data-testid="summary-count-section-inadequate">
          ▣ {run.sectionInadequate} {t('design.counts.sectionInadequate')}
        </span>
      {/if}
      {#if run.searchExhausted > 0}
        <span class="count c-exh" data-testid="summary-count-exhausted">
          ◌ {run.searchExhausted} {t('design.counts.exhausted')}
        </span>
      {/if}
      {#if run.unsupported > 0}
        <span class="count c-unsup" data-testid="summary-count-unsupported">
          — {run.unsupported} {t('design.counts.unsupported')}
        </span>
      {/if}
      {#if run.aborted}
        <span class="count c-fail" data-testid="summary-aborted">{t('design.cmd.aborted')}</span>
      {/if}
      {#if run.notReached > 0}
        <span class="count c-warn" data-testid="summary-not-reached">
          {tp('design.cmd.truncated', { notReached: run.notReached })}
        </span>
      {/if}
    {/if}
  </div>

  <!-- ─── Banner stack ─── -->
  {#if !hasCombinations}
    <div class="banner banner-block" role="alert" data-testid="banner-no-combinations">
      {t('design.banner.noCombinations')}
    </div>
  {/if}

  {#if orientCount > 0}
    <div class="banner banner-block" role="alert" data-testid="banner-orientation">
      <span>{tp('design.banner.orientation', { n: orientCount })}</span>
      <button class="banner-btn" data-testid="banner-orientation-detail" onclick={onShowOrientation}>
        {t('design.banner.orientationDetail')}
      </button>
    </div>
  {/if}

  {#if verificationStore.isBaselineStale}
    <div class="banner banner-stale" role="status" data-testid="banner-stale">
      <span>⌛ {t('design.banner.staleBaseline')}</span>
      <button class="banner-btn" data-testid="banner-rerun-code-check" onclick={onCodeCheck}>
        {t('design.banner.rerunCodeCheck')}
      </button>
    </div>
  {/if}

  {#if editedCount > 0}
    <!-- Reinforcement edits do NOT make the numbers stale: verification is
         recomputed from retained demand on every edit. The banner is therefore an
         affordance, not a warning. -->
    <div class="banner banner-info" role="status" data-testid="banner-changed">
      <span>ⓘ {tp('design.banner.changed', { n: editedCount })}</span>
      <button class="banner-btn" data-testid="banner-review-changes" onclick={onReviewChanges}>
        {t('design.banner.review')}
      </button>
      <button class="banner-btn" data-testid="banner-revert-edits" onclick={onRevertEdits}>
        {t('design.banner.revert')}
      </button>
    </div>
  {/if}

  {#if provisionalCount > 0}
    <div class="banner banner-warn" role="status" data-testid="banner-provisional">
      <OutcomeBadge flag="provisional" />
      <span>{tp('design.banner.provisional', { n: provisionalCount })}</span>
      <button class="banner-btn" data-testid="banner-provisional-review" onclick={onReviewChanges}>
        {t('design.banner.review')}
      </button>
    </div>
  {/if}

  {#if designRunStore.lastError}
    <div class="banner banner-block" role="alert" data-testid="banner-error">
      {tp(designRunStore.lastError.key, designRunStore.lastError.params)}
    </div>
  {/if}
</div>

<style>
  .toolbar { display: flex; flex-direction: column; gap: 6px; padding: 8px 12px;
    background: var(--st-surface); border-bottom: 1px solid var(--st-surface-3); flex-shrink: 0; }
  .cmd-row { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
  .code-indicator {
    display: inline-flex; align-items: baseline; gap: 6px;
    padding: 4px 8px; border: 1px solid var(--st-surface-3); border-radius: 4px;
    background: var(--st-surface-3); font-size: 0.78rem; white-space: nowrap;
  }
  .code-indicator.unbound { border-color: var(--st-hair-strong); background: var(--st-bg); }
  .code-role { opacity: 0.7; }
  .code-gate {
    display: inline-flex; align-items: center; gap: 6px;
    font-size: 0.78rem; color: var(--st-warn);
  }
  .code-gate-link {
    background: none; border:  none; padding: 0; color: var(--st-info);
    text-decoration: underline; cursor: pointer; font-size: inherit;
  }
  .code-name { font-weight: 600; }
  .cmd { padding: 4px 10px; background: var(--st-surface-3); border: 1px solid var(--st-info);
    border-radius: 4px; color: var(--st-text); font-size: 0.75rem; font-weight: 600; cursor: pointer; }
  .cmd:hover:not(:disabled) { background: var(--st-hair-strong); }
  .cmd:disabled { opacity: 0.4; cursor: not-allowed; }
  .cmd:focus-visible { outline: 2px solid var(--st-value); outline-offset: 1px; }
  .cmd-primary { background: var(--st-surface-3); border-color: var(--st-info); color: var(--st-text); }
  .cmd-all { background: var(--st-hair-strong); border-color: var(--st-ok); color: var(--st-text); }
  .cmd-cancel { background: var(--st-hair-strong); border-color: var(--st-accent); color: var(--st-text); }
  .split { position: relative; display: flex; }
  .cmd-caret { border-left: none; border-top-left-radius: 0; border-bottom-left-radius: 0; padding: 4px 6px; }
  .split .cmd-primary { border-top-right-radius: 0; border-bottom-right-radius: 0; }
  .menu { position: absolute; top: 100%; left: 0; z-index: 40; margin-top: 2px;
    background: var(--st-surface-3); border: 1px solid var(--st-info); border-radius: 4px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.5); min-width: 220px; }
  .menu button { display: block; width: 100%; text-align: left; padding: 6px 10px;
    background: none; border:  1px solid var(--st-hair); color: var(--st-text); font-size: 0.75rem; cursor: pointer; }
  .menu button:hover { background: var(--st-surface-3); }

  .progress { display: flex; align-items: center; gap: 8px; }
  .progress-bar { flex: 1; height: 5px; background: var(--st-surface-3); border-radius: 3px; overflow: hidden; }
  .progress-fill { height: 100%; background: none; transition: width 0.15s linear; }
  .progress-text { font-size: 0.7rem; color: var(--st-text-2); font-family: monospace; }

  .cmd-detailing { background: var(--st-hair-strong); }

  /*
     `Ver modelo 3D` reads as the end of the row, because it is: everything to its left
     produces the thing it shows. Interactive blue rather than the accent — the accent is the
     brand and the destructive edge, and this is neither.
  */
  .cmd-3d {
    display: inline-flex; align-items: center; gap: 5px;
    background: var(--st-surface-3);
    border-color: var(--st-interactive);
    color: var(--st-text);
  }
  .cmd-3d:hover:not(:disabled) { background: var(--st-hair-strong); }
  .cmd-3d-count {
    font-family: var(--st-mono); font-size: 0.66rem; font-weight: 600;
    padding: 0 4px; border-radius: 2px;
    background: var(--st-hair); color: var(--st-text-2);
  }

  /*
     The diagnostics chip. `margin-left: auto` sends it to the right of the row and nothing
     else in the row is allowed to grow, so it stays a chip on one line instead of the column
     down the panel it used to be.
  */
  .cmd-diag {
    margin-left: auto;
    display: inline-flex; align-items: center; gap: 5px;
    padding: 4px 9px;
    background: rgba(217, 164, 65, 0.12);
    border: 1px solid var(--st-warn);
    border-radius: 4px;
    color: var(--st-warn);
    font-size: 0.72rem; font-weight: 600;
    white-space: nowrap;
    cursor: pointer;
  }
  .cmd-diag:hover { background: rgba(217, 164, 65, 0.22); }
  .cmd-diag:focus-visible { outline: 2px solid var(--st-focus); outline-offset: 1px; }

  .open3d-error {
    margin: 0.3rem 0 0;
    font-size: 0.72rem;
    color: var(--st-warn);
  }
  .detailing-blockers { margin: 0.3rem 0 0; font-size: 0.76rem; opacity: 0.85; }
  .detailing-auto { display: inline-flex; gap: 0.3rem; align-items: center; font-size: 0.76rem; margin-top: 0.3rem; }
  .counts { display: flex; gap: 9px; flex-wrap: wrap; font-size: 0.72rem; font-family: monospace; }
  .count { color: var(--st-text-2); }
  .count-sep { color: var(--st-text-3); }
  .c-ok { color: var(--st-ok); } .c-warn { color: var(--st-warn); } .c-fail { color: var(--st-accent); }
  .c-unavail { color: var(--st-text-2); } .c-stale { color: var(--st-text); }
  .c-sect { color: var(--st-accent); } .c-exh { color: var(--st-text); } .c-unsup { color: var(--st-text-2); }
  /* The same violet the 3-D view paints a proposal with. Deliberately still a literal while
     its neighbours are tokens: `three/rebar-scene.ts` owns this colour as a numeric hex for a
     Three.js material, and `run-summary-reported.test.ts` asserts that this file agrees with
     it by value. A `var()` here would break that agreement without replacing it. */
  .c-prov { color: #a066d3; }

  .banner { display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
    padding: 5px 9px; border-radius: 4px; font-size: 0.73rem; line-height: 1.45; }
  .banner-block { background: rgba(238,34,34,0.14); border: 1px solid var(--st-accent); color: var(--st-text); }
  .banner-warn { background: rgba(255,102,0,0.13); border: 1px solid var(--st-warn); color: var(--st-text); }
  .banner-info { background: rgba(127, 212, 204,0.11); border: 1px solid var(--st-hair-strong); color: var(--st-text); }
  .banner-stale { border: 1px solid var(--st-text-3); color: var(--st-text);
    background: repeating-linear-gradient(45deg, rgba(138,143,122,0.16) 0 6px, rgba(93,97,84,0.16) 6px 12px); }
  .banner-btn { padding: 2px 8px; background: rgba(255,255,255,0.08);
    border: 1px solid rgba(255,255,255,0.18); border-radius: 3px; color: inherit;
    font-size: 0.7rem; font-weight: 600; cursor: pointer; }
  .banner-btn:hover { background: rgba(255,255,255,0.16); }
  .banner-btn:focus-visible { outline: 2px solid var(--st-value); outline-offset: 1px; }
</style>
