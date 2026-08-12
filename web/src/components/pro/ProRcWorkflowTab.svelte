<script lang="ts">
  /**
   * RC Design Workflow — single entry point for RC design.
   *
   * Verification now appears inline within each expanded element row in the
   * Design tab. The separate RC Verification subtab has been removed.
   *
   * Verification state lives in verificationStore (single source of truth).
   * This component is a thin layout wrapper — no props needed.
   *
   * The regulation settings sit above the design table, collapsed by default, because
   * they are project facts that decide which rules the table below was produced under.
   * They are one disclosure away rather than in a dialog, so a reviewer can always see
   * which edition and which aggregate size a result belongs to.
   */
  import ProDesignTab from './ProDesignTab.svelte';
  import WorkflowStages from './design/WorkflowStages.svelte';
  import ProjectRegulationsPanel from './design/ProjectRegulationsPanel.svelte';
  import DetailingWorkflow from './design/DetailingWorkflow.svelte';
  import FloorFamiliesPanel from './design/FloorFamiliesPanel.svelte';
  import { detailingStore } from '../../lib/store/detailing.svelte';
  import { modelStore } from '../../lib/store/model.svelte';
  import { t } from '../../lib/i18n/store.svelte';
  import { regulationsStore } from '../../lib/store/regulations.svelte';

  const footingCount = $derived(modelStore.model.footings.size);
  /**
   * Footings the last run could not verify, surfaced on the closed summary.
   *
   * A footing that silently failed to be checked is the failure mode this whole entity
   * exists to prevent, so the count is visible without opening the panel.
   */
  const notVerifiedCount = $derived(detailingStore.footingsNotVerified.length);

  /**
   * The header badge reflects anything the reviewer has to see without opening the panel:
   * a pending regulation change, an incomplete configuration, or a stack problem.
   */
  const needsAttention = $derived(
    regulationsStore.pending.length > 0 || regulationsStore.validation.problems.length > 0,
  );

  /**
   * Navigation for the workflow strip.
   *
   * Opening a `<details>` and scrolling it into view is the whole of it. The strip deliberately
   * does not RUN anything — the commands stay the single place work is started from — so this
   * cannot become a second, competing command surface.
   */
  let regsEl = $state<HTMLDetailsElement | undefined>();
  let detailingEl = $state<HTMLDetailsElement | undefined>();
  let floorsEl = $state<HTMLDetailsElement | undefined>();

  function reveal(el: HTMLDetailsElement | undefined) {
    if (!el) return;
    el.open = true;
    el.scrollIntoView({ block: 'nearest' });
  }

  function goToStage(target: 'model' | 'design' | 'floors' | 'detailing' | 'documents') {
    if (target === 'detailing' || target === 'documents') { reveal(detailingEl); return; }
    if (target === 'floors') { reveal(floorsEl); return; }
    // `model` and `design` both live in the design tab below, which is always mounted; closing
    // the disclosures is what brings it back into view on a 720 px window.
    if (regsEl) regsEl.open = false;
    if (detailingEl) detailingEl.open = false;
    if (floorsEl) floorsEl.open = false;
    document.querySelector('[data-testid="design-toolbar"]')?.scrollIntoView({ block: 'nearest' });
  }
</script>

<div class="rc-workflow">
  <!--
    Where you are, before what you can press.

    The tab used to open on three collapsed disclosures and a wrapping row of six commands, in an
    order a reader had to infer from which buttons were grey. The strip states the order once and
    names what each unreached step is waiting for; clicking one opens the disclosure that owns it.
    See `WorkflowStages.svelte` for why it navigates rather than acts.
  -->
  <WorkflowStages onGoTo={goToStage} />

  <details class="code-settings-disclosure" data-testid="code-settings-disclosure" bind:this={regsEl}>
    <summary>
      {t('regulations.title')}
      {#if needsAttention}
        <span class="attention" data-testid="code-settings-attention" aria-label={t('codes.provenance.assumed')}>
          {t('codes.provenance.assumed')}
        </span>
      {/if}
    </summary>
    <ProjectRegulationsPanel />
  </details>
  <details class="detailing-disclosure" data-testid="detailing-disclosure" bind:this={detailingEl}>
    <summary>
      {t('detailing.title')}
      {#if detailingStore.assemblies.length > 0}
        <span class="count" data-testid="detailing-count">{detailingStore.assemblies.length}</span>
      {/if}
    </summary>
    <DetailingWorkflow />
  </details>
  <!--
    Slabs, walls and foundations. A sibling disclosure rather than a nested one, because they
    are element FAMILIES of the same workflow — the beams and columns above and these share
    one regulation, one detailing store and one document. It sits below detailing because
    `generateFloors()` adds to the assemblies that panel lists.
  -->
  <details class="floors-disclosure" data-testid="floor-families-disclosure" bind:this={floorsEl}>
    <summary>
      {t('detailing.floorRun.title')}
      <span class="stage-tag" data-testid="floors-stage-tag">{t('design.families.optionalStage')}</span>
      {#if footingCount > 0}
        <span class="count" data-testid="floor-footing-count">{footingCount}</span>
      {/if}
      {#if notVerifiedCount > 0}
        <span class="attention" data-testid="floor-not-verified-count">{notVerifiedCount}</span>
      {/if}
    </summary>
    <FloorFamiliesPanel />
  </details>
  <ProDesignTab />
</div>

<style>
  /*
   * The column SCROLLS. It used to be `overflow: hidden`, and that was a real defect.
   *
   * Each open disclosure may claim up to 55vh or 70vh, so two of them open exceed the
   * viewport — and with the overflow hidden and no scroll path, everything past 100% became
   * unreachable. Not merely ugly: an ENABLED command could sit outside the viewport, where a
   * real pointer event lands on nothing at all. Measured with three disclosures open at a
   * 1280×720 viewport, the Generate detailing button reported a box at y = 874 and
   * `document.elementFromPoint` at its centre returned null, while a programmatic
   * `.click()` — which bypasses hit-testing — still worked. A user in that state clicks and
   * the app does nothing, with no error and no explanation.
   *
   * `min-height: 0` is what lets a flex child actually shrink so its own `overflow: auto`
   * engages instead of the child forcing the column taller.
   */
  .rc-workflow {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow-y: auto;
    overflow-x: hidden;
  }
  .rc-workflow > :global(*:last-child) { flex: 1 1 auto; min-height: 18rem; overflow: hidden; }
  .code-settings-disclosure,
  .detailing-disclosure,
  .floors-disclosure { flex: 0 0 auto; min-height: 0; border-bottom: 1px solid rgba(143, 163, 179, 0.3); }
  .code-settings-disclosure[open] { max-height: 55vh; overflow: auto; }
  .detailing-disclosure[open] { max-height: 70vh; overflow: auto; }
  .floors-disclosure[open] { max-height: 70vh; overflow: auto; }
  /*
    Why this stage carries a tag.

    "Slabs, walls and foundations" sits beside "Coordinated detailing" as a peer, and a reader has
    no way to tell that it is OPTIONAL and that it runs BEFORE detailing when the building has
    shells. It stays a section of its own — a frame-only building never opens it, and folding it
    into detailing would make every project pay for a step most do not need — but it now says
    which step it is.
  */
  .stage-tag {
    font-size: 0.65rem; font-weight: 600; letter-spacing: 0.03em;
    padding: 0.05rem 0.35rem; border-radius: 3px;
    border: 1px solid var(--st-hair-strong); color: var(--st-text-2);
  }
  .count { font-size: 0.72rem; font-weight: 600; padding: 0.1rem 0.4rem; border-radius: 3px; background: rgba(143, 163, 179,0.3); }
  summary {
    cursor: pointer;
    padding: 0.45rem 1rem;
    font-size: 0.85rem;
    font-weight: 500;
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  summary:focus-visible { outline: 2px solid currentColor; outline-offset: -2px; }
  /* Assumed state is never green. */
  .attention {
    font-size: 0.72rem;
    font-weight: 600;
    padding: 0.1rem 0.4rem;
    border-radius: 3px;
    background: var(--st-surface-3);
    color: var(--st-text);
  }
</style>
