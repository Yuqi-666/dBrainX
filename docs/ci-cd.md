# CI/CD and releases

## Ownership and branches

The repository is public source. The owner makes the development and the release decisions. Only a collaborator can push to the repository or open a pull request. The owner decides who is a collaborator, and the owner is currently the only collaborator. The repository limits pull request creation to collaborators. Security reports use the private process in [SECURITY.md](../SECURITY.md). The owner selects and commits the dependency updates. Dependabot version-update pull requests stay disabled.

`develop` is the daily development branch. The owner may commit directly to it, or merge an internal `feature/*` or `fix/*` branch into it. The `develop` ruleset requires a pull request from every other writer. Keep Conventional Commits. CI runs on each push to `develop` and `main`, and on pull requests to either branch. `main` is the promoted release history. After CI passes, promote `develop` to `main` with an internal pull request and a **merge commit**. A squash or a rebase would drop the tagged commit from the `main` history. The owner may create a release tag on `develop` before this promotion. An urgent fix uses a `hotfix/*` branch and the flow in [Patch release](#patch-release-hotfix).

Merge these workflow files into `main` before you push the first new version tag. GitHub reads the `workflow_run` workflow file from the default branch.

## Checks

The `checks` job in [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) is the only check pipeline. The repository keeps no second local gate. The job installs from the lockfile and uses a read-only token. Then it runs `release:check`, the type check, the lint baseline, the release tests, the web and server build, the server smoke test, and actionlint. A push to `develop` or `main` does not create a release.

Run the same commands locally before you push. The smoke test needs the built server, so build first. It uses an isolated database and never a live service.

```bash
pnpm install --frozen-lockfile
pnpm release:check
pnpm check-types
pnpm lint:gate
pnpm test:release
pnpm build
pnpm smoke:server
bash scripts/release/check-workflows.sh
```

## Version and candidate

Use semantic versions. A `fix` usually advances PATCH, a compatible `feat` advances MINOR, and a breaking change advances MAJOR. In `0.x`, a breaking change may advance MINOR if the release notes say so. Run `pnpm release:version VERSION` on `develop`. It synchronizes `scripts/release/release.json`, the desktop package metadata, the Tauri configuration and lockfile, `docker-compose.yml`, and `deploy/.env.example`. Declare every intended desktop target and container platform in `release.json`. Enable the products that you ship. Run `pnpm release:check` and the relevant tests.

After the version commit reaches `develop`, create and push `vVERSION` at that commit yourself. Use an annotated tag. Check that the version is newer than every existing version tag. A tag push starts `release-candidate.yml`. That workflow checks that the tag is in the `develop` history. It builds all declared container platforms. It also builds the desktop targets whose signing secrets exist on the clean runners. Then it assembles `candidate-RUN_ID-ATTEMPT`. A manual workflow dispatch from the **tag ref** remains available for a targeted retry. A retry does not create a draft automatically. The tag ruleset blocks a tag move and a tag removal.

After a successful candidate run from a tag, `release.yml` runs automatically through `workflow_run`. It checks the completed run, the tag, the version, the assets, the signatures, and the image digests. Then it creates a **draft** GitHub Release. The draft is not public, and it never overwrites an existing release. The candidate container images use digest references until publication.

Promote `develop` to `main` with an internal pull request and a merge commit. The tag must remain an ancestor of `main`. Inspect the draft and accept the product. When the product is ready, run `release.yml` manually from `main` with the candidate run ID, the tag, and `publish=true`. The protected `release` environment names the owner as the reviewer, so the owner decides when to publish. Publication promotes the container tags and makes the draft public. A tag push and a merge alone do not publish a release.

```bash
pnpm release:version VERSION
pnpm release:check
node scripts/release/assert-next-version.mjs
git add -A && git commit -m "chore(release): vVERSION"
git push origin develop
git tag -a vVERSION -m "dBrain vVERSION"
git push origin vVERSION
# After the candidate succeeds, merge develop into main with a merge commit.
gh run list --workflow release-candidate.yml
gh workflow run release.yml --ref main -f candidate_run_id=RUN_ID -f tag=vVERSION -f publish=true
```

## Patch release (hotfix)

A hotfix ships one urgent fix on top of the current `main`. It is the only flow that does not start from `develop`. It is also the only flow where the owner creates the tag after the first merge.

1. Branch from the latest `main`.
2. Make the smallest fix. Put it in `develop` too, or the next promotion loses it.
3. Advance the version by one PATCH with `pnpm release:version VERSION`. A hotfix keeps the platform declaration of `main`. Do not declare the platforms again.
4. Run the full check list above.
5. Commit, push, and open a pull request to **both** `main` and `develop`.
6. Merge the `develop` pull request **before** you tag. `release-candidate.yml` rejects a tag that is not in the `develop` history.
7. Tag, then merge the `main` pull request. The candidate needs the tag in `develop`. The publication needs it in `main`.

```bash
git fetch origin
git checkout -b hotfix/NAME origin/main
# Make the fix, then advance the version.
pnpm release:version VERSION
pnpm release:check && pnpm check-types && pnpm lint:gate && pnpm test:release && pnpm build && pnpm smoke:server
git add -A && git commit -m "fix(scope): what changed"
git push --set-upstream origin hotfix/NAME
gh pr create --base develop --head hotfix/NAME --title "fix(scope): what changed" --body "What changed and how it was checked."
gh pr create --base main --head hotfix/NAME --title "fix(scope): what changed" --body "What changed and how it was checked."
# Merge the develop pull request first. The tag must be in the develop history.
gh pr merge --merge
node scripts/release/assert-next-version.mjs
git tag -a vVERSION -m "dBrain vVERSION"
git push origin vVERSION
# After the candidate succeeds, merge the main pull request and publish.
gh workflow run release.yml --ref main -f candidate_run_id=RUN_ID -f tag=vVERSION -f publish=true
```

The optional deployment updater watches successful candidates from a tag when enabled. It may deploy a candidate before the `main` promotion. Enable it only on a test host that accepts that timing.

## Repository policy

`pnpm policy --repo Yuqi-666/dBrain` prints the plan. After these workflows merge into `main` and `checks` appears on GitHub, the owner runs `pnpm policy --apply --repo Yuqi-666/dBrain`.

The script applies these rules.

- It allows only merge commits.
- It removes a branch after its pull request merges.
- It keeps the long-lived `develop` branch.
- It enables Issues.
- It keeps Discussions disabled.
- It sets the default `GITHUB_TOKEN` permissions to read-only.
- It stops Actions from approving a pull request.
- It names the owner as the reviewer of the `release` environment.
- The `develop` ruleset lets the administrator push directly and requires a pull request from another writer. It blocks a force push and a removal.
- The `main` ruleset requires an internal pull request, the current `checks`, and resolved conversations. It blocks a force push and a removal.
- The `v*` tag ruleset blocks a tag rewrite and a tag removal.

Keep the signing secrets in the unprotected `candidate` environment, so tag builds start automatically. The `release` environment gates only the publication. Private vulnerability reporting and Dependabot security alerts and fixes stay enabled.

To include every desktop target, configure `TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`, `WINDOWS_CERTIFICATE`, `WINDOWS_CERTIFICATE_PASSWORD`, `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`, `APPLE_API_PRIVATE_KEY`, `APPLE_API_KEY`, and `APPLE_API_ISSUER` as `candidate` environment secrets. If a target lacks a required signing secret, the build skips that desktop target and names it in the job summary. The other desktop targets and the container builds continue. If no product remains, the candidate fails with a clear message. The current repository has no signing secrets, so a tag candidate contains containers only. `desktopEnabled` stays `true` in `release.json` to keep the declared targets ready for the day the secrets exist.

GitHub rulesets cannot express “only accept pull requests from this owner” for a public repository. The owner controls which pull requests merge, and closes unsolicited pull requests. Check for old rulesets whose requirements may still apply. The rules are cumulative.

## Safety and repeatability

Actions use pinned commits. The candidate and publication jobs have separate write permissions. The server smoke test uses isolated data. Do not start a publish or a signed build unless the task asks for a release, or the owner asks for it directly. See [Operations](operations.md) for the deployment and [Development](development.md) for the desktop checks.
