/**
 * A preset must not present a thickness-dependent `fy` as if it were one number.
 *
 * `structural-grades.ts` says so itself: "`fy` for hot-rolled steel FALLS with
 * thickness … `byThickness` carries it and `fy` is the thin-plate value — so a
 * caller that ignores thickness is unconservative, by about 6%, silently."
 *
 * Every production caller ignored it. `fromGrade` copied `g.fy` and dropped the
 * bands, so the picker offered S355 as a flat 355 MPa and a user sizing a 60 mm
 * plate got a yield stress 6 % above what EN 10025-2 gives them (335). The error
 * runs in the unsafe direction, which is why it is worth carrying rather than
 * documenting.
 *
 * This does NOT change the number the model uses — plumbing the member's real
 * thickness into the design check is a larger change with its own decisions. It
 * stops the picker claiming a certainty the standard does not give.
 */
import { describe, it, expect } from 'vitest';
import { getMaterialPresets } from '../material-presets';
import { ALL_GRADES } from '../structural-grades';

const PRESETS = getMaterialPresets();

describe('a preset carries its grade thickness bands', () => {
  it('keeps the bands for every grade that has them', () => {
    const banded = ALL_GRADES.filter((g) => g.byThickness && g.byThickness.length > 0);
    expect(banded.length, 'the fixture for this test is the data itself').toBeGreaterThan(0);

    for (const g of banded) {
      const preset = PRESETS.find((p) => p.gradeId === g.id);
      if (!preset) continue; // not every grade is offered in every picker
      expect(preset.thicknessBands, `${g.designation} lost its bands`).toBeDefined();
      expect(preset.thicknessBands!.length).toBe(g.byThickness!.length);
    }
  });

  it('leaves a grade with a single tabulated value alone', () => {
    const flat = ALL_GRADES.find((g) => !g.byThickness);
    expect(flat, 'some grade is tabulated as one value').toBeDefined();
    const preset = PRESETS.find((p) => p.gradeId === flat!.id);
    if (preset) expect(preset.thicknessBands).toBeUndefined();
  });

  it('the quoted fy is the FIRST band, so the bands explain the headline number', () => {
    // If these ever disagree the picker would show one number and caveat another.
    for (const p of PRESETS) {
      if (!p.thicknessBands?.length) continue;
      expect(p.fy, `${p.name}`).toBe(p.thicknessBands[0].fy);
    }
  });

  it('S355 specifically drops to 335 MPa over 40 mm, per EN 10025-2', () => {
    // The grade the module's own docstring uses to explain the hazard.
    const s355 = PRESETS.find((p) => p.gradeId === 'en-s355');
    expect(s355?.fy).toBe(355);
    const thick = s355?.thicknessBands?.find((b) => b.overMm === 40);
    expect(thick?.fy, 'the 40–80 mm band').toBe(335);
  });
});
