/**
 * CIRSOC 201 design-code adapter.
 *
 * Wraps the existing, well-tested pure capacity functions in
 * `station-design-forces.ts` behind the `DesignCodeAdapter` seam. The legacy
 * `checkFlexure` / `checkShear` / `checkColumn` estimators in `cirsoc201.ts` are
 * NOT used for verdicts any more — they remain as the required-steel seed and the
 * source of calculation memos. `checkColumn`'s straight-line interaction in
 * particular was the source of generator/verifier disagreement and never decides
 * pass/fail again.
 *
 * VERIFIER VERSION: 'cirsoc201.provided.v2'.
 *   v1 → v2 corrected the governing-axis selection (beams and columns), turned
 *   missing-reinforcement from a skipped check into an explicit failure, switched
 *   utilization to demand/capacity with a warn band, checked both column shear
 *   components, and threaded the slenderness magnifier. Statuses produced by v1
 *   are NOT comparable with v2 — v1 issued false passes.
 */

import { verifyProvidedReinforcement, requiredLd, requiredLdh } from '../../station-design-forces';
import type { ProvidedRebarResult } from '../../station-design-forces';
import type { ProvidedReinforcement } from '../../../store/model.svelte';
import { peakMy, peakMz, peakVy, peakVz, peakAxial } from '../design-axes';
import type { MemberContext } from '../member-context';
import type { CandidateGenerator } from '../candidate-generator';
import { createBeamCandidateGenerator } from '../candidate-enumerate-beam';
import { createColumnCandidateGenerator, COLUMN_LIMITS } from '../candidate-enumerate-column';
import { recommendSection, type AdviceDemands } from '../section-advice';
import { DEFAULT_OBJECTIVE, type ObjectiveSpec } from '../objective';
import { UTILIZATION_CONVENTION, type LimitingConstraint, type SectionRecommendation, type DesignReason } from '../outcome';
import {
  registerDesignCode,
  type CodeCapabilities, type CodeProvenance, type DemandRequirement,
  type DesignCodeAdapter, type DetailingLimits, type InputValidation,
} from '../code-adapter';

export const CIRSOC_VERIFIER_ID = 'cirsoc201.provided.v2';

const CAPABILITIES: CodeCapabilities = {
  beams: { flexure: true, shear: true, torsion: false, regions: true, curtailment: true, anchorage: true },
  columns: { axialFlexure: true, biaxial: true, slenderness: true, ties: true },
  walls: false,
  sectionShapes: ['rect'],
  candidateGeneration: true,
  sectionRecommendation: true,
};

export const cirsoc201Adapter: DesignCodeAdapter = {
  id: 'cirsoc',
  name: 'CIRSOC 201',
  version: '2005',
  utilizationConvention: UTILIZATION_CONVENTION,
  capabilities: CAPABILITIES,

  requiredDemands(): DemandRequirement {
    return {
      needsCombinations: true,
      minCombinations: 1,
      categories: ['My+', 'My-', 'Mz+', 'Mz-', 'Vy', 'Vz', 'N_compression'],
    };
  },

  validateInputs(ctx: MemberContext): InputValidation {
    const blocking: LimitingConstraint[] = [];
    const reasons: DesignReason[] = [];
    for (const b of ctx.blocking) {
      blocking.push(b);
      switch (b) {
        case 'missingCombinations':
          reasons.push({ key: 'design.reason.missingCombinations', params: { elementId: ctx.elementId } });
          break;
        case 'missingDemand':
          reasons.push({ key: 'design.reason.missingDemand', params: { elementId: ctx.elementId } });
          break;
        case 'missingSection':
          reasons.push({ key: 'design.reason.missingSection', params: { elementId: ctx.elementId } });
          break;
        case 'missingMaterial':
          reasons.push({ key: 'design.reason.missingMaterial', params: { elementId: ctx.elementId } });
          break;
        default:
          reasons.push({ key: 'design.reason.generic', params: { detail: b } });
      }
    }
    if (ctx.material.fc > 80) {
      blocking.push('missingMaterial');
      reasons.push({ key: 'design.reason.notConcrete', params: { fc: ctx.material.fc } });
    }
    return { ok: blocking.length === 0, blocking: [...new Set(blocking)], reasons };
  },

  detailingLimits(ctx: MemberContext): DetailingLimits {
    const { fc, fy } = ctx.material;
    const isColumn = ctx.elementType === 'column';
    const rhoMin = isColumn
      ? COLUMN_LIMITS.rhoMin
      : Math.max(0.25 * Math.sqrt(fc) / fy, 1.4 / fy);
    return {
      minClearSpacing: 0.025,
      ld: (d: number) => requiredLd(d, fc, fy),
      ldh: (d: number) => requiredLdh(d, fc, fy),
      lapSplice: (d: number) => 1.3 * requiredLd(d, fc, fy),
      rhoMin,
      rhoMax: isColumn ? COLUMN_LIMITS.rhoMax : 0.025,
    };
  },

  createGenerator(ctx: MemberContext): CandidateGenerator | null {
    if (ctx.section.b <= 0 || ctx.section.h <= 0) return null;
    if (ctx.elementType === 'column') return createColumnCandidateGenerator(ctx);
    if (ctx.elementType === 'beam') return createBeamCandidateGenerator(ctx);
    return null; // walls are declared unsupported
  },

  verify(ctx: MemberContext, rebar: ProvidedReinforcement): ProvidedRebarResult {
    return verifyProvidedReinforcement(
      ctx.elementId,
      ctx.elementType,
      rebar,
      ctx.demands,
      {
        // Area-based fallbacks are only used when no station data exists; the
        // capacity path is preferred and is what actually decides the verdict.
        flexure: { AsReq: 0 },
        shear: { AvOverS: 0, AvOverSMin: 0 },
      },
      {
        b: ctx.axes.bFlex, h: ctx.axes.hFlex,
        fc: ctx.material.fc, fy: ctx.material.fy,
        cover: ctx.material.cover, stirrupDia: ctx.material.stirrupDia,
      },
      ctx.stations,
      ctx.modelData as never,
      { axes: ctx.axes, slenderDeltaNs: ctx.slenderDeltaNs },
    );
  },

  classifyFailure(v: ProvidedRebarResult, ctx: MemberContext): LimitingConstraint[] {
    const out = new Set<LimitingConstraint>();
    for (const c of v.checks) {
      if (c.status === 'ok') continue;
      if (c.limiting) out.add(c.limiting as LimitingConstraint);
    }
    if (ctx.orientationSuspect) out.add('memberOrientationSuspect');
    return [...out];
  },

  optimizationObjective(_ctx: MemberContext): ObjectiveSpec {
    return DEFAULT_OBJECTIVE;
  },

  adviceDemands(ctx: MemberContext): AdviceDemands {
    const primaryM = ctx.axes.flexure === 'My' ? peakMy(ctx.demands) : peakMz(ctx.demands);
    const primaryV = ctx.axes.shear === 'Vy' ? peakVy(ctx.demands) : peakVz(ctx.demands);
    return {
      Mu: primaryM * ctx.slenderDeltaNs,
      Vu: primaryV,
      Nu: peakAxial(ctx.demands),
    };
  },

  recommendSection(ctx: MemberContext, limiting: LimitingConstraint[]): SectionRecommendation | null {
    return recommendSection(ctx, limiting, this.adviceDemands(ctx));
  },

  unsupported(ctx: MemberContext): LimitingConstraint[] {
    const out: LimitingConstraint[] = [];
    if (ctx.elementType === 'wall') out.push('unsupportedCheck');
    return out;
  },

  provenance(): CodeProvenance {
    return {
      codeId: 'cirsoc',
      codeName: 'CIRSOC 201',
      codeVersion: '2005',
      verifierId: CIRSOC_VERIFIER_ID,
      clauses: ['§10.2', '§10.3', '§10.5', '§10.9.1', '§11.2', '§11.5', '§7.6.1', '§7.10.5', '§12.2'],
    };
  },
};

registerDesignCode(cirsoc201Adapter);
