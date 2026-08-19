/**
 * The profile catalogue, as a source something else can consume.
 *
 * ── Why this layer exists ──────────────────────────────────────────
 *
 * `lib/data/steel-profiles.ts` is a set of tables and a couple of helpers. Every surface that
 * wanted profiles reached into it directly and rebuilt the same three things by hand: a
 * flattened list, a family grouping, and a substring search. The generator's picker did it
 * with a `<select>` carrying 100+ `<option>`s across 15 `<optgroup>`s, which is the control
 * this module exists to replace.
 *
 * A general PRO section picker is coming, and it must not be a second implementation of the
 * same three things. So the shape here is a SOURCE — query in, entries out — and the UI holds
 * a `ProfileSource`, not the tables. When the general picker lands it either uses this source
 * or supplies its own, and the generator does not change either way.
 *
 * ── The identifier ────────────────────────────────────────────────
 *
 * `ProfileId` is the catalogue NAME, unchanged. That is not laziness: `ProfileSpec.profileName`
 * already stores it, `resolveProfile` and `findProfile` already look up by it, and it is what
 * lands in a saved `.ded`. Minting a new id here would mean either migrating every stored
 * model or keeping two identifiers for one thing. The name is the id, and the id is stable.
 *
 * What is NOT allowed is a display string standing in for it. `"IPE 200 · 22.4 kg/m"` is a
 * label; the moment a label is stored, changing the label breaks the file.
 *
 * ── What this module does not do ──────────────────────────────────
 *
 * It does not resolve geometry, compose built-up sections or decide arrangements. Those live
 * in `generators/profile-resolve.ts` and `generators/built-up-section.ts` and stay there: this
 * is a catalogue, not an engine.
 */

import {
  ALL_PROFILES, PROFILE_FAMILIES, FAMILY_LIST, familyToShape,
  type ProfileFamily, type SectionShape, type SteelProfile,
} from '../data/steel-profiles';

/** The catalogue name. What the model stores, and what `resolveProfile` looks up. */
export type ProfileId = string;

/**
 * Which published tables a family comes from.
 *
 * `mixed` is not a hedge — it is the truth for `L`. `PROFILE_FAMILIES.L` is
 * `[...L, ...IRAM_L]`, two tables merged into one array with nothing on the entries saying
 * which row came from which. Inventing a per-entry provenance to make the axis look tidy
 * would be a guess presented as data, so the family is declared mixed and the filter treats
 * it as matching either standard.
 */
export type ProfileStandard = 'euronorm' | 'iram' | 'mixed';

export const FAMILY_STANDARD: Record<ProfileFamily, ProfileStandard> = {
  IPE: 'euronorm', IPN: 'euronorm', HEB: 'euronorm', HEA: 'euronorm', UPN: 'euronorm',
  W: 'iram', HP: 'iram', M: 'iram', C: 'iram', MC: 'iram', T: 'iram',
  RHS: 'iram', SHS: 'iram', CHS: 'iram',
  L: 'mixed',
};

/**
 * One catalogue row, with its units in the field names.
 *
 * The raw table mixes mm and cm² and cm⁴ silently — `a` is cm², `h` is mm — and every reader
 * has to remember which. Naming the unit is the cheapest way to stop a `1e-4` appearing in a
 * component.
 */
export interface ProfileEntry {
  id: ProfileId;
  name: string;
  family: ProfileFamily;
  standard: ProfileStandard;
  shape: SectionShape;
  heightMm: number;
  widthMm: number;
  areaCm2: number;
  iyCm4: number;
  izCm4: number;
  massKgPerM: number;
  /** Wall or web thickness, when the table publishes one. */
  thicknessMm: number | null;
}

export interface ProfileQuery {
  /** Matched against the name, case- and space-insensitively. */
  text?: string;
  /** Empty or absent means every family. */
  families?: readonly ProfileFamily[];
  /** Empty or absent means every standard. `mixed` families match either. */
  standards?: readonly Exclude<ProfileStandard, 'mixed'>[];
}

export interface ProfileGroup {
  key: string;
  entries: ProfileEntry[];
}

/**
 * The seam the future general picker plugs into.
 *
 * Deliberately four small methods rather than one `getEverything()`: a source backed by a
 * project's own section library, or by a server, can implement these without materialising a
 * full catalogue on every keystroke.
 */
export interface ProfileSource {
  list(query?: ProfileQuery): ProfileEntry[];
  byId(id: ProfileId): ProfileEntry | null;
  families(): readonly ProfileFamily[];
  standardOf(family: ProfileFamily): ProfileStandard;
}

function toEntry(p: SteelProfile): ProfileEntry {
  return {
    id: p.name,
    name: p.name,
    family: p.family,
    standard: FAMILY_STANDARD[p.family],
    shape: familyToShape(p.family),
    heightMm: p.h,
    widthMm: p.b,
    areaCm2: p.a,
    iyCm4: p.iy,
    izCm4: p.iz,
    massKgPerM: p.weight,
    thicknessMm: p.t ?? p.tw ?? null,
  };
}

/** Fold spaces and case away, so `hea200`, `HEA 200` and `hea 200` are one query. */
const norm = (s: string) => s.toLowerCase().replace(/\s+/g, '');

const ENTRIES: ProfileEntry[] = ALL_PROFILES.map(toEntry);
const BY_ID = new Map<ProfileId, ProfileEntry>(ENTRIES.map((e) => [e.id, e]));

export function queryProfiles(query: ProfileQuery = {}): ProfileEntry[] {
  const text = query.text ? norm(query.text) : '';
  const families = query.families?.length ? new Set(query.families) : null;
  const standards = query.standards?.length ? new Set(query.standards) : null;

  return ENTRIES.filter((e) => {
    if (families && !families.has(e.family)) return false;
    // A `mixed` family satisfies either standard, because it genuinely contains both.
    if (standards && e.standard !== 'mixed' && !standards.has(e.standard)) return false;
    if (text && !norm(e.name).includes(text)) return false;
    return true;
  });
}

/**
 * Group in the catalogue's own family order, not alphabetically.
 *
 * `FAMILY_LIST` is ordered the way an engineer scans a handbook — the I-sections together,
 * then the channels, then the angles, then the tubes. Sorting the groups by name would put
 * CHS first and IPE eighth, which is tidy and useless.
 */
export function groupByFamily(entries: readonly ProfileEntry[]): ProfileGroup[] {
  const byFamily = new Map<ProfileFamily, ProfileEntry[]>();
  for (const e of entries) {
    const bucket = byFamily.get(e.family);
    if (bucket) bucket.push(e); else byFamily.set(e.family, [e]);
  }
  return FAMILY_LIST
    .filter((f) => byFamily.has(f))
    .map((f) => ({ key: f, entries: byFamily.get(f)! }));
}

/** The catalogue this app ships, as a source. */
export const steelProfileSource: ProfileSource = {
  list: (query) => queryProfiles(query),
  byId: (id) => BY_ID.get(id) ?? null,
  families: () => FAMILY_LIST,
  standardOf: (family) => FAMILY_STANDARD[family],
};

/** Every family the catalogue actually has rows for. */
export function populatedFamilies(): ProfileFamily[] {
  return FAMILY_LIST.filter((f) => (PROFILE_FAMILIES[f]?.length ?? 0) > 0);
}
