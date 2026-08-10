# PR20 — UI and workflow: a plan, and the merge arithmetic behind it

**Status:** plan only. No PR20 code exists. Nothing in this document has been implemented, and
PR19 must be reviewed, taken out of draft and merged before any of it starts.

**Written from:** PR19 at `6e6bc95c` (branch `pr/19-rc-cad-constructibility`), and PR125
(`feat/pro-visual-system`) as it stood when this was written — 36 files, +1 204 / −1 204, draft,
targeting `feat/app-visual-system` (#124) rather than `main`.

---

## 1. What PR125 actually is

Two things in one draft, and they carry very different risk.

**A palette migration that is mechanical.** Eight of the nine files PR125 shares with PR19 are
`+N/−N` with N identical on both sides — a line-for-line substitution of colour literals for
tokens. Nothing moves; each edited line is replaced in place.

**A shell proposal that is structural, and explicitly open to argument.** Its own description
says so: a grouped tab rail inside the panel, a pipeline strip under the command row, a
quick-access block, a resizable panel. Only the palette slice is described as testable today.

The distinction matters because it decides the order of work: the first half can be absorbed
almost mechanically, the second half is a design conversation that has not happened yet.

## 2. The merge arithmetic

Nine files are touched by both. Measured, not estimated — PR19 against its merge base
`4a8e6b5e`, PR125 from the GitHub API:

| File | PR19 | PR125 | Shape of the risk |
|---|---|---|---|
| `App.svelte` | +76 / −13 | +44 / −10 | **The only structural clash.** Both sides add and remove. |
| `pro/ProPanel.svelte` | +7 / −0 | +62 / −62 | Additive vs substitution — low |
| `pro/ProDesignTab.svelte` | +44 / −1 | +9 / −9 | Low |
| `pro/ProAutoLoadsDialog.svelte` | +4 / −1 | +38 / −38 | Low |
| `design/DesignToolbar.svelte` | +22 / −0 | +30 / −30 | Low, but see §3 |
| `design/DetailingWorkflow.svelte` | +32 / −0 | +18 / −18 | Low |
| `design/FoundationsPanel.svelte` | +50 / −5 | +7 / −7 | Low |
| `design/FootingMatPanel.svelte` | +26 / −18 | +7 / −7 | Medium — both sides delete |
| `design/FloorFamiliesPanel.svelte` | +15 / −6 | +10 / −10 | Low |

PR19 also ships components PR125 has never seen — `RebarWorkspace`, `RebarViewport3D`,
`RebarLayersPanel`, `RebarStatusPanel`, `SelectionDetails`, `ProvisionalBanner`,
`TorsionBanner`. They carry **hard-coded hex colours** and will not be tokenised by PR125's
sweep, because that sweep ran before they existed. That is the largest *silent* integration
gap: not a conflict, a divergence. After PR125 lands, the 3-D workspace would be the only
surface in PRO still speaking the old palette.

### Colours PR19 introduced that need a token, with their meaning

These are load-bearing: each already means one thing across several surfaces, and the migration
must preserve the mapping rather than pick the nearest hue.

| Hex | Meaning | Where it appears |
|---|---|---|
| `#a066d3` | provisional proposal | 3-D bar colour, workspace banner, status dot, `summary-count-provisional` chip |
| `#d4762a` | unreinforced / refused | unreinforced concrete, status dot, torsion banner border |
| `#ff2d55` | conflict marker | 3-D marker instances |
| `#e0444a` | conflicted bar | 3-D bar colour, `failed` status dot |
| `#ffd400` | selection | highlight ring, selected member row |
| `#4caf72` | modelled | status dot |

## 3. What PR19 changed under PR125's feet

Two edits landed in files PR125 rewrites, and both are additive markup rather than restyling:

- `DesignToolbar.svelte` gained a `summary-count-provisional` chip (`◐ N provisional`,
  `.c-prov { color: #a066d3 }`). PR125 rewrites every colour declaration in that file, so the
  new rule must be migrated with the rest and not left behind as the one literal in a tokenised
  stylesheet.
- `DetailingWorkflow.svelte`, `FoundationsPanel.svelte` and `ProDesignTab.svelte` gained
  controls and panels around the RC workflow.

None of it should produce a semantic conflict. All of it will produce a textual one if the
branches are merged in the wrong order.

## 4. Recommended integration strategy

**Order.** `#124` → `#125` → PR19 → PR20. PR125 already targets #124; PR19 is the larger and
more finished branch, and rebasing a 36-file colour substitution onto it is far cheaper than
rebasing PR19's engine and detailing work onto a moving shell.

**A caveat on that order.** It means PR125 pays the conflict cost. The alternative — PR19 first
onto main, then PR125 rebased — is the same total work and puts it on the branch better able to
absorb it, because a colour substitution can be re-derived by re-running the sweep. If PR125's
author still has the generator (`web/.pro-audit.mjs` is in its file list), **re-running the
sweep after PR19 lands is strictly better than merging it**: it picks up PR19's new components
for free and eliminates every conflict in the table above.

That is the single most valuable thing to establish before starting PR20: *is the palette
migration reproducible, or is it a hand-edited diff?* If reproducible, §2's whole table stops
being a risk.

**Split PR125 in two before integrating.** The palette slice can land behind a review that is
mostly mechanical. The shell proposal (tab rail, pipeline strip, quick access, resizable panel)
should be its own PR with its own argument, because it changes navigation for every PRO user
and PR19 has just added a full-window overlay that interacts with it (see §5).

## 5. PR20's own work, in order

### 5.1 Navigation and layout

PR125 proposes moving PRO's 13 tabs out of the command row and into a rail inside the panel.
PR19 adds a **full-window 3-D overlay** (`RebarWorkspace`, `z-index: 900`, `position: fixed`)
reached from the detailing panel. The two need one decision: is the workspace a fourteenth
destination in the rail, or an overlay that escapes the shell entirely? It is currently the
latter, deliberately — the sidebar's fixed pixel width is what made the old in-panel viewer
unusable — and the rail proposal must not quietly re-nest it.

The pipeline strip (`MODEL ✓ · SOLVED ✓ · DEMANDS ✓ · CODE CHECK ⚠ · DESIGN — · DETAILING —`)
is the highest-value item in PR125's proposal and the one PR19 makes most useful: the RC
pipeline now has real, distinguishable states at every stage.

### 5.2 Accessibility

Not audited in PR19 and not free. Known gaps introduced or inherited:

- the 3-D workspace is `role="dialog" aria-modal="true"` with **no focus trap and no focus
  restore**; Escape closes it, which is the only keyboard affordance it has;
- the layer switches are real checkboxes with labels — good — but the rail has no landmark and
  no heading structure a screen reader can navigate;
- the canvas has no text alternative and no keyboard route to selection, so every inspection
  gesture is pointer-only;
- colour is currently the ONLY carrier of several distinctions (provisional violet, conflict
  red, unreinforced orange). The banners and the status rows carry text, the 3-D geometry does
  not.

The last one is a real WCAG 1.4.1 failure in the viewport and the honest fix is not a palette
change; it is that the *panel beside the picture* must always be able to answer what a colour
says. Today it can, via the tally and the inspector — which is worth stating as a design rule
before someone removes them.

### 5.3 Design workflow

One inconsistency found during PR19's audit and deliberately **not** fixed there, because it
belongs here:

> A `PROVISIONAL_BIAXIAL` member displays as **`fail`** in the summary bar and in the row
> status, because `getDisplayStatus` verifies the steel actually written to the member and the
> authoritative verifier refuses it on the biaxial check — by construction, every time.

Per-row the design table is honest (each carries a provisional badge and has its own filter),
and the run cluster now names them (`◐ N provisional`, added in PR19). But the aggregate still
reads `✗ N fail` beside it. Whether `DisplayStatus` should gain a `provisional` value is a UI
decision with a wide blast radius — the 2-D and 3-D viewport colour maps, `getStatus`,
`getMaxRatio` and every row filter read it — which is why PR19 reported it instead of changing
it. **This is the first thing to decide in PR20's workflow slice.**

### 5.4 Viewer

PR19 leaves the viewer functional and measured. What PR20 should pick up:

- **A family switch costs seconds on the E2E runner** — about 4 s on the 7-storey building with
  39 240 conflict markers visible, about 0,8 s with them off. That is fill rate, not
  tessellation, and the file's own benchmark says so. It is inside the range already measured
  for a working toggle, and it is the cost of the switches actually working. Any further gain
  needs a decision that PR19 was told not to take (marker tessellation, incremental GPU upload).
- `rebar-viewport-cost.spec.ts` now takes 12,3 min instead of 6,6 because the switches do real
  work. Every test passes; two of them starve when the whole file runs on a loaded machine. The
  fix is to stop paying for five full 7-storey setups in one file, not to loosen a budget.
- The rail is a scrolling sidebar whose sections keep their own height (fixed in PR19 after a
  section was crushed to zero). Any new banner above the body eats rail height; the invariant is
  now guarded by a test, but the header is the thing to watch.

### 5.5 Panels and visual consistency

After PR125, run one audit pass over the RC surfaces it never saw (§2 table) and migrate them
with the meanings intact. The six colours listed there are the contract; the hexes are not.

## 6. Risks, ranked

1. **PR125 is a hand-edited diff rather than a re-runnable sweep.** Turns a mechanical
   integration into 36 files of manual conflict resolution and leaves PR19's components
   untokenised. *Establish this first — it changes the whole plan.*
2. **`App.svelte` structural conflict.** The one file where both sides add and remove. Resolve
   by hand, with both branches' tests green before and after.
3. **The tab rail re-nesting the 3-D workspace.** Would undo the reason the overlay exists.
4. **Palette migration flattening a meaning.** Violet-for-proposal and orange-for-unreinforced
   are used across four surfaces each; a nearest-colour rule that maps them onto one token
   destroys a distinction the whole honest-status effort exists to make.
5. **Accessibility treated as a styling pass.** The keyboard and focus gaps in the overlay are
   structural and will not be fixed by tokens.

## 7. Explicitly out of scope for PR20

Carried forward from PR19's constraints and unchanged: the Fundaciones/Dados switch
relationship, the biaxial threshold, the crosstie rule, torsion authority, the 40 065
collisions, marker tessellation, incremental GPU upload, Rust, Cargo, WASM, the solver, Landing,
Basic/Education, V1 and the golden fixtures.
