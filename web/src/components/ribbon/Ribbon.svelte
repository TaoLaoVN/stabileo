<script lang="ts">
  import { t } from '../../lib/i18n';
  import { uiStore } from '../../lib/store/ui.svelte';
  import { historyStore } from '../../lib/store/history.svelte';
  import { resultsStore } from '../../lib/store/results.svelte';

  /**
   * Tools whose options are worth a panel. Pan and the rest act immediately,
   * so arming them closes the panel instead of opening an empty one — "in case
   * it is needed", made concrete.
   */
  const TOOLS_WITH_OPTIONS = ['select', 'node', 'element', 'support', 'load'];

  /**
   * Ribbon toolbar, in the shape CAD users already know.
   *
   * ── Why this replaces the old arrangement ─────────────────────────────
   *
   * Basic put its tools in three unrelated places: a floating tool strip over
   * the canvas, a left panel holding solve, results, examples, settings and
   * project, and a header with the mode switch. Nothing said which of them was
   * the primary surface, and the left panel permanently spent 250 px of the
   * window on controls that are used once and then ignored.
   *
   * A ribbon puts every command in one place, grouped by task and labelled, and
   * gives the canvas the whole window back. Opening something that needs more
   * than a click opens a panel on the RIGHT, which is the convention in every
   * CAD package: the drawing stays anchored to the left edge and does not jump
   * sideways when a panel appears.
   *
   * ── Structure ─────────────────────────────────────────────────────────
   *
   *   row 1   application: identity, document, save, undo/redo, settings
   *   row 2   tabs: which KIND of work you are doing
   *   row 3   groups of commands for the active tab, each with a label
   *
   * The tab is a filter over commands, not a mode: switching tabs never
   * changes the model or the tool, so a misclick costs nothing.
   */

  type Props = {
    onOpenPanel: (panel: string | null) => void;
    activePanel: string | null;
  };
  let { onOpenPanel, activePanel }: Props = $props();

  type Cmd = {
    id: string;
    icon: string;
    labelKey: string;
    /** Sets the active canvas tool. */
    tool?: string;
    /** Opens a right-hand panel instead of acting immediately. */
    panel?: string;
    /** Runs an action. */
    action?: () => void;
    /** Selects a result diagram before opening the panel. */
    diagram?: string;
    /** Large button — the primary command of its group. */
    big?: boolean;
  };

  type Group = { id: string; labelKey: string; cmds: Cmd[] };
  type Tab = { id: string; labelKey: string; groups: Group[] };

  const TABS: Tab[] = [
    {
      id: 'model',
      labelKey: 'ribbon.tabModel',
      groups: [
        {
          id: 'create',
          labelKey: 'ribbon.groupCreate',
          cmds: [
            { id: 'node', icon: '●', labelKey: 'float.node', tool: 'node', big: true },
            { id: 'element', icon: '▬', labelKey: 'float.element', tool: 'element', big: true },
          ],
        },
        {
          id: 'conditions',
          labelKey: 'ribbon.groupConditions',
          cmds: [
            { id: 'support', icon: '▽', labelKey: 'float.support', tool: 'support', big: true },
            { id: 'load', icon: '↓', labelKey: 'float.load', tool: 'load', big: true },
          ],
        },
        {
          id: 'edit',
          labelKey: 'ribbon.groupEdit',
          cmds: [
            { id: 'select', icon: '↖', labelKey: 'float.select', tool: 'select' },
            { id: 'pan', icon: '✋', labelKey: 'float.pan', tool: 'pan' },
          ],
        },
        {
          id: 'properties',
          labelKey: 'ribbon.groupProperties',
          cmds: [
            { id: 'examples', icon: '☰', labelKey: 'ribbon.examples', panel: 'examples' },
            { id: 'project', icon: '🗎', labelKey: 'ribbon.project', panel: 'project' },
          ],
        },
      ],
    },
    {
      id: 'analyse',
      labelKey: 'ribbon.tabAnalyse',
      groups: [
        {
          id: 'solve',
          labelKey: 'ribbon.groupSolve',
          cmds: [
            { id: 'solve', icon: '▶', labelKey: 'pro.solve', panel: 'results', big: true },
            { id: 'advanced', icon: '⚙', labelKey: 'ribbon.advanced', panel: 'advanced', big: true },
          ],
        },
        {
          id: 'view',
          labelKey: 'ribbon.groupView',
          cmds: [
            { id: 'dim2', icon: '2D', labelKey: 'ribbon.view2d', action: () => (uiStore.analysisMode = '2d') },
            { id: 'dim3', icon: '3D', labelKey: 'ribbon.view3d', action: () => (uiStore.analysisMode = '3d') },
          ],
        },
      ],
    },
    {
      id: 'results',
      labelKey: 'ribbon.tabResults',
      groups: [
        {
          id: 'diagrams',
          labelKey: 'ribbon.groupDiagrams',
          cmds: [
            { id: 'deformed', icon: '∿', labelKey: 'ribbon.deformed', panel: 'results', diagram: 'deformed', big: true },
            { id: 'moment', icon: '◠', labelKey: 'ribbon.moment', panel: 'results', diagram: 'moment', big: true },
            { id: 'shear', icon: '⊿', labelKey: 'ribbon.shear', panel: 'results', diagram: 'shear', big: true },
            { id: 'axial', icon: '⇔', labelKey: 'ribbon.axial', panel: 'results', diagram: 'axial', big: true },
          ],
        },
        {
          id: 'inspect',
          labelKey: 'ribbon.groupInspect',
          cmds: [
            { id: 'none', icon: '⊘', labelKey: 'ribbon.noDiagram', panel: 'results', diagram: 'none' },
          ],
        },
      ],
    },
  ];

  let activeTab = $state('model');
  const tab = $derived(TABS.find((x) => x.id === activeTab) ?? TABS[0]);

  function run(cmd: Cmd) {
    if (cmd.tool) {
      uiStore.currentTool = cmd.tool as never;
      /*
       * A tool opens its own options, or closes whatever was open. Leaving the
       * previous panel up would leave the user reading the settings of a tool
       * they just put down.
       */
      onOpenPanel(TOOLS_WITH_OPTIONS.includes(cmd.tool) ? 'tool' : null);
      return;
    }
    if (cmd.diagram) resultsStore.diagramType = cmd.diagram as never;
    if (cmd.action) cmd.action();
    if (cmd.panel) onOpenPanel(cmd.panel);
  }

  /** A command reads as current when its tool is armed or its panel is open. */
  function isActive(cmd: Cmd): boolean {
    if (cmd.tool) return uiStore.currentTool === cmd.tool;
    if (cmd.diagram) return resultsStore.diagramType === cmd.diagram;
    if (cmd.panel) return activePanel === cmd.panel;
    if (cmd.id === 'dim2') return uiStore.analysisMode === '2d';
    if (cmd.id === 'dim3') return uiStore.analysisMode === '3d';
    return false;
  }

  const mod = typeof navigator !== 'undefined' && navigator.platform?.includes('Mac') ? '⌘' : 'Ctrl';
</script>

<div class="ribbon">
  <!-- Row 2: which kind of work. Row 1 is the application header. -->
  <div class="rb-tabs" role="tablist" aria-label={t('ribbon.tabs')}>
    {#each TABS as x}
      <button
        role="tab"
        class="rb-tab"
        class:active={activeTab === x.id}
        aria-selected={activeTab === x.id}
        data-testid="rb-tab-{x.id}"
        onclick={() => (activeTab = x.id)}
      >{t(x.labelKey)}</button>
    {/each}

    <div class="rb-tabs-spacer"></div>

    <!--
      Undo/redo and save live on the tab row rather than inside a group: they
      apply to every tab, and a command that is always available should not
      move when the tab changes.
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
        onclick={() => onOpenPanel('settings')}
        class:active={activePanel === 'settings'}
        title={t('ribbon.settings')}
        aria-label={t('ribbon.settings')}
        data-testid="rb-settings"
      >⚙</button>
    </div>
  </div>

  <!-- Row 3: the commands of the active tab, grouped and labelled. -->
  <div class="rb-groups" data-testid="rb-groups">
    {#each tab.groups as g (g.id)}
      <section class="rb-group" aria-label={t(g.labelKey)}>
        <div class="rb-cmds">
          {#each g.cmds as c (c.id)}
            <button
              class="rb-cmd"
              class:big={c.big}
              class:active={isActive(c)}
              data-testid="rb-cmd-{c.id}"
              onclick={() => run(c)}
              title={t(c.labelKey)}
            >
              <span class="rb-icon" aria-hidden="true">{c.icon}</span>
              <span class="rb-label">{t(c.labelKey)}</span>
            </button>
          {/each}
        </div>
        <p class="rb-group-label">{t(g.labelKey)}</p>
      </section>
    {/each}
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

  /* ── Row 2: tabs ─────────────────────────────────────────────────────── */

  .rb-tabs {
    display: flex;
    align-items: stretch;
    gap: 0.15rem;
    padding: 0 0.6rem;
    border-bottom: 1px solid var(--st-hair);
    min-height: 32px;
  }

  .rb-tab {
    background: none;
    border: none;
    border-bottom: 2px solid transparent;
    color: var(--st-text-2);
    font-family: var(--st-mono);
    font-size: 0.68rem;
    font-weight: 600;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    padding: 0.5rem 0.9rem 0.4rem;
    cursor: pointer;
    transition: color 0.12s, border-color 0.12s;
  }

  .rb-tab:hover { color: var(--st-text); }

  /*
    The active tab is marked with a rule rather than a filled pill: the ribbon
    already carries a lot of small shapes, and a filled tab competes with the
    command buttons for the same attention.
  */
  .rb-tab.active {
    color: var(--st-text);
    border-bottom-color: var(--st-accent);
  }

  .rb-tabs-spacer { flex: 1; }

  .rb-quick { display: flex; align-items: center; gap: 0.15rem; }

  .rb-quick-btn {
    background: none;
    border: 1px solid transparent;
    border-radius: var(--st-radius);
    color: var(--st-text-2);
    font-size: 0.95rem;
    line-height: 1;
    padding: 0.3rem 0.5rem;
    cursor: pointer;
    transition: background 0.12s, color 0.12s;
  }

  .rb-quick-btn:hover:not(:disabled) {
    background: var(--st-surface-3);
    color: var(--st-text);
  }

  .rb-quick-btn.active {
    color: var(--st-accent);
    border-color: var(--st-hair);
  }

  .rb-quick-btn:disabled { opacity: 0.32; cursor: default; }

  /* ── Row 3: command groups ───────────────────────────────────────────── */

  .rb-groups {
    display: flex;
    align-items: stretch;
    gap: 0;
    padding: 0.35rem 0.6rem 0;
    overflow-x: auto;
  }

  /*
    The vertical rule between groups is the whole reason a ribbon scans
    faster than a row of buttons: it turns eighteen commands into four things
    to choose between.
  */
  .rb-group {
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    padding: 0 0.7rem 0.25rem;
    border-right: 1px solid var(--st-hair);
  }

  .rb-group:last-child { border-right: none; }

  .rb-cmds { display: flex; align-items: flex-start; gap: 0.15rem; }

  .rb-cmd {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.2rem;
    min-width: 46px;
    background: none;
    border: 1px solid transparent;
    border-radius: var(--st-radius);
    color: var(--st-text-2);
    padding: 0.3rem 0.35rem;
    cursor: pointer;
    transition: background 0.12s, color 0.12s, border-color 0.12s;
  }

  .rb-cmd:hover { background: var(--st-surface-3); color: var(--st-text); }

  .rb-cmd.active {
    background: var(--st-selected-bg);
    border-color: var(--st-accent);
    color: var(--st-text);
  }

  .rb-icon {
    font-size: 1.05rem;
    line-height: 1.1;
    color: var(--st-text);
  }

  .rb-cmd.big .rb-icon { font-size: 1.45rem; }
  .rb-cmd.big { min-width: 58px; }
  .rb-cmd.active .rb-icon { color: var(--st-accent); }

  .rb-label {
    font-size: 0.64rem;
    line-height: 1.15;
    text-align: center;
    max-width: 8ch;
  }

  .rb-group-label {
    margin: 0.25rem 0 0;
    text-align: center;
    font-family: var(--st-mono);
    font-size: 0.58rem;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--st-text-3);
  }

  @media (max-width: 900px) {
    .rb-label { display: none; }
    .rb-cmd, .rb-cmd.big { min-width: 38px; }
    .rb-group-label { font-size: 0.52rem; }
  }
</style>
