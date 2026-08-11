# `rebar-3d.spec.ts` starvation — diagnosis, and the fix that has not been made yet

**Status:** diagnosed, NOT fixed. Captured here so the next pass starts from the measurement
rather than from the symptom.

## The symptom

Run the file whole and one test fails; run that test alone and it passes.

```
$ npx playwright test e2e/rebar-3d.spec.ts e2e/rebar-workspace-open.spec.ts \
    e2e/rebar-workspace-focus.spec.ts        # E2E_PORT=4293
  1 failed
    rebar-3d.spec.ts:319 › a whole building reports columns, beams, slabs and walls with their steel
  28 passed (8.6m)

$ npx playwright test e2e/rebar-3d.spec.ts --grep "a whole building reports columns"
  ✓ 1 passed (36.5s)
```

## What it is NOT

**Not a missing timeout.** All four heavy tests already declare a budget — lines 324, 362, 383
and 396 each carry their own `test.setTimeout`. Raising them further would hide the problem, and
is explicitly out of bounds.

**Not the fix from the last pass.** The `--st-*` token aliasing in `RebarWorkspace` changes no
geometry, no store and no timing; the same starvation is recorded in
`pr20-ui-and-workflow-plan.md` §5.4, written before any of it.

## What it is

Four tests in this file each pay a **complete** 7-storey setup: load a 203-member model, solve
it, design every member, coordinate the detailing, run the floor design, and build a scene of
about 21 000 tubes and 8 000 conflict markers. `workers: 1`, so they run one after another in the
same process, and the last ones run on a machine that has been at full tilt for minutes.

| Line | Test | Needs the building for |
|---|---|---|
| 324 | a whole building reports columns, beams, slabs and walls | **the whole journey** — this is the one to keep intact |
| 362 | turning columns off removes their STEEL as well as their concrete | a model with column steel |
| 383 | a family the model does not contain says so on its switch | a model missing at least one family |
| 396 | closed ties, crossties and joint ties are counted apart | a model with all three tie kinds |

Only line 324 is about the journey. The other three are **observers**: they open a prepared
workspace and assert what the rail reports.

## The fix, and the trap in it

Reuse the prepared state for the three observers, keep 324 as a full journey.

The trap is that "reuse" here means sharing a page, because the model lives in memory rather
than in storage — and 362 turns a layer switch OFF, which the store deliberately keeps across a
close/reopen (`rebar-workspace.svelte.ts`: "closing keeps the switches, reloading resets"). So a
naive shared page lets 362's toggle change what 383 and 396 observe. That is exactly the
cross-test coupling this must not introduce.

Two candidate shapes, in order of preference:

1. **Serialise the prepared project once, deserialise per test.** A worker-scoped fixture runs
   the chain once and captures the project through the production save path; each observer gets
   its own page and loads it. Independence is real — no shared object — and the expensive part is
   paid once. Needs an e2e hook pair for snapshot/restore, which does not exist yet; it must
   drive the same `file.ts` entry points the UI does, not write store state directly.

2. **Shared worker page plus an explicit reset.** Cheaper to write, and each observer must
   restore the view state it depends on in its own first line. Rejected as the default because it
   makes every future test in this file responsible for a contract it cannot see.

Whichever is chosen, the requirement stands: no force click, no widened timeout, no disabled
spec, one Playwright instance, `E2E_PORT=4293`.

## Also worth doing in the same pass

`rebar-viewport-cost.spec.ts` has the same shape and the plan document already measured it: 12,3
min for five 7-storey setups in one file. The fix is the same fix.
