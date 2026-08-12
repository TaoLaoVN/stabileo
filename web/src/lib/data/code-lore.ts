/**
 * code-lore.ts — where each design code comes from, and why it is the way it is.
 *
 * A dropdown listing twenty-two codes tells a student nothing about which
 * world they are stepping into. These are the sentences a colleague would say:
 * who writes it, roughly when, and the one fact that explains the rest — why
 * CIRSOC looks so much like AISC, why Eurocode has national annexes at all, why
 * the American concrete code is numbered 318.
 *
 * Kept deliberately short. This is a `?` beside a control, not a history
 * lesson, and anything longer would be closed unread.
 */

export interface CodeLore {
  /** Body that writes and maintains it. */
  body: string;
  /** When it appeared, or the edition in use. */
  since: string;
  /** The fact that makes the rest make sense. */
  trivia: string;
}

/**
 * Keyed by the code's display name, because that is what the picker has in
 * hand — the metals resolve an id, the non-metals carry a name, and this has
 * to serve both.
 */
export const CODE_LORE: Record<string, CodeLore> = {
  // ── Steel, hot-rolled ──
  'CIRSOC 301:2005': {
    body: 'INTI-CIRSOC, Argentina',
    since: '2005; the first edition dates from 1982',
    trivia:
      'It is a VERIFICATION code, not an independent one: it adopts AISC 360’s method almost verbatim and adapts it to Argentine steels and units. That is why an engineer trained on AISC recognises it immediately — and why the sections it uses are whatever the local mills normalise, IRAM grades alongside ASTM ones.',
  },
  'AISC 360-16': {
    body: 'American Institute of Steel Construction',
    since: '2016 edition; the specification line runs back to 1923',
    trivia:
      'It carries LRFD and ASD side by side in one document, with the same nominal strengths and two different safety formats. That unification happened in 2005; before it the profession was split between two separate specifications and two camps.',
  },
  'AISC 360-22': {
    body: 'American Institute of Steel Construction',
    since: '2022 edition',
    trivia:
      'Added provisions for ductile design and for high-strength steels above 100 ksi, which earlier editions simply did not cover.',
  },
  'EN 1993-1-1:2005': {
    body: 'CEN, the European Committee for Standardization',
    since: '2005, replacing the 1992 ENV trial version',
    trivia:
      'Each country publishes a National Annex fixing the parameters left open — partial factors, buckling curves, some limits — so "EN 1993" alone does not pin a calculation. The same beam can pass in one country and fail in another, legitimately.',
  },
  'NBR 8800:2008': {
    body: 'ABNT, Brazil',
    since: '2008, superseding the 1986 edition',
    trivia:
      'The 1986 edition was allowable-stress; 2008 moved to limit states and aligned closely with AISC and Eurocode. NBR 8800:2024 is the current revision.',
  },

  // ── Steel, cold-formed ──
  'CIRSOC 303:2009': {
    body: 'INTI-CIRSOC, Argentina',
    since: '2009',
    trivia:
      'The cold-formed companion to CIRSOC 301, following AISI’s method. Thin walls buckle locally before they yield, which is why they need a separate code rather than a chapter.',
  },
  'AISI S100-16': {
    body: 'American Iron and Steel Institute',
    since: '2016; the first cold-formed specification is from 1946',
    trivia:
      'Introduced the Direct Strength Method as a full alternative to effective widths — instead of reducing each plate element, you compute the whole section’s buckling loads and design from those.',
  },
  'EN 1993-1-3:2006': {
    body: 'CEN',
    since: '2006',
    trivia:
      'Covers members down to about 1 mm wall. Below that, EN 1993-1-4 and the sheeting parts take over.',
  },
  'NBR 14762:2010': {
    body: 'ABNT, Brazil',
    since: '2010',
    trivia:
      'Brazil’s cold-formed code, written around the ZAR galvanised grades of NBR 7008.',
  },

  // ── Aluminium ──
  'EN 1999-1-1:2007': {
    body: 'CEN',
    since: '2007',
    trivia:
      'Eurocode 9 is the youngest of the Eurocodes. Aluminium has no yield plateau, so it designs on a 0,2% proof stress, and it must account for the heat-affected zone: welding an aluminium member can halve its strength locally, which no steel code has to say.',
  },
  'ADM 2020': {
    body: 'The Aluminum Association, United States',
    since: '2020 edition of the Aluminum Design Manual',
    trivia:
      'Uses E = 69 600 MPa and nu = 0,33, against Eurocode 9’s 70 000 and 0,30. The same metal, two codes, two moduli — the difference is calibration, not physics.',
  },
  'CIRSOC 701:2010': {
    body: 'INTI-CIRSOC, Argentina',
    since: '2010',
    trivia:
      'Argentina’s aluminium code, which follows the American ADM tradition rather than the European one.',
  },

  // ── Stainless ──
  'EN 1993-1-4:2006': {
    body: 'CEN',
    since: '2006',
    trivia:
      'Stainless has no yield plateau either: its stress-strain curve rounds off gradually, so carbon-steel buckling curves do not apply. That rounding is also why it is more forgiving of local buckling than its strength alone suggests.',
  },
  'AISC Design Guide 27': {
    body: 'AISC, United States',
    since: '2013',
    trivia:
      'A design guide rather than a specification — the United States has no mandatory stainless structural code, so this fills the gap.',
  },

  // ── Concrete ──
  'CIRSOC 201': {
    body: 'INTI-CIRSOC, Argentina',
    since: '2005, with a 2025 revision; the line begins in 1982',
    trivia:
      'Adapted from ACI 318, which is why it shares its modulus expression E = 4700·sqrt(f’c). Argentine concrete is specified by its characteristic CYLINDER strength, hence H-25 for 25 MPa.',
  },
  'EN 1992-1-1': {
    body: 'CEN',
    since: '2004',
    trivia:
      'Names concrete by BOTH cylinder and cube strength — C25/30 is one concrete, not a choice, because the cube test reads higher for the same material. Its modulus comes from the MEAN strength, which is why it lands well above ACI’s for the same class.',
  },
  'ACI 318': {
    body: 'American Concrete Institute',
    since: 'Current edition 2019; the first is from 1910',
    trivia:
      'The "318" is just the committee number, and it stuck. Strengths are specified in psi, so the metric equivalents come out at odd values: 4000 psi is 27,6 MPa, not 28.',
  },
  'NBR 6118': {
    body: 'ABNT, Brazil',
    since: '2014, revised 2023',
    trivia:
      'Its modulus expression scales with the AGGREGATE type — granite, basalt, limestone and sandstone each get their own factor. No other code here does that, and it can move E by 30%.',
  },

  // ── Timber ──
  'EN 338': {
    body: 'CEN',
    since: '1995, revised 2016',
    trivia:
      'Strength CLASSES rather than species: C24 means the same properties whether it is Norway spruce or Scots pine. The number is the characteristic bending strength in MPa, C is softwood and D hardwood — which is why a D30 and a C30 bend alike and weigh very differently.',
  },
};

/** Lore for a code, by display name. Null when none is written. */
export function codeLore(name: string | undefined): CodeLore | null {
  if (!name) return null;
  return CODE_LORE[name] ?? null;
}
