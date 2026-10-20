# AGENTS.md

Scope: the whole dBrain repository.
Read this file first.
Then read the `AGENTS.md` file in the directory that you will change.

This file is a map and a rule set.
It is not a manual.
Keep this file shallow.
Put new detail in the nearest child file.

## What dBrain is

dBrain is a knowledge workspace.
A user records content in nodes and connects nodes with edges.
The user reads and edits the result as a graph, a data view, or a dashboard.
The web app talks to a self-hosted server.
The desktop app runs the full backend and PocketBase on the local machine.
The product is in early public development. The source version is in `scripts/release/release.json`.

## Repository map

| Directory | Content | Read next |
| --- | --- | --- |
| `apps/` | The web, desktop, and server programs, plus the marketing submodule | [apps/AGENTS.md](apps/AGENTS.md) |
| `packages/` | Shared UI, editor, graph, data view, state, client | [packages/AGENTS.md](packages/AGENTS.md) |
| `backend/` | Domain model, use cases, storage, adapters | [backend/AGENTS.md](backend/AGENTS.md) |
| `scripts/` | Development and release automation | [scripts/AGENTS.md](scripts/AGENTS.md) |
| `pb/` | PocketBase hooks and migrations | [pb/AGENTS.md](pb/AGENTS.md) |
| `deploy/` | Container, gateway, and deployment templates | [deploy/AGENTS.md](deploy/AGENTS.md) |
| `docs/` | User, developer, and operator manuals: English in the tree root, Chinese in `docs/zh/` | [docs/AGENTS.md](docs/AGENTS.md) |
| `.github/` | CI, desktop, container, and release workflows | [.github/AGENTS.md](.github/AGENTS.md) |

## How the parts connect

```text
apps/web, apps/desktop  ->  packages/*      shared UI, state, and client code
apps/web, apps/desktop  ->  apps/server     business calls over tRPC
apps/server             ->  backend/*       domain, use cases, adapters
backend/infrastructure  ->  PocketBase      records, files, and identity
```

- `apps/web` and `apps/desktop` share `packages/`. Change shared behavior once, then check both apps.
- `backend/` uses inward dependencies. The domain layer depends on no other backend layer.
- `backend/adapter-front` owns the tRPC router and the composition root. Start there to trace a request.
- PocketBase is the server data store. The desktop local mode keeps entity records in IndexedDB and uses a local PocketBase for identity and files.

## Commands

Prerequisites: Node 24.15.0, pnpm 9.0.0, and FFmpeg with FFprobe.

```bash
pnpm install --frozen-lockfile
cp .env.example .env          # then set the admin email and password
pnpm dev                      # first run downloads PocketBase and yt-dlp; starts the stack
pnpm dev:remote               # the same, behind the development gateway
node scripts/release/download-pocketbase.mjs  # explicit PocketBase refresh
```

Development addresses: web `http://localhost:3000`, server `http://localhost:3001`, PocketBase `http://127.0.0.1:8090`. The ports come from `.env` (`DBRAIN_WEB_PORT`, `DBRAIN_SERVER_PORT`, `DBRAIN_PB_HTTP`).

```bash
pnpm check-types
pnpm lint:gate
pnpm test:release
pnpm build                    # builds the server and the web app
pnpm smoke:server             # isolated two-user regression; needs the built server
pnpm policy                   # prints the public GitHub repository policy
pnpm dev:desktop              # needs Rust and the native libraries
```

## Repository rules

1. Do not commit `node_modules`, build output, runtime resources, a real `.env`, or a local database.
2. For a schema change, update the PocketBase base migration and add a new change migration. Never edit a released change migration.
3. Change business behavior in `backend/domain` or `backend/application` first. Then update the adapters and the UI.
4. Add a JavaScript dependency in the correct workspace package and update `pnpm-lock.yaml`. Add a Rust dependency and update `Cargo.lock`.
5. Write a user-facing manual in `docs/` and its Chinese version in `docs/zh/`. Keep the two files in step.
6. Use Conventional Commits for commits and internal pull request titles. Example: `fix(server): reject a stale token`.
7. Do not point a smoke test at a live service. The server smoke test needs an isolated test database.

## Before you finish

1. Run the checks that CI runs. The `checks` job in [`.github/workflows/ci.yml`](.github/workflows/ci.yml) is the only check pipeline; run its commands locally so a green run predicts a green pull request.
2. Run the checks relevant to your change. CI runs the required checks on pushes to develop and main and on internal pull requests.
3. Run `pnpm release:check`, `pnpm check-types`, `pnpm lint:gate`, `pnpm test:release`, `pnpm build`, `pnpm smoke:server`, and `bash scripts/release/check-workflows.sh` for a full check. `pnpm lint:gate` blocks new diagnostics against a baseline. Build before the smoke test.
4. If you changed the desktop app, also run the desktop checks in [apps/desktop/AGENTS.md](apps/desktop/AGENTS.md).
5. The owner develops on `develop` directly or through internal feature/fix branches. Tag on `develop`, merge it to `main` with a merge commit, and publish the automatically drafted release manually. An urgent fix uses the `hotfix/*` flow. External PRs are not accepted. Read [docs/ci-cd.md](docs/ci-cd.md) first.
