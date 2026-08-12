<script lang="ts">
  /**
   * Torsional shear — which theory applies, and what it gives.
   *
   * Until now a torque produced a number inside the total shear and nothing
   * else: no way to see how much of tau came from twisting, and no statement of
   * WHICH theory produced it. That last part is not a detail. Three different
   * theories apply depending on whether the wall is solid, closed or open, they
   * disagree by orders of magnitude, and the section's appearance does not tell
   * you which one you are in.
   *
   * So the theory is named on screen rather than applied silently, and where
   * the section is closed the panel also states what slitting it would cost —
   * the one comparison that makes the distinction concrete.
   */
  import type { ResolvedSection } from '../../lib/engine/section-stress';
  import { computeTorsionFlow, closedVersusOpen } from '../../lib/engine/torsion-flow';
  import { t } from '../../lib/i18n';
  import { fmt } from './fmt';

  interface Props {
    showTorsion: boolean;
    /** Torque at the station, kN·m. */
    torque: number;
    resolved: ResolvedSection | undefined;
  }

  let { showTorsion = $bindable(), torque, resolved }: Props = $props();

  const flow = $derived(resolved ? computeTorsionFlow(torque, resolved) : null);
  const slitPenalty = $derived(resolved ? closedVersusOpen(resolved) : null);
</script>

<button class="ssp-section-toggle" onclick={() => showTorsion = !showTorsion}>
  <span class="ssp-chevron">{showTorsion ? '▾' : '▸'}</span>
  {t('stress.torsion')}
  <span class="ssp-help ssp-help-inline" title={t('stress.torsionHelp')}>?</span>
</button>

{#if showTorsion}
  {#if !flow}
    <!-- No torque is a state worth naming: it is the common case, and an empty
         panel would read as a failure to compute rather than as nothing to
         report. -->
    <p class="ssp-tor-empty">{t('stress.torsionNone')}</p>
  {:else}
    <div class="ssp-tor">
      <div class="ssp-tor-theory">
        <span class="ssp-tor-badge">{t(flow.labelKey)}</span>
      </div>
      <div class="ssp-tor-row">
        <span class="ssp-tor-label">T</span>
        <span class="ssp-tor-val">{fmt(Math.abs(torque))}<span class="ssp-tor-unit">kN·m</span></span>
      </div>
      <div class="ssp-tor-row ssp-tor-peak">
        <span class="ssp-tor-label">&tau;<sub>max</sub></span>
        <span class="ssp-tor-val">{fmt(flow.tauMax)}<span class="ssp-tor-unit">MPa</span></span>
      </div>
      <div class="ssp-tor-row">
        <span class="ssp-tor-label">J</span>
        <!-- In cm⁴, the unit every profile table uses. -->
        <span class="ssp-tor-val">{fmt(flow.j * 1e8)}<span class="ssp-tor-unit">cm⁴</span></span>
      </div>

      <p class="ssp-tor-note">{t(`${flow.labelKey}Note`)}</p>

      {#if slitPenalty !== null}
        <!-- The single most instructive number here: same wall, same area, same
             bending inertia, and a factor of hundreds in torsion. -->
        <p class="ssp-tor-slit">
          {t('stress.torsionSlit').replace('{factor}', slitPenalty.toFixed(0))}
        </p>
      {/if}
    </div>
  {/if}
{/if}

<style>
  .ssp-section-toggle {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 0;
    background: none;
    border: none;
    color: var(--st-text-3);
    font-size: 0.68rem;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    cursor: pointer;
    border-bottom: 1px solid rgba(26, 74, 122, 0.3);
  }
  .ssp-section-toggle:hover { color: var(--st-text-2); }
  .ssp-chevron { font-size: 0.6rem; width: 10px; }

  .ssp-tor { padding: 5px 0 8px; }
  .ssp-tor-empty {
    margin: 6px 0 8px;
    font-size: 0.65rem;
    color: var(--st-text-3);
    line-height: 1.45;
  }
  .ssp-tor-theory { margin-bottom: 5px; }
  .ssp-tor-badge {
    display: inline-block;
    padding: 2px 7px;
    border-radius: 3px;
    background: rgba(127, 212, 204, 0.14);
    border: 1px solid rgba(127, 212, 204, 0.35);
    color: var(--st-value);
    font-size: 0.62rem;
  }
  .ssp-tor-row {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 6px;
    font-size: 0.68rem;
    color: var(--st-text-2);
  }
  .ssp-tor-label { color: var(--st-text-3); flex: none; }
  .ssp-tor-val { font-family: 'Courier New', monospace; text-align: right; }
  .ssp-tor-unit { color: var(--st-text-3); opacity: 0.7; margin-left: 3px; font-size: 0.9em; }
  .ssp-tor-peak .ssp-tor-val { color: var(--st-value); font-weight: 600; }
  .ssp-tor-note {
    margin: 6px 0 0;
    font-size: 0.58rem;
    line-height: 1.45;
    color: var(--st-text-3);
  }
  .ssp-tor-slit {
    margin: 6px 0 0;
    padding: 5px 7px;
    border-radius: 3px;
    background: rgba(255, 140, 0, 0.08);
    border-left: 2px solid var(--st-warn);
    font-size: 0.6rem;
    line-height: 1.45;
    color: var(--st-text-2);
  }

  .ssp-help {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 13px;
    height: 13px;
    border-radius: 50%;
    background: rgba(127, 212, 204, 0.12);
    color: var(--st-value);
    font-size: 0.5rem;
    font-weight: 700;
    cursor: help;
    flex-shrink: 0;
    border: 1px solid rgba(127, 212, 204, 0.25);
    opacity: 0.6;
    font-style: normal;
    line-height: 1;
  }
  .ssp-help:hover { opacity: 1; }
  .ssp-help-inline { margin-left: auto; }
</style>
