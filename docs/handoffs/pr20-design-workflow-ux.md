# PR20 — the concrete design workflow, audited and reordered

**What this pass changed:** the panel now states the pipeline instead of implying it. What it did
NOT change: any geometry, any state machine, any CIRSOC authority, any batching, and no number the
engine produces.

---

## 1. The audit, and how it was done

Screenshots of every surface at **1280×720** — the smallest size PR20 claims to support and the
size the defects show at — driven through the real workflow. Reading the markup would not have
found most of these; three of them are invisible in the source and obvious in a picture.

### What the pictures showed

| # | Surface | Problem | Fixed |
|---|---|---|---|
| 1 | Design tab, top | Three collapsed disclosures and six commands, in **no stated order**. A newcomer inferred the pipeline from which buttons were grey. | ✅ workflow strip |
| 2 | Command row | Six buttons wrapping onto three lines, all the same weight, with a **read-out** (`Concrete code: CIRSOC 201`) inline among them as if it were a seventh control. | ✅ three named groups; read-out on its own line |
| 3 | Command row + Families | **Two buttons labelled "Design all"** with different scopes — the frame, and whichever families are ticked. | ✅ renamed + scope stated on both |
| 4 | Command row | "Generate detailing automatically after a successful design" floated between the commands and the counts, belonging to neither. | ✅ moved into the DETAIL group, beside the command it governs |
| 5 | Detailing panel | **Horizontal overflow**: state pills and the sheet clipped on the right, with no scrollbar to reach them. Cause: a `1fr` grid track cannot shrink below its content, and the `@media (max-width: 800px)` fallback asks about the WINDOW while the panel is ~540 px. | ✅ `minmax(0, 1fr)` + a container query |
| 6 | Detailing panel | The sheet preview was a **clipped thumbnail** with no title: which assembly, which level, which kind of sheet were all unstated. | ✅ caption + `⤢ Enlarge` into a full-window dialog |
| 7 | Detailing panel | No empty state: with no sheet selected the area was simply blank. | ✅ explicit empty state |
| 8 | Floors section | Sat beside "Coordinated detailing" as a peer, with nothing saying it is **optional** or that it runs **before** detailing. | ✅ `optional step` tag + a sentence saying when to run it |
| 9 | 3-D viewer | Its own palette (`#141a23`, `#232a35`, `#1e2733`), its own heading weights, native form controls — which is why it read as another program docked inside Stabileo. | ✅ moved onto `--st-*`; headings unified |
| 10 | Everywhere | Toasts land on the command row at 1280×720. | ⚠️ observed, not fixed — see §5 |

---

## 2. The recommended order, and why it is the order

The strip states it, so the interface and this document cannot disagree:

```
1 Model  ›  2 Demands  ›  3 Code check  ›  4 Design  ›  5 Detailing  ›  6 Documents
```

- **1 Model** — load or draw, then solve. Everything downstream reads the results.
- **2 Demands** — per-station envelopes. The checks read these, not the raw results.
- **3 Code check** — establishes the baseline the certificates are stamped against.
- **4 Design** — the frame (`Design all`), and optionally **slabs, walls and foundations** as a
  separate step for buildings that have shells.
- **5 Detailing** — coordinates the bars the design produced into assemblies.
- **6 Documents** — drawings, schedule, report and the 3-D view are four projections of ONE
  document instance. That is why they are one stage and not four.

**Why floors stayed a separate section** (Phase 4 asked the question explicitly). Three options
were on the table: fold it into detailing, keep it separate with an explanation, or make it an
explicit later stage. It stays **separate, explained, and placed before detailing**, because:

- a frame-only building never needs it, and folding it into detailing would make every project
  step through a stage most do not use;
- it is not an alternative to `Design all` — it designs a different set of families, and the two
  compose; the copy now says exactly that;
- it must precede detailing, because detailing coordinates whatever bars exist when it runs.

The tag on the section header and the sentence inside it carry that; the strip does not show it as
a seventh step precisely because it is conditional, and a step that most projects skip would make
the pipeline read as longer than it is.

---

## 3. What was redesigned

**The workflow strip** (`WorkflowStages.svelte`) — six numbered stages, each `done` / `current` /
`blocked`, with the instruction for the current one underneath in words. It is derived from the
same state the commands gate on, so a stage cannot claim work is finished while the command that
does it is still lit. Clicking a stage **navigates** — opens the disclosure that owns it — and
never runs anything, so it cannot become a second command surface. Order, glyph and word are three
separate channels, so nothing here depends on colour.

**The command row** — three groups named `1 · Verify`, `2 · Design`, `3 · Detail`, matching the
strip's vocabulary, with a hairline between them that survives wrapping.

**The detailing panel** — the grid can shrink, the schedule scrolls itself, the sheet has a
caption and an enlarge control, and there is an empty state that explains what to pick.

**The enlarged sheet** — a full-window dialog rendering **the same `sheetSvg`** the preview shows.
No second renderer: what you enlarge is what the DXF and the report carry. The scroll is the pan,
so the drawing keeps its own size rather than being scaled into illegibility. Focus is captured
and restored by the same helper the 3-D workspace uses, and Escape closes it.

**The 3-D viewer chrome** — surfaces, hairlines, buttons, focus rings and heading hierarchy now
come from the design tokens. The **state colours were deliberately left alone**: violet for a
proposal, orange for unreinforced, red for a conflict are load-bearing meanings, and the plan
document warns specifically against nearest-matching them onto a generic accent.

---

## 4. What stayed the same, on purpose

- Every calculation, state machine, threshold and authority. This was a UX pass.
- The 3-D overlay stays an **overlay** rather than becoming a fourteenth panel tab: the panel's
  fixed pixel width is what made the old in-panel viewer unusable.
- The status/piece/family colour semantics in the viewer.
- The detailing store's structure, the document model, and every export.

---

## 5. Debt, and what is still experimental

- **Toasts cover the command row at 1280×720.** They auto-dismiss, so it is seconds of a covered
  button rather than an unreachable one, and `pro-design-gates.spec.ts` waits them out rather than
  hiding the fact. Whether a transient notice may cover the primary commands at the smallest
  supported width is a design decision, not a defect to patch quietly.
- **The counts strip** (`8 members ✓8 verified ⚠0 warning …`) is still a dense monospace line.
  It is honest and complete; it is not yet *grouped*.
- **The workflow strip wraps to two lines** at 1280×720 with all six stages. Legible, but the
  chevron after the last stage on a wrapped line dangles.
- **The `<fieldset>Sheet</fieldset>`** keeps a native legend border, which is the one control group
  in the panel that does not match the others.
- **The assemblies column** still wraps its level label awkwardly at narrow widths.
- **Still experimental, and labelled as such in the product:** the provisional-biaxial proposals,
  the torsion notice (PR21), and the CAD handoff, which states in its own words that its output is
  a semantic handoff and not a drawing.

---

## 6. Tests

`e2e/pro-design-workflow.spec.ts` (12): the strip renders six stages in order; an empty project
marks the first current and the rest not-done; the stages advance as work is done and the hint
follows; a stage navigates without solving or designing; the command row is three named groups and
the read-out is outside them; the two Design buttons no longer share a label and each states its
scope; the auto-detailing preference sits inside the group of the command it governs; the optional
stage says it is optional; **nothing overflows the detailing panel at 1280×720** (measured as
`scrollWidth ≤ clientWidth`, not eyeballed) and every export button stays inside the panel; the
sheet has a caption, a readable preview, and an enlarge dialog that is `aria-modal`, bigger than
the preview, reachable by scroll rather than cropped, backed by exactly one `<svg>` from the same
source, closed by Escape with focus restored to the control that opened it; and the strip names
every stage and its instruction in **English, Español and Português**.

---

## 7. Second pass: one shape for every stage

The first pass fixed the pipeline's *legibility* — a strip, grouped commands, a readable sheet. It
left the sections themselves as they were: three identical grey `<summary>` bars and one section
with no header at all. Nothing on them said what the section was FOR, whether it had run, or where
it sat in the order, so the tab still read as four small applications stacked vertically.

`StageSection.svelte` is the repeatable shell every stage now uses:

| Slot | What it carries |
|---|---|
| marker | the step number, or `✓` once the stage is done |
| title | the stage's name |
| state | a **glyph and a word** — `done` / `now` / `waiting` / `optional` — never colour alone |
| purpose | one sentence saying what the stage is for, replaced by the missing requirement while it is blocked |
| badge | a count worth seeing without opening — assemblies, footings |
| attention | a warning chip, which is never green |

It runs nothing. A stage's primary action lives in its own body, beside the things it acts on; a
shell that also held buttons would put every command two owners away from its context and compete
with the command row.

**Order changed.** "Slabs, walls and foundations" moved ABOVE "Coordinated detailing". It is
optional and it must run BEFORE detailing when the building has shells, and it used to sit after
it — so reading order contradicted execution order. Its position now says what its copy says.

**A numbering clash, introduced and removed.** The command groups were labelled `1 · Verify`,
`2 · Design`, `3 · Detail` in the first pass. Once the sections carried their own numbers (1, 4,
5) the screen showed two different numbering schemes at once. The group labels lost their numbers;
the sections keep theirs, because they are the ones the strip counts.

### Still open after this pass

- The counts strip is still an undifferentiated monospace line.
- The workflow strip wraps to two lines at 1280×720, leaving a dangling chevron.
- Toasts still land on the command row at that width.
- The detailing panel is a review screen in structure — summary, conflicts, sheet, exports — but
  its conflict list and its sheet still share one column rather than being ranked.
- The 3-D viewer's chrome is on the tokens; its rail is not yet grouped by family.
