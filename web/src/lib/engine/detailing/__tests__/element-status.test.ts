/**
 * The six states, and the distinctions that make them worth having.
 *
 * The temptation in a module like this is to test the switch statement, which proves nothing
 * — the switch IS the specification. What is worth pinning is the cases where two inputs
 * disagree, because those are the ones a future edit will collapse: a verified member with no
 * bars, a member with bars and a failing verification, and a member the design never reached
 * that still has concrete on screen.
 */

import { describe, expect, it } from 'vitest';
import {
  statusOf, reportElementStatus, ELEMENT_STATUS_ORDER,
  type DesignOutcomeSummary,
} from '../element-status';
import type { SceneModel, SceneSolid, SceneBar } from '../scene-model';

function solid(id: number, over: Partial<SceneSolid> = {}): SceneSolid {
  return {
    id: `member:${id}`, kind: 'beam', elementIds: [id],
    base: [
      { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 },
      { x: 1, y: 1, z: 0 }, { x: 0, y: 1, z: 0 },
    ],
    extrude: { x: 0, y: 0, z: 1 },
    label: { key: 'detailing.scene.solid.member', params: { id } },
    reinforced: false,
    ...over,
  };
}

function barFor(id: number): SceneBar {
  return {
    barId: `b${id}`, diameterMm: 16, role: 'longitudinal', assemblyId: 'a',
    elementIds: [id], polyline: [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }],
    cuttingLength: 1, conflicted: false,
  };
}

function scene(solids: SceneSolid[], bars: SceneBar[] = []): SceneModel {
  return {
    seriesId: 'S', revision: 1, readiness: 'ISSUED',
    bars, solids, conflicts: [],
    facets: { assemblies: [], families: [], roles: [], layers: [] },
    bounds: null, unresolvedMembers: [], unreinforcedMembers: [],
  };
}

// ─── The distinctions ────────────────────────────────────────────

describe('the states a member can be in', () => {
  it('is MODELLED only when the design passed AND steel exists', () => {
    expect(statusOf(true, { outcome: 'VERIFIED' })).toBe('MODELLED');
  });

  it('separates "designed but not modelled" from "not designed"', () => {
    /**
     * The wall case, and the reason this state exists.
     *
     * A wall with no start/end geometry is fully checked — its capacity, its curtains, its
     * minimum steel are all real — and produces no bar. The checks stand; the despiece does
     * not exist. Calling that NOT_EVALUATED throws away a verification that was performed,
     * and calling it MODELLED promises a schedule that cannot be written.
     */
    expect(statusOf(false, { outcome: 'VERIFIED' })).toBe('DESIGNED_NOT_MODELLED');
    expect(statusOf(false, undefined)).toBe('NOT_EVALUATED');
  });

  it('keeps UNSUPPORTED apart from REFUSED, because the remedies differ', () => {
    // REFUSED: a bigger section may help. UNSUPPORTED: nothing you do to the section will,
    // because the check is not implemented. Collapsing them sends people to the wrong fix.
    expect(statusOf(false, { outcome: 'UNSUPPORTED' })).toBe('UNSUPPORTED');
    expect(statusOf(false, { outcome: 'SECTION_INADEQUATE' })).toBe('REFUSED');
    expect(statusOf(false, { outcome: 'SEARCH_EXHAUSTED' })).toBe('REFUSED');
  });

  it('treats absent demand as not evaluated rather than as a refusal', () => {
    expect(statusOf(false, { outcome: 'DEMAND_UNAVAILABLE' })).toBe('NOT_EVALUATED');
  });

  it('lets a FAILING verification outrank a stale VERIFIED outcome', () => {
    /**
     * The case that would otherwise show green.
     *
     * A member can carry steel and a VERIFIED outcome from an earlier run and still fail
     * verification now — editing the section or the loads does exactly that. Reading the
     * outcome first would report MODELLED for a member the app knows does not pass.
     */
    expect(statusOf(true, { outcome: 'VERIFIED', verificationStatus: 'fail' })).toBe('FAILED');
  });

  it('accepts family steel that has no per-member outcome', () => {
    // Footing, slab and wall steel comes from the floor run, which produces family records
    // rather than per-element outcomes. Calling that NOT_EVALUATED would be false.
    expect(statusOf(true, undefined)).toBe('MODELLED');
  });
});

// ─── The report ──────────────────────────────────────────────────

describe('the report covers what is on screen', () => {
  it('is driven by the SOLIDS, so a member with no outcome still gets a state', () => {
    /**
     * The original bug, in status form.
     *
     * Iterating the design outcomes would silently omit exactly the members that have none —
     * which are the ones that vanished from the view in the first place.
     */
    const r = reportElementStatus(
      scene([solid(1), solid(2)]),
      new Map<number, DesignOutcomeSummary>([[1, { outcome: 'VERIFIED' }]]),
    );
    expect(r.entries.map((e) => e.elementId)).toEqual([1, 2]);
    expect(r.entries[1].status).toBe('NOT_EVALUATED');
  });

  it('counts every state and offers only the ones present', () => {
    const r = reportElementStatus(
      scene(
        [solid(1, { reinforced: true }), solid(2), solid(3)],
        [barFor(1)],
      ),
      new Map<number, DesignOutcomeSummary>([
        [1, { outcome: 'VERIFIED' }],
        [2, { outcome: 'UNSUPPORTED', limiting: ['biaxial'] }],
      ]),
    );
    expect(r.counts.MODELLED).toBe(1);
    expect(r.counts.UNSUPPORTED).toBe(1);
    expect(r.counts.NOT_EVALUATED).toBe(1);
    expect(r.counts.REFUSED).toBe(0);
    expect(r.present).toEqual(['UNSUPPORTED', 'NOT_EVALUATED', 'MODELLED']);
  });

  it('orders the states by how much they need looking at', () => {
    // Not alphabetical: a list that buries the failures under the passes is a list nobody
    // scrolls to the end of.
    expect(ELEMENT_STATUS_ORDER[0]).toBe('FAILED');
    expect(ELEMENT_STATUS_ORDER[ELEMENT_STATUS_ORDER.length - 1]).toBe('MODELLED');
  });

  it('carries the limiting constraints through, so the reason can be shown', () => {
    const r = reportElementStatus(
      scene([solid(1)]),
      new Map<number, DesignOutcomeSummary>([[1, {
        outcome: 'UNSUPPORTED', limiting: ['biaxial'],
      }]]),
    );
    expect(r.entries[0].limiting).toEqual(['biaxial']);
  });

  it('does not count one member twice when two solids name it', () => {
    // A footing and its pedestal, or a member split across solids. The status list is per
    // MEMBER, and a duplicated row is a miscount in the panel's headline figures.
    const r = reportElementStatus(
      scene([solid(1), solid(1, { id: 'pedestal:1', kind: 'pedestal' })]),
      new Map(),
    );
    expect(r.entries).toHaveLength(1);
  });
});
