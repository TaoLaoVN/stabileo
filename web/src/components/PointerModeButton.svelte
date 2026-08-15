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

<button
  class="pointer-mode"
  class:panning={isPan}
  onclick={toggle}
  title={isPan ? t('viewport.switchToSelect') : t('viewport.switchToPan')}
  aria-label={isPan ? t('viewport.switchToSelect') : t('viewport.switchToPan')}
  aria-pressed={isPan}
  data-testid="pointer-mode"
>
  <Icon name={isPan ? 'pan' : 'select'} size={17} />
</button>

<style>
  /*
   * Marked by TINT, not by the accent fill the ribbon uses for "this is what
   * the panel is showing". The pointer mode is a different kind of state — it
   * is always on, one way or the other — and painting it the same colour would
   * put a second thing in the interface claiming to be the current activity,
   * which is exactly what moving it out of the ribbon was for.
   */
  .pointer-mode {
    color: var(--st-text-2);
  }

  .pointer-mode.panning {
    color: var(--st-value);
  }
</style>
