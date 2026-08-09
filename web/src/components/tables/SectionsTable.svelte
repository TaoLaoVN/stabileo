<script lang="ts">
  import { modelStore, uiStore, resultsStore } from '../../lib/store';
  import { t } from '../../lib/i18n';
  import SectionChanger from '../SectionChanger.svelte';
  import type { SteelProfile } from '../../lib/data/steel-profiles';
  import { profileToSectionFull } from '../../lib/data/steel-profiles';
  import type { SectionProperties } from '../../lib/data/section-shapes';
  import { solverProperties } from '../../lib/section/state';

  const sectionsArr = $derived([...modelStore.sections.values()]);
  const is3D = $derived(uiStore.analysisMode === '3d');

  // Unit conversion factors: model stores m² and m⁴, display in cm² and cm⁴
  const M2_TO_CM2 = 1e4;   // m² → cm²
  const M4_TO_CM4 = 1e8;   // m⁴ → cm⁴
  /** Format area in cm² */
  function fmtA(v: number) { return (v * M2_TO_CM2).toPrecision(4); }
  /** Format inertia in cm⁴ */
  function fmtI(v: number) { return (v * M4_TO_CM4).toPrecision(4); }

  let sectionChangerTargetSecId = $state<number | null>(null);
  let showSectionChanger = $state(false);

  function addSection() {
    modelStore.addSection({ name: t('table.newSection'), a: 0.005, iz: 0.00002, iy: 0.00008 });
  }

  function updateSectionField(id: number, field: string, val: string) {
    if (field === 'name') {
      modelStore.updateSection(id, { name: val });
    } else {
      const num = parseFloat(val);
      if (isNaN(num)) return;
      // Convert from display units (cm², cm⁴) back to model units (m², m⁴)
      let modelVal = num;
      if (field === 'a') modelVal = num / M2_TO_CM2;
      else if (field === 'iy' || field === 'iz' || field === 'j') modelVal = num / M4_TO_CM4;
      modelStore.updateSection(id, { [field]: modelVal });
      resultsStore.clear();
    }
  }

  function deleteSection(id: number) {
    const ok = modelStore.removeSection(id);
    if (!ok) alert(t('table.cannotDeleteSection'));
  }

  // Apply a standard profile to an EXISTING section (update in place) -- via SectionChanger
  function handleSCProfileSelect(profile: SteelProfile) {
    if (sectionChangerTargetSecId === null) return;
    const full = profileToSectionFull(profile);
    modelStore.updateSection(sectionChangerTargetSecId, {
      name: profile.name,
      a: full.a,
      iz: full.iz,
      iy: full.iy,
      b: full.b,
      h: full.h,
      shape: full.shape,
      tw: full.tw,
      tf: full.tf,
      t: full.t,
    });
    resultsStore.clear();
    showSectionChanger = false;
    sectionChangerTargetSecId = null;
  }

  // Apply a custom shape to an EXISTING section -- via SectionChanger
  function handleSCShapeSelect(name: string, props: SectionProperties) {
    if (sectionChangerTargetSecId === null) return;
    modelStore.updateSection(sectionChangerTargetSecId, {
      name,
      a: props.a,
      iz: props.iz,
      iy: props.iy,
      j: props.j,
      b: props.b,
      h: props.h,
      shape: props.shape as any,
      tw: props.tw,
      tf: props.tf,
      t: props.t,
    });
    resultsStore.clear();
    showSectionChanger = false;
    sectionChangerTargetSecId = null;
  }

  // Apply an amorphous section (no shape) to an EXISTING section -- via SectionChanger
  function handleSCAmorphousSelect(data: { name: string; a: number; iy: number; iz: number; j?: number }) {
    if (sectionChangerTargetSecId === null) return;
    modelStore.updateSection(sectionChangerTargetSecId, {
      name: data.name,
      a: data.a,
      iy: data.iy,
      iz: data.iz,
      j: data.j,
      shape: undefined,
      b: undefined,
      h: undefined,
      tw: undefined,
      tf: undefined,
      t: undefined,
    });
    resultsStore.clear();
    showSectionChanger = false;
    sectionChangerTargetSecId = null;
  }
</script>

<table>
  <thead>
    <tr><th>ID</th><th>{t('table.name')}</th><th>A (cm&sup2;)</th><th>Iy (cm&#8308;)</th><th>Iz (cm&#8308;)</th>{#if is3D}<th>J (cm&#8308;)</th>{/if}<th>{t('table.rotation')}</th><th></th></tr>
  </thead>
  <tbody>
    {#each sectionsArr as sec}
      <!-- Read-only because the numbers are DERIVED, not because the section
           happens to carry a `shape` string. A geometry-backed section's A and
           I are outputs of its polygons; letting them be typed over would put
           the model in a state where the drawing and the numbers disagree. -->
      {@const derived = sec.canonical?.kind === 'geometry-backed'}
      {@const props = solverProperties(sec)}
      <tr>
        <td class="id-cell">{sec.id}</td>
        <td class="name-with-action">
          <input type="text" value={sec.name} onchange={(e) => updateSectionField(sec.id, 'name', e.currentTarget.value)} />
          <button class="row-action-btn" title={t('table.changeSection')} onclick={() => { sectionChangerTargetSecId = sec.id; showSectionChanger = true; }}>&#9783;</button>
        </td>
        {#if derived}
          <!-- The values shown are the ones the solver is actually given, so
               the table, the section drawing and the analysis cannot quote
               three different areas for one profile. -->
          <td><span class="ro-val" title={t('table.derivedFromGeometry')}>{fmtA(props.a)}</span></td>
          <td><span class="ro-val" title={t('table.derivedFromGeometry')}>{fmtI(props.iy ?? props.iz)}</span></td>
          <td><span class="ro-val" title={t('table.derivedFromGeometry')}>{fmtI(props.iz)}</span></td>
          {#if is3D}
            <td><span class="ro-val" title={props.j == null ? t('table.torsionUnavailable') : t('table.derivedFromGeometry')}>{props.j == null ? '—' : fmtI(props.j)}</span></td>
          {/if}
        {:else}
          <td><input type="number" step="0.01" value={sec.a * M2_TO_CM2} onchange={(e) => updateSectionField(sec.id, 'a', e.currentTarget.value)} /></td>
          <td><input type="number" step="0.01" value={(sec.iy ?? sec.iz) * M4_TO_CM4} onchange={(e) => updateSectionField(sec.id, 'iy', e.currentTarget.value)} /></td>
          <td><input type="number" step="0.01" value={sec.iz * M4_TO_CM4} onchange={(e) => updateSectionField(sec.id, 'iz', e.currentTarget.value)} /></td>
          {#if is3D}
            <td><input type="number" step="0.01" value={(sec.j ?? (sec.iy ?? sec.iz) * 0.001) * M4_TO_CM4} onchange={(e) => updateSectionField(sec.id, 'j', e.currentTarget.value)} /></td>
          {/if}
        {/if}
        <td><input type="number" step="1" min="0" max="359" class="rot-input" value={sec.rotation ?? 0} onchange={(e) => updateSectionField(sec.id, 'rotation', e.currentTarget.value)} /></td>
        <td class="action-cell">
          <button class="del" onclick={() => deleteSection(sec.id)}>&#10005;</button>
        </td>
      </tr>
    {/each}
  </tbody>
</table>
<div class="table-footer">
  <button class="add-btn" onclick={addSection}>{t('table.addSectionManual')}</button>
</div>
<SectionChanger
  open={showSectionChanger}
  onprofileselect={(p: SteelProfile, _s: { a: number; iy: number; iz: number; b: number; h: number }) => handleSCProfileSelect(p)}
  onshapeselect={(name: string, props: SectionProperties) => handleSCShapeSelect(name, props)}
  onamorphousselect={(data) => handleSCAmorphousSelect(data)}
  onclose={() => { showSectionChanger = false; sectionChangerTargetSecId = null; }}
  is3D={uiStore.analysisMode === '3d'}
/>

<style>
  table {
    width: max-content;
    min-width: 100%;
    border-collapse: collapse;
  }

  th {
    text-align: left;
    padding: 0.25rem 0.35rem;
    color: var(--st-text-3);
    font-weight: 500;
    font-size: 0.65rem;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    border-bottom: 1px solid var(--st-surface-3);
    position: sticky;
    top: 0;
    background: var(--st-surface-2);
    white-space: nowrap;
  }

  td {
    padding: 0.2rem 0.35rem;
    border-bottom: 1px solid var(--st-bg);
    color: var(--st-text-2);
    white-space: nowrap;
  }

  .id-cell {
    color: var(--st-value);
    font-weight: 600;
  }

  .rot-input {
    width: 38px !important;
    text-align: center;
  }

  td input[type="number"],
  td input[type="text"] {
    width: 55px;
    padding: 0.1rem 0.2rem;
    background: var(--st-surface-3);
    border: 1px solid var(--st-surface-3);
    border-radius: 3px;
    color: var(--st-text);
    font-size: 0.7rem;
  }

  td input[type="text"] {
    width: 80px;
  }

  .action-cell {
    display: flex;
    gap: 0.2rem;
    align-items: center;
  }

  .name-with-action {
    display: flex;
    align-items: center;
    gap: 0.25rem;
  }

  .name-with-action input {
    flex: 1;
    min-width: 0;
  }

  .row-action-btn {
    background: var(--st-surface-3);
    border: 1px solid var(--st-surface-3);
    border-radius: 3px;
    color: var(--st-value);
    cursor: pointer;
    font-size: 0.8rem;
    padding: 0.1rem 0.3rem;
    line-height: 1;
    transition: all 0.15s;
  }

  .row-action-btn:hover {
    background: var(--st-surface-3);
    color: white;
  }

  .del {
    background: none;
    border: none;
    color: var(--st-text-3);
    cursor: pointer;
    font-size: 0.8rem;
    padding: 0.1rem 0.3rem;
  }
  .del:hover {
    color: var(--st-accent);
  }

  tr:hover {
    background: rgba(127, 212, 204, 0.05);
  }

  .table-footer {
    padding: 0.5rem;
    border-top: 1px solid var(--st-bg);
  }

  .add-btn {
    width: 100%;
    padding: 0.4rem 0.5rem;
    background: var(--st-surface-3);
    border: 1px solid var(--st-surface-3);
    border-radius: 4px;
    color: var(--st-value);
    cursor: pointer;
    font-size: 0.8rem;
    transition: all 0.2s;
  }

  .add-btn:hover {
    background: var(--st-surface-3);
    color: white;
  }

  .ro-val {
    font-size: 0.7rem;
    color: var(--st-text-3);
    font-family: monospace;
    user-select: text;
  }
</style>
