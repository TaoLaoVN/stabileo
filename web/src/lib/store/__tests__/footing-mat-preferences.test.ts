import { describe, it, expect, beforeEach } from 'vitest';
// Imported for its SIDE EFFECT: it wires the foundation-change edge and the mutation hook
// that clears stale results. Without it the analysis-neutrality assertions below would be
// vacuous — nothing would be listening to clear anything.
import '../index';
import { modelStore } from '../model.svelte';
import { resultsStore } from '../results.svelte';
import { historyStore } from '../history.svelte';
import { compressSnapshot, decompressSnapshot } from '../../utils/url-sharing';
import {
  DEFAULT_BOTTOM_MAT_DIAMETER_MM, SUPPORTED_MAT_DIAMETERS_MM,
  defaultFootingMatPreferences, migrateFootingMatPreferences,
} from '../../model/footing';

/**
 * The bottom-mat preferences: the number that used to be invisible.
 *
 * It was `DEFAULT_FOOTING_BAR_DIA_MM = 16` inside the detailing store — a private constant
 * that fixed the effective depth of every footing check in the project, that no user could
 * see, and that therefore read from outside exactly like a designed result. These tests are
 * what make it a preference instead: visible, editable, persisted, and connected to the
 * invalidation edge that retires the documents it decided.
 */
describe('bottom-mat preferences on the model', () => {
  beforeEach(() => { modelStore.clear(); });

  const withFooting = () => {
    const nodeId = modelStore.addNode(0, 0, 0);
    const profileId = modelStore.addSoilProfile('Arena densa');
    modelStore.updateSoilProfile(profileId, {
      bearing: { kind: 'allowablePressure', allowableBearingKPa: 250 },
    });
    const footingId = modelStore.addFooting(nodeId, 'Z1');
    modelStore.updateFooting(footingId, { B: 1.8, L: 1.8, thickness: 0.45 });
    return { nodeId, profileId, footingId };
  };

  // ── O: migration ───────────────────────────────────────────────

  it('a project that never stated a mat reads as 16 mm / 16 mm / AUTO_COMPLIANT (O)', () => {
    // Not "a better default": these are the values the invisible constant was ALREADY applying
    // to such a project, so reopening it reproduces its previous numbers instead of silently
    // redesigning it.
    expect(DEFAULT_BOTTOM_MAT_DIAMETER_MM).toBe(16);
    expect(defaultFootingMatPreferences()).toEqual({
      bottomMatDiameterXmm: 16,
      bottomMatDiameterYmm: 16,
      bottomMatSpacingPolicy: 'AUTO_CODE_COMPLIANT',
    });
    expect(modelStore.footingMatPreferences()).toEqual(defaultFootingMatPreferences());
  });

  it('migrates an absent, null or empty stored value to the same triple (O)', () => {
    for (const raw of [undefined, null, {}, 'nonsense', 42]) {
      expect(migrateFootingMatPreferences(raw).preferences)
        .toEqual(defaultFootingMatPreferences());
    }
  });

  it('restores an old .ded snapshot with no mat field at the default (O)', () => {
    withFooting();
    const wire = JSON.parse(JSON.stringify(modelStore.snapshot()));
    // Exactly what a project saved before PR18-A looks like on the wire.
    delete wire.footingMatPreferences;
    modelStore.clear();
    modelStore.restore(wire);
    expect(modelStore.footingMatPreferences()).toEqual(defaultFootingMatPreferences());
  });

  it('snaps an unsupported stored diameter back to the default, with a notice', () => {
    // A hand-edited .ded or share URL carrying Ø7 would otherwise reach the design and produce
    // a mat nobody can buy.
    const m = migrateFootingMatPreferences({
      bottomMatDiameterXmm: 7, bottomMatDiameterYmm: 20,
      bottomMatSpacingPolicy: 'AUTO_CODE_COMPLIANT',
    });
    expect(m.preferences.bottomMatDiameterXmm).toBe(16);
    expect(m.preferences.bottomMatDiameterYmm).toBe(20);
    expect(m.notices.map((n) => n.key))
      .toEqual(['footing.migration.matDiameterUnsupported']);
  });

  it('offers the project\'s own bar catalogue, not a competing one', () => {
    // A second list is how the Foundations panel comes to offer a diameter the rest of the app
    // cannot detail.
    expect(SUPPORTED_MAT_DIAMETERS_MM).toEqual([10, 12, 16, 20, 25, 32]);
    expect(SUPPORTED_MAT_DIAMETERS_MM).toContain(DEFAULT_BOTTOM_MAT_DIAMETER_MM);
  });

  // ── P: persistence ─────────────────────────────────────────────

  it('survives snapshot/restore (P)', () => {
    withFooting();
    modelStore.setFootingMatPreferences({
      bottomMatDiameterXmm: 20, bottomMatDiameterYmm: 25,
    });
    const snap = modelStore.snapshot();
    modelStore.clear();
    expect(modelStore.footingMatPreferences().bottomMatDiameterXmm).toBe(16);

    modelStore.restore(snap);
    expect(modelStore.footingMatPreferences()).toEqual({
      bottomMatDiameterXmm: 20, bottomMatDiameterYmm: 25,
      bottomMatSpacingPolicy: 'AUTO_CODE_COMPLIANT',
    });
  });

  it('survives the JSON round-trip that .ded and autosave perform (P)', () => {
    withFooting();
    modelStore.setFootingMatPreferences({ bottomMatDiameterXmm: 32 });
    const wire = JSON.parse(JSON.stringify(modelStore.snapshot()));
    modelStore.clear();
    modelStore.restore(wire);
    expect(modelStore.footingMatPreferences().bottomMatDiameterXmm).toBe(32);
  });

  it('survives a URL share, together with the footings it designs (P)', () => {
    // A shared project without them would reopen designed to a different mat than the one that
    // was shared, which is the same class of defect as sharing a footing without its soil.
    const { footingId } = withFooting();
    modelStore.setFootingMatPreferences({
      bottomMatDiameterXmm: 12, bottomMatDiameterYmm: 20,
    });
    const packed = compressSnapshot(modelStore.snapshot());
    modelStore.clear();
    const decoded = decompressSnapshot(packed);
    expect(decoded).not.toBeNull();
    modelStore.restore(decoded!);

    expect(modelStore.model.footings.get(footingId)!.B).toBe(1.8);
    expect(modelStore.footingMatPreferences().bottomMatDiameterXmm).toBe(12);
    expect(modelStore.footingMatPreferences().bottomMatDiameterYmm).toBe(20);
  });

  it('changes nothing else about the project it round-trips (P)', () => {
    const { footingId, profileId } = withFooting();
    modelStore.setFootingMatPreferences({ bottomMatDiameterYmm: 25 });
    const before = JSON.parse(JSON.stringify(modelStore.snapshot()));

    modelStore.clear();
    modelStore.restore(before);
    const after = JSON.parse(JSON.stringify(modelStore.snapshot()));

    // Dimensions, soil, identifiers, diameters and policy all come back unchanged, and
    // `restore(snapshot())` is a no-op on the whole payload rather than on the parts this
    // test happened to name.
    expect(after.footings).toEqual(before.footings);
    expect(after.geotechnical).toEqual(before.geotechnical);
    expect(after.footingMatPreferences).toEqual(before.footingMatPreferences);
    expect(modelStore.model.footings.get(footingId)!.thickness).toBe(0.45);
    expect(modelStore.model.geotechnical!.profiles.find((p) => p.id === profileId)).toBeDefined();
  });

  // ── Q: invalidation, on the foundation channel ─────────────────

  it('does NOT clear the structural analysis when a diameter changes (Q)', () => {
    withFooting();
    // `modelVersion` is what fires the results-invalidation hook, so holding it is the
    // mechanism by which a valid solve survives. A mat diameter changes the depth a footing is
    // designed at; it does not change the stiffness that produced the reaction.
    const before = modelStore.modelVersion;
    modelStore.setFootingMatPreferences({ bottomMatDiameterXmm: 20 });
    expect(modelStore.modelVersion).toBe(before);
  });

  it('leaves a stored 3D result set in place (Q)', () => {
    withFooting();
    resultsStore.setResults3D({
      displacements: [], reactions: [], elementForces: [],
    } as never);
    expect(resultsStore.results3D).not.toBeNull();

    modelStore.setFootingMatPreferences({ bottomMatDiameterYmm: 25 });

    // If this were null, the design run that follows the edit would find no reaction and every
    // footing would report "no reaction" — the exact failure the foundation channel exists for.
    expect(resultsStore.results3D).not.toBeNull();
  });

  it('fires the targeted foundation-change edge, which is what supersedes documents (Q)', () => {
    // Registered here rather than asserted through the detailing store: this is the SAME edge
    // `store/index.ts` connects to `supersedeDocuments()`, so proving the edge fires proves the
    // supersession is reached. Overwriting the hook is confined to this test file.
    let fired = 0;
    modelStore._setOnFoundationChange(() => { fired++; });

    modelStore.setFootingMatPreferences({ bottomMatDiameterXmm: 20 });
    expect(fired).toBe(1);
    modelStore.setFootingMatPreferences({ bottomMatDiameterYmm: 32 });
    expect(fired).toBe(2);
  });

  it('does not fire, record or supersede on a write that changes nothing (Q)', () => {
    // A document retired by a no-op edit teaches the user to ignore supersession.
    let fired = 0;
    modelStore._setOnFoundationChange(() => { fired++; });
    modelStore.setFootingMatPreferences({ bottomMatDiameterXmm: 16 });
    modelStore.setFootingMatPreferences({});
    expect(fired).toBe(0);
  });

  // ── The undo channel ───────────────────────────────────────────

  it('is undoable through the foundation channel, and redoable', () => {
    withFooting();
    modelStore.setFootingMatPreferences({ bottomMatDiameterXmm: 25 });
    expect(modelStore.footingMatPreferences().bottomMatDiameterXmm).toBe(25);

    historyStore.undo();
    expect(modelStore.footingMatPreferences().bottomMatDiameterXmm).toBe(16);

    historyStore.redo();
    expect(modelStore.footingMatPreferences().bottomMatDiameterXmm).toBe(25);
  });

  it('undoing a mat edit does not destroy the solve either', () => {
    withFooting();
    resultsStore.setResults3D({
      displacements: [], reactions: [], elementForces: [],
    } as never);
    modelStore.setFootingMatPreferences({ bottomMatDiameterXmm: 25 });
    const version = modelStore.modelVersion;

    historyStore.undo();

    expect(modelStore.footingMatPreferences().bottomMatDiameterXmm).toBe(16);
    expect(modelStore.modelVersion).toBe(version);
    expect(resultsStore.results3D).not.toBeNull();
  });

  it('a new project starts from the stated default, not the previous project\'s mat', () => {
    modelStore.setFootingMatPreferences({ bottomMatDiameterXmm: 32 });
    modelStore.clear();
    expect(modelStore.footingMatPreferences().bottomMatDiameterXmm).toBe(16);
  });
});
