<script lang="ts">
  /**
   * One stage of the concrete workflow, in the shape every stage uses.
   *
   * ── Why a shared shell ─────────────────────────────────────────────
   *
   * The panel's sections were three identical grey `<summary>` bars and one section with no header
   * at all. Nothing on them said what the section was FOR, whether it had run, or where it sat in
   * the order — so the only way to read the panel was to know the code. Worse, each section had
   * grown its own layout, so the tab read as four small applications stacked vertically.
   *
   * This is the repeatable pattern: number, title, one sentence of purpose, and a state that is
   * carried by a glyph AND a word, never by colour alone. A section that adopts it cannot forget
   * to say what it is.
   *
   * ── What it deliberately does not do ───────────────────────────────
   *
   * It runs nothing. The primary action of a stage lives in the stage's own body, next to the
   * things it acts on; a shell that also held buttons would put every command two owners away
   * from its own context and would compete with the command row.
   *
   * `open` is bound, so the parent keeps control of which stages are expanded — the workflow strip
   * navigates by opening them, and that has to keep working.
   */
  import type { Snippet } from 'svelte';
  import { t } from '../../../lib/i18n';

  type State = 'done' | 'current' | 'blocked' | 'optional';

  interface Props {
    /** Position in the pipeline, shown in the marker. */
    step: number;
    title: string;
    /** One sentence: what this stage is for. Never a restatement of the title. */
    purpose: string;
    state: State;
    /** What is missing, when the stage cannot run yet. Shown instead of the purpose. */
    blockedBy?: string;
    /** A count worth seeing without opening — assemblies, footings. */
    badge?: string | number;
    /**
     * Test ids for the two chips.
     *
     * Overridable because the ids they replaced — `detailing-count`, `floor-not-verified-count` —
     * are a contract other specs already depend on. The chips are the same facts in a new shell;
     * renaming them would have been churn that broke coverage for no user-visible reason.
     */
    badgeTestid?: string;
    attentionTestid?: string;
    /** Something that needs attention, shown as a warning chip. */
    attention?: string;
    open?: boolean;
    testid: string;
    children: Snippet;
  }
  let {
    step, title, purpose, state, blockedBy, badge, attention,
    badgeTestid, attentionTestid,
    open = $bindable(false), testid, children,
  }: Props = $props();

  /** Glyph and word per state, so the state never depends on the colour. */
  const STATE_TEXT: Record<State, { glyph: string; key: string }> = {
    done: { glyph: '✓', key: 'design.stageCard.done' },
    current: { glyph: '▸', key: 'design.stageCard.current' },
    blocked: { glyph: '·', key: 'design.stageCard.blocked' },
    optional: { glyph: '○', key: 'design.stageCard.optional' },
  };
</script>

<details class="stage" data-testid={testid} data-state={state} bind:open>
  <summary>
    <span class="marker" data-state={state} aria-hidden="true">
      {state === 'done' ? '✓' : step}
    </span>
    <span class="head">
      <span class="title-row">
        <span class="title">{title}</span>
        <!-- Glyph + word: the state is legible with the colour removed. -->
        <span class="state" data-testid={`${testid}-state`}>
          <span aria-hidden="true">{STATE_TEXT[state].glyph}</span>
          {t(STATE_TEXT[state].key)}
        </span>
        {#if badge !== undefined}
          <span class="badge" data-testid={badgeTestid ?? `${testid}-badge`}>{badge}</span>
        {/if}
        {#if attention}
          <span class="attention" data-testid={attentionTestid ?? `${testid}-attention`}>⚠ {attention}</span>
        {/if}
      </span>
      <!-- Purpose, or the requirement that replaces it while the stage cannot run. -->
      <span class="purpose" data-testid={`${testid}-purpose`}>
        {state === 'blocked' && blockedBy ? blockedBy : purpose}
      </span>
    </span>
  </summary>
  <div class="body">{@render children()}</div>
</details>

<style>
  /*
    One shell, one set of paddings.

    `flex: 0 0 auto` and a capped open height keep the column scrollable as a whole: the panel has
    ONE scroll, and a section that grew its own nested scroller is how content ends up unreachable
    at 720 px.
  */
  .stage {
    flex: 0 0 auto;
    min-height: 0;
    border-bottom: 1px solid var(--st-hair);
    background: var(--st-surface);
  }
  .stage[open] { max-height: 70vh; overflow: auto; }

  summary {
    display: flex;
    align-items: flex-start;
    gap: 0.5rem;
    padding: 0.5rem 0.75rem;
    cursor: pointer;
    list-style: none;
  }
  summary::-webkit-details-marker { display: none; }
  summary:hover { background: var(--st-surface-3); }
  summary:focus-visible { outline: 2px solid var(--st-value); outline-offset: -2px; }

  .marker {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.25rem;
    height: 1.25rem;
    flex: 0 0 auto;
    margin-top: 0.05rem;
    border-radius: 50%;
    border: 1px solid var(--st-hair-strong);
    font-size: 0.66rem;
    font-weight: 700;
    color: var(--st-text-2);
  }
  .marker[data-state='done'] { border-color: var(--st-ok); color: var(--st-ok); }
  .marker[data-state='current'] { border-color: var(--st-interactive); color: var(--st-interactive); }

  .head { display: flex; flex-direction: column; gap: 0.1rem; min-width: 0; }
  .title-row { display: flex; align-items: baseline; gap: 0.4rem; flex-wrap: wrap; }
  .title { font-size: 0.85rem; font-weight: 600; color: var(--st-text); }

  .state {
    font-size: 0.65rem;
    font-weight: 600;
    letter-spacing: 0.02em;
    color: var(--st-text-2);
    white-space: nowrap;
  }
  .stage[data-state='done'] .state { color: var(--st-ok); }
  .stage[data-state='current'] .state { color: var(--st-interactive); }

  .badge {
    font-size: 0.68rem; font-weight: 600;
    padding: 0.02rem 0.35rem; border-radius: 3px;
    background: var(--st-surface-3); color: var(--st-text);
  }
  /* Attention is never green, and it carries its own glyph. */
  .attention {
    font-size: 0.66rem; font-weight: 600;
    padding: 0.02rem 0.35rem; border-radius: 3px;
    background: var(--st-surface-3); color: var(--st-warn);
  }

  .purpose {
    font-size: 0.7rem;
    line-height: 1.35;
    color: var(--st-text-2);
  }

  /* One padding for every stage body, so nothing touches the panel's edge. */
  .body { padding: 0 0.75rem 0.7rem; }
</style>
