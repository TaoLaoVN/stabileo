/**
 * The production path from a modelled footing to a checked, detailed footing.
 *
 * To foundations what `run-floor-design.ts` is to slabs and walls: it reads what the model
 * and the solver already hold, and calls `checkFooting` — which has been complete and
 * unit-tested since PR18 opened with no caller outside its own tests.
 *
 * ── What the demand is made of ──────────────────────────────────
 *
 * Strength checks (one-way shear, punching, flexure) take the GOVERNING strength
 * combination's reaction: real per-combination solver output, chosen by the largest
 * vertical, with the combination named in the result so the certificate can state it.
 *
 * Bearing is a SERVICE-level comparison (§13.3.1), and the app has no service-combination
 * concept — every stored combination is a strength combination. So the service reaction is
 * summed from the PER-CASE reactions at unit factors, over gravity cases only, and that
 * choice is reported as an assumption rather than applied silently. Wind and seismic cases
 * are excluded, because a service wind combination has its own factors that this project
 * does not model; a footing whose bearing would be governed by them says so instead of
 * being checked against an incomplete sum. With no per-case results at all, bearing is
 * UNSUPPORTED — it is not approximated from the factored reaction by dividing by a guessed
 * 1,4.
 *
 * ── The gate ────────────────────────────────────────────────────
 *
 * A footing cannot be reported as verified without its inputs. Missing soil, missing
 * reaction, invalid geometry and an unsupported footing kind each produce an outcome with
 * `check: null` and a named reason. `checkFooting` itself already rolls any unsupported
 * constituent up to UNSUPPORTED, so a footing whose punching could not be checked never
 * reads as OK.
 *
 * Pure: no store, no runes. Forces kN, moments kN·m, lengths m, pressures kPa.
 */

import { msg, type EngineMessage } from '../../codes/message';
import type { RegulationEdition } from '../../codes/regulation';
import { deriveDevelopment, type DevelopmentResult } from '../../codes/cirsoc201/anchorage';
import {
  footingEffectiveDepth, validateFooting, type Footing,
} from '../../model/footing';
import {
  findProfile, geotechnicalAssumptions, type ProjectGeotechnical,
} from '../../model/geotechnical';
import { checkFooting, type FootingCheck, type FootingInput } from './foundation-check';
import type { ColumnPosition } from './punching-shear';
import type { DowelInput } from './floor-design';

export interface FootingNode { x: number; y: number; z?: number }

/** The column a footing supports, when the model identifies one. */
export interface FootingColumn {
  elementId: number;
  /** Section plan dimensions, m. */
  b: number;
  h: number;
  /** Longitudinal bars, for dowel sizing. */
  bars?: { count: number; diameterMm: number };
  tieDiaMm?: number;
}

/** One combination's reaction at a node. */
export interface CombinationReaction {
  combinationId: number;
  combinationName: string;
  /** Vertical reaction, kN. Sign as the solver reports it. */
  fz: number;
  /** Reaction moments about the global X and Y axes, kN·m. */
  mx: number;
  my: number;
}

/** One load case's reaction at a node, for the service sum. */
export interface CaseReaction {
  caseId: number;
  /** 'D' | 'L' | 'W' | 'E' | … as the project's load cases declare. */
  caseType: string;
  fz: number;
  mx: number;
  my: number;
}

export interface NodeReactions {
  factored: readonly CombinationReaction[];
  /** Absent when the project was solved without per-case results. */
  cases?: readonly CaseReaction[];
}

export interface RunFootingDesignInput {
  footings: readonly Footing[];
  geotechnical: ProjectGeotechnical | undefined;
  nodes: ReadonlyMap<number, FootingNode>;
  /** Columns by element id, for the punching perimeter and the dowels. */
  columns: ReadonlyMap<number, FootingColumn>;
  reactions: ReadonlyMap<number, NodeReactions>;
  /** Project-resolved concrete strength, MPa. */
  fc: number;
  /** Reinforcement yield strength, MPa. */
  fy: number;
  edition: RegulationEdition;
  /** Bottom-mat bar diameter, mm — sets the effective depth. */
  barDiameterMm: number;
}

/** What `buildFloorAssembly` consumes for one footing. */
export interface FootingAssemblyEntry {
  id: string;
  check: FootingCheck;
  elementIds: number[];
  dowels?: DowelInput;
}

export interface FootingDesignOutcome {
  footingId: number;
  name: string;
  /** Null when the footing could not be checked. `unsupported` says why. */
  check: FootingCheck | null;
  entry: FootingAssemblyEntry | null;
  /** Elevation the footing is attributed to — the underside. */
  level: number;
  /** The strength combination the checks were run against. */
  governingCombination: string | null;
  unsupported: EngineMessage[];
  assumptions: EngineMessage[];
}

export interface RunFootingDesignResult {
  outcomes: FootingDesignOutcome[];
  /** Entries grouped by level, ready for `buildFloorAssembly`. */
  entriesByLevel: Map<number, FootingAssemblyEntry[]>;
  trace: string[];
}

/** Load-case types that contribute to the service gravity sum. */
const GRAVITY_CASES: ReadonlySet<string> = new Set(['D', 'L', 'Lr', 'S', 'R']);
/** Load-case types whose SERVICE combination factors this project does not model. */
const LATERAL_CASES: ReadonlySet<string> = new Set(['W', 'E']);

/**
 * Where the critical punching perimeter sits relative to the footing edges.
 *
 * A footing normally extends past its column on all four sides, so the perimeter closes and
 * the case is `interior` — unlike a slab-column joint, where the position is a property of
 * the building. It stops being interior only when eccentricity or a large column brings a
 * face within d/2 of the edge, which truncates the perimeter. Two truncated sides is a
 * corner; more than two means the column does not fit on the footing at all.
 */
export function punchingPosition(
  f: Footing, column: { b: number; h: number }, d: number,
): {
  /** Null when the truncation pattern is not one of the three cases §22.6.5.3 tabulates. */
  position: ColumnPosition | null;
  truncatedSides: number;
  /** Set when `position` is null — which pattern was found. */
  pattern?: 'oppositeFaces' | 'doesNotFit';
} {
  const half = d / 2;
  // Cantilever from each column face to the corresponding footing edge, including the
  // deliberate plan eccentricity. Tracked per AXIS, not just counted: which faces are
  // truncated changes the answer.
  const alongB = [
    (f.B - column.b) / 2 - f.eccentricityB,
    (f.B - column.b) / 2 + f.eccentricityB,
  ].filter((c) => c < half).length;
  const alongL = [
    (f.L - column.h) / 2 - f.eccentricityL,
    (f.L - column.h) / 2 + f.eccentricityL,
  ].filter((c) => c < half).length;
  const truncatedSides = alongB + alongL;

  if (truncatedSides === 0) return { position: 'interior', truncatedSides };
  if (truncatedSides === 1) return { position: 'edge', truncatedSides };
  if (truncatedSides === 2) {
    // Adjacent pair — one face on each axis — is the corner case.
    if (alongB === 1 && alongL === 1) return { position: 'corner', truncatedSides };
    // Two OPPOSITE faces is a strip-like condition. §22.6.5.3's α_s tabulates exactly three
    // cases and this is none of them; treating it as a corner would apply the wrong α_s to a
    // perimeter of a different shape. It is reported as unsupported rather than approximated.
    return { position: null, truncatedSides, pattern: 'oppositeFaces' };
  }
  return { position: null, truncatedSides, pattern: 'doesNotFit' };
}

export function runFootingDesign(input: RunFootingDesignInput): RunFootingDesignResult {
  const outcomes: FootingDesignOutcome[] = [];
  const entriesByLevel = new Map<number, FootingAssemblyEntry[]>();
  const trace: string[] = [];
  const levelKey = (z: number) => Math.round(z * 1000) / 1000;

  // Deterministic under input reordering: the assembly ids, the marks and the schedule all
  // derive from this order, so it cannot depend on Map iteration.
  const ordered = [...input.footings].sort((a, b) => a.id - b.id);

  for (const f of ordered) {
    const unsupported: EngineMessage[] = [];
    const assumptions: EngineMessage[] = [];
    const level = levelKey(f.foundingElevation);
    const fail = (governing: string | null = null): void => {
      outcomes.push({
        footingId: f.id, name: f.name, check: null, entry: null, level,
        governingCombination: governing, unsupported, assumptions,
      });
    };

    // ── Geometry ────────────────────────────────────────────────
    const geometryIssues = validateFooting(f).filter((i) => i.severity === 'blocking');
    if (geometryIssues.length > 0) {
      unsupported.push(...geometryIssues.map((i) => i.message));
      fail();
      continue;
    }
    if (f.kind !== 'isolated') {
      // `checkFooting` would return UNSUPPORTED for this anyway; refusing here keeps the
      // reason attached to the footing rather than buried in a check result.
      unsupported.push(msg('footing.run.kindNotImplemented', { footing: f.name, kind: f.kind }));
      fail();
      continue;
    }
    if (!input.nodes.has(f.nodeId)) {
      unsupported.push(msg('footing.run.nodeMissing', { footing: f.name, node: f.nodeId }));
      fail();
      continue;
    }

    // ── The ground ──────────────────────────────────────────────
    const profile = findProfile(input.geotechnical, f.soilProfileId);
    if (!profile) {
      unsupported.push(msg('footing.run.noSoilProfile', { footing: f.name }));
      fail();
      continue;
    }
    if (profile.bearing.kind !== 'allowablePressure') {
      unsupported.push(msg('footing.run.bearingUnstated', {
        footing: f.name, profile: profile.name,
      }));
      fail();
      continue;
    }
    const allowableBearing = profile.bearing.allowableBearingKPa;
    assumptions.push(...geotechnicalAssumptions(profile));

    // ── The reaction ────────────────────────────────────────────
    const r = input.reactions.get(f.nodeId);
    if (!r || r.factored.length === 0) {
      // No reaction means no load. Designing for zero would produce a footing reinforced
      // for nothing, which is worse than an unchecked one.
      unsupported.push(msg('footing.run.noReaction', { footing: f.name, node: f.nodeId }));
      fail();
      continue;
    }

    // The governing strength combination is the one with the largest downward vertical.
    // `Math.abs` because the solver's sign convention for a support reaction depends on the
    // support type, and the magnitude is what the footing carries either way.
    const governing = r.factored.reduce(
      (best, c) => (Math.abs(c.fz) > Math.abs(best.fz) ? c : best), r.factored[0]);
    const factoredAxial = Math.abs(governing.fz);

    // Service reaction for bearing: unit-factor sum over gravity cases.
    let serviceAxial: number | null = null;
    let serviceMomentB = 0;
    let serviceMomentL = 0;
    if (r.cases && r.cases.length > 0) {
      const gravity = r.cases.filter((c) => GRAVITY_CASES.has(c.caseType));
      const lateral = r.cases.filter((c) => LATERAL_CASES.has(c.caseType)
        && (c.fz !== 0 || c.mx !== 0 || c.my !== 0));
      if (gravity.length === 0) {
        unsupported.push(msg('footing.run.noGravityCase', { footing: f.name }));
      } else {
        serviceAxial = Math.abs(gravity.reduce((s, c) => s + c.fz, 0));
        // Reaction moments about global X and Y map onto the footing's L and B axes
        // respectively for an unrotated footing.
        serviceMomentL = gravity.reduce((s, c) => s + c.mx, 0);
        serviceMomentB = gravity.reduce((s, c) => s + c.my, 0);
        assumptions.push(msg('footing.assumption.serviceFromGravityCases', {
          footing: f.name,
          cases: gravity.map((c) => c.caseType).join(' + '),
        }));
        if (lateral.length > 0) {
          // Refusing to state a bearing result would be wrong — the gravity check is real.
          // Claiming it covers the wind case would also be wrong. So the result stands and
          // its limit is named.
          unsupported.push(msg('footing.run.serviceLateralExcluded', {
            footing: f.name,
            cases: [...new Set(lateral.map((c) => c.caseType))].join(', '),
          }));
        }
      }
    } else {
      unsupported.push(msg('footing.run.noServiceCases', { footing: f.name }));
    }
    if (serviceAxial === null) {
      // Bearing is the check the footing exists to satisfy. Without a service demand there
      // is no footing verification, and dividing the factored load by an assumed 1,4 would
      // be inventing the load factor the project already states somewhere else.
      fail(governing.combinationName);
      continue;
    }

    if (f.rotationDeg !== 0) {
      // The reaction moments are global. Resolving them onto rotated footing axes is
      // defensible arithmetic, but it is not implemented, and silently treating a rotated
      // footing's global moments as local ones would mis-assign the eccentricity.
      unsupported.push(msg('footing.run.rotationNotResolved', {
        footing: f.name, rotation: f.rotationDeg,
      }));
      fail(governing.combinationName);
      continue;
    }

    // ── The column ──────────────────────────────────────────────
    const column = f.columnElementId === undefined
      ? undefined
      : input.columns.get(f.columnElementId);
    if (!column) {
      // Bearing and one-way shear need no column; punching and the dowels do. `checkFooting`
      // rolls its own unsupported punching up to UNSUPPORTED, so this cannot read as OK.
      unsupported.push(msg('footing.run.noColumn', { footing: f.name }));
      fail(governing.combinationName);
      continue;
    }

    const d = footingEffectiveDepth(f, input.barDiameterMm);
    if (!(d > 0)) {
      unsupported.push(msg('footing.run.noEffectiveDepth', { footing: f.name }));
      fail(governing.combinationName);
      continue;
    }
    assumptions.push(msg('footing.assumption.averageMatDepth', {
      footing: f.name, d: +d.toFixed(3), bar: input.barDiameterMm,
    }));

    const perimeter = punchingPosition(f, column, d);
    if (perimeter.position === null) {
      unsupported.push(msg(
        perimeter.pattern === 'doesNotFit'
          ? 'footing.run.columnDoesNotFit'
          : 'footing.run.perimeterOppositeFaces',
        { footing: f.name },
      ));
      fail(governing.combinationName);
      continue;
    }
    const position = perimeter.position;
    if (perimeter.truncatedSides > 0) {
      assumptions.push(msg('footing.assumption.truncatedPerimeter', {
        footing: f.name, position, sides: perimeter.truncatedSides,
      }));
    }

    // ── The check ───────────────────────────────────────────────
    const fi: FootingInput = {
      kind: 'isolated',
      B: f.B, L: f.L,
      thickness: f.thickness,
      d,
      columnB: column.b, columnH: column.h,
      fc: input.fc,
      allowableBearing,
      serviceAxial,
      factoredAxial,
      serviceMomentB, serviceMomentL,
      position,
    };
    const check = checkFooting(fi);

    const elementIds = [column.elementId];
    const starter = column.bars
      ? starterDevelopment(column.bars.diameterMm, input)
      : null;
    const entry: FootingAssemblyEntry = {
      id: `F${f.id}`,
      check,
      elementIds,
      ...(column.bars && starter
        ? {
          dowels: {
            id: `F${f.id}-C${column.elementId}`,
            centre: {
              x: (input.nodes.get(f.nodeId)!.x) + f.eccentricityB,
              y: (input.nodes.get(f.nodeId)!.y) + f.eccentricityL,
            },
            footingTopZ: f.foundingElevation + f.thickness,
            footingThickness: f.thickness,
            footingCover: f.cover,
            columnB: column.b, columnH: column.h,
            cover: f.cover,
            tieDia: column.tieDiaMm ?? 8,
            bars: column.bars,
            // Development and lap come from the authoritative clause implementation
            // (`deriveDevelopment`, Table 25.4.2.3 with the §25.4.2.1(b) floor), not from a
            // second formula written here. `favourableSpacing: false` is the conservative
            // row, correct for starters bunched at a column perimeter rather than spread.
            ldFooting: starter.ldM,
            // §25.5.2.1 Class B: starters out of a footing lap all bars at one station, so
            // the Class A fraction is never satisfied and 1,3·ld is the honest lap.
            lapAbove: CLASS_B_LAP_FACTOR * starter.ldM,
            elementIds,
            edition: input.edition,
          },
        }
        : {}),
    };
    if (!column.bars) {
      unsupported.push(msg('footing.run.noColumnBars', { footing: f.name }));
    }

    outcomes.push({
      footingId: f.id, name: f.name, check, entry, level,
      governingCombination: governing.combinationName,
      unsupported, assumptions,
    });
    const list = entriesByLevel.get(level);
    if (list) list.push(entry); else entriesByLevel.set(level, [entry]);
  }

  const checked = outcomes.filter((o) => o.check !== null).length;
  trace.push(
    `Fundaciones: ${checked} de ${outcomes.length} zapata(s) verificada(s), ` +
    `${outcomes.reduce((n, o) => n + o.unsupported.length, 0)} condición(es) no soportada(s).`);

  return { outcomes, entriesByLevel, trace };
}

/** §25.5.2.1 Class B lap multiplier. */
const CLASS_B_LAP_FACTOR = 1.3;

/**
 * Development length for a column starter out of a footing.
 *
 * Delegates to `deriveDevelopment` — Table 25.4.2.3 with the §25.4.2.1(b) 300 mm floor —
 * rather than restating the formula. A second implementation of ld is exactly how two parts
 * of the same project come to disagree about the same bar.
 *
 * `favourableSpacing: false` selects the conservative table row. Starters are bunched at the
 * column perimeter, not spread at the clear spacing the favourable row assumes, so the
 * longer length is the correct one — and being wrong in this direction shortens real steel.
 */
function starterDevelopment(
  barDiameterMm: number, input: Pick<RunFootingDesignInput, 'fc' | 'fy' | 'edition'>,
): DevelopmentResult {
  return deriveDevelopment({
    diameterMm: barDiameterMm,
    fy: input.fy,
    fc: input.fc,
    favourableSpacing: false,
    edition: input.edition,
  });
}
