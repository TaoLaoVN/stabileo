/**
 * Render one DocumentModel to the three deliverables.
 *
 * ── The single-source rule ─────────────────────────────────────────
 *
 * All three functions take the SAME `DocumentModel` instance. That is the whole point of
 * the model existing: a report, a drawing set and a bar schedule of one floor are three
 * projections of one claim, and built independently they drift. Every fact printed here
 * comes from the model; none of these functions may compute a new one.
 *
 * ── Drafts print, and say what they are ────────────────────────────
 *
 * A conflicted floor still produces all three files, because an engineer discussing a
 * clash needs the drawing of it. What it must never produce is something that looks
 * issued. So a REVIEW_DRAFT carries its readiness and its unresolved conflicts on the face
 * of every output — the first page of the report, a DXF layer of annotations, and a
 * dedicated block of schedule rows — and each states that it is not for construction.
 *
 * Pure: no store, no runes, no DOM, no file system. The caller turns these into files.
 */

import { buildTitleBlock, buildSchedule, scheduleToAoa, sheetToDxf, sheetToSvg,
  drawElevation, drawSection, barArcs, type Sheet, type Projection } from './drawings';
import type { DocumentModel, OpenConflict } from './document-model';
import type { BarMark } from './assembly';

/** Everything the renderers need that is not in the model: locale and presentation. */
export interface RenderOptions {
  locale: string;
  projectName: string;
  /** Commercial stock length for the schedule, m. */
  stockLength?: number;
  /** Steel density, kg/m³, for the mass column. */
  steelDensity?: number;
}

const DEFAULTS = { stockLength: 12, steelDensity: 7850 };

/** The readiness banner every output carries. Not decoration — it is the claim. */
export function readinessBanner(doc: DocumentModel, locale: string): string {
  const es = locale.startsWith('es');
  switch (doc.readiness) {
    case 'ISSUED':
      return es ? 'EMITIDO PARA CONSTRUCCIÓN' : 'ISSUED FOR CONSTRUCTION';
    case 'REVIEWED':
      return es ? 'REVISADO' : 'REVIEWED';
    case 'FOR_REVIEW':
      return es ? 'PARA REVISIÓN — NO APTO PARA CONSTRUCCIÓN'
        : 'FOR REVIEW — NOT FOR CONSTRUCTION';
    case 'SUPERSEDED':
      return es
        ? `REEMPLAZADO POR LA REVISIÓN ${doc.supersededBy ?? '?'} — NO APTO PARA CONSTRUCCIÓN`
        : `SUPERSEDED BY REVISION ${doc.supersededBy ?? '?'} — NOT FOR CONSTRUCTION`;
    default:
      return es
        ? `BORRADOR DE REVISIÓN — ${doc.openConflicts.length} CONFLICTO(S) SIN RESOLVER — NO APTO PARA CONSTRUCCIÓN`
        : `REVIEW DRAFT — ${doc.openConflicts.length} UNRESOLVED CONFLICT(S) — NOT FOR CONSTRUCTION`;
  }
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] ?? c));
}

// ─── PDF (as print-ready HTML, handed to the existing print pipeline) ───

/**
 * The report.
 *
 * Returns HTML rather than a PDF binary because the app already prints through the
 * browser, which produces better typography than any bundled PDF writer and adds no
 * dependency. The caller opens it in a print window.
 */
export function renderReportHtml(
  doc: DocumentModel, opts: RenderOptions,
  translate: (key: string, params?: Record<string, unknown>) => string,
): string {
  const es = opts.locale.startsWith('es');
  const L = (a: string, b: string) => (es ? a : b);
  const draft = doc.readiness === 'REVIEW_DRAFT' || doc.readiness === 'SUPERSEDED';

  const rows: string[] = [];

  rows.push(`<h1>${esc(opts.projectName)}</h1>`);
  rows.push(`<p class="banner ${draft ? 'draft' : 'ok'}">${esc(readinessBanner(doc, opts.locale))}</p>`);
  rows.push(`<p class="summary">${esc(translate(doc.summary.key, doc.summary.params))}</p>`);

  // ── Revision block ──
  rows.push(`<h2>${L('Revisión', 'Revision')}</h2><table><tbody>`);
  rows.push(`<tr><th>${L('Revisión', 'Revision')}</th><td>${doc.revision.number}</td></tr>`);
  rows.push(`<tr><th>${L('Fecha', 'Date')}</th><td>${esc(doc.revision.at)}</td></tr>`);
  rows.push(`<tr><th>${L('Autor', 'Author')}</th><td>${esc(doc.revision.author)}</td></tr>`);
  rows.push(`<tr><th>${L('Rev. de armado', 'Detailing rev.')}</th><td>${doc.revision.detailingRevision}</td></tr>`);
  rows.push(`<tr><th>${L('Rev. de solicitaciones', 'Demand rev.')}</th><td>${doc.revision.demandRevision}</td></tr>`);
  rows.push(`<tr><th>${L('Madurez', 'Maturity')}</th><td>${esc(doc.maturity)}</td></tr>`);
  rows.push('</tbody></table>');

  // ── Regulations, with editions, exactly as verified ──
  rows.push(`<h2>${L('Reglamentos', 'Regulations')}</h2><ul>`);
  for (const r of doc.regulations) rows.push(`<li>${esc(r.id)} — ${esc(r.edition)}</li>`);
  rows.push('</ul>');

  if (doc.refs.length > 0) {
    rows.push(`<h3>${L('Artículos aplicados', 'Clauses applied')}</h3><ul class="clauses">`);
    for (const r of doc.refs) {
      rows.push(`<li>${esc(r.regulation)} ${esc(r.edition)} §${esc(r.clause)}</li>`);
    }
    rows.push('</ul>');
  }

  // ── Certificates ──
  rows.push(`<h2>${L('Certificados de verificación', 'Verification certificates')}</h2>`);
  rows.push(`<table><thead><tr>`
    + `<th>${L('Elemento', 'Member')}</th><th>${L('Verificador', 'Verifier')}</th>`
    + `<th>${L('Estado', 'Status')}</th><th>${L('Coincide con la geometría', 'Matches geometry')}</th>`
    + `</tr></thead><tbody>`);
  for (const c of doc.certificates) {
    rows.push(`<tr><td>${c.elementId}</td><td>${esc(c.verifierId)}</td>`
      + `<td>${esc(c.status)}</td>`
      + `<td class="${c.matches ? 'ok' : 'bad'}">${c.matches ? L('Sí', 'Yes') : L('No', 'No')}</td></tr>`);
  }
  rows.push('</tbody></table>');

  // ── Assemblies: beam lines and column stacks ──
  for (const a of doc.assemblies) {
    rows.push(`<h2>${esc(translate(a.label.key, a.label.params))}</h2>`);
    rows.push(`<p>${L('Estado', 'State')}: <strong>${esc(a.state)}</strong> · `
      + `${L('Elementos', 'Members')}: ${a.elementIds.join(', ')} · `
      + `${L('Barras', 'Bars')}: ${a.bars.length} · `
      + `${L('Capas', 'Layers')}: ${a.layers.length}</p>`);

    if (a.laps.length > 0) {
      rows.push(`<h3>${L('Empalmes físicos', 'Physical laps')}</h3><table><thead><tr>`
        + `<th>${L('Nudo', 'Joint')}</th><th>${L('Barras', 'Bars')}</th>`
        + `<th>${L('Tipo', 'Kind')}</th><th>${L('Clase', 'Class')}</th>`
        + `<th>${L('Longitud (mm)', 'Length (mm)')}</th></tr></thead><tbody>`);
      for (const l of a.laps) {
        rows.push(`<tr><td>${esc(l.jointId)}</td>`
          + `<td>${esc(l.fromBarId)} / ${esc(l.toBarId)}</td>`
          + `<td>${esc(l.kind)}</td><td>${esc(l.spliceClass)}</td>`
          + `<td>${Math.round(l.lapLength * 1000)}</td></tr>`);
      }
      rows.push('</tbody></table>');
    }

    if (a.fusions.length > 0) {
      rows.push(`<h3>${L('Barras continuas a través de nudos', 'Bars continuous through joints')}</h3><ul>`);
      for (const f of a.fusions) {
        rows.push(`<li>${esc(f.barId)} — ${L('elementos', 'members')} ${f.ownerElementIds.join(', ')}</li>`);
      }
      rows.push('</ul>');
    }

    if (a.constructibility) {
      rows.push(`<h3>${L('Condiciones de constructibilidad', 'Constructibility conditions')}</h3><ul class="conds">`);
      for (const c of a.constructibility.conditions) {
        rows.push(`<li class="${c.passed ? 'ok' : 'bad'}">${esc(c.condition)}: `
          + `${esc(translate(c.detail.key, c.detail.params))}</li>`);
      }
      rows.push('</ul>');
    }
  }

  // ── Unresolved conflicts. On a draft this is the point of the document. ──
  if (doc.openConflicts.length > 0) {
    rows.push(`<h2 class="bad">${L('Conflictos sin resolver', 'Unresolved conflicts')} `
      + `(${doc.openConflicts.length})</h2>`);
    rows.push(`<table><thead><tr>`
      + `<th>${L('Conjunto', 'Assembly')}</th><th>${L('Elementos', 'Members')}</th>`
      + `<th>${L('Barras', 'Bars')}</th><th>${L('Clase', 'Class')}</th>`
      + `<th>${L('Medido (mm)', 'Measured (mm)')}</th><th>${L('Requerido (mm)', 'Required (mm)')}</th>`
      + `<th>${L('Acción sugerida', 'Suggested action')}</th></tr></thead><tbody>`);
    for (const c of doc.openConflicts) {
      rows.push(`<tr><td>${esc(c.assemblyId)}</td><td>${c.elementIds.join(', ')}</td>`
        + `<td>${esc(c.barIds[0])} / ${esc(c.barIds[1])}</td><td>${esc(c.pairClass)}</td>`
        + `<td>${Math.round(c.clearance * 1000)}</td><td>${Math.round(c.required * 1000)}</td>`
        + `<td>${esc(translate(c.suggestedAction.key, c.suggestedAction.params))}</td></tr>`);
    }
    rows.push('</tbody></table>');
  }

  if (doc.assumptions.length > 0) {
    rows.push(`<h2>${L('Hipótesis', 'Assumptions')}</h2><ul>`);
    for (const a of doc.assumptions) rows.push(`<li>${esc(translate(a.key, a.params))}</li>`);
    rows.push('</ul>');
  }

  return `<!doctype html><html lang="${esc(opts.locale)}"><head><meta charset="utf-8">`
    + `<title>${esc(opts.projectName)} — rev ${doc.revision.number}</title><style>`
    + 'body{font:12px/1.45 system-ui,sans-serif;margin:24px;color:#111}'
    + 'h1{font-size:20px;margin:0 0 4px}h2{font-size:15px;margin:20px 0 6px;'
    + 'border-bottom:1px solid #ccc;padding-bottom:2px}h3{font-size:13px;margin:12px 0 4px}'
    + 'table{border-collapse:collapse;width:100%;margin:4px 0 10px}'
    + 'th,td{border:1px solid #bbb;padding:3px 6px;text-align:left;font-size:11px}'
    + 'th{background:#f2f2f2}.banner{font-weight:700;padding:6px 10px;margin:6px 0 14px}'
    + '.banner.draft{background:#fde2e2;border:2px solid #b00}'
    + '.banner.ok{background:#e6f5e6;border:2px solid #2a7}'
    + '.bad{color:#b00}.ok{color:#2a7}ul{margin:4px 0 10px 18px}'
    + '@media print{body{margin:0}}'
    + `</style></head><body>${rows.join('')}</body></html>`;
}

// ─── DXF ───

export interface DrawingSet {
  sheets: Array<{ name: string; sheet: Sheet; dxf: string; svg: string }>;
  /** All sheets concatenated into one DXF. */
  dxf: string;
}

/**
 * Elevations for every beam line, a section per assembly, and the conflict annotations.
 *
 * The bars drawn are the model's FINAL BarPaths — after fusion and lap materialisation —
 * so the drawing shows the steel that will be placed rather than the steel the generator
 * first proposed.
 */
export function renderDrawings(doc: DocumentModel, opts: RenderOptions): DrawingSet {
  const sheets: DrawingSet['sheets'] = [];
  let n = 0;

  for (const a of doc.assemblies) {
    if (a.bars.length === 0) continue;

    // Plan axis of this assembly, from its own steel: the direction its longest bar runs.
    const longest = a.bars.reduce((m, b) => (b.cuttingLength > m.cuttingLength ? b : m), a.bars[0]);
    const s0 = longest.segments[0].start;
    const e0 = longest.segments[longest.segments.length - 1].end;
    const d = { x: e0.x - s0.x, y: e0.y - s0.y, z: 0 };
    const len = Math.hypot(d.x, d.y) || 1;
    const right = { x: d.x / len, y: d.y / len, z: 0 };
    const projection: Projection = { right, up: { x: 0, y: 0, z: 1 }, origin: s0 };

    // Member outline: the bounding box of the steel, which is what an elevation needs to
    // frame it. Section geometry proper belongs to the member and is drawn from it below.
    const xs = a.bars.flatMap((b) => b.segments.flatMap((sg) => [sg.start, sg.end]));
    const proj1 = (p: typeof s0) =>
      (p.x - s0.x) * right.x + (p.y - s0.y) * right.y;
    const zs = xs.map((p) => p.z);
    const us = xs.map(proj1);
    const outline = [
      { x: Math.min(...us), y: Math.min(...zs) },
      { x: Math.max(...us), y: Math.min(...zs) },
      { x: Math.max(...us), y: Math.max(...zs) },
      { x: Math.min(...us), y: Math.max(...zs) },
    ];

    const notes = [
      readinessBanner(doc, opts.locale),
      ...doc.openConflicts
        .filter((c) => c.assemblyId === a.id)
        .map((c) => conflictNote(c, opts.locale)),
    ];

    n += 1;
    const elevation = drawElevation({
      assembly: a.source,
      outlines: [{
        points: [
          { x: s0.x, y: s0.y, z: Math.min(...zs) },
          { x: s0.x + right.x * Math.max(...us), y: s0.y + right.y * Math.max(...us), z: Math.min(...zs) },
          { x: s0.x + right.x * Math.max(...us), y: s0.y + right.y * Math.max(...us), z: Math.max(...zs) },
          { x: s0.x, y: s0.y, z: Math.max(...zs) },
        ],
        closed: true,
      }],
      projection,
      clauses: doc.refs,
      sheetNumber: `R${doc.revision.number}-${n}`,
      // Readiness and every open conflict go ON the drawing, not beside it.
      title: `${opts.projectName} — ${notes.join(' | ')}`,
    });
    const arcs = a.bars.flatMap((b) => barArcs(b, projection));
    sheets.push({
      name: `${a.id}-elevation`,
      sheet: elevation,
      dxf: sheetToDxf(elevation, arcs, opts.locale),
      svg: sheetToSvg(elevation, 1200, opts.locale),
    });

    n += 1;
    const section = drawSection({
      assembly: a.source,
      atX: (Math.min(...us) + Math.max(...us)) / 2,
      outline,
      projection,
      clauses: doc.refs,
      sheetNumber: `R${doc.revision.number}-${n}`,
      title: `${opts.projectName} — ${readinessBanner(doc, opts.locale)}`,
    } as never);
    sheets.push({
      name: `${a.id}-section`,
      sheet: section,
      dxf: sheetToDxf(section, [], opts.locale),
      svg: sheetToSvg(section, 800, opts.locale),
    });
  }

  return { sheets, dxf: sheets.map((s) => s.dxf).join('\n') };
}

function conflictNote(c: OpenConflict, locale: string): string {
  const es = locale.startsWith('es');
  return es
    ? `CONFLICTO ${c.pairClass}: ${c.barIds[0]}/${c.barIds[1]} en elementos ${c.elementIds.join(',')} `
      + `— medido ${Math.round(c.clearance * 1000)} mm, requerido ${Math.round(c.required * 1000)} mm`
    : `CONFLICT ${c.pairClass}: ${c.barIds[0]}/${c.barIds[1]} in members ${c.elementIds.join(',')} `
      + `— measured ${Math.round(c.clearance * 1000)} mm, required ${Math.round(c.required * 1000)} mm`;
}

// ─── XLSX ───

/**
 * The bar schedule, as a sheet-per-assembly array of arrays.
 *
 * Marks, diameter, shape, cutting length, count, mass, member and joint references, lap
 * data, revision and maturity — all read off the model, none recomputed.
 */
export function renderSchedule(
  doc: DocumentModel, opts: RenderOptions,
): Array<{ name: string; aoa: (string | number)[][] }> {
  const es = opts.locale.startsWith('es');
  const L = (a: string, b: string) => (es ? a : b);
  const density = opts.steelDensity ?? DEFAULTS.steelDensity;
  const out: Array<{ name: string; aoa: (string | number)[][] }> = [];

  for (const a of doc.assemblies) {
    // The assembly's OWN marks, from `assignMarks`. Rebuilding them here would be a
    // second mark scheme that could disagree with the one on the drawings — the exact
    // drift the DocumentModel exists to prevent. A fused bar is already one mark of its
    // true cutting length because materialisation happened before marking.
    const marks = a.source.marks;

    const table = buildSchedule(marks, opts.stockLength ?? DEFAULTS.stockLength);
    // The schedule's title block is this assembly's own, so the sheet number, revision and
    // clause list on the spreadsheet match the ones on its drawings.
    const aoa = scheduleToAoa(table, buildTitleBlock({
      sheetNumber: `R${doc.revision.number}`,
      title: `${opts.projectName} — ${readinessBanner(doc, opts.locale)}`,
      assembly: a.source,
      clauses: doc.refs,
    }), opts.locale);

    // The references a fabricator needs to place the bar, appended to the standard table:
    // which members it belongs to, and which layer it sits in.
    const barById = new Map(a.bars.map((b) => [b.id, b]));
    const header = aoa.findIndex((r) =>
      typeof r[0] === 'string' && /^(marca|mark)$/i.test(String(r[0]).trim()));
    if (header >= 0) {
      aoa[header] = [...aoa[header],
        L('Masa (kg)', 'Mass (kg)'), L('Elementos', 'Members'), L('Capa', 'Layer')];
      for (let i = 0; i < marks.length; i++) {
        const row = aoa[header + 1 + i];
        if (!row) break;
        const m = marks[i];
        const first = m.barIds.map((id) => barById.get(id)).find(Boolean);
        const members = [...new Set(m.barIds
          .flatMap((id) => barById.get(id)?.ownerElementIds ?? []))].sort((x, y) => x - y);
        const area = Math.PI * (m.diameterMm / 2000) ** 2;
        aoa[header + 1 + i] = [...row,
          m.massKg > 0
            ? Math.round(m.massKg * 1000) / 1000
            : Math.round(area * m.cuttingLength * m.quantity * density * 1000) / 1000,
          members.join(', '),
          first?.layerId ?? ''];
      }
    }

    // Laps get their own block: the fabricator has to know a bar is spliced, not merely
    // that two bars exist.
    if (a.laps.length > 0) {
      aoa.push([]);
      aoa.push([L('EMPALMES', 'LAPS')]);
      aoa.push([L('Nudo', 'Joint'), L('Desde', 'From'), L('Hasta', 'To'),
        L('Tipo', 'Kind'), L('Clase', 'Class'), L('Longitud (mm)', 'Length (mm)')]);
      for (const l of a.laps) {
        aoa.push([l.jointId, l.fromBarId, l.toBarId, l.kind, l.spliceClass,
          Math.round(l.lapLength * 1000)]);
      }
    }

    aoa.push([]);
    aoa.push([L('Revisión', 'Revision'), doc.revision.number,
      L('Madurez', 'Maturity'), doc.maturity,
      L('Estado', 'Readiness'), doc.readiness]);

    if (doc.openConflicts.length > 0) {
      aoa.push([]);
      aoa.push([readinessBanner(doc, opts.locale)]);
      aoa.push([L('Conjunto', 'Assembly'), L('Barras', 'Bars'), L('Clase', 'Class'),
        L('Medido (mm)', 'Measured (mm)'), L('Requerido (mm)', 'Required (mm)')]);
      for (const c of doc.openConflicts.filter((x) => x.assemblyId === a.id)) {
        aoa.push([c.assemblyId, `${c.barIds[0]} / ${c.barIds[1]}`, c.pairClass,
          Math.round(c.clearance * 1000), Math.round(c.required * 1000)]);
      }
    }

    out.push({ name: a.id.slice(0, 31), aoa });
  }

  return out;
}
