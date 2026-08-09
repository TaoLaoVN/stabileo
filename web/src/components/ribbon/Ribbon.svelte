<script lang="ts">
  import { t } from '../../lib/i18n';
  import { TWO_D_INTERNAL_FORCE_LABELS as F2D } from '../../lib/geometry/coordinate-system';
  import { uiStore } from '../../lib/store/ui.svelte';
  import { historyStore } from '../../lib/store/history.svelte';
  import { resultsStore } from '../../lib/store/results.svelte';
  import Icon from './Icon.svelte';
  import { runSolve } from '../../lib/actions/solve';
  import { saveProject } from '../../lib/store/file';

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
    /** Literal label, for symbols like N, My, Vz that are not translated. */
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
   * Greying beats hiding for a command that could apply here but cannot run
   * yet — that is why the whole results group is present and disabled before
   * the first solve. It does NOT apply to a quantity that has no meaning in
   * the current mode: Mz and Vy are out-of-plane and simply do not exist in a
   * 2D model, so in 2D they are absent rather than greyed. See below.
   */
  const threeD = $derived(uiStore.analysisMode === '3d');

  /*
   * Ordered N, My, Vz, Mz, Vy, T — the pairs that share a plane sit together,
   * rather than the alphabetical order the store happens to use.
   *
   * ── Which axis a 2D diagram is about ──────────────────────────────────
   *
   * The 2D plane is x–z, and a 2D node's degrees of freedom are ux, uz and θy.
   * A 2D frame therefore bends about its local y and shears along its local z:
   * its two diagrams are **My and Vz**, the same two an identical model shows
   * in 3D. Mz and Vy are the out-of-plane pair and cannot exist in 2D at all,
   * so they are not offered there.
   *
   * These were labelled Mz and Vy, which is the pre-migration Y-up naming from
   * before the app moved to Z-up. The engine still carries that history: the
   * Rust `Reaction` struct serialises `rx`, `rz`, `my` and keeps `ry`/`mz` only
   * as deserialise aliases for old files. Anything in the UI still saying Mz or
   * Vy about a 2D model is a leftover from that migration.
   *
   * The consequence was not cosmetic. The same model solved in 2D and in 3D
   * put the identical diagram under two different names — 2D's "Mz" was 3D's
   * "My" — so comparing the two modes suggested the solver disagreed with
   * itself.
   *
   * My/Mz and Vz/Vy each share an icon; the out-of-plane one is turned 90°,
   * because it is the same action about a perpendicular axis.
   */
  const diagramCmds = $derived.by((): Cmd[] => {
    const any = () => solved;
    const only3d = () => solved && threeD;
    const cmds: Cmd[] = [
      { id: 'none', icon: 'none', labelKey: 'ribbon.noDiagram', panel: 'results', diagram: 'none', enabled: any },
      { id: 'deformed', icon: 'deformed', labelKey: 'ribbon.deformed', panel: 'results', diagram: 'deformed', enabled: any },
      { id: 'axial', icon: 'axial', label: F2D.axial, nameKey: 'ribbon.nameAxial', panel: 'results', diagram: 'axial', enabled: any },
      { id: 'momentY', icon: 'moment', label: F2D.moment, nameKey: 'ribbon.nameMomentY', panel: 'results', diagram: threeD ? 'momentY' : 'moment', enabled: any },
      { id: 'shearZ', icon: 'shear', label: F2D.shear, nameKey: 'ribbon.nameShearZ', panel: 'results', diagram: threeD ? 'shearZ' : 'shear', enabled: any },
    ];
    /*
     * Out-of-plane, so absent rather than disabled in 2D. A greyed-out Mz would
     * imply the quantity exists here and is merely unavailable; it does not.
     */
    if (threeD) {
      cmds.push(
        { id: 'moment', icon: 'moment', rotate: 90, label: 'Mz', nameKey: 'ribbon.nameMomentZ', panel: 'results', diagram: 'momentZ', enabled: only3d, needs3d: true },
        { id: 'shear', icon: 'shear', rotate: 90, label: 'Vy', nameKey: 'ribbon.nameShearY', panel: 'results', diagram: 'shearY', enabled: only3d, needs3d: true },
        { id: 'torsion', icon: 'torsion', label: 'T', nameKey: 'ribbon.nameTorsion', panel: 'results', diagram: 'torsion', enabled: only3d, needs3d: true },
      );
    }
    return cmds;
  });

  /*
   * Derived, not a plain const.
   *
   * This was evaluated once at component init, which read `diagramCmds` and
   * froze that snapshot. It happened to work while the diagram list was always
   * the same length and only its `enabled`/`diagram` closures varied — those
   * are re-read on every render. It stops working the moment the list's LENGTH
   * depends on the mode, which is what hiding the out-of-plane Mz and Vy in 2D
   * does: switching to 3D left the ribbon showing the 2D list forever.
   */
  const GROUPS: Group[] = $derived([
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
  ]);

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
    <!--
      Document-level commands, in their own box before the first group.
      ─────────────────────────────────────────────────────────────────
      Examples, Project, Save, Undo, Redo and Settings do not act on the model
      in front of you — they act on WHICH model you have, or on the application
      itself. Filing them under a group heading would misstate their scope, and
      scattering them (two in the title bar, three at the far right) made the
      most consequential commands in the window the hardest to find.

      Word puts exactly this set in a quick-access block pinned ahead of the
      ribbon's first tab, and that is what this is: leftmost, boxed off by a
      rule, never moving, never changing with the mode.
    -->
    <div class="rb-quick" data-testid="rb-quick">
      <button
        class="rb-quick-btn"
        class:active={activePanel === 'examples'}
        onclick={() => onOpenPanel('examples')}
        title={t('ribbon.examples')}
        aria-label={t('ribbon.examples')}
        data-testid="hdr-examples"
      ><Icon name="examples" size={17} /></button>
      <button
        class="rb-quick-btn"
        class:active={activePanel === 'project'}
        onclick={() => onOpenPanel('project')}
        title={t('ribbon.project')}
        aria-label={t('ribbon.project')}
        data-testid="hdr-project"
      ><Icon name="project" size={17} /></button>
      <!--
        Save is in the Project panel too. It is here as well because it is the
        one command in that panel you run repeatedly, and reaching it through a
        panel is three actions for something that should be one.
      -->
      <button
        class="rb-quick-btn"
        onclick={() => saveProject()}
        title="{t('project.saveTab')} ({mod}+S)"
        aria-label={t('project.saveTab')}
        data-testid="rb-save"
      ><Icon name="save" size={17} /></button>
      <span class="rb-quick-sep" aria-hidden="true"></span>
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

  /*
     Boxed off, ahead of the first group, with the same rule the groups use
     between themselves — so it reads as a peer of the groups rather than as
     part of View, which is what it would look like sitting flush against it.
  */
  .rb-quick {
    display: flex;
    align-items: center;
    gap: 0.1rem;
    padding: 0 0.5rem 0 0.2rem;
    margin-right: 0.35rem;
    border-right: 1px solid var(--st-hair);
    align-self: stretch;
    flex: none;
  }

  /* Document commands | history and settings. */
  .rb-quick-sep {
    width: 1px;
    align-self: center;
    height: 16px;
    margin: 0 0.25rem;
    background: var(--st-hair);
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
