/**
 * The DocumentModel: one assembled, self-consistent description of what is being issued.
 *
 * ── Why a model rather than three exporters ────────────────────────
 *
 * A PDF, a DXF and an XLSX of the same floor are three renderings of ONE statement about
 * the structure. Built independently they drift: the schedule totals bars the drawing does
 * not show, the report quotes a revision the drawing predates, and nobody can tell which is
 * wrong. The failure is silent and it is discovered on site.
 *
 * So the document is assembled ONCE — regulations, revisions, certificates, physical
 * assemblies, layers, fusions, laps, transitions, conflicts, review state, maturity — and
 * the three outputs are projections of it. Anything absent from the model cannot appear in
 * an output, and anything in the model appears in all of them consistently.
 *
 * ── Readiness is part of the document, not a footnote ──────────────
 *
 * A conflicted floor can still be documented. Engineers need drawings to discuss a problem
 * long before it is solved, and refusing to produce them is not caution, it is
 * obstruction. What must never happen is a conflicted floor producing a document that
 * looks issued.
 *
 * So every document carries a `readiness`, and a document that is not CONSTRUCTIBLE is a
 * REVIEW DRAFT: it lists its unresolved conflicts on the face of the first sheet, it is
 * watermarked, and it makes no construction claim. That is a different artefact from an
 * issued drawing, and it says so.
 *
 * Pure: no store, no runes, no i18n, no file system.
 */

import type { BarPath } from '../../codes/cirsoc201/bar-geometry';
import type { ClauseRef, RegulationEdition } from '../../codes/regulation';
import { worstMaturity, type Maturity } from '../../codes/maturity';
import { msg, type EngineMessage } from '../../codes/message';
import type { DetailingAssembly, ReviewState } from './assembly';
import type { BarConflict } from './collision';
import type { LapInterval } from './lap-materialize';
import type { ConstructibilityAssessment } from './constructibility';

/**
 * What this document may claim.
 *
 * Ordered by increasing authority. A renderer that does not understand a value must refuse
 * to render rather than fall back to the most permissive one.
 */
export type DocumentReadiness =
  /** Physical conflicts remain. Discussion material; makes no construction claim. */
  | 'REVIEW_DRAFT'
  /** Clean and reverified, but no engineer has signed it. */
  | 'FOR_REVIEW'
  /** An engineer has reviewed it. */
  | 'REVIEWED'
  /** Issued for construction. */
  | 'ISSUED'
  /** A later revision exists. Kept for the record and never to be built from. */
  | 'SUPERSEDED';

export interface DocumentRevision {
  /** Monotonic per document series. */
  number: number;
  /** ISO timestamp supplied by the caller — this module never reads the clock. */
  at: string;
  /** Free text; the app does not authenticate it. */
  author: string;
  /** The detailing revision this document was built from. */
  detailingRevision: number;
  /** The demand revision the detailing was verified against. */
  demandRevision: number;
}

/** One member's certificate, and whether it still describes the steel in the model. */
export interface CertificateEntry {
  elementId: number;
  /** Hash of the reinforcement the certificate was issued against. */
  certifiedHash: string;
  /** Hash of the reinforcement actually in the model now. */
  currentHash: string;
  /** The only question that matters. */
  matches: boolean;
  verifierId: string;
  status: 'ok' | 'warn' | 'fail' | 'notRun';
}

export interface DocumentAssembly {
  id: string;
  label: EngineMessage;
  state: ReviewState;
  elementIds: number[];
  bars: BarPath[];
  /** Distinct layer identities present, in a stable order. */
  layers: string[];
  laps: LapInterval[];
  /** Bars fused through a joint: one bar where the generator produced two. */
  fusions: Array<{ jointId: string; barId: string; ownerElementIds: number[] }>;
  conflicts: BarConflict[];
  constructibility?: ConstructibilityAssessment;
  maturity: Maturity;
  assumptions: EngineMessage[];
}

export interface DocumentModel {
  /** Stable identity of the document SERIES, constant across revisions. */
  seriesId: string;
  revision: DocumentRevision;
  readiness: DocumentReadiness;
  /** Set when this revision has been superseded, naming the one that replaced it. */
  supersededBy?: number;
  /** Regulations in force, with their editions, exactly as the verification used them. */
  regulations: Array<{ id: string; edition: RegulationEdition }>;
  /** Every clause the detailing relied on, deduplicated. */
  refs: ClauseRef[];
  assemblies: DocumentAssembly[];
  certificates: CertificateEntry[];
  /**
   * Unresolved conflicts across the whole document, as structured records.
   *
   * Present on a REVIEW_DRAFT and empty on anything above it. A renderer prints these on
   * the face of the first sheet; they are the reason the document is a draft.
   */
  openConflicts: OpenConflict[];
  /** Rolled up across assemblies. */
  maturity: Maturity;
  assumptions: EngineMessage[];
  /** One-line statement of what this document is. Translated at the boundary. */
  summary: EngineMessage;
}

/**
 * An unresolved conflict, with everything an engineer needs to act on it.
 *
 * A bare count is not actionable and a bare list of bar ids is barely better. The rule that
 * was applied, what was measured against it, and what was already tried are the difference
 * between a report someone can work from and a report someone has to re-derive.
 */
export interface OpenConflict {
  assemblyId: string;
  elementIds: number[];
  barIds: [string, string];
  /** Where, in model coordinates. */
  at: { x: number; y: number; z: number };
  /** Measured surface distance, m. Negative means interpenetration. */
  clearance: number;
  /** What the rule demanded, m. */
  required: number;
  /** The classification, e.g. `prohibitedOverlap`. */
  pairClass: string;
  /** The clause behind `required`. Empty for classes with no spacing rule. */
  refs: ClauseRef[];
  /** What the coordinator tried before giving up. */
  attempted: EngineMessage[];
  maturity: Maturity;
  /** What the engineer should do about it. */
  suggestedAction: EngineMessage;
}

/**
 * Decide what the document may claim, from evidence rather than from intent.
 *
 * Deliberately pessimistic at every step. A caller who wants ISSUED must have supplied an
 * assembly that reached ISSUED, a clean conflict list AND matching certificates; any gap
 * drops it to the highest rung the evidence supports.
 */
export function documentReadiness(input: {
  assemblies: readonly DocumentAssembly[];
  certificates: readonly CertificateEntry[];
  supersededBy?: number;
}): DocumentReadiness {
  if (input.supersededBy !== undefined) return 'SUPERSEDED';

  const anyConflict = input.assemblies.some((a) =>
    a.conflicts.some((c) => c.severity !== 'marginal'));
  if (anyConflict) return 'REVIEW_DRAFT';

  // A certificate that does not describe the steel in the model is worse than none: it is
  // a correct-looking claim about geometry that no longer exists.
  if (input.certificates.length === 0
    || input.certificates.some((c) => !c.matches || c.status === 'fail')) {
    return 'REVIEW_DRAFT';
  }

  const rank = (s: ReviewState) =>
    ['DRAFT', 'VERIFIED', 'COORDINATED', 'CONSTRUCTIBLE', 'REVIEWED', 'ISSUED'].indexOf(s);
  const lowest = input.assemblies.reduce(
    (m, a) => Math.min(m, rank(a.state)), Number.POSITIVE_INFINITY);

  if (lowest >= rank('ISSUED')) return 'ISSUED';
  if (lowest >= rank('REVIEWED')) return 'REVIEWED';
  if (lowest >= rank('CONSTRUCTIBLE')) return 'FOR_REVIEW';
  return 'REVIEW_DRAFT';
}

/** Turn an assembly's conflicts into records an engineer can act on. */
export function openConflictsOf(
  a: DocumentAssembly, attempted: readonly EngineMessage[] = [],
): OpenConflict[] {
  return a.conflicts
    .filter((c) => c.severity !== 'marginal')
    .map((c) => ({
      assemblyId: a.id,
      elementIds: c.elementIds,
      barIds: [c.barA, c.barB] as [string, string],
      at: c.at,
      clearance: c.clearance,
      required: c.required,
      pairClass: c.pairClass ?? 'unknown',
      refs: [],
      attempted: [...attempted],
      maturity: a.maturity,
      suggestedAction: msg(
        c.pairClass === 'prohibitedOverlap'
          ? 'detailing.action.prohibitedOverlap'
          : 'detailing.action.increaseSpacing',
        {
          elements: c.elementIds.join(', '),
          shortfall: Math.round(c.shortfall * 1000),
        },
      ),
    }));
}

/**
 * Assemble the document.
 *
 * Everything it will ever say is decided here. The renderers below add no facts.
 */
export function buildDocumentModel(input: {
  seriesId: string;
  revision: DocumentRevision;
  regulations: Array<{ id: string; edition: RegulationEdition }>;
  assemblies: readonly DetailingAssembly[];
  laps: readonly LapInterval[];
  certificates: readonly CertificateEntry[];
  supersededBy?: number;
  /** Alternatives the coordinator tried, for the conflict records. */
  attempted?: readonly EngineMessage[];
}): DocumentModel {
  const docAssemblies: DocumentAssembly[] = input.assemblies.map((a) => {
    const layers = [...new Set(a.bars.map((b) => b.layerId).filter(Boolean) as string[])]
      .sort();
    const ownIds = new Set(a.bars.map((b) => b.id));
    return {
      id: a.id,
      label: msg(a.labelKey ?? 'detailing.assembly.generic', a.labelParams ?? {}),
      state: a.state,
      elementIds: [...a.elementIds],
      bars: [...a.bars],
      layers,
      laps: input.laps.filter((l) => ownIds.has(l.fromBarId) || ownIds.has(l.toBarId)),
      // A bar owned by more than one member passed through a joint as one piece.
      fusions: a.bars
        .filter((b) => b.ownerElementIds.length > 1)
        .map((b) => ({
          jointId: b.id, barId: b.id, ownerElementIds: [...b.ownerElementIds],
        })),
      conflicts: [...a.conflicts],
      constructibility: a.constructibility,
      maturity: a.maturity,
      assumptions: [...(a.provenance?.assumptions ?? [])],
    };
  });

  const readiness = documentReadiness({
    assemblies: docAssemblies,
    certificates: input.certificates,
    supersededBy: input.supersededBy,
  });

  const openConflicts = docAssemblies
    .flatMap((a) => openConflictsOf(a, input.attempted));

  // Clause provenance travels on the bars themselves, so the document cites exactly the
  // rules the steel it contains was built under — not a list maintained alongside it that
  // can drift out of step.
  const refs = new Map<string, ClauseRef>();
  for (const a of input.assemblies) {
    for (const bar of a.bars) {
      for (const r of bar.refs ?? []) {
        refs.set(`${r.regulation}|${r.edition}|${r.clause}`, r);
      }
    }
  }

  return {
    seriesId: input.seriesId,
    revision: input.revision,
    readiness,
    supersededBy: input.supersededBy,
    regulations: [...input.regulations],
    refs: [...refs.values()],
    assemblies: docAssemblies,
    certificates: [...input.certificates],
    openConflicts,
    maturity: worstMaturity(docAssemblies.map((a) => a.maturity)),
    assumptions: docAssemblies.flatMap((a) => a.assumptions),
    summary: msg(
      readiness === 'REVIEW_DRAFT'
        ? 'detailing.document.reviewDraft'
        : readiness === 'SUPERSEDED'
          ? 'detailing.document.superseded'
          : 'detailing.document.current',
      {
        revision: input.revision.number,
        assemblies: docAssemblies.length,
        conflicts: openConflicts.length,
        superseded: input.supersededBy ?? 0,
      },
    ),
  };
}

/**
 * Mark a document superseded by a later revision.
 *
 * A superseded document is never mutated in place and never deleted. It is the record of
 * what was issued, and a project that cannot show what it previously issued cannot answer
 * the only question that matters after something goes wrong.
 */
export function supersede(doc: DocumentModel, byRevision: number): DocumentModel {
  return {
    ...doc,
    readiness: 'SUPERSEDED',
    supersededBy: byRevision,
    summary: msg('detailing.document.superseded', {
      revision: doc.revision.number,
      assemblies: doc.assemblies.length,
      conflicts: doc.openConflicts.length,
      superseded: byRevision,
    }),
  };
}

/** True when this document may be used to build. Nothing else may claim it. */
export function isConstructionReady(doc: DocumentModel): boolean {
  return doc.readiness === 'ISSUED';
}
