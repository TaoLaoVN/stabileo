<script lang="ts">
  /**
   * Line icons for the ribbon.
   *
   * The ribbon shipped with Unicode glyphs — ●, ▬, ▽, ✋ — which was quick and
   * looked it. They came from different typefaces, so their weights and optical
   * sizes never matched; several are emoji on some platforms and render in
   * colour; and none of them says anything specific about structural analysis.
   * A hand does not mean "pan" any more than a triangle means "pinned support".
   *
   * These are drawn instead: one 24×24 grid, one stroke weight, `currentColor`
   * so a disabled or active button tints them with no extra rules, and shapes
   * taken from the drawings an engineer already reads — a roller on its
   * circles, a moment as a parabola, shear as the step it actually is.
   *
   * `stroke-width` is 1.6 at 24 units, which lands near a hairline at the sizes
   * the ribbon uses and keeps the icons in the same visual family as the
   * hairline borders around them.
   */

  type Props = { name: string; size?: number };
  let { name, size = 22 }: Props = $props();
</script>

<svg
  class="icon"
  width={size}
  height={size}
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="1.6"
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
  focusable="false"
>
  {#if name === 'select'}
    <!-- Arrow cursor, the one shape every application agrees on. -->
    <path d="M5 3l6.5 16 2.2-6.4 6.3-2.2z" />
  {:else if name === 'pan'}
    <!-- Four-way move, not a hand: the gesture is panning, not grabbing. -->
    <path d="M12 3v18M3 12h18" />
    <path d="M12 3l-2.4 2.6M12 3l2.4 2.6M12 21l-2.4-2.6M12 21l2.4-2.6" />
    <path d="M3 12l2.6-2.4M3 12l2.6 2.4M21 12l-2.6-2.4M21 12l-2.6 2.4" />
  {:else if name === 'view2d'}
    <!-- A framed plane with its grid. -->
    <rect x="3.5" y="4.5" width="17" height="15" rx="1" />
    <path d="M9 4.5v15M15 4.5v15M3.5 9.5h17M3.5 14.5h17" />
  {:else if name === 'view3d'}
    <!-- Isometric box. -->
    <path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z" />
    <path d="M12 3v18M4 7.5l8 4.5 8-4.5" />
  {:else if name === 'node'}
    <!-- A joint: the point plus the crosshair that places it. -->
    <circle cx="12" cy="12" r="3" />
    <path d="M12 2.5v4M12 17.5v4M2.5 12h4M17.5 12h4" />
  {:else if name === 'element'}
    <!-- A member spanning two joints. -->
    <path d="M6.6 17.4L17.4 6.6" />
    <circle cx="5" cy="19" r="2" />
    <circle cx="19" cy="5" r="2" />
  {:else if name === 'support'}
    <!-- Pinned support: triangle on hatched ground. -->
    <path d="M12 6l6 9H6z" />
    <path d="M3.5 15h17" />
    <path d="M6 15l-1.8 3M11 15l-1.8 3M16 15l-1.8 3M21 15l-1.8 3" />
  {:else if name === 'load'}
    <!-- Point load onto a member. -->
    <path d="M12 3v12" />
    <path d="M8.4 11.6L12 15.4l3.6-3.8" />
    <path d="M4 19.5h16" />
  {:else if name === 'solve'}
    <path d="M7 4.5l12 7.5-12 7.5z" />
  {:else if name === 'advanced'}
    <!-- Sliders: parameters, not a gear. A gear means settings. -->
    <path d="M4 7h10M18 7h2M4 12h4M12 12h8M4 17h9M17 17h3" />
    <circle cx="16" cy="7" r="2" />
    <circle cx="10" cy="12" r="2" />
    <circle cx="15" cy="17" r="2" />
  {:else if name === 'data'}
    <!-- A table, because that is literally what the panel shows. -->
    <rect x="3.5" y="4.5" width="17" height="15" rx="1" />
    <path d="M3.5 9.5h17M3.5 14.5h17M9.5 4.5v15" />
  {:else if name === 'settings'}
    <circle cx="12" cy="12" r="3.2" />
    <path d="M12 2.5v2.6M12 18.9v2.6M2.5 12h2.6M18.9 12h2.6M5.2 5.2l1.9 1.9M16.9 16.9l1.9 1.9M18.8 5.2l-1.9 1.9M7.1 16.9l-1.9 1.9" />
  {:else if name === 'undo'}
    <path d="M4 10h10a5 5 0 0 1 0 10H8" />
    <path d="M7.5 6.5L4 10l3.5 3.5" />
  {:else if name === 'redo'}
    <path d="M20 10H10a5 5 0 0 0 0 10h6" />
    <path d="M16.5 6.5L20 10l-3.5 3.5" />
  {:else if name === 'none'}
    <circle cx="12" cy="12" r="8.5" />
    <path d="M6 18L18 6" />
  {:else if name === 'deformed'}
    <!-- The undeflected member, ghosted, with the deflected one over it. -->
    <path d="M3 8h18" opacity="0.4" />
    <path d="M3 8c4 0 5 9 9 9s5-9 9-9" />
  {:else if name === 'moment'}
    <!-- Parabola on a baseline: the bending diagram itself. -->
    <path d="M3 6h18" />
    <path d="M3 6c3.5 0 5 12 9 12s5.5-12 9-12" />
  {:else if name === 'momentY' || name === 'momentZ'}
    <path d="M3 6h18" />
    <path d="M3 6c3.5 0 5 12 9 12s5.5-12 9-12" />
  {:else if name === 'shear' || name === 'shearZ'}
    <!-- Shear is a step function, and it is drawn as one. -->
    <path d="M3 12h6V5h6v14h6" />
  {:else if name === 'axial'}
    <path d="M3 12h18" />
    <path d="M6.5 8.5L3 12l3.5 3.5M17.5 8.5L21 12l-3.5 3.5" />
  {:else if name === 'torsion'}
    <path d="M4 12a8 8 0 1 1 3 6.2" />
    <path d="M3.2 8.6L4 12.4l3.8-.9" />
  {:else if name === 'examples'}
    <path d="M4 6.5h16M4 12h16M4 17.5h10" />
  {:else if name === 'project'}
    <path d="M5 3.5h9l5 5v12H5z" />
    <path d="M14 3.5v5h5" />
  {/if}
</svg>

<style>
  .icon {
    display: block;
    flex: none;
  }
</style>
