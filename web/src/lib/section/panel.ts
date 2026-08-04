/**
 * panel.ts — the canonical detailed-analysis result the UI renders.
 *
 * # Why an adapter rather than logic inside the components
 *
 * `SectionStressPanel` and `CrossSectionDrawing` both need the same thing: the
 * canonical geometry, the canonical bending field, and proof the two describe
 * one section. Putting that in either component would duplicate it in the
 * other and leave the guard reachable from only one of them. So it lives here,
 * is pure, and is testable without mounting Svelte.
 *
 * # What is canonical and what is not
 *
 * Only axial and bending stress come from canonical geometry today. Transverse
 * shear and torsion are boundary-value problems on the section that Checkpoint
 * 2C solves; the legacy formulas for them are valid for a narrow set of
 * families and wrong for angles, arbitrary polygons and closed sections. The
 * result therefore reports its components explicitly rather than handing back
 * one undifferentiated "stress", so a caller cannot combine a trustworthy
 * normal stress with an untrustworthy shear and present the total as valid.
 */

import type { Section } from '../store/model.svelte';
import type { ElementForces } from '../engine/types';
import { analyzeSectionBending, type BendingResponse } from '../engine/wasm-solver';
import { computeDiagramValueAt } from '../engine/diagrams';
import { resolveDrawingGeometry, assertSameGeometry, type DrawingGeometry, type DrawingRefusal } from './drawing';

/**
 * Section families whose legacy transverse-shear implementation was validated
 * for its own domain.
 *
 * A solid rectangle and the web/flange split of an I, H or U profile have a
 * single well-defined width `b(y)`, which is what `V*Q/(I*b)` requires. An
 * angle does not — its principal axes are rotated and its shear centre sits at
 * the corner — and neither does an arbitrary polygon or a closed section. Those
 * are excluded here rather than run through a formula that returns a
 * plausible-looking wrong number.
 */
const LEGACY_SHEAR_VALID_SHAPES = new Set(['rect', 'I', 'H', 'U']);

export type StressComponentSource = 'canonical' | 'legacy' | 'unavailable';

/** Which parts of a detailed result may be trusted, and why. */
export interface ComponentProvenance {
  normalAndBending: StressComponentSource;
  transverseShear: StressComponentSource;
  torsion: StressComponentSource;
  /** True only when every component present is trustworthy for this section. */
  combinedCriteriaValid: boolean;
}

export interface CanonicalPanelResult {
  ok: true;
  geometry: DrawingGeometry;
  bending: BendingResponse;
  /** Resultants used, echoed so the panel can show exactly what was analysed. */
  forces: { n: number; my: number; mz: number };
  provenance: ComponentProvenance;
}

export type PanelRefusal =
  | DrawingRefusal
  | { kind: 'noResults' }
  | { kind: 'noForces' }
  | { kind: 'engineError'; message: string };

export type PanelResult = CanonicalPanelResult | { ok: false; refusal: PanelRefusal };

/**
 * Element-local resultants at a station, mapped into section coordinates.
 *
 * 2D carries a single bending moment about the section's horizontal axis, so
 * `mz` is zero; 3D supplies both. A rotated section sees the moment vector
 * rotated by `-rotation` in its own frame — the same transform the Rust side
 * applies, requested here by `forcesAreLocal` rather than duplicated.
 */
export function stationForces2D(ef: ElementForces, t: number): { n: number; my: number; mz: number } {
  return {
    n: computeDiagramValueAt('axial', t, ef),
    my: computeDiagramValueAt('moment', t, ef),
    mz: 0,
  };
}

/** Interpolate a 3D element's resultants at a station. */
export function stationForces3D(
  ef: { nStart: number; nEnd: number; myStart: number; myEnd: number; mzStart: number; mzEnd: number },
  t: number,
): { n: number; my: number; mz: number } {
  const lerp = (a: number, b: number) => a + (b - a) * t;
  return {
    n: lerp(ef.nStart, ef.nEnd),
    my: lerp(ef.myStart, ef.myEnd),
    mz: lerp(ef.mzStart, ef.mzEnd),
  };
}

/** Decide which stress components this section may legitimately report. */
export function componentProvenance(sec: Section): ComponentProvenance {
  const canonical = sec.canonical?.kind === 'geometry-backed';
  const shape = sec.shape ?? '';
  const legacyShearOk = canonical && LEGACY_SHEAR_VALID_SHAPES.has(shape);
  return {
    normalAndBending: canonical ? 'canonical' : 'unavailable',
    transverseShear: legacyShearOk ? 'legacy' : 'unavailable',
    // Neither Routh's J nor the `Iz * 0.001` compatibility fallback is a
    // detailed torsional result, and the Saint-Venant solver is Checkpoint 2C.
    torsion: 'unavailable',
    // A combined criterion is only meaningful if every component feeding it is
    // trustworthy. With shear or torsion unavailable, von Mises over "normal
    // stress plus nothing" is still exact, so the flag tracks whether an
    // INVALID component would be mixed in — never whether one is missing.
    combinedCriteriaValid: canonical,
  };
}

/**
 * Build the canonical detailed-analysis result for one element station.
 *
 * Refuses rather than approximating: a properties-only section, an unresolved
 * section, absent results, or any geometry/digest disagreement all return a
 * structured refusal the panel can render as "detailed geometry unavailable".
 */
export function canonicalPanelResult(
  sec: Section,
  forces: { n: number; my: number; mz: number } | null,
): PanelResult {
  const drawing = resolveDrawingGeometry(sec);
  if (!drawing.ok) return { ok: false, refusal: drawing.refusal };
  if (!forces) return { ok: false, refusal: { kind: 'noForces' } };

  const st = sec.canonical;
  if (!st || st.kind !== 'geometry-backed') {
    return { ok: false, refusal: { kind: 'notResolved' } };
  }

  let bending: BendingResponse;
  try {
    bending = analyzeSectionBending({
      geometry: st.geometry,
      n: forces.n,
      my: forces.my,
      mz: forces.mz,
      // The section's own rotation maps element-local moments into its frame.
      forcesAreLocal: true,
    });
  } catch (err) {
    return { ok: false, refusal: { kind: 'engineError', message: (err as Error)?.message ?? String(err) } };
  }

  // The guard the whole layer exists for: the outline about to be drawn and
  // the field about to be plotted on it must be the same section.
  const mismatch = assertSameGeometry(drawing.geometry, bending);
  if (mismatch) return { ok: false, refusal: mismatch };

  return {
    ok: true,
    geometry: drawing.geometry,
    bending,
    forces,
    provenance: componentProvenance(sec),
  };
}
