// Preset materials for quick selection
// Properties in SI units: E (MPa), ν, ρ (kN/m³), fy (MPa)

import { t } from '../i18n';
import {
  HOT_ROLLED, COLD_FORMED, ALUMINIUM, STAINLESS,
  BASIC_REGIONS, MATERIAL_DESIGN_CODES, gradesForCode,
  type StructuralGrade, type GradeFamily, type GradeRegion, type ThicknessBand,
} from './structural-grades';
import { CONCRETE, TIMBER } from './non-metal-grades';

export interface MaterialPreset {
  name: string;
  category: 'acero' | 'conformado' | 'inox' | 'hormigon' | 'madera' | 'aluminio';
  e: number;    // MPa
  nu: number;
  rho: number;  // kN/m³
  fy?: number;  // MPa
  /**
   * The product standard the values come from, for the metal grades.
   *
   * Shown next to the name because "A572 Gr.50" and "S355" are only meaningful
   * alongside the standard that defines them, and because two standards can
   * use the same designation for different steels.
   */
  standard?: string;
  /** Ultimate tensile strength, MPa — present for the graded metals. */
  fu?: number;
  /** Link back to the grade database, so a selection can be traced. */
  gradeId?: string;
  /** Origin of the product standard — absent for concrete, timber and rebar. */
  region?: GradeRegion;
  /**
   * Whether the values were read from the governing standard or carried from
   * general knowledge of the material. Surfaced in the picker, because a user
   * choosing a grade for a calculation deserves to know which they are getting.
   */
  verification?: 'standard' | 'typical';
  /**
   * The grade's thickness bands, where the product standard tabulates them.
   *
   * `fy` above is the THIN-PLATE value, which is what `structural-grades.ts`
   * warns about in its own header: hot-rolled yield falls with thickness, and a
   * caller that quotes the headline number for a 60 mm plate is unconservative
   * by about 6 %. Carrying the bands lets the picker say so instead of
   * presenting one number as if the standard gave only one.
   *
   * This is disclosure, not selection: nothing here picks a band, because the
   * member's governing thickness is not known at this point. Choosing by
   * thickness is a larger change with its own decisions.
   */
  thicknessBands?: ThicknessBand[];
}

/**
 * Adapt a catalogued grade to the preset shape the pickers already consume.
 *
 * The grade database is the source of truth; this is a projection of it, so
 * adding a grade there makes it appear in every picker without touching them.
 */
function fromGrade(g: StructuralGrade, category: MaterialPreset['category']): MaterialPreset {
  return {
    name: g.designation,
    category,
    e: g.e,
    nu: g.nu,
    rho: g.rho,
    fy: g.fy,
    fu: g.fu,
    standard: g.productStandard,
    gradeId: g.id,
    region: g.region,
    verification: g.verification,
    thicknessBands: g.byThickness,
  };
}

/** Returns material presets with translated names (call inside reactive context) */
export function getMaterialPresets(): MaterialPreset[] {
  return [
    // ─── Aceros estructurales, de la base multinorma ───
    //
    // Listed from the grade database rather than repeated here, so IRAM, ASTM,
    // EN and NBR grades all reach the picker and none of them can drift out of
    // step with the values the checks use.
    ...HOT_ROLLED.map((g) => fromGrade(g, 'acero')),
    ...COLD_FORMED.map((g) => fromGrade(g, 'conformado')),
    ...STAINLESS.map((g) => fromGrade(g, 'inox')),

    // Reinforcing steel: a bar grade, not a section grade, so it has no place
    // in the rolled-profile database but is still needed to model concrete.
    { name: t('material.steelADN420'),    category: 'acero', e: 200000, nu: 0.3, rho: 78.5, fy: 420 },

    // ─── Hormigones, multinorma ───
    //
    // Projected from the grade database like the metals. The design code is
    // part of each entry's identity rather than a filter over it, because for
    // concrete the MODULUS depends on the code: the same 25 MPa concrete is
    // 23 500 MPa under CIRSOC/ACI and 31 500 under Eurocode.
    ...CONCRETE.map((c): MaterialPreset => ({
      name: c.designation,
      category: 'hormigon',
      e: c.e, nu: c.nu, rho: c.rho,
      // `fy` is the generic strength field the panels read; for concrete the
      // meaningful strength is fck, so that is what goes in it.
      fy: c.fck,
      standard: c.code,
      gradeId: c.id,
      region: c.region as GradeRegion,
      verification: 'standard',
    })),

    // ─── Maderas, clases EN 338 ───
    ...TIMBER.map((w): MaterialPreset => ({
      name: w.designation,
      category: 'madera',
      e: w.e, nu: w.nu, rho: w.rho,
      fy: w.fmk,
      standard: w.code,
      gradeId: w.id,
      region: w.region as GradeRegion,
      verification: 'standard',
    })),

    // ─── Aluminio ───
    ...ALUMINIUM.map((g) => fromGrade(g, 'aluminio')),
  ];
}

/** @deprecated Use getMaterialPresets() instead */
export const MATERIAL_PRESETS: MaterialPreset[] = [
  { name: 'Acero A36',       category: 'acero', e: 200000, nu: 0.3, rho: 78.5, fy: 250 },
  { name: 'Acero A572 Gr50', category: 'acero', e: 200000, nu: 0.3, rho: 78.5, fy: 345 },
  { name: 'Acero A992',      category: 'acero', e: 200000, nu: 0.3, rho: 78.5, fy: 345 },
  { name: 'Acero A500 Gr C', category: 'acero', e: 200000, nu: 0.3, rho: 78.5, fy: 317 },
  { name: 'Acero ADN 420',   category: 'acero', e: 200000, nu: 0.3, rho: 78.5, fy: 420 },
  { name: 'Hormigón H-20', category: 'hormigon', e: 21019, nu: 0.2, rho: 24.0, fy: 20 },
  { name: 'Hormigón H-25', category: 'hormigon', e: 23500, nu: 0.2, rho: 24.0, fy: 25 },
  { name: 'Hormigón H-30', category: 'hormigon', e: 25743, nu: 0.2, rho: 24.0, fy: 30 },
  { name: 'Hormigón H-35', category: 'hormigon', e: 27806, nu: 0.2, rho: 24.0, fy: 35 },
  { name: 'Hormigón H-40', category: 'hormigon', e: 29725, nu: 0.2, rho: 24.5, fy: 40 },
  { name: 'Hormigón H-45', category: 'hormigon', e: 31529, nu: 0.2, rho: 24.5, fy: 45 },
  { name: 'Hormigón H-50', category: 'hormigon', e: 33234, nu: 0.2, rho: 25.0, fy: 50 },
  { name: 'Madera (pino)',   category: 'madera', e: 10000, nu: 0.3, rho: 5.0 },
  { name: 'Madera (eucalipto)', category: 'madera', e: 15000, nu: 0.3, rho: 8.0 },
  { name: 'Aluminio 6061-T6', category: 'aluminio', e: 69000, nu: 0.33, rho: 27.0, fy: 276 },
];

export const MATERIAL_CATEGORIES = [
  { id: 'acero', label: 'matCat.steel' },
  { id: 'conformado', label: 'matCat.coldFormed' },
  { id: 'inox', label: 'matCat.stainless' },
  { id: 'aluminio', label: 'matCat.aluminum' },
  { id: 'hormigon', label: 'matCat.concrete' },
  { id: 'madera', label: 'matCat.wood' },
] as const;

/**
 * The grade family behind a picker category, or null for the non-metals.
 *
 * Concrete and timber have no entry in the grade database and no design code
 * attached here, so they return null and the code filter simply does not apply
 * to them.
 */
export function categoryFamily(category: string): GradeFamily | null {
  switch (category) {
    case 'acero': return 'hot-rolled';
    case 'conformado': return 'cold-formed';
    case 'inox': return 'stainless';
    case 'aluminio': return 'aluminium';
    default: return null;
  }
}

export interface PresetFilter {
  /** Design code to narrow the grades to. Omitted means no code filter. */
  codeId?: string;
  /** PRO shows every region; Basic shows European, American and Argentine. */
  pro?: boolean;
}

export function searchPresets(
  query: string,
  category?: string,
  filter: PresetFilter = {},
): MaterialPreset[] {
  let source = getMaterialPresets();
  if (category) source = source.filter(p => p.category === category);

  // Region gating, then the code association. Both only bite on the graded
  // metals: a preset with no region (concrete, timber, reinforcing bar) is
  // never filtered out by a control that has no opinion about it.
  if (!filter.pro) {
    source = source.filter(p => !p.region || BASIC_REGIONS.includes(p.region));
  }
  const family = category ? categoryFamily(category) : null;
  // Concrete and timber filter by the code NAME carried on the preset: they
  // have no grade family in the metal sense, but the control means the same
  // thing to a user, so it behaves the same way.
  if (filter.codeId && !family) {
    source = source.filter(p => !p.standard || p.standard === filter.codeId);
  }
  if (filter.codeId && family) {
    const code = MATERIAL_DESIGN_CODES.find(c => c.id === filter.codeId);
    if (code) {
      const allowed = new Set(gradesForCode(code, family).map(g => g.id));
      source = source.filter(p => !p.gradeId || allowed.has(p.gradeId));
    }
  }

  if (!query.trim()) return source;
  const q = query.trim().toLowerCase();
  // Searching the standard as well as the name is what makes "EN 10025" or
  // "NBR" a usable query — which is how someone working to one code finds the
  // grades that code is written around.
  return source.filter(p =>
    p.name.toLowerCase().includes(q) || (p.standard?.toLowerCase().includes(q) ?? false),
  );
}
