# PR19 — readiness for review

**Branch:** `pr/19-rc-cad-constructibility` · **PR:** #90, **draft** · not merged, and nothing in
this document changes that. Taking it out of draft is Bauti's call after the manual QA below.

**Scope:** RC detailing made constructible and honest — the design outcome, the document it
produces, and the four projections of that document.

---

## 1. Features finished

| Area | What is done |
|---|---|
| Autosave | IndexedDB with revisions, structural fingerprint, unfinished-write marker, retention window, localStorage fallback reported as degraded rather than used silently. Written after every expensive operation, not only on the 30 s timer. |
| Restore | Banner, restore, re-solve, restore twice. The stored project contains the design. |
| Global design | Design-all across families; per-member outcomes; run summary. |
| Floor families | Slabs, walls, footings designed and detailed as families. |
| Provisional proposals | `PROVISIONAL_BIAXIAL`: the primary axis designed and verified by the ordinary search, the secondary axis declared unevaluated. Never certified, never counted as verified, never hidden. |
| 3-D viewer | Full-window workspace; columns, beams, slabs, walls, footings and pedestals; geometry batched per family × colour; selection of bars, solids and conflict markers; section plane; isolation; status filter; per-family tally. |
| Toggles | Six family switches plus reinforcement, concrete, conflict markers and hide-unreinforced. A switch is a visibility flag, never a rebuild. |
| Conflicts | 40 065 detected on the 7-storey building, classified, marked in 3-D, clickable, and carried into report, DXF and schedule. |
| Drawings | General plans, per-level plans, sections and column details. |
| Reconciliation | One document, four projections, cross-examined against each other rather than against a fixture. |
| Torsion warning | Beams carrying torsion no check evaluates are named on every surface that shows their steel. |
| Honest states | Seven element states with one shared not-for-construction list. |

## 2. Gates

Run at `HEAD` of this branch:

| Gate | Result |
|---|---|
| `npm run typecheck` | 490/490, no new errors |
| `npm run test:unit` | 276 files, 5444 tests, 0 failures |
| `npm run test:build` | 2 files, 8 tests |
| `npm run build` | clean |
| `E2E_PORT=4293 npx playwright test` | 198 passed, 4 skipped; see §9 for the one load-dependent failure |

`E2E_PORT=4293` is not optional locally: port 4173 is reused by another worktree's `vite preview`
and Playwright will silently adopt it, testing the wrong bundle. It has cost two debugging
sessions.

## 3. Limitations, stated

These are things the app does NOT do. Each is visible to the user rather than silent.

- **Torsion is not verified.** The CIRSOC 201 adapter declares `beams.torsion: false`. Beams
  with torsion above 0,1 kN·m are named in the viewer, the sheets, the report and the schedule
  with "TORSIÓN NO EVALUADA — función en desarrollo … se corregirá en PR21".
- **A beam's secondary bending axis is not verified.** Above a 10 % ratio the member becomes a
  proposal rather than a certified design.
- **Beams have no side-face bars** in the schema, the generator, the geometry, the drawings or
  the schedule, which is why a weak-axis check that failed would have no knob to turn. See
  `docs/audits/biaxial-beam-design.md`.
- **Columns' torsion is out of scope** of the warning: their transverse steel is detailed for
  confinement and their verification is a different unfinished story.
- **The 7-storey example has no footings.** The switch says "sin elementos en este modelo"
  rather than looking like a working switch that hides nothing.
- **Two nested scrollers are not allowed in the rail**; the member list does not scroll on its
  own, the rail does.

## 4. Provisional states — what a reader sees

| Surface | What it says |
|---|---|
| Design summary bar | `◐ N provisional`, beside `✗ fail` and never inside it |
| Design table row | violet `◐` badge with text, and its own row filter |
| Detailing sidebar / status panel | `PROVISIONAL` state row, violet dot |
| 3-D workspace | violet bars, a permanent banner while the model holds one |
| 3-D inspector | the member's state, plus the design's own sentence |
| Drawing sheets | first note: "PROPUESTA PROVISIONAL — NO APTO PARA EMISIÓN CONSTRUCTIVA" |
| Schedule | sheet-level line plus a per-row status beside the mark |
| Report | banner above the fold and a section naming every member |

The exception that produces this state is one predicate, `isKnownBiaxialLimitation`, with two
callers. It applies only when EVERY failing check is the biaxial one: a proposal that also fails
on flexure or shear stays FAILED.

## 5. Warnings carried

- provisional proposal (secondary axis unverified)
- torsion not evaluated
- unresolved conflicts, with counts by severity and a bounded worst-N list
- unreinforced members (concrete the app could not design), drawn in their own colour
- readiness / draft watermark on every export
- stale baseline, stale context
- autosave degraded to localStorage
- families present in the switch list but absent from the model

## 6. Decisions pending — for Bauti

1. **Fundaciones vs Dados.** Two separate switches, one per family, like everything else. The
   PR19 brief asked for "apagar Fundaciones oculta … dados". Merging them would make the Dados
   switch a dead control. Unchanged pending a decision.
2. **`design.counts.provisional` wording** — currently "provisorio"/"provisional". The 3-D
   surfaces say "Propuesta provisional".
3. **Whether the 7-storey example should ship with footings**, so the foundations switch has
   something to govern in the flagship demo.

## 7. Manual QA still owed

Nothing here is covered by an assertion that a human would not repeat.

- [ ] Open the 3-D workspace on the 7-storey building and switch each of the ten controls by
      hand. The counts are asserted; how it FEELS at ~4 s per family switch on a real GPU is not.
- [ ] Click a conflict marker, confirm the inspector names both bars and both members, and that
      "go back" walks the selection history.
- [ ] Cut a section on each axis and flip it.
- [ ] Read one drawing sheet, one schedule and the report end to end, looking for a sentence
      that reads wrong rather than one that is missing.
- [ ] Confirm the provisional violet and the unreinforced orange are distinguishable on your
      monitor.
- [ ] Reload mid-work and restore; confirm the banner text and that the layers come back at
      their defaults (documented policy, not a bug).
- [ ] Resize the window down to a laptop screen with both banners up.

## 8. Merge risk

Nine files are shared with PR125; eight are line-for-line colour substitutions and
`App.svelte` is a genuine structural clash. Seven RC components PR125 has never seen carry six
load-bearing colours that need tokens with their meanings intact. Full arithmetic and the
recommended order in `pr20-ui-and-workflow-plan.md`.

## 9. Known non-blocking issues

**A 7-storey setup solve can starve under accumulated load.** Five occurrences across four full
suite runs, never the same test twice, always `page.evaluate(solve)` on `pro-edificio-7p`,
always passing in isolation seconds later — the same test takes 37 s alone.

The suspected cause was the parallel solve falling back to solving every load case on the main
thread when the worker pool cannot be brought up. **That is now disproven.** The fixture records
the fallback warning and the setup solve has a deadline of its own, and the occurrence it caught
reported: solve unfinished, *parallel solve fell back to sequential: **no***. The worker pool was
up. The solve was simply that slow on a machine that had spent the previous ten minutes on the
cost spec.

So it is environmental saturation, not a product fault and not a fallback — and the evidence for
that statement now exists rather than being inferred. The deadline is calibrated at 480 s: below
the 900 s these specs allow themselves, so a genuine hang fails in half the time and says why,
and above the measured worst case so it does not fire on load alone.

**Nothing was loosened to reach a green run.** The measurement budgets are untouched, no spec is
disabled and no click is forced. The remaining fix is structural: the suite performs about
thirteen full 7-storey chains (load → solve → design → detail → floor-design), five of them in
`rebar-viewport-cost.spec.ts` alone. Cutting that means reusing prepared state across tests,
which risks both coverage and inter-test independence, so it is a pass of its own rather than
something to improvise. Until then, expect roughly one load-dependent failure per full local
run, always reproducible-green in isolation.

Structural fix, deliberately not attempted here: the suite runs ~13 full 7-storey chains. Cutting
that is a spec refactor with a real risk of reducing coverage, and belongs to its own pass.

## 10. Not-for-construction behaviour

The app never presents unverified work as finished. Concretely: a proposal cannot hold a
certificate or be counted as verified; a member the design refused is drawn in its own colour
rather than omitted; a conflicted floor still exports, because the conflicts are the thing the
reviewer needs to see; every export carries its readiness; and `NOT_FOR_CONSTRUCTION_STATUSES`
is one list read by the viewport legend, the sheets, the schedule and the report, so the claim
cannot be true on one projection and forgotten on another.

## 11. Explicitly out of scope

**PR20** — PR125 integration, navigation, layout, accessibility, design workflow, viewer polish,
results, panels, visual consistency.

**PR21** — real biaxial design, conflict audit and resolution, torsion, crossties, remaining
engineering.

**Never touched in PR19** — Rust, Cargo, WASM, the solver, global analysis, load generation, the
biaxial threshold, the crosstie rule, torsion authority, the collision set, marker tessellation,
incremental GPU upload, V1, the golden fixtures, Landing and Basic/Education.
