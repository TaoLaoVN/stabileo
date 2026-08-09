<script lang="ts">
  /**
   * A `?` that explains one option, and shows what it produces.
   *
   * The authoring panel asks a teacher to configure things whose effect is not
   * visible until a student opens the exercise — "diagram shape question" says
   * nothing about what appears on screen. So each of these carries two parts:
   * what the option does, and a small rendering of how the result looks.
   *
   * Opens on click rather than hover: hover tooltips are unreachable on a
   * tablet, which is where a teacher preparing class material often is.
   *
   * Positioned `fixed` against the VIEWPORT rather than `absolute` against the
   * panel. The first version did the latter and most bubbles ran off the right
   * edge, readable only halfway: a narrow side panel is not a viewport, and
   * anchoring to the trigger says nothing about whether the result fits on
   * screen.
   */
  import { placePopover, type Placement } from './popover-position';

  interface Props {
    /** What the option does, in a sentence or two. */
    what: string;
    /** How the result looks to a student. Rendered as a small example block. */
    example?: string;
  }
  let { what, example = '' }: Props = $props();

  let open = $state(false);
  let btn = $state<HTMLButtonElement | null>(null);
  let place = $state<Placement>({ left: 0, top: 0, width: 250, above: false });

  function reposition() {
    if (!btn) return;
    const r = btn.getBoundingClientRect();
    place = placePopover(
      { left: r.left, top: r.top, bottom: r.bottom },
      { width: window.innerWidth, height: window.innerHeight },
    );
  }

  function toggle(e: MouseEvent) {
    e.stopPropagation();
    open = !open;
    if (open) reposition();
  }

  // A fixed popover does not travel with a scrolling panel, so it closes
  // instead of drifting away from the `?` that opened it.
  $effect(() => {
    if (!open) return;
    const close = () => (open = false);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    document.addEventListener('click', close);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
      document.removeEventListener('click', close);
    };
  });
</script>

<button
  bind:this={btn}
  class="help-btn"
  class:open
  onclick={toggle}
  aria-expanded={open}
  aria-label="?"
>?</button>

{#if open}
  <div
    class="help-pop"
    style="left:{place.left}px; top:{place.top}px; width:{place.width}px"
    onclick={(e) => e.stopPropagation()}
    role="tooltip"
  >
    <p class="help-what">{what}</p>
    {#if example}
      <div class="help-example">{example}</div>
    {/if}
  </div>
{/if}

<style>
  .help-btn {
    width: 14px; height: 14px; line-height: 12px; padding: 0;
    border-radius: 50%; border: 1px solid #555; background: none;
    color: #888; font-size: 0.62rem; cursor: pointer; font-weight: 700;
    flex: none;
  }
  .help-btn:hover, .help-btn.open { border-color: #4ecdc4; color: #4ecdc4; }
  .help-pop {
    position: fixed; z-index: 200;
    padding: 8px 10px; max-height: 60vh; overflow-y: auto;
    background: #16211f; border: 1px solid #35504c; border-radius: 4px;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.6);
  }
  .help-what { margin: 0; color: #cfe3e0; font-size: 0.68rem; line-height: 1.45; }
  .help-example {
    margin-top: 6px; padding: 6px 8px; border-radius: 3px;
    background: #101a19; border-left: 2px solid #4ecdc4;
    color: #9fbfbc; font-size: 0.65rem; line-height: 1.5; white-space: pre-line;
  }
</style>
