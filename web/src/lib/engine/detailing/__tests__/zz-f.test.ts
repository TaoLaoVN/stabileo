import { describe, it } from 'vitest';
import frame from '../../../templates/fixtures/rc-design-frame.json';
import { runDesign } from '../../design/candidate-search';
import { cirsoc201Adapter } from '../../design/adapters/cirsoc201-adapter';
import { solveFixture } from '../../design/__tests__/helpers';
import { runDetailing } from '../run-detailing';
import type { MemberDesignOutcome } from '../../design/outcome';
describe('f', () => { it('x', () => {
  const solved = solveFixture(frame);
  const summary = runDesign(cirsoc201Adapter, solved.contexts.values(), { maxRunMs: 180_000 });
  const t0 = process.hrtime.bigint();
  const r = runDetailing({ contexts: solved.contexts,
    outcomes: summary.outcomes as ReadonlyMap<number, MemberDesignOutcome>,
    nodes: solved.data.nodes as never, elements: solved.data.elements as never,
    edition: '2025', verifierId: 'ev', demandRevision: 1, maxAggregateSizeMm: 19 });
  const ms = Number(process.hrtime.bigint()-t0)/1e6;
  const bc = new Map<string,number>();
  for (const a of r.assemblies) for (const c of a.conflicts)
    bc.set(`${c.severity}|${(c as any).pairClass}`,(bc.get(`${c.severity}|${(c as any).pairClass}`)??0)+1);
  console.log('F ' + JSON.stringify({ outcome:r.layoutSearch.outcome,
    stats:r.layoutSearch.stats,
    emptiedEvents:r.layoutSearch.emptiedDomains.length,
    emptiedMembers:new Set(r.layoutSearch.emptiedDomains.map(e=>e.elementId)).size,
    joints:r.layoutSearch.infeasibleJoints.length, assigned:r.layoutSearch.assignment.size,
    conflicts:r.assemblies.reduce((n,a)=>n+a.conflicts.length,0),
    breaches:r.assemblies.flatMap(a=>a.unsupported).filter(u=>/separación libre/.test(String(u.message))).length,
    bars:r.assemblies.reduce((n,a)=>n+a.bars.length,0),
    marks:r.assemblies.reduce((n,a)=>n+a.marks.length,0),
    states:[...r.assemblies.reduce((m,a)=>m.set(a.state,(m.get(a.state)??0)+1),new Map())],
    byClass:Object.fromEntries([...bc].sort((a,b)=>b[1]-a[1])), ms:Math.round(ms) }));
}, 300_000); });
