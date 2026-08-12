<script lang="ts">
  /**
   * One role's profile: catalogue pick, arrangement, gap and rotation.
   *
   * Basic on purpose. The arrangement list is filtered by what the chosen profile can
   * actually be built into — `availableArrangements` refuses the compound ones for a profile
   * whose centroid is unknown — so the control cannot offer something the emitter would
   * then reject. The gap only appears for a compound arrangement, because it means nothing
   * for a single profile.
   */
  import { t } from '../../../lib/i18n';
  import { FAMILY_LIST, PROFILE_FAMILIES } from '../../../lib/data/steel-profiles';
  import { availableArrangements, canCompose, resolveProfile } from '../../../lib/engine/generators/profile-resolve';
  import { ARRANGEMENTS, isClosedArrangement } from '../../../lib/engine/generators/built-up-section';
  import type { ProfileSpec } from '../../../lib/engine/generators/emit';
  import type { MemberRole } from '../../../lib/engine/generators/member-roles';

  interface Props {
    role: MemberRole;
    spec: ProfileSpec;
    onChange: (next: ProfileSpec) => void;
  }
  const { role, spec, onChange }: Props = $props();

  const resolved = $derived(resolveProfile(spec.profileName));
  const arrangements = $derived(resolved ? availableArrangements(resolved) : (['single'] as const));
  const refusalCount = $derived(
    resolved ? Object.keys(ARRANGEMENTS).length - arrangements.length : 0,
  );
  const compound = $derived(spec.arrangement !== 'single');

  function pickProfile(name: string) {
    const r = resolveProfile(name);
    // A profile change can invalidate the arrangement — switching from an I-beam to a
    // properties-only channel takes the compound options away. Fall back rather than emit
    // a spec the emitter would refuse.
    const keep = r && canCompose(r, spec.arrangement) === null;
    onChange({ ...spec, profileName: name, arrangement: keep ? spec.arrangement : 'single' });
  }
</script>

<div class="row" data-testid={`gen-profile-${role}`}>
  <label class="lbl" for={`prof-${role}`}>{t(`generator.role.${role}`)}</label>

  <select
    id={`prof-${role}`}
    value={spec.profileName}
    onchange={(e) => pickProfile((e.currentTarget as HTMLSelectElement).value)}
  >
    {#each FAMILY_LIST as fam (fam)}
      {#if PROFILE_FAMILIES[fam]?.length}
        <optgroup label={fam}>
          {#each PROFILE_FAMILIES[fam] as p (p.name)}
            <option value={p.name}>{p.name}</option>
          {/each}
        </optgroup>
      {/if}
    {/each}
  </select>

  <select
    aria-label={t('generator.ui.arrangement')}
    value={spec.arrangement}
    onchange={(e) => onChange({ ...spec, arrangement: (e.currentTarget as HTMLSelectElement).value as ProfileSpec['arrangement'] })}
  >
    {#each arrangements as a (a)}
      <option value={a}>{t(`generator.arrangement.${a}`)}</option>
    {/each}
  </select>

  {#if compound}
    <label class="gap">
      <span>{t('generator.ui.gap')}</span>
      <input
        type="number" min="0" step="1" value={spec.gapMm}
        onchange={(e) => onChange({ ...spec, gapMm: Number((e.currentTarget as HTMLInputElement).value) || 0 })}
      />
      <span class="unit">mm</span>
    </label>
  {/if}

  <select
    aria-label={t('generator.ui.rotation')}
    value={String(spec.rotationDeg)}
    onchange={(e) => {
      const v = (e.currentTarget as HTMLSelectElement).value;
      onChange({ ...spec, rotationDeg: v === 'auto' ? 'auto' : Number(v) });
    }}
  >
    <option value="auto">{t('generator.ui.rotationAuto')}</option>
    <option value="0">0°</option>
    <option value="90">90°</option>
    <option value="180">180°</option>
    <option value="270">270°</option>
  </select>
</div>

{#if compound && isClosedArrangement(spec.arrangement)}
  <p class="note" data-testid={`gen-closed-${role}`}>
    {t('generator.builtUp.torsion.closedCellNotComputed')}
  </p>
{/if}
{#if refusalCount > 0}
  <p class="note" data-testid={`gen-refused-${role}`}>
    {t('generator.problem.centroidUnknown')
      .replace('{profile}', spec.profileName)
      .replace('{family}', resolved?.family ?? '')}
  </p>
{/if}

<style>
  .row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-bottom: 4px; }
  .lbl { min-width: 6.5rem; font-size: 0.7rem; color: #bcd; }
  select, input {
    background: #0b1a2c; color: #dde; border: 1px solid #24486e;
    border-radius: 3px; padding: 2px 4px; font-size: 0.7rem;
  }
  select:focus-visible, input:focus-visible { outline: 2px solid #4ecdc4; outline-offset: 1px; }
  input { width: 4.5rem; text-align: right; }
  .gap { display: inline-flex; align-items: center; gap: 4px; font-size: 0.68rem; color: #9ab; }
  .unit { color: #778; }
  .note { margin: 0 0 6px 6.5rem; font-size: 0.65rem; color: #f0cc66; line-height: 1.35; }
</style>
