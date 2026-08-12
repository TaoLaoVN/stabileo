<script lang="ts">
  /**
   * A committed screenshot, served as AVIF with a WebP fallback at two widths.
   * `base` is the file stem under /screenshots (no extension, no width).
   */
  type Props = { base: string; alt: string; sizes?: string; class?: string; eager?: boolean };
  let { base, alt, sizes = '(max-width: 760px) 92vw, 45vw', class: cls = '', eager = false }: Props = $props();
</script>

<picture class={cls}>
  <source
    type="image/avif"
    srcset="/screenshots/{base}-800.avif 800w, /screenshots/{base}-1600.avif 1600w"
    {sizes}
  />
  <source
    type="image/webp"
    srcset="/screenshots/{base}-800.webp 800w, /screenshots/{base}-1600.webp 1600w"
    {sizes}
  />
  <img
    src="/screenshots/{base}-1600.webp"
    {alt}
    loading={eager ? 'eager' : 'lazy'}
    decoding="async"
  />
</picture>
