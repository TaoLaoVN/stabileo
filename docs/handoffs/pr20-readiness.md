# PR20 — readiness

**Status: NOT ready to leave draft.** Not because a gate is red, but because two things this
document names have not been done: manual QA of the redesigned workflow, and the localisation of
423 Spanish strings the engine renders to every user in every language.

Branch `feat/pro-visual-system`, PR #125, at `64c28f81`.

---

## 1. Gates

Run in sequence on one machine, no two suites in parallel.

| Gate | Result |
|---|---|
| typecheck | ✅ 479 errors against a baseline of 490 — **no new type errors** |
| unit suite | ✅ no failures |
| build tests | ✅ 14 |
| production build | ✅ 14,58 s |
| smoke | ✅ 152 / 152 (measured `5cb9088d`) |
| ded-roundtrip · project-restore · tab-reactivation · rebar-3d · viewport-cost | see the suite below — all five are in it |
| full Playwright suite, once | **328 passed · 3 failed · 4 skipped · 1 did not run · 34,6 min** |

**Typecheck baseline debt.** 479 reported against a baseline of 490. The eleven that no longer
report are inherited, not fixed by this branch, and the baseline is deliberately NOT re-recorded
here: lowering it is a change whose diff deserves its own review, and doing it inside a test pass
would hide which errors went away and why.

---

## 2. The clean run, and how each failure is classified

The categories the brief asked for, applied honestly:

| Class | Meaning |
|---|---|
| **producto** | the application is wrong |
| **test obsoleto** | the test describes a surface that has since moved |
| **infraestructura** | the harness or the environment, not the app |
| **saturación** | the app and the test are both fine; the machine was not |
| **screenshot** | a pixel difference from font/antialiasing |

### The clean run at `64c28f81`

Started only after the load average fell below 6; the machine still drifted to 6–9 during it, which
is visible in the one heavy failure.

| # | Test | Class | Evidence |
|---|---|---|---|
| 1 | `ded-roundtrip › the 7-storey project survives the file` | **saturación** | `the solve did not finish in 480 s`, worker pool UP, no fallback. The same solve is ~9 s idle, and this spec passed at 5/5 twice earlier in the session. |
| 2 | `landing › the embed is rendered at native size` | **infraestructura (flake)** | `pointer y offset expected ≤3, received 7`. **Re-run in isolation: passes in 19,2 s.** Landing was never touched by this branch. |
| 3 | `rc-design-visual › overlay legend` | **screenshot** | 696→697 px, 645 px differing — the identical signature recorded below. |

Nothing classified as **producto** and nothing as **test obsoleto**.

### Standing classification, from repeated measurement across this session

| Test | Class | Evidence |
|---|---|---|
| `rc-design-visual › overlay legend` | **screenshot** | 696→697 px, 645 px differing, ratio 0,03 — byte-identical signature across five runs, including a run with every change of this session stashed. The three English strings it renders (`design.overlay.*`) were never edited: `git diff` shows zero removals from `en.ts`. Its describe block is titled "(non-blocking)". Its sibling test is `mode: 'serial'`, so it also reports "1 did not run". |
| `rc-design › B15` | **saturación** | 4,0 s in isolation; >60 s under a loaded worker. Measured directly: 150 smoke tests → 1 failure, 139 → 0. The `@smoke` footprint of the new language tests was trimmed for exactly this reason, and smoke then measured 152/152. |
| `ded-roundtrip` (7-storey), `project-restore`, `tab-reactivation` (7-storey), `rebar-3d` journey | **saturación** | All fail with one signature: `page.evaluate` on the 7-storey solve exceeding its budget, with the worker pool UP and no fallback. The same solve is ~9 s on an idle machine. Each has passed on a calm machine in this session — `rebar-3d` + `viewport-cost` at 34/34 in 8,4 min with load ≈ 4, and the same pair failed at load ≈ 10. |

**Why "saturación" is not a euphemism here.** `fixtures.ts` documents the measurement that
established it: a 7-storey solve that takes about ten seconds idle exceeded FOUR MINUTES on a
worker that had been busy for ten, with the parallel pool up and no fallback to the sequential
solver. It is a real, known fragility of this suite on a contended machine, and it is the reason
`prepared-building.ts` exists — the observers no longer solve at all. What remains is the handful
of specs that legitimately must solve.

**A measurement hazard worth recording.** Two runs in this session were invalidated by contention
the operator could not see: a zombie `vitest` worker pool at 478 % CPU competing with Playwright,
and a stretch at load average 25 on a 14-core machine caused by processes outside this work. Any
timing-sensitive result taken during those is worthless. The run reported above was started only
after the load average fell below 6.

---

## 3. Text that is still not localised

**423 Spanish literals across 21 files** in `lib/engine/detailing`, reaching real surfaces in
every language. This is the largest remaining gap in PR20 and it is NOT fixed.

| Literales | Archivo | Superficie donde se ve | Ejemplo |
|---:|---|---|---|
| 54 | `document-render.ts` | Sheet notes, report sections, DXF annotation | «PARA REVISIÓN — NO APTO PARA CONSTRUCCIÓN…» |
| 44 | `generate-beam.ts` | Bent-up-bar refusals → assembly notes, sheet notes | «anclaje doblando la armadura dentro del alma…» |
| 43 | `footing-flexure.ts` | FootingMatPhysicalPanel → «Memoria de la geometría» | «momento externo en una sección por un plano vertical…» |
| 39 | `generate-column.ts` | Assembly notes | «La cantidad de barras pasa de ${lo.bars.count} a ${hi.bars.c…» |
| 36 | `foundation-check.ts` | Foundations panel findings | «resistencia a corte en una dirección…» |
| 31 | `footing-dowel-cage.ts` | Footing CAD handoff notes | «transmisión de fuerzas por armadura en la interfaz columna-b…» |
| 29 | `punching-shear.ts` | Footing panel → «Punção» steps; floor design notes | «secciones críticas para corte en dos direcciones…» |
| 24 | `beam-top-steel.ts` | Top-steel notes → status panel chip, schedule | «cada doblez del estribo debe contener una barra longitudinal…» |
| 20 | `wall-design.ts` | Walls table notes | «límites de la armadura en tabiques…» |
| 17 | `floor-design.ts` | Floor run unsupported list | «transmisión de fuerzas por armadura…» |
| 16 | `slab-design.ts` | Slabs table notes | «toda la carga se transmite en la dirección corta, se diseña …» |
| 15 | `drawings.ts` | Drawing labels/notes | «${provisionalMembers.length} elemento(s) de esta lámina (${p…» |
| 12 | `footing-mat-geometry.ts` | FootingMatPhysicalPanel → geometry.steps | «recubrimiento mínimo del hormigón colado en contacto con el …» |
| 10 | `run-detailing.ts` | Skip reasons, coordination notes | «${j.jointId}\|${la < lb ? la : lb}\|${la < lb ? lb : la}…» |
| 9 | `footing-mat-anchorage.ts` | FootingMatPhysicalPanel → anchorage.*.steps | «el anclaje de la armadura debe cumplir con el Capítulo 25…» |
| 7 | `coordinate-floor.ts` | Floor coordination notes | «${initial} conflicto(s) detectado(s); se intenta la escalera…» |
| 5 | `floor-transverse.ts` | Floor transverse notes | «armadura de corte mínima en losas…» |
| 4 | `structure-drawings.ts` | Structure drawing labels | «Corte horizontal en z = ${atZ.toFixed(2)} m — ${cut} barra(s…» |
| 3 | `classify.ts` | Classification notes | «separación máxima de la armadura transversal a lo largo del …» |
| 3 | `assembly.ts` | Assembly migration notices | «Hay elementos que no superan su verificación individual.…» |
| 2 | `splice.ts` | Bar schedule / detail memo (mostly EngineMessage already) | «longitud de empalme por yuxtaposición en tracción…» |

**Total: 423 literales en 21 archivos.**

**Why they were not extracted.** Every one of them is inside the detailing engine or an authority
module. Moving them to keys means editing the files that compute punching shear, splice lengths,
bent-up-bar admissibility and footing flexure — the modules this pass was explicitly told not to
touch, and the ones whose output the 114-verified / 5-provisional result depends on. A mechanical
extraction across 21 calculation files is not a translation task; it is an engine refactor, and it
deserves its own PR with the engine's own tests as the gate.

**What WAS extracted, because it was safe.** The five calculation-memo titles — Flexure, Shear,
Flexo-compression, Torsion, Biaxial (Bresler) — are labels `getCodeDetail` assembles in a
transitional adapter, not text a CIRSOC adapter produced and not a formula. They now carry a
`titleKey` alongside the unchanged `title`, and the panel prefers the key. `title` is byte-identical
so every other consumer is untouched.

**What is already correct.** `lib/codes` and `lib/engine/loads` are pure: they emit
`{ key, params }` and `engine-text.ts` renders them at the boundary. `engine-purity.test.ts` now
requires those keys in all three offered locales, which closed 62 of them in this session.
`splice.ts` is largely on that path already (5 of its strings are `msg()`).

**So the honest statement about the three languages** is: the PRO *interface* is complete in
English, Spanish and Portuguese — 894 keys were added and a gate enforces it — and the *calculation
memos and document notes generated by the detailing engine are Spanish-only, whatever language the
interface is in*. Both halves are true and the second one is not a detail.

---

## 4. What still needs a human

- **Manual QA of the redesigned workflow.** The UX pass was audited with screenshots and is covered
  by 12 assertions, but hierarchy, density and "does this read as one product" are judgements a
  test cannot make. Specifically: the stage strip across a full project; the enlarged sheet dialog
  with a large real drawing; the 3-D viewer at 1280×720; and the three languages side by side.
- **The `.ded` of a 7-storey project**, saved and reopened by hand. It is covered end to end by
  `ded-roundtrip.spec.ts` at 48,0 MB, but this is a data-export path and deserves one human look.
- **Whether a transient toast may cover the primary commands** at the smallest supported width.
  Observed, deliberately not patched — it is a design decision.
- **The 1 px snapshot.** Update it in a commit of its own, after someone confirms by eye that the
  legend is unchanged. It was not updated automatically at any point in this work.

---

## 5. Debt, by where it lives

**Localisation** — the 423 above. Plus: the eleven unoffered dictionaries remain ~790 keys behind
(nothing renders them; `OFFERED_LOCALES` is a single edit away from re-enabling one).

**Suite fragility** — the 7-storey solve under contention. The starvation fix removed nine of the
thirteen full setups; what remains is irreducible without giving up coverage.

**Coverage** — 167 of the 413 RC-surface test ids are still referenced by nothing
(`pr20-pro-design-matrix.md`). The riskiest named there are `cmd-cancel`, `footing-delete` (deletes
without confirmation) and the entire conflict inspector, which is also unreachable by keyboard.

**UX** — the counts strip is still an undifferentiated monospace line; the stage strip wraps at
1280×720 with a dangling chevron; the sheet `<fieldset>` keeps a native legend border.

**Still experimental, and labelled as such in the product** — provisional-biaxial proposals, the
torsion notice (deferred to PR21), and the CAD handoff, which states in its own words that its
output is a semantic handoff and not a drawing.

---

## 6. Recommendation

**Keep PR20 in draft.** Nothing found in this pass is a product defect, and every gate that can be
run without a human is green on a quiet machine. What is missing is not a fix — it is a judgement
(the manual QA) and a piece of work that was correctly refused (the engine's 423 strings, which
cannot be extracted without editing calculation modules that were out of bounds).

The two things that would change this recommendation, in order:

1. A person walks the redesigned workflow once, in all three languages.
2. A decision on the 423: extract them in a dedicated engine PR, or accept Spanish-only calculation
   memos and say so in the product rather than in a handoff document.
