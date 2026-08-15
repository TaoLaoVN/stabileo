# Handoff → Diego: the base needs its WASM bindings regenerated

**What is needed:** run `npm run wasm` on `pr/19-rc-cad-constructibility` and commit the four
generated files. No Rust to write — the code is already there and correct.

**Why it is yours and not PR20's:** PR20 touches no Rust, no Cargo, no WASM and no bindings, and
that constraint has held for the whole branch. Regenerating another branch's build artefacts from
inside PR20 would put a WASM rebuild in a PR whose premise is that it contains none, and would
leave the base still broken for anyone else who branches from it.

---

## The defect

`web/src/lib/engine/wasm-solver.ts` on the base calls two exports that its own committed bindings
do not expose:

```
wasm-solver.ts(220,43)  analyze_section_torsion_field   → bindings offer analyze_section_torsion
wasm-solver.ts(221,41)  analyze_section_shear_field     → bindings offer analyze_section_shear
```

Introduced by **`743e11ef`** — *"fix(web): PR124 review follow-ups — keyboard crash, per-tick
re-solves, picker thumbnails"*, 2026-08-10. The call sites landed; `npm run wasm` did not.

## The Rust is fine

`engine/src/lib.rs` declares both, each behind `#[wasm_bindgen]`:

```rust
#[wasm_bindgen]
pub fn analyze_section_torsion_field(json: &str) -> Result<String, JsValue>

#[wasm_bindgen]
pub fn analyze_section_shear_field(json: &str) -> Result<String, JsValue>
```

So this is **stale generated glue**, not missing functionality and not a solver problem. It fails
at the type level, before any number is computed. There is no evidence of a mathematics defect and
none of a regression from PR20.

## Files that need regenerating

| File | Has the two exports? |
|---|---|
| `web/src/lib/wasm/dedaliano_engine.d.ts` | ❌ 0 of 2 |
| `web/src/lib/wasm/dedaliano_engine.js` | ❌ 0 of 2 |
| `web/src/lib/wasm/dedaliano_engine_bg.wasm.d.ts` | ❌ 0 of 2 |
| `web/src/lib/wasm/dedaliano_engine_bg.wasm` | binary — stale with the rest |

## What to do

```bash
git checkout pr/19-rc-cad-constructibility
cd web && npm run wasm

# The two exports must now be present in all three text bindings:
grep -c "analyze_section_torsion_field\|analyze_section_shear_field" \
  src/lib/wasm/dedaliano_engine.d.ts \
  src/lib/wasm/dedaliano_engine.js \
  src/lib/wasm/dedaliano_engine_bg.wasm.d.ts     # expect 2, 2, 2

npm run typecheck          # expect: no new type errors
```

Then commit **only** the four files under `web/src/lib/wasm/`.

**Please do not fold anything else into that commit.** Keeping it to the regenerated artefacts is
what lets the re-integration on the PR20 side be verified by reading a diff instead of re-testing
the whole base.

## What happens next on the PR20 side

1. Integrate only that change into `pr20-base-integration-wip`.
2. Read the diff — it must be four files under `web/src/lib/wasm/` and nothing else.
3. `npm run typecheck` — must report no new errors.
4. Run the **whole** post-integration gate set: unit, build tests, production build, locale parity,
   smoke, ded-roundtrip, project-restore, tab-reactivation, rebar-3d, viewport-cost, families,
   floors, detailing, documents, Ver en 3D, preview, sticky headers, then the full suite once.
5. Only then is PR20 mergeable. Not before.

## State of the branches, for reference

| Ref | SHA | What it is |
|---|---|---|
| `feat/pro-visual-system` | `d585b7ed` | PR20 as developed and as its gates describe it |
| `pr20-base-integration-wip` | `dd0dcf22` | the base merged in, 9 conflicts resolved by hand |
| `pr20-before-base-integration` | `d585b7ed` | backup branch |
| `pr20-pre-integration-HEAD` | `d585b7ed` | backup tag |
| `origin/pr/19-rc-cad-constructibility` | `2e4cd2f3` | the base |

The 9 conflict resolutions are documented in `dd0dcf22`'s commit message, one paragraph each, with
what was kept from which side and why. None of them touches calculation, geometry, states,
batching, the DocumentModel or translations. Two of them keep assertions from **both** sides where
the two branches made different claims that were both true.

## PR20's own state, so nothing is over-read from this

- Functionally complete against the base it was developed on; scope closed and accepted.
- Its gates were green **against that base**: unit 5989, build tests 14, production build clean,
  locale parity 60, smoke 37/37, full suite 402 passed with one known 1 px screenshot.
- **Those numbers do not describe the integrated tree** and are not offered as if they did.
- Manual QA: **not done**. `pr20-qa-manual.md` is the checklist.
- PR20 stays in draft.
