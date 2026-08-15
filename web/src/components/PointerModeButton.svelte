<script lang="ts">
  /**
   * Select or pan, on the model rather than in the ribbon.
   *
   * # Why it moved
   *
   * These two are not tasks, they are how you hold the mouse — the thing you
   * switch mid-gesture, twenty times while reading a result. They sat in the
   * ribbon among the commands that open panels, which put them in permanent
   * competition with everything else for what the ribbon highlights: after a
   * solve, a lit diagram plus a lit Select meant two commands claimed to be
   * the current activity while the right-hand panel could only show one.
   *
   * Moved here, that contradiction cannot arise. The ribbon highlights what the
   * panel is showing; the pointer mode is a property of the cursor and says so
   * where the cursor is.
   *
   * # Why a toggle rather than two buttons
   *
   * There are exactly two states and they are mutually exclusive, so a single
   * control that shows the CURRENT one and switches on click carries the same
   * information in half the space — and cannot display the impossible state of
   * both or neither, which two buttons can.
   */
  import { uiStore } from '../lib/store';
  import { t } from '../lib/i18n';
  import Icon from './ribbon/Icon.svelte';

  const isPan = $derived(uiStore.currentTool === 'pan');
  const action = $derived(isPan ? t('viewport.switchToSelect') : t('viewport.switchToPan'));

  function toggle() {
    /*
     * Assigned through the store's setter, which is where the rule lives that
     * arming an EDIT tool puts a diagram away. Select and pan are not edit
     * tools, so nothing is put away here — which is the whole point of them
     * being persistent.
     */
    uiStore.currentTool = isPan ? 'select' : 'pan';
  }
</script>

<!--
  The tip is a sibling inside the wrapper rather than the native `title`,
  because it has to say two different KINDS of thing: what the click does, and
  where the other half of the setting lives. A title attribute renders those as
  one run-on line with no way to separate them, and the second sentence is the
  one that answers the question people actually arrive with — "it selects
  members and I want nodes".
-->
<div class="pm-wrap">
  <button
    class="pointer-mode"
    class:panning={isPan}
    onclick={toggle}
    aria-label={action}
    aria-pressed={isPan}
    data-testid="pointer-mode"
  >
    <Icon name={isPan ? 'pan' : 'select'} size={17} />
  </button>

  <div class="pm-tip" role="tooltip">
    <p class="pm-tip-action">{action}</p>
    <!--
      Only while selecting: pointed at the panel that decides WHAT a drag
      picks up. In pan mode there is no such setting in play and the sentence
      would be advice about a mode the user is not in.
    -->
    {#if !isPan}
      <p class="pm-tip-note">{t('viewport.selectKindHint')}</p>
    {/if}
  </div>
</div>

<style>
  .pm-wrap {
    position: relative;
    display: flex;
  }

  /*
   * Sized and skinned as the twin of zoom-to-fit directly below it. It had
   * been a ribbon-shaped tile — icon over label, 46 px tall and full width —
   * which read as a heading for the stack rather than a member of it. The
   * label is gone with it: two floating buttons in a column, one labelled and
   * one not, is the mismatch you notice before you read either.
   */
  .pointer-mode {
    width: 32px;
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    border: 1px solid var(--st-hair-strong);
    border-radius: var(--st-radius);
    background: color-mix(in srgb, var(--st-surface) 90%, transparent);
    color: var(--st-text-2);
    cursor: pointer;
    transition: background 0.15s, color 0.15s, border-color 0.15s;
  }

  .pointer-mode:hover {
    background: var(--st-surface-3);
    color: var(--st-text);
  }

  /*
   * Marked by TINT, never by the accent fill the ribbon uses for "this is what
   * the panel is showing". The pointer mode is a different kind of state — it
   * is always on, one way or the other — and painting it the same colour would
   * put a second thing on screen claiming to be the current activity, which is
   * exactly what moving it out of the ribbon was for.
   */
  .pointer-mode.panning {
    color: var(--st-value);
    border-color: color-mix(in srgb, var(--st-value) 45%, transparent);
  }

  .pm-tip {
    position: absolute;
    /* Opens leftward: the button is pinned to the right edge of the viewport
       and there is nothing to the right of it to open into. */
    right: calc(100% + 6px);
    top: 0;
    width: max-content;
    max-width: 220px;
    padding: 6px 8px;
    border: 1px solid var(--st-hair-strong);
    border-radius: var(--st-radius);
    background: var(--st-surface);
    box-shadow: 0 2px 8px rgb(0 0 0 / 0.18);
    opacity: 0;
    visibility: hidden;
    transition: opacity 0.12s;
    pointer-events: none;
    z-index: 20;
  }

  .pm-wrap:hover .pm-tip,
  .pm-wrap:focus-within .pm-tip {
    opacity: 1;
    visibility: visible;
  }

  .pm-tip p { margin: 0; }

  .pm-tip-action {
    font-size: 0.72rem;
    line-height: 1.3;
    color: var(--st-text);
  }

  /* Separated by a rule, not just space: it is a different kind of statement —
     the first line says what the click does, this one says where a related
     setting lives. */
  .pm-tip-note {
    margin-top: 6px !important;
    padding-top: 6px;
    border-top: 1px solid var(--st-hair);
    font-size: 0.66rem;
    line-height: 1.4;
    color: var(--st-text-3);
  }
</style>
