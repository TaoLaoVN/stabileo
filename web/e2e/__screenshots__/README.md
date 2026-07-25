# Playwright screenshot baselines

Path template (see `playwright.config.ts`):
`e2e/__screenshots__/{platform}/{name}.png` — Playwright resolves `{platform}` from
`process.platform`, so Linux CI reads `linux/` and macOS reads `darwin/`.

## Status

| Platform | `overlay-legend.png` | `batch-dialog.png` | Notes |
|---|---|---|---|
| `darwin/` | ✅ committed | ✅ committed | Generated on the authoring machine. **Local development only** — CI never reads these. |
| `linux/`  | ⏳ pending | ⏳ pending | See below. |

## Why the Linux baselines are not committed yet

They must be produced in a real Linux Playwright/Chromium/SwiftShader environment.
The authoring machine is macOS (Darwin 24.6.0, arm64) with **no container or VM
runtime available** — `docker`, `podman`, `nerdctl`, `lima`, `colima`, `vagrant`,
`multipass` and `qemu` are all absent, and installing one is an environment change
outside this change's scope.

The Darwin images were deliberately **not** copied or renamed into `linux/`: a
cross-platform-renamed PNG is a fabricated baseline and would compare against
different font rendering and rasterisation.

## How to land them

The CI `e2e` job runs the visual spec with `--update-snapshots`, writes
`e2e/__screenshots__/linux/*.png`, and uploads them as the
`linux-screenshot-baselines` artifact. Download that artifact from the first run and
commit its two files here.

Alternatively, reproduce locally with the official pinned container:

```sh
docker run --rm -it -v "$PWD":/w -w /w/web \
  mcr.microsoft.com/playwright:v1.60.0-jammy \
  sh -c 'npm ci && VITE_E2E=1 npm run build && \
         npx playwright test --grep "visual baselines" --update-snapshots'
```

Both comparisons use `expect.soft(...)` and the CI step is `continue-on-error`, so a
missing or mismatched baseline is informational and never fails the job. The DOM,
store-hook and functional browser assertions remain blocking.
