# scripts/AGENTS.md

Scope: the `scripts/` directory.
Parent map: [../AGENTS.md](../AGENTS.md).

This directory holds development and release automation.
The JavaScript files use the `.mjs` suffix and run directly, so no build step exists.

## Map

| Path | Purpose |
| --- | --- |
| `dev-pocketbase.mjs` | Starts the local PocketBase with fixed data, migration, and hook directories. |
| `dev-pocketbase-admin.mjs` | Applies the operator account to the local database. The root script `pnpm pb:admin` calls it. |
| `dev-run.mjs` | Starts the development stack from the root `.env`. The root scripts `pnpm dev` and `pnpm dev:remote` call it. Its preflight downloads PocketBase and yt-dlp when they are missing. |
| `dev-gateway.mjs` | One-port entry for remote development. It routes `/trpc` and `/pb/api/*` to the backends, `/pb/upload/*` to the API, and everything else to Next, and forwards the browser Host unchanged. The root script `pnpm dev:remote` calls it. |
| `plugin-sign.mjs` | Signs one plugin manifest with the test-only key, or verifies one against the fixture's trusted keys. |
| `sandbox-probe.mjs` | Prints the MXC capability matrix for this host and exits 0 with `SANDBOX_UNAVAILABLE` when no backend is usable. `backend/sandbox/src/mxc-support.ts` holds the data; `--markdown` and `--json` change the output only. |
| `lib/` | Shared modules. Examples: the yt-dlp release download and checksum check (`yt-dlp-download.mjs`), runtime bundling, development port resolution, development gateway routing, child-process shutdown, macOS library rewriting, Windows signing. |
| `release/` | Version, check, build, signing, and release scripts. Many scripts have a `.test.mjs` neighbour. |
| `policy/` | The owner-maintained GitHub policy. The root script `pnpm policy` calls `apply-ruleset.mjs`. |

## Release scripts

`release/check.mjs` verifies version and lock consistency.
`release/lint-gate.mjs` fails on new lint diagnostics against `release/lint-baseline.json`.
`release/server-smoke.mjs` starts a server against a fresh database and checks user isolation. It needs a built `apps/server/dist` and never a live service.
`release/download-pocketbase.mjs` fetches the pinned binary from `release/pocketbase-lock.json` and verifies its checksum.
`release/version.mjs` synchronizes the version in `release/release.json`, `apps/desktop/package.json`, `apps/desktop/src-tauri/tauri.conf.json`, the Tauri lockfile, `docker-compose.yml`, and `deploy/.env.example`.
`release/candidate.mjs` assembles and verifies candidates, then prepares release assets.
`release/platforms.mjs` reads the declared platforms of a release candidate and holds the runner of each platform.
`release/validate-run.mjs` accepts or rejects a tag-triggered or manual release candidate run before publication.
`release/assert-next-version.mjs` rejects a version that does not advance existing tags.
`release/container-images.mjs` builds and pushes the container images.
`release/promote-images.mjs` tags verified image digests when the GitHub release is published.
`release/check-workflows.sh` runs the pinned actionlint binary against `.github/workflows/*.yml`.
`lib/pocketbase-migrations.mjs` prepares the durable migration run directory for development and desktop.

Read a script before you run it.
Several scripts publish images or change a live host.

## Check pipeline

`.github/workflows/ci.yml` is the only check pipeline. The repository keeps no second local check list; a duplicate list drifted from CI and blocked releases. The root command `pnpm test:release` collects the `.test.mjs` files of `lib/`, `policy/`, and `release/`.

Run the CI commands locally before you push. The list is in [docs/ci-cd.md](../docs/ci-cd.md).

## Repository policy

`policy/apply-ruleset.mjs` prints the GitHub branch, tag, and environment policy. The flag `--apply` writes it. Read it before you run that flag; it changes a live repository.

## Rules

1. Never run `release/container-images.mjs` or a release publish step unless the task asks for a release.
2. Keep the version equal in `release/release.json`, the Git tag, `apps/desktop/package.json`, and `tauri.conf.json`.
3. Keep the PocketBase version and checksums equal in `release/pocketbase-lock.json`, `deploy/pocketbase/Dockerfile`, and the documentation.
4. Shrink `release/lint-baseline.json` only after you fix the diagnostics. Use `node scripts/release/lint-gate.mjs --update-baseline`.
5. Add a test as a `.test.mjs` file next to the script. The root command `pnpm test:release` collects it.
6. Never print a secret. The local `.env` file and `pb/pb_data/.superuser-credentials.txt` hold real credentials.
7. Keep the required CI checks in `.github/workflows/ci.yml` and the required status context in `policy/apply-ruleset.mjs` in sync with each other and with [docs/ci-cd.md](../docs/ci-cd.md).
