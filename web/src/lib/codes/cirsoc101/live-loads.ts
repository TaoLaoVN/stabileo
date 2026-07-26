/**
 * CIRSOC 101-2025 — imposed (live) loads.
 *
 * Table 4.1  minimum uniform and concentrated imposed loads by occupancy
 * §4.7.2      live-load reduction, Eq. (4.1), with K_LL from Table 4.2
 * §4.7.3–4.7.6 the limits on that reduction
 * §4.8        minimum roof imposed loads
 *
 * Every entry below is transcribed cell by cell from the normative column of the
 * official text (Edición Julio 2025, pp. 78–95) and carries the table it came from.
 * Where Table 4.1 refers the reader to an article instead of giving a number, the entry
 * records that rather than inventing a value.
 *
 * This replaces the single free-typed `occupancyQ` the app used to accept. Manual loads
 * remain fully supported — this is an additional, code-grounded path, not a replacement
 * for engineering judgement.
 *
 * Pure: no store, no runes.
 */

import { clause, type ClauseRef } from '../regulation';

const T41 = clause('cirsoc-101', '2025', 'Tabla 4.1',
  'sobrecargas mínimas uniformemente distribuidas y concentradas');

export type OccupancyCategory =
  | 'residential' | 'office' | 'commercial' | 'education' | 'health' | 'assembly'
  | 'industrial' | 'storage' | 'parking' | 'roof' | 'circulation' | 'other';

export interface OccupancyEntry {
  key: string;
  /** As printed in Table 4.1. */
  labelEs: string;
  labelEn: string;
  category: OccupancyCategory;
  /** Uniform imposed load Lo, kN/m². Null when Table 4.1 refers to an article instead. */
  uniformKNm2: number | null;
  /** Concentrated imposed load, kN. Null when the table gives none. */
  concentratedKN: number | null;
  /**
   * True for garages and places of public assembly. Blocks the §2.3.2 Exception 1
   * reduced L factor and, separately, blocks the §4.7.5 live-load reduction.
   */
  garageOrPublicAssembly?: boolean;
  /** Table 4.1 sends the reader elsewhere; recorded verbatim so the UI can say so. */
  seeArticle?: string;
  refs: ClauseRef[];
}

const e = (
  key: string, labelEs: string, labelEn: string, category: OccupancyCategory,
  uniformKNm2: number | null, concentratedKN: number | null = null,
  extra: Partial<OccupancyEntry> = {},
): OccupancyEntry => ({
  key, labelEs, labelEn, category, uniformKNm2, concentratedKN, refs: [T41], ...extra,
});

/**
 * Table 4.1, in the order it is printed.
 *
 * This is a faithful subset, not the complete table: entries whose value exists only as
 * a cross-reference to another article, and highly specialised occupancies (hangars,
 * morgues, bowling alleys, crane runways), are either recorded with `seeArticle` or
 * omitted. Omission means the user types the value manually — it never means the app
 * substituted a number of its own.
 */
export const OCCUPANCY_TABLE_2025: readonly OccupancyEntry[] = Object.freeze([
  // Archivos
  e('archivos', 'Archivos', 'Filing areas', 'office', 7.0),

  // Áreas de reunión — every one is a place of public assembly
  e('reunion_asientos_fijos', 'Áreas de reunión — asientos fijos, sujetos al piso',
    'Assembly — fixed seats secured to the floor', 'assembly', 3.0, null, { garageOrPublicAssembly: true }),
  e('reunion_vestibulos', 'Áreas de reunión — vestíbulos',
    'Assembly — lobbies', 'assembly', 5.0, null, { garageOrPublicAssembly: true }),
  e('reunion_asientos_moviles', 'Áreas de reunión — asientos móviles',
    'Assembly — movable seats', 'assembly', 5.0, null, { garageOrPublicAssembly: true }),
  e('reunion_plataformas', 'Áreas de reunión — plataformas de montaje',
    'Assembly — stage platforms', 'assembly', 5.0, null, { garageOrPublicAssembly: true }),
  e('reunion_escenarios', 'Áreas de reunión — pisos de escenarios',
    'Assembly — stage floors', 'assembly', 7.0, null, { garageOrPublicAssembly: true }),
  e('reunion_proyeccion', 'Áreas de reunión — salas de proyección',
    'Assembly — projection rooms', 'assembly', 5.0, null, { garageOrPublicAssembly: true }),
  e('reunion_otras', 'Áreas de reunión — otras',
    'Assembly — other areas', 'assembly', 5.0, null, { garageOrPublicAssembly: true }),

  // Azoteas y terrazas
  e('azotea_publica', 'Azoteas y terrazas — donde pueden congregarse personas',
    'Roof terraces — where people may congregate', 'roof', 5.0, null, { garageOrPublicAssembly: true }),
  e('azotea_privada', 'Azoteas accesibles privadamente',
    'Privately accessible roof terraces', 'roof', 3.0),
  e('azotea_inaccesible', 'Azoteas inaccesibles', 'Inaccessible roof terraces', 'roof', 1.0),

  // Balcones
  e('balcon_vivienda', 'Balcones — viviendas en general',
    'Balconies — dwellings generally', 'residential', 5.0),
  e('balcon_casa_pequena', 'Balcones — casas de 1 y 2 familias, hasta 10 m²',
    'Balconies — one- and two-family houses, up to 10 m²', 'residential', 3.0),
  e('balcon_otros', 'Balcones — otros casos', 'Balconies — other cases', 'residential', null, null,
    { seeArticle: '4.11' }),

  // Baños
  e('bano_vivienda', 'Baños — viviendas', 'Bathrooms — dwellings', 'residential', 2.0),
  e('bano_otros', 'Baños — otros destinos', 'Bathrooms — other occupancies', 'other', 3.0),

  // Bibliotecas
  e('biblioteca_lectura', 'Bibliotecas — salas de lectura',
    'Libraries — reading rooms', 'education', 3.0, 4.5),
  e('biblioteca_deposito', 'Bibliotecas — salas de almacenamiento de libros',
    'Libraries — book stacks', 'education', 7.0, 4.5),
  e('biblioteca_pasillos_sup', 'Bibliotecas — pasillos en pisos superiores a planta baja',
    'Libraries — corridors above ground floor', 'circulation', 4.0, 4.5),
  e('biblioteca_pasillos_pb', 'Bibliotecas — pasillos en planta baja',
    'Libraries — ground floor corridors', 'circulation', 5.0, 4.5),

  // Cielorrasos con posibilidad de almacenamiento
  e('cielorraso_liviano', 'Cielorrasos — áreas de almacenamiento liviano',
    'Ceilings — light storage areas', 'storage', 1.0),
  e('cielorraso_ocasional', 'Cielorrasos — áreas de almacenamiento ocasional',
    'Ceilings — occasional storage areas', 'storage', 0.5),
  e('cielorraso_mantenimiento', 'Cielorrasos — accesibles con fines de mantenimiento',
    'Ceilings — accessible for maintenance', 'other', null, 1.0),

  // Cocinas
  e('cocina_vivienda', 'Cocinas — viviendas', 'Kitchens — dwellings', 'residential', 2.0),
  e('cocina_otros', 'Cocinas — otros destinos', 'Kitchens — other occupancies', 'other', 4.0),

  // Comercios
  e('comercio_minorista_pb', 'Comercios — venta minorista, planta baja',
    'Retail — ground floor', 'commercial', 5.0, 4.5),
  e('comercio_minorista_sup', 'Comercios — venta minorista, pisos superiores',
    'Retail — upper floors', 'commercial', 4.0, 4.5),
  e('comercio_mayorista', 'Comercios — venta mayorista, todos los pisos',
    'Wholesale — all floors', 'commercial', 6.0, 4.5),

  // Cuartos de máquinas
  e('cuarto_maquinas', 'Cuartos de máquinas y calderas',
    'Machine and boiler rooms', 'industrial', 7.5),

  // Cubiertas de techo
  e('cubierta_usual', 'Cubiertas de techo — planas, inclinadas y curvas usuales',
    'Roofs — ordinary flat, pitched and curved', 'roof', 1.0),
  e('cubierta_jardin', 'Cubiertas utilizadas para jardines en terrazas y azoteas',
    'Roofs used as roof gardens', 'roof', 5.0),
  e('cubierta_toldos', 'Toldos y marquesinas — construcciones de tela sobre esqueleto',
    'Awnings and canopies — fabric on a frame', 'roof', 0.25, null,
    { seeArticle: 'no reducible' }),
  e('cubierta_cerramiento', 'Cubiertas de cerramiento (pantalla) para patios, piscinas, pérgolas',
    'Screen enclosures for patios, pools, pergolas', 'roof', 0.25, 1.0,
    { seeArticle: 'no reducible' }),
  e('cubierta_otras', 'Cubiertas — todas las demás construcciones',
    'Roofs — all other constructions', 'roof', 1.0),

  // Depósitos
  e('deposito_liviano', 'Depósitos — liviano', 'Storage — light', 'storage', 6.0),
  e('deposito_pesado', 'Depósitos — pesado', 'Storage — heavy', 'storage', 12.0, null,
    { seeArticle: '4.13' }),

  // Escaleras
  e('escalera_privada', 'Escaleras fijas — viviendas uni y bifamiliares y hoteles en áreas privadas',
    'Fixed stairs — one/two-family dwellings and private hotel areas', 'circulation', 2.0),
  e('escalera_otros', 'Escaleras fijas — todos los demás destinos',
    'Fixed stairs — all other occupancies', 'circulation', 5.0),

  e('escotillas', 'Escotillas y claraboyas', 'Hatches and skylights', 'other', null, 1.0),

  // Escuelas
  e('escuela_aulas', 'Escuelas — aulas', 'Schools — classrooms', 'education', 3.0, 4.5),
  e('escuela_pasillos_sup', 'Escuelas — pasillos y corredores en pisos superiores',
    'Schools — corridors above ground floor', 'circulation', 4.0, 4.5),
  e('escuela_pasillos_pb', 'Escuelas — pasillos y corredores en planta baja',
    'Schools — ground floor corridors', 'circulation', 5.0, 4.5),

  // Entrepiso liviano
  e('entrepiso_liviano', 'Entrepiso liviano', 'Light mezzanine', 'other', null, 1.0),

  // Garajes
  e('garaje_autos', 'Garajes — vehículos de pasajeros',
    'Garages — passenger vehicles', 'parking', 2.5, null, { garageOrPublicAssembly: true }),
  e('garaje_camiones', 'Garajes — camiones y ómnibus',
    'Garages — trucks and buses', 'parking', null, null,
    { garageOrPublicAssembly: true, seeArticle: '4.10.3' }),

  // Hospitales
  e('hospital_habitaciones', 'Hospitales — habitaciones',
    'Hospitals — patient rooms', 'health', 2.0, 4.5),
  e('hospital_quirofanos', 'Hospitales — quirófanos y laboratorios',
    'Hospitals — operating rooms and laboratories', 'health', 3.0, 4.5),
  e('hospital_corredores', 'Hospitales — corredores sobre planta baja',
    'Hospitals — corridors above ground floor', 'circulation', 4.0, 4.5),

  // Oficinas
  e('oficina', 'Oficinas', 'Offices', 'office', 2.5, 9.0),
  e('oficina_corredores_sup', 'Oficinas — corredores en pisos superiores',
    'Offices — corridors above ground floor', 'circulation', 4.0, 9.0),
  e('oficina_corredores_pb', 'Oficinas — corredores y vestíbulos en planta baja',
    'Offices — ground floor corridors and lobbies', 'circulation', 5.0, 9.0),

  // Viviendas
  e('vivienda', 'Viviendas — ambientes en general',
    'Dwellings — rooms generally', 'residential', 2.0),
  e('vivienda_dormitorio', 'Viviendas — dormitorios',
    'Dwellings — bedrooms', 'residential', 2.0),

  // Fábricas y talleres
  e('fabrica_liviana', 'Fábricas y talleres — livianos',
    'Factories and workshops — light', 'industrial', 6.0, null, { seeArticle: '4.12.1' }),
  e('fabrica_pesada', 'Fábricas y talleres — pesados',
    'Factories and workshops — heavy', 'industrial', 12.0, null, { seeArticle: '4.12.1' }),
]);

export function findOccupancy(key: string): OccupancyEntry | undefined {
  return OCCUPANCY_TABLE_2025.find((o) => o.key === key);
}

// ─── §4.7 live-load reduction ────────────────────────────────────

/** Table 4.2 — live-load element factor K_LL. */
export type ElementKind =
  | 'interiorColumn' | 'exteriorColumnNoCantilever' | 'edgeColumnWithCantilever'
  | 'cornerColumnWithCantilever' | 'edgeBeamNoCantilever' | 'interiorBeam' | 'other';

const T42 = clause('cirsoc-101', '2025', 'Tabla 4.2', 'factor de sobrecarga K_LL');

export const K_LL: Readonly<Record<ElementKind, number>> = Object.freeze({
  interiorColumn: 4,
  exteriorColumnNoCantilever: 4,
  edgeColumnWithCantilever: 3,
  cornerColumnWithCantilever: 2,
  edgeBeamNoCantilever: 2,
  interiorBeam: 2,
  // "Todos los demás elementos": edge beams with cantilever slabs, cantilever beams,
  // one-way slabs, two-way slabs, and members without continuous shear transfer.
  other: 1,
});

/** §4.7.2 — the reduction does not apply below this threshold. */
export const REDUCTION_THRESHOLD_M2 = 37;

export interface ReductionInputs {
  /** Unreduced Lo from Table 4.1, kN/m². */
  loKNm2: number;
  /** Tributary area A_t, m². */
  tributaryAreaM2: number;
  elementKind: ElementKind;
  /** How many floors the member supports. Drives the 0,5 Lo / 0,4 Lo floor. */
  floorsSupported: number;
  /** True for garages holding passenger vehicles (§4.7.4). */
  passengerGarage?: boolean;
  /** True for places of public assembly (§4.7.5). */
  publicAssembly?: boolean;
  /**
   * One-way slab: the tributary width used for A_t is capped at 1.5 × span (§4.7.6).
   * Supply the span so the cap can be enforced rather than assumed satisfied.
   */
  oneWaySlabSpanM?: number;
  /** Tributary width actually used, m. Required when `oneWaySlabSpanM` is given. */
  tributaryWidthM?: number;
}

export interface ReductionResult {
  /** Reduced design live load L, kN/m². */
  lKNm2: number;
  /** L / Lo. 1.0 when no reduction applied. */
  ratio: number;
  /** True when any reduction was applied. */
  reduced: boolean;
  /** Why the result is what it is — shown in the derivation report. */
  reason: string;
  refs: ClauseRef[];
}

/**
 * §4.7.2 Eq. (4.1) — L = Lo (0,25 + 4,57/√(K_LL·A_t)), with the limits of §4.7.3–4.7.6.
 *
 * The order of checks matters and follows the regulation: the article-level
 * prohibitions (§4.7.3 heavy loads, §4.7.5 public assembly) are applied before the
 * general expression, and §4.7.4 replaces it for passenger garages.
 */
export function reduceLiveLoad(inputs: ReductionInputs): ReductionResult {
  const { loKNm2: lo, tributaryAreaM2: at, elementKind, floorsSupported } = inputs;
  const kll = K_LL[elementKind];
  const kllAt = kll * at;
  const eqRef = clause('cirsoc-101', '2025', '4.7.2', 'reducción en sobrecargas uniformes');

  const none = (reason: string, refs: ClauseRef[]): ReductionResult =>
    ({ lKNm2: lo, ratio: 1, reduced: false, reason, refs });

  // §4.7.5 — public assembly areas are not reduced.
  if (inputs.publicAssembly) {
    return none('Lugares destinados a reuniones públicas: la sobrecarga no se reduce.',
      [clause('cirsoc-101', '2025', '4.7.5', 'lugares destinados a reuniones públicas')]);
  }

  // §4.7.6 — one-way slabs: A_t must not exceed 1.5 × span × span.
  if (inputs.oneWaySlabSpanM !== undefined && inputs.tributaryWidthM !== undefined) {
    const cap = 1.5 * inputs.oneWaySlabSpanM;
    if (inputs.tributaryWidthM > cap) {
      return none(
        `Losa en una dirección: el ancho tributario (${inputs.tributaryWidthM.toFixed(2)} m) ` +
        `excede 1,5 × la luz (${cap.toFixed(2)} m). No se aplica reducción.`,
        [clause('cirsoc-101', '2025', '4.7.6', 'limitaciones para losas en una sola dirección')]);
    }
  }

  // §4.7.4 — passenger garages are not reduced, except members supporting 2+ floors,
  // which may be reduced by 20 %.
  if (inputs.passengerGarage) {
    const ref = clause('cirsoc-101', '2025', '4.7.4', 'garajes para vehículos de pasajeros');
    if (floorsSupported >= 2) {
      return { lKNm2: 0.8 * lo, ratio: 0.8, reduced: true,
        reason: 'Garaje de vehículos de pasajeros, elemento que soporta dos o más pisos: reducción del 20 %.',
        refs: [ref] };
    }
    return none('Garaje de vehículos de pasajeros: la sobrecarga no se reduce.', [ref]);
  }

  // §4.7.3 — loads exceeding 5 kN/m² are not reduced, except members supporting 2+
  // floors, which may be reduced by 20 %.
  if (lo > 5.0) {
    const ref = clause('cirsoc-101', '2025', '4.7.3', 'sobrecargas pesadas');
    if (floorsSupported >= 2) {
      return { lKNm2: 0.8 * lo, ratio: 0.8, reduced: true,
        reason: `Lo = ${lo} kN/m² > 5 kN/m² y el elemento soporta dos o más pisos: reducción del 20 %.`,
        refs: [ref] };
    }
    return none(`Lo = ${lo} kN/m² > 5 kN/m²: la sobrecarga no se reduce.`, [ref]);
  }

  // §4.7.2 — the general expression applies only from K_LL·A_t ≥ 37 m².
  if (!(kllAt >= REDUCTION_THRESHOLD_M2)) {
    return none(
      `K_LL·A_t = ${kll} × ${at.toFixed(1)} = ${kllAt.toFixed(1)} m² < ${REDUCTION_THRESHOLD_M2} m²: ` +
      'no corresponde reducción.',
      [eqRef, T42]);
  }

  const raw = lo * (0.25 + 4.57 / Math.sqrt(kllAt));
  const floor = floorsSupported >= 2 ? 0.4 * lo : 0.5 * lo;
  const l = Math.max(raw, Math.min(lo, floor));
  const clamped = raw < floor;

  return {
    lKNm2: Math.min(l, lo),
    ratio: Math.min(l, lo) / lo,
    reduced: Math.min(l, lo) < lo,
    reason:
      `K_LL·A_t = ${kll} × ${at.toFixed(1)} = ${kllAt.toFixed(1)} m². ` +
      `L = ${lo} (0,25 + 4,57/√${kllAt.toFixed(1)}) = ${raw.toFixed(3)} kN/m²` +
      (clamped
        ? `, limitado a ${floorsSupported >= 2 ? '0,4' : '0,5'} Lo = ${floor.toFixed(3)} kN/m².`
        : '.'),
    refs: [eqRef, T42],
  };
}

// ─── §4.8 minimum roof imposed loads ─────────────────────────────

/**
 * §4.8.1 — roofs inaccessible except for maintenance carry a minimum ordinary imposed
 * load of 1,0 kN/m² (Table 4.1, "cubiertas de techo … usuales").
 */
export const ROOF_MIN_KNM2 = 1.0;

export const ROOF_MIN_REF = clause('cirsoc-101', '2025', '4.8.1',
  'cubiertas inaccesibles salvo con fines de mantenimiento');
