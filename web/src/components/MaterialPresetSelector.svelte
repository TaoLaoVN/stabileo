<script lang="ts">
  import { MATERIAL_CATEGORIES, searchPresets, categoryFamily, type MaterialPreset } from '../lib/data/material-presets';
  import {
    MATERIAL_DESIGN_CODES, codesForFamily, codesForMode, defaultCodeFor,
  } from '../lib/data/structural-grades';
  import { concreteCodes, timberCodes } from '../lib/data/non-metal-grades';
  import { uiStore } from '../lib/store';
  import { t } from '../lib/i18n';

  interface Props {
    open: boolean;
    onselect: (preset: MaterialPreset) => void;
    onclose: () => void;
  }

  let { open, onselect, onclose }: Props = $props();

  let activeCategory = $state<string>('acero');
  let searchQuery = $state('');

  const isPro = $derived(uiStore.analysisMode === 'pro');
  const family = $derived(categoryFamily(activeCategory));

  /**
   * Codes offered for the active category.
   *
   * Metals resolve theirs from the design-code table by family. Concrete and
   * timber carry their code on each entry instead, because for them the code
   * is part of the material's identity rather than a lens over it — the same
   * concrete has a different modulus under each one, so "C25/30 to ACI" is not
   * a thing that exists.
   */
  const codes = $derived.by(() => {
    if (family) return codesForMode(codesForFamily(family), isPro).map((c) => ({ id: c.id, name: c.name }));
    if (activeCategory === 'hormigon') return concreteCodes().map((c) => ({ id: c, name: c }));
    if (activeCategory === 'madera') return timberCodes().map((c) => ({ id: c, name: c }));
    return [];
  });

  /**
   * The selected design code.
   *
   * Held as an id that may be stale — switching category can leave it pointing
   * at a code that category has no entry for. Resolving it against the current
   * list on every read, and falling back to the category's default, means the
   * picker can never end up filtering by something not on screen.
   */
  let codeId = $state<string | null>(null);
  const activeCode = $derived.by(() => {
    const chosen = codeId ? codes.find((c) => c.id === codeId) : undefined;
    if (chosen) return chosen;
    if (family) {
      const d = defaultCodeFor(family);
      return d ? { id: d.id, name: d.name } : null;
    }
    // Non-metals default to the Argentine code where there is one, for the same
    // reason the metals do: this is an Argentine tool.
    const local = codes.find((c) => c.name.startsWith('CIRSOC'));
    return local ?? codes[0] ?? null;
  });

  let filtered = $derived(
    searchPresets(searchQuery, activeCategory, {
      codeId: activeCode?.id,
      pro: isPro,
    }),
  );

  function pickCategory(id: string) {
    activeCategory = id;
    searchQuery = '';
    // Reset rather than carry the code across: CIRSOC 301 governs rolled
    // sections and CIRSOC 303 cold-formed ones, so the right code for the new
    // category is its own default, not whatever the last one was.
    codeId = null;
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') onclose();
  }
</script>

{#if open}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="preset-overlay" onclick={onclose} onkeydown={handleKeydown}>
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="preset-modal" onclick={(e) => e.stopPropagation()}>
      <div class="preset-header">
        <h3>{t('dialog.chooseMaterial')}</h3>
        <button class="close-btn" onclick={onclose}>✕</button>
      </div>

      <div class="preset-tabs">
        {#each MATERIAL_CATEGORIES as cat}
          <button
            class="tab-btn"
            class:active={activeCategory === cat.id}
            onclick={() => pickCategory(cat.id)}
          >{t(cat.label)}</button>
        {/each}
      </div>

      <!-- Design code. Present only for the graded metals: concrete and timber
           have no code attached here, and an inert control would only suggest
           it does something. -->
      {#if codes.length > 0}
        <div class="preset-code">
          <label for="preset-code-sel">{t('matCode.label')}</label>
          <!-- Driven by `activeCode`, not by `codeId`: the latter is null until
               the user chooses, and binding to it would show a blank control
               while the list is in fact filtered by the default. -->
          <select
            id="preset-code-sel"
            value={activeCode?.id ?? ''}
            onchange={(e) => codeId = (e.currentTarget as HTMLSelectElement).value}
          >
            {#each codes as c}
              <option value={c.id}>{c.name}</option>
            {/each}
          </select>
          <span class="preset-code-hint">{t('matCode.hint')}</span>
        </div>
      {/if}

      <div class="preset-search">
        <input type="text" placeholder={t('search.material')} bind:value={searchQuery} />
      </div>

      <div class="preset-list">
        {#each filtered as p}
          <button class="preset-item" onclick={() => onselect(p)}>
            <span class="preset-name">
              {p.name}
              <!-- The standard is part of the identity, not a footnote: two
                   standards can give the same designation to different steels,
                   and a grade cannot be specified on a drawing without it. -->
              {#if p.standard}<span class="preset-std">{p.standard}</span>{/if}
              <!-- A value carried from general knowledge rather than read from
                   the standard. Small, but present: someone sizing a member
                   deserves to know which kind of number they picked. -->
              {#if p.verification === 'typical'}
                <span class="preset-unver" title={t('grade.typicalHelp')}>~</span>
              {/if}
            </span>
            <span class="preset-props">
              E={p.e >= 1000 ? `${(p.e/1000).toFixed(0)}GPa` : `${p.e}MPa`}
              {#if p.fy} fy={p.fy}MPa{/if}
              {#if p.fu} fu={p.fu}MPa{/if}
              ρ={p.rho}kN/m³
            </span>
          </button>
        {/each}
        {#if filtered.length === 0}
          <p class="no-results">{t('search.noResults')}</p>
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  .preset-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,0.6);
    z-index: 1000;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .preset-modal {
    background: #16213e;
    border: 1px solid #1a4a7a;
    border-radius: 8px;
    width: 420px;
    max-height: 70vh;
    display: flex;
    flex-direction: column;
    box-shadow: 0 8px 32px rgba(0,0,0,0.5);
  }

  .preset-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.75rem 1rem;
    border-bottom: 1px solid #1a4a7a;
  }

  .preset-header h3 {
    color: #4ecdc4;
    font-size: 0.9rem;
    margin: 0;
  }

  .close-btn {
    background: none;
    border: none;
    color: #888;
    cursor: pointer;
    font-size: 1rem;
    padding: 0.2rem 0.4rem;
    border-radius: 4px;
  }
  .close-btn:hover { color: #e94560; }

  .preset-tabs {
    display: flex;
    border-bottom: 1px solid #0f3460;
    padding: 0 0.5rem;
  }

  .tab-btn {
    padding: 0.4rem 0.6rem;
    border: none;
    background: transparent;
    color: #888;
    cursor: pointer;
    font-size: 0.75rem;
    border-bottom: 2px solid transparent;
  }
  .tab-btn:hover { color: #eee; }
  .tab-btn.active { color: #4ecdc4; border-bottom-color: #4ecdc4; }

  .preset-search {
    padding: 0.5rem;
  }

  .preset-search input {
    width: 100%;
    padding: 0.4rem 0.6rem;
    background: #0f3460;
    border: 1px solid #1a4a7a;
    border-radius: 4px;
    color: #eee;
    font-size: 0.8rem;
  }

  .preset-list {
    overflow-y: auto;
    flex: 1;
    padding: 0.25rem 0.5rem 0.5rem;
  }

  .preset-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    width: 100%;
    padding: 0.5rem 0.6rem;
    background: transparent;
    border: 1px solid transparent;
    border-radius: 4px;
    color: #ccc;
    cursor: pointer;
    font-size: 0.8rem;
    text-align: left;
    transition: all 0.15s;
  }

  .preset-item:hover {
    background: #1a4a7a;
    border-color: #4ecdc4;
    color: white;
  }

  .preset-name {
    font-weight: 600;
  }

  .preset-code {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 16px 0;
    flex-wrap: wrap;
  }
  .preset-code label {
    font-size: 0.72rem;
    color: #999;
    white-space: nowrap;
  }
  .preset-code select {
    flex: 1;
    min-width: 150px;
    padding: 4px 6px;
    border-radius: 4px;
    border: 1px solid #35504c;
    background: #16211f;
    color: #cfe3e0;
    font-size: 0.75rem;
  }
  .preset-code-hint {
    width: 100%;
    font-size: 0.62rem;
    color: #777;
    line-height: 1.35;
  }

  /* Subordinate to the designation, but on the same line: it qualifies the
     name rather than describing the material. */
  .preset-unver {
    margin-left: 4px;
    padding: 0 4px;
    border-radius: 3px;
    background: rgba(255, 140, 0, 0.14);
    color: #e0a060;
    font-size: 0.62rem;
    font-weight: 700;
    cursor: help;
  }
  .preset-std {
    margin-left: 6px;
    font-weight: 400;
    font-size: 0.68rem;
    color: #7fd4cc;
    opacity: 0.75;
  }

  .preset-props {
    font-size: 0.7rem;
    color: #888;
  }

  .preset-item:hover .preset-props {
    color: #aaa;
  }

  .no-results {
    text-align: center;
    color: #666;
    font-size: 0.8rem;
    padding: 1rem;
  }
</style>
