import { describe, it } from 'vitest';
import frame from '../../../templates/fixtures/rc-design-frame.json';
import { runDesign } from '../../design/candidate-search';
import { cirsoc201Adapter } from '../../design/adapters/cirsoc201-adapter';
import { solveFixture } from '../../design/__tests__/helpers';
import { generateLayoutCandidates, candidateClears } from '../candidates';
import { computeColumnLayout } from '../../station-design-forces';
import { minClearSpacingInLayer } from '../../../codes/cirsoc201/spacing';
import { DEFAULT_TOLERANCES } from '../collision';
import type { MemberDesignOutcome } from '../../design/outcome';

describe('one', () => { it('x', () => {
  const solved = solveFixture(frame);
  const summary = runDesign(cirsoc201Adapter, solved.contexts.values(), { maxRunMs: 180_000 });
  const nodes = solved.data.nodes as any, elements = solved.data.elements as any;
  const P = DEFAULT_TOLERANCES.placement;

  // Find an 8Ø12 beam whose both end columns are 8Ø20.
  let pick: any = null;
  for (const [id, ctx] of solved.contexts) {
    if (ctx.elementType !== 'beam') continue;
    const acc: any = (summary.outcomes.get(id) as MemberDesignOutcome|undefined)?.accepted;
    const g = acc?.regions ?? {}; const bot = g.bottomSpan ?? acc?.bottom;
    if (!bot || bot.count !== 8 || bot.diameter !== 12) continue;
    const el = elements.get(id); const nI = nodes.get(el.nodeI), nJ = nodes.get(el.nodeJ);
    if (!nI || !nJ) continue;
    pick = { id, ctx, el, nI, nJ, bot, g, acc }; break;
  }
  if (!pick) { console.log('ONE none'); return; }

  const { id, ctx, el, nI, nJ, bot } = pick;
  const dx = nJ.x-nI.x, dy = nJ.y-nI.y, L = Math.hypot(dx,dy)||1;
  const t = { x: dy/L, y: -dx/L };
  const cw = Math.max(0.02, ctx.section.b - 2*(ctx.material.cover + ctx.material.stirrupDia/1000));

  // Column obstacles at each end, via the AUTHORITATIVE layout.
  const obstaclesAt = (n:any) => {
    const out: any[] = [];
    for (const [cid, cctx] of solved.contexts) {
      if (cctx.elementType !== 'column') continue;
      const cel = elements.get(cid); if (!cel) continue;
      const a = nodes.get(cel.nodeI), b = nodes.get(cel.nodeJ); if (!a||!b) continue;
      const lo = (a.z??0)<=(b.z??0)?a:b, hi = (a.z??0)<=(b.z??0)?b:a;
      if (Math.hypot(lo.x-n.x, lo.y-n.y) > 0.6) continue;
      if ((lo.z??0) > (n.z??0)+0.02 || (hi.z??0) < (n.z??0)-0.02) continue;
      const acc: any = (summary.outcomes.get(cid) as any)?.accepted;
      const LL = acc?.longitudinal ?? acc?.column; if (!LL) continue;
      const lay = computeColumnLayout(LL.count, LL.diameter, cctx.section.b, cctx.section.h,
        cctx.material.cover, cctx.material.stirrupDia, undefined,
        { edition:'2025', maxAggregateSizeMm:19 } as never);
      for (const bar of lay.bars) out.push({ cid, dia: LL.diameter,
        x: lo.x + bar.x - cctx.section.b/2, y: lo.y + bar.y - cctx.section.h/2 });
    }
    // dedupe by plan position
    const m = new Map<string, any>();
    for (const o of out) m.set(`${Math.round(o.x*1000)}:${Math.round(o.y*1000)}`, o);
    return [...m.values()];
  };

  const proj = (n:any) => obstaclesAt(n).map((o:any)=>({
    at: +(((o.x-n.x)*t.x + (o.y-n.y)*t.y)).toFixed(5),
    halfWidth: +(o.dia/2000 + P).toFixed(5), dia: o.dia }))
    .sort((a:any,b:any)=>a.at-b.at);

  const kI = proj(nI), kJ = proj(nJ);
  const union = [...kI, ...kJ];
  const spacing = minClearSpacingInLayer('2025', { barDiameterMm: 12, maxAggregateSizeMm: 19 });

  // Channels from the union
  const half = cw/2;
  const blocked = union.map(o=>({lo:o.at-o.halfWidth, hi:o.at+o.halfWidth})).sort((a,b)=>a.lo-b.lo);
  const merged: any[] = [];
  for (const b of blocked) { const last = merged[merged.length-1];
    if (last && b.lo <= last.hi) last.hi = Math.max(last.hi, b.hi); else merged.push({...b}); }
  const chans: any[] = []; let cur = -half;
  for (const b of merged) { if (b.lo > cur) chans.push({lo:cur, hi:b.lo}); cur = Math.max(cur,b.hi); }
  if (cur < half) chans.push({lo:cur, hi:half});

  const d = 0.012;
  const pitchCode = d + spacing.minClear;
  const pitchTarget = d + spacing.minClear + P;
  const cap = (c:any, pitch:number) => { const w=c.hi-c.lo; return w<d?0:Math.floor((w-d)/pitch)+1; };

  const dom = generateLayoutCandidates({ count:8, diameterMm:12, clearWidth:cw,
    edition:'2025', maxAggregateSizeMm:19, memberKind:'beam', placementTolerance:P,
    obstacles: union });
  const okI = dom.filter(c=>candidateClears(c,12,kI).ok).length;
  const okJ = dom.filter(c=>candidateClears(c,12,kJ).ok).length;
  const okBoth = dom.filter(c=>candidateClears(c,12,kI).ok && candidateClears(c,12,kJ).ok).length;

  console.log('ONE ' + JSON.stringify({
    member:id, b:ctx.section.b, h:ctx.section.h, cover:ctx.material.cover,
    stirrup:ctx.material.stirrupDia, bars:`${bot.count}Ø${bot.diameter}`,
    clearWidth:+cw.toFixed(4), halfWidth:+half.toFixed(4),
    transverse:{x:+t.x.toFixed(3), y:+t.y.toFixed(3)},
    codeMinClear:+spacing.minClear.toFixed(4), placementAllowance:P,
    pitchCode:+pitchCode.toFixed(4), pitchTarget:+pitchTarget.toFixed(4),
    obstaclesEndI:kI.length, obstaclesEndJ:kJ.length,
    distinctProjections:[...new Set(union.map(o=>o.at))].sort((a,b)=>a-b),
    channels:chans.map(c=>({lo:+c.lo.toFixed(4), hi:+c.hi.toFixed(4),
      w:+(c.hi-c.lo).toFixed(4), capCode:cap(c,pitchCode), capTarget:cap(c,pitchTarget)})),
    perLayerNeeded:4,
    totalCapCode:chans.reduce((n,c)=>n+cap(c,pitchCode),0),
    totalCapTarget:chans.reduce((n,c)=>n+cap(c,pitchTarget),0),
    domain:dom.length, clearsEndI:okI, clearsEndJ:okJ, clearsBoth:okBoth,
    channelAware:dom.filter(c=>c.id.startsWith('ch')).length,
  }));
}, 300_000); });
