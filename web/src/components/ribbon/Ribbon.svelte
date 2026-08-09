<script lang="ts">
  import { t } from '../../lib/i18n';
  import { uiStore } from '../../lib/store/ui.svelte';
  import { historyStore } from '../../lib/store/history.svelte';
  import { resultsStore } from '../../lib/store/results.svelte';
  import Icon from './Icon.svelte';
  import { runSolve } from '../../lib/actions/solve';

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
    onOpenPanel: (panel: string | null, opts?: { toggle?: boolean }) => void;
    activePanel: string | null;
  };
  let { onOpenPanel, activePanel }: Props = $props();

  type Cmd = {
    id: string;
    /** Icon name, or a function when it depends on state. */
    icon: string | (() => string);
    /** Translation key for the button label. */
    labelKey?: string | (() => string);
    /** Literal label, for symbols like N, Mz, Vy that are not translated. */
    label?: string;
    /** Translation key for the human name, shown in the tooltip. */
    nameKey?: string;
    /** Degrees to turn the icon, for a force about a perpendicular axis. */
    rotate?: number;
    tool?: string;
    panel?: string;
    diagram?: string;
    action?: () => void;
    /** Greyed when false. Never hidden. */
    enabled?: () => boolean;
    /** Only meaningful for a 3D frame; explains its own greying in 2D. */
    needs3d?: boolean;
  };

  type Group = { id: string; labelKey: string; cmds: Cmd[] };

  const solved = $derived(resultsStore.results != null || resultsStore.results3D != null);

  /*
   * The available diagrams genuinely differ between 2D and 3D — a 3D frame has
   * My, Mz, Vy, Vz and torsion where a 2D one has M, V and N. The ribbon used a
   * fixed 2D list, so in 3D it offered diagrams that did not exist and hid the
   * ones that did, and disagreed with the panel that listed them correctly.
   */
  /*
   * ONE list of diagrams, always the same length and always in the same place.
   *
   * The list was mode-dependent, so commands appeared and disappeared as the
   * user switched 2D/3D and the row re-flowed under the cursor. The same rule
   * that governs the results group before a solve governs this: a diagram that
   * does not apply to the current mode is greyed, not removed, and its tooltip
   * says why. My, Mz, Vz and torsion exist only for a 3D frame; M, V and N read
   * as their 3D counterparts, so they stay live in both.
   */
  const threeD = $derived(uiStore.analysisMode === '3d');

  /*
   * Ordered N, My, Vz, Mz, Vy, T — the pairs that share a plane sit together,
   * rather than the alphabetical order the store happens to use.
   *
   * The symbols are always fully qualified. A 2D frame bends about z and shears
   * along y, so its diagrams ARE Mz and Vy; labelling them bare "M" and "V"
   * left the user to guess which axis they meant and made the 3D-only My and Vz
   * look like different quantities rather than the other half of the same pair.
   *
   * My/Mz and Vz/Vy each share an icon turned 90°, because they are the same
   * action about perpendicular axes.
   */
  const diagramCmds = $derived.by((): Cmd[] => {
    const any = () => solved;
    const only3d = () => solved && threeD;
    return [
      { id: 'none', icon: 'none', labelKey: 'ribbon.noDiagram', panel: 'results', diagram: 'none', enabled: any },
      { id: 'deformed', icon: 'deformed', labelKey: 'ribbon.deformed', panel: 'results', diagram: 'deformed', enabled: any },
      { id: 'axial', icon: 'axial', label: 'N', nameKey: 'ribbon.nameAxial', panel: 'results', diagram: 'axial', enabled: any },
      { id: 'momentY', icon: 'moment', label: 'My', nameKey: 'ribbon.nameMomentY', panel: 'results', diagram: 'momentY', enabled: only3d, needs3d: true },
      { id: 'shearZ', icon: 'shear', label: 'Vz', nameKey: 'ribbon.nameShearZ', panel: 'results', diagram: 'shearZ', enabled: only3d, needs3d: true },
      { id: 'moment', icon: 'moment', rotate: 90, label: 'Mz', nameKey: 'ribbon.nameMomentZ', panel: 'results', diagram: threeD ? 'momentZ' : 'moment', enabled: any },
      { id: 'shear', icon: 'shear', rotate: 90, label: 'Vy', nameKey: 'ribbon.nameShearY', panel: 'results', diagram: threeD ? 'shearY' : 'shear', enabled: any },
      { id: 'torsion', icon: 'torsion', label: 'T', nameKey: 'ribbon.nameTorsion', panel: 'results', diagram: 'torsion', enabled: only3d, needs3d: true },
    ];
  });

  const GROUPS: Group[] = [
    {
      id: 'view',
      labelKey: 'ribbon.groupView',
      cmds: [
        { id: 'select', icon: 'select', labelKey: 'float.select', tool: 'select' },
        { id: 'pan', icon: 'pan', labelKey: 'float.pan', tool: 'pan' },
        /*
         * One button, not two. A pair where one is always lit reads as a
         * permanent alarm — the accent is for what you are doing now, and
         * "the view is 2D" is a condition, not an action. The button shows the
         * mode you would switch TO, which is how a toggle explains itself.
         */
        {
          id: 'dim',
          icon: () => (threeD ? 'view2d' : 'view3d'),
          labelKey: () => (threeD ? 'ribbon.view2d' : 'ribbon.view3d'),
          action: () => (uiStore.analysisMode = threeD ? '2d' : '3d'),
        },
      ],
    },
    {
      id: 'draw',
      labelKey: 'ribbon.groupDraw',
      cmds: [
        { id: 'node', icon: 'node', labelKey: 'float.node', tool: 'node' },
        { id: 'element', icon: 'element', labelKey: 'float.element', tool: 'element' },
      ],
    },
    {
      id: 'conditions',
      labelKey: 'ribbon.groupConditions',
      cmds: [
        { id: 'support', icon: 'support', labelKey: 'float.support', tool: 'support' },
        { id: 'load', icon: 'load', labelKey: 'float.load', tool: 'load' },
      ],
    },
    {
      id: 'analyse',
      labelKey: 'ribbon.tabAnalyse',
      cmds: [
        { id: 'solve', icon: 'solve', labelKey: 'pro.solve', action: () => runSolve() },
        { id: 'advanced', icon: 'advanced', labelKey: 'ribbon.advanced', panel: 'advanced' },
        { id: 'data', icon: 'data', labelKey: 'ribbon.data', panel: 'data' },
      ],
    },
    {
      id: 'results',
      labelKey: 'ribbon.tabResults',
      cmds: diagramCmds,
    },
  ];

  function run(cmd: Cmd) {
    if (cmd.enabled && !cmd.enabled()) return;
    if (cmd.tool) {
      /*
       * Arming a tool no longer opens a side panel: its options appear in the
       * contextual bar directly below, where the eye already is. It does close
       * whatever panel was open, because that panel belonged to a different
       * task than the one just started.
       */
      uiStore.currentTool = cmd.tool as never;
      onOpenPanel(null);
      return;
    }
    if (cmd.diagram) {
      /*
       * Picking a diagram OPENS the panel; it never toggles it shut. Routing it
       * through the toggle meant choosing Shear while Results was already open
       * closed the panel — the command reads as "show me this", and "show" has
       * no off state.
       */
      resultsStore.diagramType = cmd.diagram as never;
      if (cmd.action) cmd.action();
      onOpenPanel(cmd.panel ?? null, { toggle: false });
      return;
    }
    if (cmd.action) cmd.action();
    if (cmd.panel) onOpenPanel(cmd.panel);
  }

  function isActive(cmd: Cmd): boolean {
    if (cmd.tool) return uiStore.currentTool === cmd.tool;
    if (cmd.diagram) return solved && resultsStore.diagramType === cmd.diagram;
    if (cmd.panel) return activePanel === cmd.panel;
    return false;  // `dim` is a switch, not a state: it never lights up.
  }

  const mod = typeof navigator !== 'undefined' && navigator.platform?.includes('Mac') ? '⌘' : 'Ctrl';

  /** Keyboard shortcuts the application already listens for. */
  const KEYS: Record<string, string> = {
    node: 'N', element: 'E', support: 'S', load: 'L',
    select: 'V', pan: 'H', solve: 'Enter',
  };

  function cmdLabel(c: Cmd): string {
    if (c.label) return c.label;
    const k = typeof c.labelKey === 'function' ? c.labelKey() : c.labelKey;
    return k ? t(k) : '';
  }

  /**
   * Name, then shortcut, then why it is unavailable. A tooltip that only
   * repeats the visible label is wasted: these carry the full name of a symbol
   * like Mz, the key that arms the tool, and the reason a greyed command is
   * greyed.
   */
  function cmdTitle(c: Cmd, enabled: boolean): string {
    const name = c.nameKey ? t(c.nameKey) : cmdLabel(c);
    const full = c.label ? `${name} (${c.label})` : name;
    const key = KEYS[c.id];
    const withKey = key ? `${full} — ${key}` : full;
    if (enabled) return withKey;
    return `${withKey} — ${c.needs3d && !threeD ? t('ribbon.needs3d') : t('ribbon.needsSolve')}`;
  }
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
              title={cmdTitle(c, on)}
            >
              <span class="rb-icon"><Icon name={typeof c.icon === 'function' ? c.icon() : c.icon} rotate={c.rotate ?? 0} /></span>
              <span class="rb-label" class:symbol={!!c.label}>{cmdLabel(c)}</span>
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
      ><Icon name="undo" size={17} /></button>
      <button
        class="rb-quick-btn"
        onclick={() => historyStore.redo()}
        disabled={!historyStore.canRedo}
        title="{t('toolbar.redo')} ({mod}+Y)"
        aria-label={t('toolbar.redo')}
      ><Icon name="redo" size={17} /></button>
      <button
        class="rb-quick-btn"
        class:active={activePanel === 'settings'}
        onclick={() => onOpenPanel('settings')}
        title={t('ribbon.settings')}
        aria-label={t('ribbon.settings')}
        data-testid="rb-settings"
      ><Icon name="settings" size={17} /></button>
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
    display: flex;
    color: var(--st-text);
  }

  .rb-cmd:disabled .rb-icon { color: var(--st-text-2); }

  /* A symbol is the engineering notation itself, so it takes the mono face. */
  .rb-label.symbol {
    font-family: var(--st-mono);
    font-size: 0.72rem;
    letter-spacing: 0.02em;
  }

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
    display: flex;
    align-items: center;
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
    .rb-cmd { min-width: 46px; }
    .rb-group { padding: 0 0.45rem 0.2rem; }
  }

  @media (max-width: 1180px) {
    .rb-label { display: none; }
    .rb-cmd { min-width: 34px; padding: 0.35rem 0.3rem; }
    .rb-group { padding: 0 0.35rem 0.2rem; }
  }
</style>
