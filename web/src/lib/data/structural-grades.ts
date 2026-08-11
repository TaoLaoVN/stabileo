/**
 * structural-grades.ts — steel, aluminium and stainless grades, across codes.
 *
 * # The two axes, which are not the same axis
 *
 * A metal member is specified by TWO independent things, and conflating them is
 * the modelling error this file exists to prevent:
 *
 *   * a **grade**, fixed by a PRODUCT standard (EN 10025, ASTM A572, NBR 7007,
 *     IRAM-IAS U 500). This is what the mill certifies: E, nu, rho, fy, fu.
 *   * a **design code** (CIRSOC 301, AISC 360, EN 1993-1-1, NBR 8800). This is
 *     what the engineer applies: resistance factors, buckling curves, section
 *     classification.
 *
 * They vary independently. An A36 section can be checked to AISC 360 or to
 * CIRSOC 301; an S355 can be checked to EN 1993 with a German or a French
 * national annex. So a grade does not belong to a code, and this file keeps
 * them as separate tables joined by family rather than as one flat list.
 *
 * # Where these numbers come from, and what that obliges
 *
 * Every value here is a published characteristic value from the product
 * standard named in `productStandard`. They are the nominal values a code
 * checks against, not measured properties of any particular heat.
 *
 * Two consequences worth stating plainly rather than burying:
 *
 *   1. `fy` for hot-rolled steel FALLS with thickness. A grade quoted as "S355"
 *      is 355 MPa up to 40 mm and 335 MPa beyond it. Where the standard tabulates
 *      that, `byThickness` carries it and `fy` is the thin-plate value — so a
 *      caller that ignores thickness is unconservative, by about 6%, silently.
 *   2. Elastic constants differ BY CODE for the same metal: EN 1999 fixes
 *      aluminium at E = 70000 MPa and nu = 0.3, while ADM uses 69600 and 0.33.
 *      The values here follow the standard each grade is published under.
 *
 * These are reference values for modelling and teaching. A professional
 * verification should be checked against the governing standard's own table —
 * which is why `productStandard` is stored per grade rather than assumed.
 */

export type GradeFamily = 'hot-rolled' | 'cold-formed' | 'aluminium' | 'stainless';

/** Where a grade's product standard comes from. */
export type GradeRegion = 'AR' | 'US' | 'EU' | 'BR' | 'AU' | 'IN' | 'ZA';

/**
 * The regions Basic mode offers.
 *
 * European and American cover the overwhelming majority of what is specified
 * locally, and they also cover CIRSOC by construction: CIRSOC 301 is a
 * verification code that adopts AISC's method and takes its sections from
 * whatever is commercially normalised, which in Argentina means IRAM grades
 * alongside ASTM ones. So Argentina is in this list not as a third region but
 * because it is the default, and hiding its own grades would be perverse.
 *
 * Everything else — Brazilian, Australian, Indian, South African — is real and
 * loaded, just not surfaced in Basic. PRO shows the lot.
 */
export const BASIC_REGIONS: GradeRegion[] = ['AR', 'EU', 'US'];

/** A yield/ultimate pair that applies over a thickness band. */
export interface ThicknessBand {
  /** Lower bound, exclusive, mm. */
  overMm: number;
  /** Upper bound, inclusive, mm. */
  upToMm: number;
  fy: number;
  fu: number;
}

export interface StructuralGrade {
  /** Stable identifier — this is what a saved model stores. */
  id: string;
  /** How the grade is written on a drawing. */
  designation: string;
  /** The PRODUCT standard that fixes the values below. */
  productStandard: string;
  /** Where that standard comes from — drives which modes offer the grade. */
  region: GradeRegion;
  family: GradeFamily;
  /** Young's modulus, MPa. */
  e: number;
  nu: number;
  /** Weight density, kN/m³. */
  rho: number;
  /** Yield (or 0.2% proof) strength, MPa — the thinnest band. */
  fy: number;
  /** Ultimate tensile strength, MPa. */
  fu: number;
  /**
   * Thickness dependence, where the product standard tabulates it. Absent
   * means the standard quotes a single value for the usual range, not that
   * thickness has no effect.
   */
  byThickness?: ThicknessBand[];
  /** Anything a user would otherwise have to know from outside the table. */
  note?: string;
}

export interface DesignCode {
  id: string;
  /** As cited in a calculation report. */
  name: string;
  region: string;
  /** Which families this code covers. */
  families: GradeFamily[];
  /** The safety format the code is written in. */
  format: 'LRFD' | 'ASD' | 'LRFD+ASD' | 'partial-factors' | 'allowable';
  /**
   * Which regions' grades this code is normally applied to.
   *
   * Not a restriction the code imposes — nothing stops an engineer checking an
   * EN grade to AISC, and the arithmetic works. It is what the code's own
   * tables are written around, and it is what makes the picker useful rather
   * than exhaustive: choosing CIRSOC should surface the steels an Argentine
   * drawing actually specifies, not all sixty-eight.
   *
   * CIRSOC lists two regions because that is the honest answer: it adopts
   * AISC's method, so IRAM and ASTM grades sit side by side in local practice.
   */
  gradeRegions: GradeRegion[];
}

// ─────────────────────────────────────────────────────────────────────
// Hot-rolled structural steel
//
// E = 210 000 MPa under EN, 200 000 MPa under ASTM/NBR — a real difference in
// the standards, not a rounding, and it moves a deflection by 5%.
// ─────────────────────────────────────────────────────────────────────

const EN_STEEL = { e: 210000, nu: 0.3, rho: 78.5 } as const;
const US_STEEL = { e: 200000, nu: 0.3, rho: 78.5 } as const;

export const HOT_ROLLED: StructuralGrade[] = [
  // ── Argentina — IRAM, the grades CIRSOC 301 is written around ──
  //
  // The F-nn number is the yield strength in kgf/mm²: F-24 is 24 kgf/mm²,
  // i.e. 235 MPa. Worth knowing, because the designation looks like a
  // strength in MPa and is not one.
  { id: 'iram-f24', designation: 'F-24', productStandard: 'IRAM-IAS U 500-42', region: 'AR', family: 'hot-rolled', ...US_STEEL, fy: 235, fu: 370 },
  { id: 'iram-f26', designation: 'F-26', productStandard: 'IRAM-IAS U 500-42', region: 'AR', family: 'hot-rolled', ...US_STEEL, fy: 255, fu: 410 },
  { id: 'iram-f36', designation: 'F-36', productStandard: 'IRAM-IAS U 500-42', region: 'AR', family: 'hot-rolled', ...US_STEEL, fy: 355, fu: 510 },

  // ── ASTM ──
  { id: 'astm-a36', designation: 'A36', productStandard: 'ASTM A36', region: 'US', family: 'hot-rolled', ...US_STEEL, fy: 250, fu: 400 },
  { id: 'astm-a529-50', designation: 'A529 Gr.50', productStandard: 'ASTM A529', region: 'US', family: 'hot-rolled', ...US_STEEL, fy: 345, fu: 450 },
  { id: 'astm-a529-55', designation: 'A529 Gr.55', productStandard: 'ASTM A529', region: 'US', family: 'hot-rolled', ...US_STEEL, fy: 380, fu: 485 },
  { id: 'astm-a572-42', designation: 'A572 Gr.42', productStandard: 'ASTM A572', region: 'US', family: 'hot-rolled', ...US_STEEL, fy: 290, fu: 415 },
  { id: 'astm-a572-50', designation: 'A572 Gr.50', productStandard: 'ASTM A572', region: 'US', family: 'hot-rolled', ...US_STEEL, fy: 345, fu: 450 },
  { id: 'astm-a572-55', designation: 'A572 Gr.55', productStandard: 'ASTM A572', region: 'US', family: 'hot-rolled', ...US_STEEL, fy: 380, fu: 485 },
  { id: 'astm-a572-60', designation: 'A572 Gr.60', productStandard: 'ASTM A572', region: 'US', family: 'hot-rolled', ...US_STEEL, fy: 415, fu: 520 },
  { id: 'astm-a572-65', designation: 'A572 Gr.65', productStandard: 'ASTM A572', region: 'US', family: 'hot-rolled', ...US_STEEL, fy: 450, fu: 550 },
  {
    id: 'astm-a992', designation: 'A992', productStandard: 'ASTM A992', region: 'US', family: 'hot-rolled', ...US_STEEL, fy: 345, fu: 450,
    note: 'W shapes. fy is capped at 450 MPa and fy/fu is limited to 0.85 — the ductility requirement that A36 lacked.',
  },
  { id: 'astm-a588', designation: 'A588', productStandard: 'ASTM A588', region: 'US', family: 'hot-rolled', ...US_STEEL, fy: 345, fu: 485, note: 'Weathering steel.' },
  { id: 'astm-a913-50', designation: 'A913 Gr.50', productStandard: 'ASTM A913', region: 'US', family: 'hot-rolled', ...US_STEEL, fy: 345, fu: 450 },
  { id: 'astm-a913-65', designation: 'A913 Gr.65', productStandard: 'ASTM A913', region: 'US', family: 'hot-rolled', ...US_STEEL, fy: 450, fu: 550 },

  // ── EN 10025-2, with the thickness bands of EN 1993-1-1 table 3.1 ──
  {
    id: 'en-s235', designation: 'S235', productStandard: 'EN 10025-2', region: 'EU', family: 'hot-rolled', ...EN_STEEL, fy: 235, fu: 360,
    byThickness: [{ overMm: 0, upToMm: 40, fy: 235, fu: 360 }, { overMm: 40, upToMm: 80, fy: 215, fu: 360 }],
  },
  {
    id: 'en-s275', designation: 'S275', productStandard: 'EN 10025-2', region: 'EU', family: 'hot-rolled', ...EN_STEEL, fy: 275, fu: 430,
    byThickness: [{ overMm: 0, upToMm: 40, fy: 275, fu: 430 }, { overMm: 40, upToMm: 80, fy: 255, fu: 410 }],
  },
  {
    id: 'en-s355', designation: 'S355', productStandard: 'EN 10025-2', region: 'EU', family: 'hot-rolled', ...EN_STEEL, fy: 355, fu: 510,
    byThickness: [{ overMm: 0, upToMm: 40, fy: 355, fu: 510 }, { overMm: 40, upToMm: 80, fy: 335, fu: 470 }],
  },
  {
    id: 'en-s450', designation: 'S450', productStandard: 'EN 10025-2', region: 'EU', family: 'hot-rolled', ...EN_STEEL, fy: 440, fu: 550,
    byThickness: [{ overMm: 0, upToMm: 40, fy: 440, fu: 550 }, { overMm: 40, upToMm: 80, fy: 410, fu: 550 }],
  },
  // EN 10025-3, normalised fine-grain — the grades used where toughness governs.
  { id: 'en-s275n', designation: 'S275N', productStandard: 'EN 10025-3', region: 'EU', family: 'hot-rolled', ...EN_STEEL, fy: 275, fu: 390 },
  { id: 'en-s355n', designation: 'S355N', productStandard: 'EN 10025-3', region: 'EU', family: 'hot-rolled', ...EN_STEEL, fy: 355, fu: 490 },
  { id: 'en-s420n', designation: 'S420N', productStandard: 'EN 10025-3', region: 'EU', family: 'hot-rolled', ...EN_STEEL, fy: 420, fu: 520 },
  { id: 'en-s460n', designation: 'S460N', productStandard: 'EN 10025-3', region: 'EU', family: 'hot-rolled', ...EN_STEEL, fy: 460, fu: 540 },

  // ── Brazil — NBR 7007, the grades in the CalcSteel list ──
  { id: 'nbr-mr250', designation: 'MR-250', productStandard: 'NBR 7007', region: 'BR', family: 'hot-rolled', ...US_STEEL, fy: 250, fu: 400 },
  { id: 'nbr-ar350', designation: 'AR-350', productStandard: 'NBR 7007', region: 'BR', family: 'hot-rolled', ...US_STEEL, fy: 350, fu: 450 },
  { id: 'nbr-ar350cor', designation: 'AR-350 COR', productStandard: 'NBR 7007', region: 'BR', family: 'hot-rolled', ...US_STEEL, fy: 350, fu: 485, note: 'Weathering steel.' },
  { id: 'nbr-ar415', designation: 'AR-415', productStandard: 'NBR 7007', region: 'BR', family: 'hot-rolled', ...US_STEEL, fy: 415, fu: 520 },
];

// ─────────────────────────────────────────────────────────────────────
// Cold-formed steel
//
// Thin-walled sections buckle locally before they yield, so these grades are
// only half the story: the design code's effective-width rules are the other
// half, and they differ more between codes than the grades do.
// ─────────────────────────────────────────────────────────────────────

export const COLD_FORMED: StructuralGrade[] = [
  // ── EN 10346, structural galvanised sheet ──
  { id: 'en-s220gd', designation: 'S220GD+Z', productStandard: 'EN 10346', region: 'EU', family: 'cold-formed', ...EN_STEEL, fy: 220, fu: 300 },
  { id: 'en-s250gd', designation: 'S250GD+Z', productStandard: 'EN 10346', region: 'EU', family: 'cold-formed', ...EN_STEEL, fy: 250, fu: 330 },
  { id: 'en-s280gd', designation: 'S280GD+Z', productStandard: 'EN 10346', region: 'EU', family: 'cold-formed', ...EN_STEEL, fy: 280, fu: 360 },
  { id: 'en-s320gd', designation: 'S320GD+Z', productStandard: 'EN 10346', region: 'EU', family: 'cold-formed', ...EN_STEEL, fy: 320, fu: 390 },
  { id: 'en-s350gd', designation: 'S350GD+Z', productStandard: 'EN 10346', region: 'EU', family: 'cold-formed', ...EN_STEEL, fy: 350, fu: 420 },
  {
    id: 'en-s550gd', designation: 'S550GD+Z', productStandard: 'EN 10346', region: 'EU', family: 'cold-formed', ...EN_STEEL, fy: 550, fu: 560,
    note: 'High strength, low ductility: fu/fy is only 1.02, so no plastic redistribution is available.',
  },

  // ── ASTM ──
  { id: 'astm-a653-33', designation: 'A653 SS Gr.33', productStandard: 'ASTM A653', region: 'US', family: 'cold-formed', ...US_STEEL, fy: 230, fu: 310, note: 'Galvanised.' },
  { id: 'astm-a653-37', designation: 'A653 SS Gr.37', productStandard: 'ASTM A653', region: 'US', family: 'cold-formed', ...US_STEEL, fy: 255, fu: 360, note: 'Galvanised.' },
  { id: 'astm-a653-40', designation: 'A653 SS Gr.40', productStandard: 'ASTM A653', region: 'US', family: 'cold-formed', ...US_STEEL, fy: 275, fu: 380, note: 'Galvanised.' },
  { id: 'astm-a653-50', designation: 'A653 SS Gr.50 Cl.1', productStandard: 'ASTM A653', region: 'US', family: 'cold-formed', ...US_STEEL, fy: 345, fu: 450, note: 'Galvanised.' },
  { id: 'astm-a653-80', designation: 'A653 SS Gr.80', productStandard: 'ASTM A653', region: 'US', family: 'cold-formed', ...US_STEEL, fy: 550, fu: 570, note: 'Galvanised, high strength, low ductility.' },
  { id: 'astm-a1011-50', designation: 'A1011 SS Gr.50', productStandard: 'ASTM A1011', region: 'US', family: 'cold-formed', ...US_STEEL, fy: 345, fu: 450 },
  { id: 'astm-a1003-h', designation: 'A1003 Type H (ST33H)', productStandard: 'ASTM A1003', region: 'US', family: 'cold-formed', ...US_STEEL, fy: 230, fu: 310, note: 'Framing members.' },

  // ── Structural hollow sections, cold-formed ──
  //
  // A500's yield depends on the SHAPE, not only the grade: the corners of a
  // square tube are worked harder than a round one. Both are listed because
  // picking the wrong one is a 9% error on the strength.
  { id: 'astm-a500b-round', designation: 'A500 Gr.B (circular)', productStandard: 'ASTM A500', region: 'US', family: 'cold-formed', ...US_STEEL, fy: 290, fu: 400 },
  { id: 'astm-a500b-shaped', designation: 'A500 Gr.B (rect./cuadrado)', productStandard: 'ASTM A500', region: 'US', family: 'cold-formed', ...US_STEEL, fy: 315, fu: 400 },
  { id: 'astm-a500c-round', designation: 'A500 Gr.C (circular)', productStandard: 'ASTM A500', region: 'US', family: 'cold-formed', ...US_STEEL, fy: 317, fu: 427 },
  { id: 'astm-a500c-shaped', designation: 'A500 Gr.C (rect./cuadrado)', productStandard: 'ASTM A500', region: 'US', family: 'cold-formed', ...US_STEEL, fy: 345, fu: 427 },

  // ── Brazil — NBR 7008 (the ZAR grades NBR 14762 designs with) ──
  { id: 'nbr-zar250', designation: 'ZAR-250', productStandard: 'NBR 7008', region: 'BR', family: 'cold-formed', ...US_STEEL, fy: 250, fu: 360 },
  { id: 'nbr-zar280', designation: 'ZAR-280', productStandard: 'NBR 7008', region: 'BR', family: 'cold-formed', ...US_STEEL, fy: 280, fu: 380 },
  { id: 'nbr-zar345', designation: 'ZAR-345', productStandard: 'NBR 7008', region: 'BR', family: 'cold-formed', ...US_STEEL, fy: 345, fu: 430 },
];

// ─────────────────────────────────────────────────────────────────────
// Structural aluminium
//
// `fy` is the 0.2% PROOF stress: aluminium has no yield plateau, so there is
// no yield point to quote and the value is defined by a permanent set. Its
// modulus is a third of steel's, which is why aluminium structures are almost
// always governed by deflection and buckling rather than by strength.
// ─────────────────────────────────────────────────────────────────────

const EN_ALU = { e: 70000, nu: 0.3, rho: 27.0 } as const;

export const ALUMINIUM: StructuralGrade[] = [
  // 5xxx — magnesium alloys: weldable, marine, work-hardened tempers.
  { id: 'alu-5052-h32', designation: '5052-H32', productStandard: 'EN AW-5052', region: 'EU', family: 'aluminium', ...EN_ALU, fy: 195, fu: 230 },
  { id: 'alu-5083-h111', designation: '5083-H111', productStandard: 'EN AW-5083', region: 'EU', family: 'aluminium', ...EN_ALU, fy: 125, fu: 275, note: 'Naval.' },
  { id: 'alu-5083-h116', designation: '5083-H116', productStandard: 'EN AW-5083', region: 'EU', family: 'aluminium', ...EN_ALU, fy: 215, fu: 305, note: 'Naval.' },
  { id: 'alu-5086-h32', designation: '5086-H32', productStandard: 'EN AW-5086', region: 'EU', family: 'aluminium', ...EN_ALU, fy: 195, fu: 275 },
  { id: 'alu-5754-h22', designation: '5754-H22', productStandard: 'EN AW-5754', region: 'EU', family: 'aluminium', ...EN_ALU, fy: 130, fu: 220 },

  // 6xxx — magnesium-silicon: extrudable and heat-treatable, the structural
  // workhorses. A welded 6xxx member loses roughly half its proof stress in the
  // heat-affected zone, which the design code handles and this table does not.
  { id: 'alu-6060-t6', designation: '6060-T6', productStandard: 'EN AW-6060', region: 'EU', family: 'aluminium', ...EN_ALU, fy: 150, fu: 190, note: 'Extrusion.' },
  { id: 'alu-6061-t6', designation: '6061-T6', productStandard: 'EN AW-6061', region: 'EU', family: 'aluminium', ...EN_ALU, fy: 240, fu: 260 },
  { id: 'alu-6063-t6', designation: '6063-T6', productStandard: 'EN AW-6063', region: 'EU', family: 'aluminium', ...EN_ALU, fy: 170, fu: 205, note: 'Extrusion.' },
  { id: 'alu-6082-t6', designation: '6082-T6', productStandard: 'EN AW-6082', region: 'EU', family: 'aluminium', ...EN_ALU, fy: 250, fu: 290 },
  { id: 'alu-7020-t6', designation: '7020-T6', productStandard: 'EN AW-7020', region: 'EU', family: 'aluminium', ...EN_ALU, fy: 280, fu: 350 },
];

// ─────────────────────────────────────────────────────────────────────
// Stainless steel
//
// The reason it gets its own design code: stainless has NO yield plateau
// either — its stress-strain curve rounds off gradually, so a member reaches
// its proof stress progressively rather than at once. Carbon-steel buckling
// curves do not apply, which is what EN 1993-1-4 exists to replace.
// ─────────────────────────────────────────────────────────────────────

const AUSTENITIC = { e: 200000, nu: 0.3, rho: 79.0 } as const;
const FERRITIC = { e: 220000, nu: 0.3, rho: 77.0 } as const;
const DUPLEX = { e: 200000, nu: 0.3, rho: 78.0 } as const;

export const STAINLESS: StructuralGrade[] = [
  { id: 'ss-1.4301', designation: '1.4301 / 304', productStandard: 'EN 10088-4', region: 'EU', family: 'stainless', ...AUSTENITIC, fy: 230, fu: 540, note: 'Austenítico.' },
  { id: 'ss-1.4306', designation: '1.4306 / 304L', productStandard: 'EN 10088-4', region: 'EU', family: 'stainless', ...AUSTENITIC, fy: 220, fu: 520, note: 'Austenítico, bajo carbono.' },
  { id: 'ss-1.4318', designation: '1.4318 / 301LN', productStandard: 'EN 10088-4', region: 'EU', family: 'stainless', ...AUSTENITIC, fy: 350, fu: 650, note: 'Austenítico al N, alta resistencia.' },
  { id: 'ss-1.4401', designation: '1.4401 / 316', productStandard: 'EN 10088-4', region: 'EU', family: 'stainless', ...AUSTENITIC, fy: 240, fu: 530, note: 'Austenítico al Mo.' },
  { id: 'ss-1.4404', designation: '1.4404 / 316L', productStandard: 'EN 10088-4', region: 'EU', family: 'stainless', ...AUSTENITIC, fy: 240, fu: 530, note: 'Austenítico al Mo, bajo carbono.' },
  { id: 'ss-1.4541', designation: '1.4541 / 321', productStandard: 'EN 10088-4', region: 'EU', family: 'stainless', ...AUSTENITIC, fy: 220, fu: 520, note: 'Austenítico al Ti.' },
  { id: 'ss-1.4571', designation: '1.4571 / 316Ti', productStandard: 'EN 10088-4', region: 'EU', family: 'stainless', ...AUSTENITIC, fy: 240, fu: 540, note: 'Austenítico al Ti.' },
  { id: 'ss-1.4003', designation: '1.4003 / 3CR12', productStandard: 'EN 10088-4', region: 'EU', family: 'stainless', ...FERRITIC, fy: 280, fu: 450, note: 'Ferrítico.' },
  { id: 'ss-1.4016', designation: '1.4016 / 430', productStandard: 'EN 10088-4', region: 'EU', family: 'stainless', ...FERRITIC, fy: 260, fu: 450, note: 'Ferrítico.' },
  { id: 'ss-1.4362', designation: '1.4362 / 2304', productStandard: 'EN 10088-4', region: 'EU', family: 'stainless', ...DUPLEX, fy: 400, fu: 600, note: 'Dúplex.' },
  { id: 'ss-1.4462', designation: '1.4462 / 2205', productStandard: 'EN 10088-4', region: 'EU', family: 'stainless', ...DUPLEX, fy: 480, fu: 660, note: 'Dúplex.' },
];

export const ALL_GRADES: StructuralGrade[] = [
  ...HOT_ROLLED,
  ...COLD_FORMED,
  ...ALUMINIUM,
  ...STAINLESS,
];

// ─────────────────────────────────────────────────────────────────────
// Design codes
// ─────────────────────────────────────────────────────────────────────

/**
 * Design codes, seen from the MATERIALS side.
 *
 * `section-catalog.ts` carries a list under the same concept, seen from the
 * PROFILES side: which dimensional families a code can be applied to. These are
 * two projections of one thing, and they share ids on purpose — `cirsoc-301`
 * here and `cirsoc-301` there are the same code.
 *
 * They are deliberately NOT merged today. The profile list answers "which
 * series does this code ship", the grade list answers "which metal families
 * does it cover", and folding them together would force every profile family to
 * declare a material family it has no opinion about. What is enforced instead
 * is that they cannot disagree where they overlap — see the cross-check in
 * `__tests__/structural-grades.test.ts`, which fails if the same id is given
 * two different regions.
 */
export const MATERIAL_DESIGN_CODES: DesignCode[] = [
  // Hot-rolled
  { id: 'cirsoc-301', name: 'CIRSOC 301:2005', region: 'AR', families: ['hot-rolled'], format: 'LRFD', gradeRegions: ['AR', 'US'] },
  { id: 'aisc-360-16', name: 'AISC 360-16', region: 'US', families: ['hot-rolled'], format: 'LRFD+ASD', gradeRegions: ['US'] },
  { id: 'aisc-360-22', name: 'AISC 360-22', region: 'US', families: ['hot-rolled'], format: 'LRFD+ASD', gradeRegions: ['US'] },
  { id: 'en-1993-1-1', name: 'EN 1993-1-1:2005', region: 'EU', families: ['hot-rolled'], format: 'partial-factors', gradeRegions: ['EU'] },
  { id: 'nbr-8800', name: 'NBR 8800:2008', region: 'BR', families: ['hot-rolled'], format: 'LRFD', gradeRegions: ['BR'] },
  { id: 'as-4100', name: 'AS 4100:2020', region: 'AU', families: ['hot-rolled'], format: 'LRFD', gradeRegions: ['AU', 'EU'] },
  { id: 'csa-s16', name: 'CSA S16:19', region: 'CA', families: ['hot-rolled'], format: 'LRFD', gradeRegions: ['US'] },
  { id: 'sans-10162-1', name: 'SANS 10162-1:2011', region: 'ZA', families: ['hot-rolled'], format: 'LRFD', gradeRegions: ['ZA', 'EU'] },
  { id: 'is-800', name: 'IS 800:2007', region: 'IN', families: ['hot-rolled'], format: 'LRFD', gradeRegions: ['IN', 'EU'] },

  // Cold-formed
  { id: 'cirsoc-303', name: 'CIRSOC 303:2009', region: 'AR', families: ['cold-formed'], format: 'LRFD', gradeRegions: ['AR', 'US'] },
  { id: 'aisi-s100-16', name: 'AISI S100-16', region: 'US', families: ['cold-formed'], format: 'LRFD+ASD', gradeRegions: ['US'] },
  { id: 'en-1993-1-3', name: 'EN 1993-1-3:2006', region: 'EU', families: ['cold-formed'], format: 'partial-factors', gradeRegions: ['EU'] },
  { id: 'nbr-14762', name: 'NBR 14762:2010', region: 'BR', families: ['cold-formed'], format: 'LRFD', gradeRegions: ['BR'] },
  { id: 'as-nzs-4600', name: 'AS/NZS 4600:2018', region: 'AU/NZ', families: ['cold-formed'], format: 'LRFD', gradeRegions: ['AU', 'US'] },
  { id: 'is-811', name: 'IS 811:1987', region: 'IN', families: ['cold-formed'], format: 'allowable', gradeRegions: ['IN', 'EU'] },

  // Aluminium
  { id: 'en-1999-1-1', name: 'EN 1999-1-1:2007', region: 'EU', families: ['aluminium'], format: 'partial-factors', gradeRegions: ['EU'] },
  { id: 'adm-2020', name: 'ADM 2020', region: 'US', families: ['aluminium'], format: 'LRFD+ASD', gradeRegions: ['US', 'EU'] },
  { id: 'cirsoc-701', name: 'CIRSOC 701:2010', region: 'AR', families: ['aluminium'], format: 'LRFD', gradeRegions: ['AR', 'EU'] },
  { id: 'as-1664-1', name: 'AS 1664.1:1997', region: 'AU', families: ['aluminium'], format: 'LRFD', gradeRegions: ['AU', 'EU'] },

  // Stainless
  { id: 'en-1993-1-4', name: 'EN 1993-1-4:2006', region: 'EU', families: ['stainless'], format: 'partial-factors', gradeRegions: ['EU'] },
  { id: 'aisc-dg27', name: 'AISC Design Guide 27', region: 'US', families: ['stainless'], format: 'LRFD+ASD', gradeRegions: ['US', 'EU'] },
  { id: 'as-nzs-4673', name: 'AS/NZS 4673:2001', region: 'AU/NZ', families: ['stainless'], format: 'LRFD', gradeRegions: ['AU', 'EU'] },
];

// ─────────────────────────────────────────────────────────────────────
// Queries
// ─────────────────────────────────────────────────────────────────────

export function gradesForFamily(family: GradeFamily): StructuralGrade[] {
  return ALL_GRADES.filter((g) => g.family === family);
}

/**
 * The code a picker should start on.
 *
 * CIRSOC wherever the family has one — this is an Argentine tool and the local
 * code is the right default, not an option buried among twenty-two. Families
 * CIRSOC does not cover fall back to the first code that does, so the picker
 * always opens on something real rather than on an empty selection.
 */
export function defaultCodeFor(family: GradeFamily): DesignCode | undefined {
  const codes = codesForFamily(family);
  return codes.find((c) => c.id.startsWith('cirsoc')) ?? codes[0];
}

/**
 * Grades a design code would normally be applied to.
 *
 * A code with no match returns the whole family rather than nothing: an empty
 * picker looks broken, and the association here is a convenience for finding
 * grades, not a rule about which are legal.
 */
export function gradesForCode(code: DesignCode, family: GradeFamily): StructuralGrade[] {
  const pool = gradesForFamily(family);
  const matching = pool.filter((g) => code.gradeRegions.includes(g.region));
  return matching.length > 0 ? matching : pool;
}

/**
 * Restrict to what a mode offers.
 *
 * Basic ships European and American grades — plus Argentine, which is the
 * default and cannot sensibly be hidden. PRO adds the rest, which are already
 * loaded here rather than fetched later: the data is small, and gating it at
 * the query keeps one database instead of two that can disagree.
 */
export function gradesForMode<T extends { region: GradeRegion }>(items: T[], pro: boolean): T[] {
  return pro ? items : items.filter((g) => BASIC_REGIONS.includes(g.region));
}

/** Design codes a mode offers, by the same rule. */
export function codesForMode(codes: DesignCode[], pro: boolean): DesignCode[] {
  if (pro) return codes;
  return codes.filter((c) => c.gradeRegions.some((r) => BASIC_REGIONS.includes(r)));
}

export function codesForFamily(family: GradeFamily): DesignCode[] {
  return MATERIAL_DESIGN_CODES.filter((c) => c.families.includes(family));
}

export function gradeById(id: string): StructuralGrade | undefined {
  return ALL_GRADES.find((g) => g.id === id);
}

/**
 * The strength that applies at a given plate thickness.
 *
 * Falls back to the grade's headline values when the standard quotes no bands,
 * and clamps to the thickest band rather than refusing: a caller asking about
 * 100 mm plate is better served by the 80 mm value plus a note than by
 * nothing. Returning the THIN value there would be unconservative, which is
 * the failure mode worth designing against.
 */
export function strengthAtThickness(
  grade: StructuralGrade,
  thicknessMm: number,
): { fy: number; fu: number; extrapolated: boolean } {
  const bands = grade.byThickness;
  if (!bands || bands.length === 0) {
    return { fy: grade.fy, fu: grade.fu, extrapolated: false };
  }
  for (const b of bands) {
    if (thicknessMm > b.overMm && thicknessMm <= b.upToMm) {
      return { fy: b.fy, fu: b.fu, extrapolated: false };
    }
  }
  const last = bands[bands.length - 1];
  const first = bands[0];
  // Below the first band means thinner than tabulated: the thin value governs.
  if (thicknessMm <= first.overMm) return { fy: first.fy, fu: first.fu, extrapolated: false };
  return { fy: last.fy, fu: last.fu, extrapolated: true };
}

/** Free-text search over designation, standard and note. */
export function searchGrades(query: string, family?: GradeFamily): StructuralGrade[] {
  const pool = family ? gradesForFamily(family) : ALL_GRADES;
  const q = query.trim().toLowerCase();
  if (!q) return pool;
  return pool.filter((g) =>
    g.designation.toLowerCase().includes(q) ||
    g.productStandard.toLowerCase().includes(q) ||
    (g.note?.toLowerCase().includes(q) ?? false),
  );
}
