/**
 * Which quantity is on screen, and how it is drawn.
 *
 * These are two independent facts that `diagramType` had been encoding as one:
 * `'axial'` is the axial force as a diagram, `'axialColor'` is the same
 * quantity as member colour, and `'colorMap'` is some quantity — named in a
 * second field — as a heat map. Three spellings for two facts.
 *
 * Every reader had to know all three encodings to answer "what is the user
 * looking at", and each derived it separately: the ribbon to light a command,
 * the panel to offer the representations. So the derivation is pinned here
 * rather than in each of them.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { resultsStore } from '../results.svelte';
import {
  activeQuantity, activeRepresentation, representationsFor,
  showQuantityAs, commandShowsQuantity,
} from '../result-view';

beforeEach(() => {
  resultsStore.diagramType = 'none' as never;
  resultsStore.colorMapKind = 'moment';
});

describe('reading what is on screen', () => {
  it('a diagram is that quantity, drawn as a diagram', () => {
    resultsStore.diagramType = 'momentY' as never;
    expect(activeQuantity()).toBe('momentY');
    expect(activeRepresentation()).toBe('diagram');
  });

  it('member colour is the axial force, drawn as colour', () => {
    resultsStore.diagramType = 'axialColor' as never;
    expect(activeQuantity()).toBe('axial');
    expect(activeRepresentation()).toBe('memberColour');
  });

  it('a colour map is the quantity named in the second field', () => {
    resultsStore.diagramType = 'colorMap' as never;
    resultsStore.colorMapKind = 'shearZ';
    expect(activeQuantity()).toBe('shearZ');
    expect(activeRepresentation()).toBe('colourMap');
  });

  it('says nothing is shown when nothing is', () => {
    expect(activeQuantity()).toBeNull();
    expect(activeRepresentation()).toBeNull();
  });

  it('does not claim a quantity for the deformed shape', () => {
    resultsStore.diagramType = 'deformed' as never;
    expect(activeQuantity()).toBeNull();
  });

  it('does not claim a quantity for a stress-ratio map', () => {
    /*
     * `stressRatio` and `vonMises` are derived measures, not internal forces:
     * they are chosen elsewhere, carry their own fixed scale, and must not
     * appear in a per-quantity selector — offering "show the stress ratio as a
     * diagram" would be offering something that does not exist.
     */
    resultsStore.diagramType = 'colorMap' as never;
    for (const kind of ['stressRatio', 'vonMises', 'shellVonMises', 'shellBending'] as const) {
      resultsStore.colorMapKind = kind;
      expect(activeQuantity(), kind).toBeNull();
      expect(activeRepresentation(), kind).toBeNull();
    }
  });
});

describe('what each quantity can be shown as', () => {
  it('offers a colour map for every quantity', () => {
    for (const q of ['axial', 'moment', 'shear', 'momentY', 'momentZ', 'shearY', 'shearZ', 'torsion'] as const) {
      expect(representationsFor(q), q).toContain('colourMap');
      expect(representationsFor(q), q).toContain('diagram');
    }
  });

  it('offers member colour for axial alone', () => {
    expect(representationsFor('axial')).toEqual(['diagram', 'memberColour', 'colourMap']);
    for (const q of ['moment', 'momentY', 'shearZ', 'torsion'] as const) {
      expect(representationsFor(q), q).not.toContain('memberColour');
    }
  });

  it('always lists the diagram first', () => {
    for (const q of ['axial', 'momentY', 'torsion'] as const) {
      expect(representationsFor(q)[0]).toBe('diagram');
    }
  });
});

describe('switching representation keeps the quantity', () => {
  it('diagram → colour map shows the same quantity', () => {
    showQuantityAs('momentZ', 'diagram');
    expect(activeQuantity()).toBe('momentZ');

    showQuantityAs('momentZ', 'colourMap');
    expect(activeQuantity()).toBe('momentZ');
    expect(activeRepresentation()).toBe('colourMap');
    expect(resultsStore.diagramType).toBe('colorMap');
  });

  it('colour map → diagram comes back to the same quantity', () => {
    showQuantityAs('shearY', 'colourMap');
    showQuantityAs('shearY', 'diagram');
    expect(resultsStore.diagramType).toBe('shearY');
    expect(activeRepresentation()).toBe('diagram');
  });

  it('axial round-trips through all three', () => {
    showQuantityAs('axial', 'diagram');
    expect(resultsStore.diagramType).toBe('axial');

    showQuantityAs('axial', 'memberColour');
    expect(resultsStore.diagramType).toBe('axialColor');
    expect(activeQuantity()).toBe('axial');

    showQuantityAs('axial', 'colourMap');
    expect(activeQuantity()).toBe('axial');
    expect(resultsStore.colorMapKind).toBe('axial');

    showQuantityAs('axial', 'diagram');
    expect(resultsStore.diagramType).toBe('axial');
  });

  it('member colour asked for a quantity that has none falls back to the diagram', () => {
    // Rather than painting a moment red for "hogging", which is a convention
    // about which fibre is in tension and not something to read off a colour.
    showQuantityAs('momentY', 'memberColour');
    expect(resultsStore.diagramType).toBe('momentY');
  });

  it('switching quantity while in a colour map keeps the colour map', () => {
    showQuantityAs('momentY', 'colourMap');
    showQuantityAs('torsion', 'colourMap');
    expect(activeQuantity()).toBe('torsion');
    expect(activeRepresentation()).toBe('colourMap');
  });
});

describe('the ribbon lights the quantity, not the representation', () => {
  it('stays lit through all three representations', () => {
    for (const how of ['diagram', 'memberColour', 'colourMap'] as const) {
      showQuantityAs('axial', how);
      expect(commandShowsQuantity('axial'), how).toBe(true);
    }
  });

  it('lights a colour-mapped quantity, which used to go dark', () => {
    showQuantityAs('shearZ', 'colourMap');
    expect(commandShowsQuantity('shearZ')).toBe(true);
    expect(commandShowsQuantity('momentY')).toBe(false);
  });

  it('lights exactly one command at a time', () => {
    const commands = ['axial', 'momentY', 'momentZ', 'shearY', 'shearZ', 'torsion'];
    for (const q of commands) {
      showQuantityAs(q as never, 'colourMap');
      const lit = commands.filter((c) => commandShowsQuantity(c));
      expect(lit, `showing ${q}`).toEqual([q]);
    }
  });

  it('lights nothing when a stress-ratio map is shown', () => {
    resultsStore.diagramType = 'colorMap' as never;
    resultsStore.colorMapKind = 'stressRatio';
    for (const c of ['axial', 'momentY', 'shearZ']) {
      expect(commandShowsQuantity(c), c).toBe(false);
    }
  });
});
