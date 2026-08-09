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
   */
  interface Props {
    /** What the option does, in a sentence or two. */
    what: string;
    /** How the result looks to a student. Rendered as a small example block. */
    example?: string;
  }
  let { what, example = '' }: Props = $props();
  let open = $state(false);
</script>

<span class="help-wrap">
  <button
    class="help-btn"
    class:open
    onclick={(e) => { e.stopPropagation(); open = !open; }}
    aria-expanded={open}
    aria-label="?"
  >?</button>
  {#if open}
    <div class="help-pop">
      <p class="help-what">{what}</p>
      {#if example}
        <div class="help-example">{example}</div>
      {/if}
    </div>
  {/if}
</span>

<style>
  .help-wrap { position: relative; display: inline-flex; }
  .help-btn {
    width: 14px; height: 14px; line-height: 12px; padding: 0;
    border-radius: 50%; border: 1px solid #555; background: none;
    color: #888; font-size: 0.62rem; cursor: pointer; font-weight: 700;
  }
  .help-btn:hover, .help-btn.open { border-color: #4ecdc4; color: #4ecdc4; }
  .help-pop {
    position: absolute; top: 18px; left: -6px; z-index: 40;
    width: 250px; padding: 8px 10px;
    background: #16211f; border: 1px solid #35504c; border-radius: 4px;
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.5);
  }
  .help-what { margin: 0; color: #cfe3e0; font-size: 0.68rem; line-height: 1.45; }
  .help-example {
    margin-top: 6px; padding: 6px 8px; border-radius: 3px;
    background: #101a19; border-left: 2px solid #4ecdc4;
    color: #9fbfbc; font-size: 0.65rem; line-height: 1.5; white-space: pre-line;
  }
</style>
