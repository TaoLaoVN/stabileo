<script lang="ts">
  import { t } from '../../lib/i18n';
  import { uiStore } from '../../lib/store/ui.svelte';
  import { historyStore } from '../../lib/store/history.svelte';
  import { resultsStore } from '../../lib/store/results.svelte';

  /**
   * Ribbon toolbar.
   *
   * ── Groups, not tabs ──────────────────────────────────────────────────
   *
   * The first version made Model / Analyse / Results into tabs, so two thirds
   * of the commands were always hidden and getting from "draw a node" to "show
   * the moment diagram" cost a tab switch. Structural work does not divide into
   * three separate activities; it is one loop — build, solve, look — travelled
   * many times a minute, and a tab is the wrong control for something you cross
   * constantly.
   *
   * So the three are GROUPS on one permanent row, divided by rules and labelled
   * underneath. Everything is one click away and nothing moves under the cursor.
   *
   * ── Sizing ────────────────────────────────────────────────────────────
   *
   * Microsoft's ribbon guidance is that a group should carry three or four
   * predefined variants, so a narrowing window degrades smoothly instead of
   * truncating. This has four, and no variant ever drops a command — only
   * labels and scale give way:
   *
   *     ≥ 1500   large icons, a label under every command
   *     ≥ 1180   smaller icons, labels kept
   *     ≥  900   icons only; the group label carries the meaning
   *     <  900   the ribbon yields to the mobile tool strip entirely
   *
   * ── Disabled, not hidden ──────────────────────────────────────────────
   *
   * From the same guidance: a command that cannot run is greyed, never removed.
   * A control that vanishes teaches nothing and shifts its neighbours under the
   * cursor; a greyed one says the feature exists and its tooltip says what it is
   * waiting for. The diagram commands are therefore present and disabled before
   * the first solve, rather than appearing after it.
   */

  type Props = {
    onOpenPanel: (panel: string | null) => void;
    activePanel: string | null;
  };
  let { onOpenPanel, activePanel }: Props = $props();

  /**
   * Tools whose options are worth a panel. Pan acts immediately, so arming it
   * closes the panel instead of opening an empty one.
   */
  const TOOLS_WITH_OPTIONS = ['select', 'node', 'element', 'support', 'load'];

  type Cmd = {
    id: string;
    icon: string;
    labelKey: string;
    tool?: string;
    panel?: string;
    diagram?: string;
    action?: () => void;
    /** Greyed when false. Never hidden. */
    enabled?: () => boolean;
  };

  type Group = { id: string; labelKey: string; cmds: Cmd[] };

  const solved = $derived(resultsStore.results != null || resultsStore.results3D != null);

  const GROUPS: Group[] = [
    {
      id: 'model',
      labelKey: 'ribbon.tabModel',
      cmds: [
        { id: 'select', icon: '↖', labelKey: 'float.select', tool: 'select' },
        { id: 'node', icon: '●', labelKey: 'float.node', tool: 'node' },
        { id: 'element', icon: '▬', labelKey: 'float.element', tool: 'element' },
        { id: 'support', icon: '▽', labelKey: 'float.support', tool: 'support' },
        { id: 'load', icon: '↓', labelKey: 'float.load', tool: 'load' },
        { id: 'pan', icon: '✋', labelKey: 'float.pan', tool: 'pan' },
      ],
    },
    {
      id: 'analyse',
      labelKey: 'ribbon.tabAnalyse',
      cmds: [
        { id: 'dim2', icon: '▦', labelKey: 'ribbon.view2d', action: () => (uiStore.analysisMode = '2d') },
        { id: 'dim3', icon: '◈', labelKey: 'ribbon.view3d', action: () => (uiStore.analysisMode = '3d') },
        { id: 'solve', icon: '▶', labelKey: 'pro.solve', panel: 'results' },
        { id: 'advanced', icon: '⚙', labelKey: 'ribbon.advanced', panel: 'advanced' },
      ],
    },
    {
      id: 'results',
      labelKey: 'ribbon.tabResults',
      cmds: [
        { id: 'deformed', icon: '∿', labelKey: 'ribbon.deformed', panel: 'results', diagram: 'deformed', enabled: () => solved },
        { id: 'moment', icon: '◠', labelKey: 'ribbon.moment', panel: 'results', diagram: 'moment', enabled: () => solved },
        { id: 'shear', icon: '⊿', labelKey: 'ribbon.shear', panel: 'results', diagram: 'shear', enabled: () => solved },
        { id: 'axial', icon: '⇔', labelKey: 'ribbon.axial', panel: 'results', diagram: 'axial', enabled: () => solved },
        { id: 'none', icon: '⊘', labelKey: 'ribbon.noDiagram', panel: 'results', diagram: 'none', enabled: () => solved },
      ],
    },
  ];

  function run(cmd: Cmd) {
    if (cmd.enabled && !cmd.enabled()) return;
    if (cmd.tool) {
      uiStore.currentTool = cmd.tool as never;
      onOpenPanel(TOOLS_WITH_OPTIONS.includes(cmd.tool) ? 'tool' : null);
      return;
    }
    if (cmd.diagram) resultsStore.diagramType = cmd.diagram as never;
    if (cmd.action) cmd.action();
    if (cmd.panel) onOpenPanel(cmd.panel);
  }

  function isActive(cmd: Cmd): boolean {
    if (cmd.tool) return uiStore.currentTool === cmd.tool;
    if (cmd.diagram) return solved && resultsStore.diagramType === cmd.diagram;
    if (cmd.id === 'dim2') return uiStore.analysisMode === '2d';
    if (cmd.id === 'dim3') return uiStore.analysisMode === '3d';
    if (cmd.panel) return activePanel === cmd.panel;
    return false;
  }

  const mod = typeof navigator !== 'undefined' && navigator.platform?.includes('Mac') ? '⌘' : 'Ctrl';
</script>

<div class="ribbon" data-testid="ribbon">
  <div class="rb-row">
    {#each GROUPS as g (g.id)}
      <section class="rb-group" data-group={g.id} aria-label={t(g.labelKey)}>
        <div class="rb-cmds">
          {#each g.cmds as c (c.id)}
            {@const on = !c.enabled || c.enabled()}
            <button
              class="rb-cmd"
              class:active={isActive(c)}
              disabled={!on}
              data-testid="rb-cmd-{c.id}"
              onclick={() => run(c)}
              title={on ? t(c.labelKey) : `${t(c.labelKey)} — ${t('ribbon.needsSolve')}`}
            >
              <span class="rb-icon" aria-hidden="true">{c.icon}</span>
              <span class="rb-label">{t(c.labelKey)}</span>
            </button>
          {/each}
        </div>
        <p class="rb-group-label">{t(g.labelKey)}</p>
      </section>
    {/each}

    <div class="rb-spacer"></div>

    <!--
      Undo, redo and settings sit apart and never move. They apply to
      everything, so filing them under one group heading would misstate their
      scope — the same reason Office keeps its quick-access controls outside the
      tabs.
    -->
    <div class="rb-quick">
      <button
        class="rb-quick-btn"
        onclick={() => historyStore.undo()}
        disabled={!historyStore.canUndo}
        title="{t('toolbar.undo')} ({mod}+Z)"
        aria-label={t('toolbar.undo')}
      >↶</button>
      <button
        class="rb-quick-btn"
        onclick={() => historyStore.redo()}
        disabled={!historyStore.canRedo}
        title="{t('toolbar.redo')} ({mod}+Y)"
        aria-label={t('toolbar.redo')}
      >↷</button>
      <button
        class="rb-quick-btn"
        class:active={activePanel === 'settings'}
        onclick={() => onOpenPanel('settings')}
        title={t('ribbon.settings')}
        aria-label={t('ribbon.settings')}
        data-testid="rb-settings"
      >⚙</button>
    </div>
  </div>
</div>

<style>
  .ribbon {
    background: var(--st-surface);
    border-bottom: 1px solid var(--st-hair);
    font-family: var(--st-sans);
    flex: none;
    user-select: none;
  }

  .rb-row {
    display: flex;
    align-items: stretch;
    padding: 0.3rem 0.5rem 0;
    overflow-x: auto;
    scrollbar-width: thin;
  }

  /*
     The vertical rule is what makes a ribbon scan faster than a row of
     buttons: it turns seventeen commands into four things to choose between.
  */
  .rb-group {
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    padding: 0 0.6rem 0.2rem;
    border-right: 1px solid var(--st-hair);
    flex: none;
  }

  .rb-cmds { display: flex; align-items: flex-start; gap: 0.1rem; }

  .rb-cmd {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.15rem;
    min-width: 52px;
    background: none;
    border: 1px solid transparent;
    border-radius: var(--st-radius);
    color: var(--st-text-2);
    padding: 0.3rem;
    cursor: pointer;
    transition: background 0.12s, color 0.12s, border-color 0.12s;
  }

  .rb-cmd:hover:not(:disabled) { background: var(--st-surface-3); color: var(--st-text); }

  .rb-cmd.active {
    background: var(--st-selected-bg);
    border-color: var(--st-accent);
    color: var(--st-text);
  }

  .rb-cmd.active .rb-icon { color: var(--st-accent); }

  /*
     Greyed, never removed. A command that disappears when it cannot run
     teaches nothing and shifts its neighbours under the cursor; a greyed one
     says the feature exists, and its tooltip says what it is waiting for.
  */
  .rb-cmd:disabled { opacity: 0.34; cursor: default; }

  .rb-icon {
    font-size: 1.35rem;
    line-height: 1.1;
    color: var(--st-text);
  }

  .rb-cmd:disabled .rb-icon { color: var(--st-text-2); }

  .rb-label {
    font-size: 0.63rem;
    line-height: 1.15;
    text-align: center;
    max-width: 9ch;
  }

  .rb-group-label {
    margin: 0.2rem 0 0;
    text-align: center;
    font-family: var(--st-mono);
    font-size: 0.57rem;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--st-text-3);
    white-space: nowrap;
  }

  .rb-spacer { flex: 1; min-width: 0.5rem; }

  .rb-quick {
    display: flex;
    align-items: flex-start;
    gap: 0.1rem;
    padding: 0.3rem 0.2rem 0;
    flex: none;
  }

  .rb-quick-btn {
    background: none;
    border: 1px solid transparent;
    border-radius: var(--st-radius);
    color: var(--st-text-2);
    font-size: 1rem;
    line-height: 1;
    padding: 0.35rem 0.5rem;
    cursor: pointer;
    transition: background 0.12s, color 0.12s;
  }

  .rb-quick-btn:hover:not(:disabled) { background: var(--st-surface-3); color: var(--st-text); }
  .rb-quick-btn.active { color: var(--st-accent); border-color: var(--st-hair); }
  .rb-quick-btn:disabled { opacity: 0.32; cursor: default; }

  /* ── Size variants ───────────────────────────────────────────────────
     Four steps, so a narrowing window degrades smoothly rather than
     truncating. No variant drops a command: only labels and scale give way.
     ────────────────────────────────────────────────────────────────── */

  @media (max-width: 1500px) {
    .rb-icon { font-size: 1.15rem; }
    .rb-cmd { min-width: 46px; }
    .rb-group { padding: 0 0.45rem 0.2rem; }
  }

  @media (max-width: 1180px) {
    .rb-label { display: none; }
    .rb-cmd { min-width: 34px; padding: 0.35rem 0.3rem; }
    .rb-icon { font-size: 1.1rem; }
    .rb-group { padding: 0 0.35rem 0.2rem; }
  }
</style>
