// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The test files `pnpm test:release` runs, grouped by area.
 *
 * `test:release` is the CI gate (`.github/workflows/ci.yml` -> `checks`). It is
 * an explicit list, not a recursive `*.test.ts` glob: a glob would pull in tests
 * that need PocketBase or a live stack, and CI must not run those. The price of
 * an explicit list is drift — a new test runs nowhere and nobody notices. The
 * list
 * is therefore data in this module, and `scripts/lib/test-manifest.test.mjs`
 * fails when a test file in `backend/`, `plugins/`, `packages/`, `apps/`, or
 * `scripts/` is neither listed here nor listed in `skippableTests` with a
 * reason.
 *
 * Adding a test: add its repo-relative path to the matching group below. If the
 * test cannot run in CI without external state, add it to `skippableTests`
 * instead, with the reason. Do not widen the command in `package.json`.
 */

/** @typedef {{ path: string, reason: string }} SkippedTest */

/** Repo-relative paths of the test files the CI gate runs, in review order. */
export const testFiles = [
  // Script tests: development, policy, and release automation.
  "scripts/lib/dev-gateway.test.mjs",
  "scripts/lib/dev-ports.test.mjs",
  "scripts/lib/pdfjs-assets.test.mjs",
  "scripts/lib/pdfjs-worker-patch.test.mjs",
  "scripts/lib/plugin-packages.test.mjs",
  "scripts/lib/pocketbase-migrations.test.mjs",
  "scripts/lib/workspace-members.test.mjs",
  "scripts/lib/yt-dlp-download.test.mjs",
  "scripts/lib/test-manifest.test.mjs",
  "scripts/policy/apply-ruleset.test.mjs",
  "scripts/release/assert-next-version.test.mjs",
  "scripts/release/candidate.test.mjs",
  "scripts/release/check.test.mjs",
  "scripts/release/ci-pipeline.test.mjs",
  "scripts/release/container-images.test.mjs",
  "scripts/release/database-date-time.test.mjs",
  "scripts/release/edge-hook.test.mjs",
  "scripts/release/editor-select-and-copy.test.mjs",
  "scripts/release/lint-gate.test.mjs",
  "scripts/release/macos-libraries.test.mjs",
  "scripts/release/markdown-paste.test.mjs",
  "scripts/release/media-derived-hook.test.mjs",
  "scripts/release/node-content-size.test.mjs",
  "scripts/release/node-references-hook.test.mjs",
  "scripts/release/pdf-viewer.test.mjs",
  "scripts/release/platforms.test.mjs",
  "scripts/release/pocketbase-connections.test.mjs",
  "scripts/release/runtime-manifest.test.mjs",
  "scripts/release/signing-targets.test.mjs",
  "scripts/release/stop-runtime-child.test.mjs",
  "scripts/release/storage-limits-hook.test.mjs",
  "scripts/release/toc-scroll.test.mjs",
  "scripts/release/update-script.test.mjs",
  "scripts/release/updater-watch.test.mjs",
  "scripts/release/upload-auth.test.mjs",
  "scripts/release/upload-chunked.test.mjs",
  "scripts/release/validate-run.test.mjs",
  "scripts/release/view-theme-sync.test.mjs",
  "scripts/release/webpage-object-storage.test.mjs",

  // Shared package tests that need no DOM or browser globals.
  "packages/ui/src/components/node-content/registry.test.ts",
  "packages/utils/src/node-content.test.ts",
  "packages/utils/src/resource-references.test.ts",
  "packages/utils/src/storage-limits.test.ts",

  // Plugin package tests that need no DOM or browser globals.
  "plugins/builtin/server/node-types.test.ts",

  // Backend tests. These construct their own fakes; none needs PocketBase.
  "backend/application/src/commands/file/file-command.service.test.ts",
  "backend/application/src/commands/file/hls-playlist.test.ts",
  "backend/application/src/commands/media/cookie-file.test.ts",
  "backend/application/src/commands/media/media-import.service.test.ts",
  "backend/application/src/commands/node/node-command.service.test.ts",
  "backend/domain/src/contract-compile.test.ts",
  "backend/domain/src/event-bus/envelope.test.ts",
  "backend/domain/src/models/node-type/registry.test.ts",
  "backend/domain/src/models/plugin/capability.test.ts",
  "backend/domain/src/models/workspace/name.test.ts",
  "backend/infrastructure/src/database/mappers/node.mapper.test.ts",
  "backend/infrastructure/src/database/request-scope.test.ts",
  "backend/infrastructure/src/downloaders/media-browser-detector.test.ts",
  "backend/infrastructure/src/downloaders/media-quality.test.ts",
  "backend/infrastructure/src/downloaders/media-sites.test.ts",
  "backend/infrastructure/src/downloaders/vtt-parser.test.ts",
  "backend/infrastructure/src/downloaders/yt-dlp-args.test.ts",
  "backend/infrastructure/src/downloaders/yt-dlp-cookie.test.ts",
  "backend/infrastructure/src/downloaders/yt-dlp-media-downloader.test.ts",
  "backend/infrastructure/src/downloaders/yt-dlp-media-probe.test.ts",
  "backend/infrastructure/src/storage/file-address.test.ts",
  "backend/infrastructure/src/storage/file-upload-sessions.test.ts",
  "backend/infrastructure/src/storage/media-cookie-cipher.test.ts",
  "backend/infrastructure/src/storage/media-import-jobs.test.ts",
  "backend/infrastructure/src/storage/multipart-envelope.test.ts",
  "backend/infrastructure/src/storage/pocketbase-media-analysis.test.ts",
  "backend/infrastructure/src/transcoders/ffmpeg-audio-transcoder.test.ts",

  // Server and desktop entry points that run without PocketBase.
  "apps/server/src/desktop/security.test.ts",
  "apps/server/src/desktop/upgrade-backup.test.ts",
  "apps/server/src/origin.test.ts",
];

/**
 * Test files that exist but do not run in the CI gate, each with the reason it
 * is excluded. This is data, not a skip switch: the consistency test lets a
 * file be unlisted only by matching one of these entries, so a new test still
 * forces a decision.
 *
 * @type {readonly SkippedTest[]}
 */
export const skippableTests = [
  { path: "packages/ui/src/components/annotation/colors.test.ts", reason: "JSX/TS UI test: runs under `pnpm test:ui` (esbuild transform), not node --test" },
  { path: "packages/ui/src/components/annotation/draw.test.ts", reason: "JSX/TS UI test: runs under `pnpm test:ui` (esbuild transform), not node --test" },
  { path: "packages/ui/src/components/annotation/erase.test.ts", reason: "JSX/TS UI test: runs under `pnpm test:ui` (esbuild transform), not node --test" },
  { path: "packages/ui/src/components/annotation/geometry.test.ts", reason: "JSX/TS UI test: runs under `pnpm test:ui` (esbuild transform), not node --test" },
  { path: "packages/ui/src/components/dynamic-island/geometry.test.ts", reason: "JSX/TS UI test: runs under `pnpm test:ui` (esbuild transform), not node --test" },
  { path: "packages/ui/src/components/dynamic-island/swap.test.ts", reason: "JSX/TS UI test: runs under `pnpm test:ui` (esbuild transform), not node --test" },
  { path: "packages/ui/src/components/dynamic-island/tuning.test.ts", reason: "JSX/TS UI test: runs under `pnpm test:ui` (esbuild transform), not node --test" },
  { path: "packages/ui/src/components/header/graph-header/node-density.test.ts", reason: "JSX/TS UI test: runs under `pnpm test:ui` (esbuild transform), not node --test" },
  { path: "packages/ui/src/components/media-player/media-controller.test.ts", reason: "JSX/TS UI test: runs under `pnpm test:ui` (esbuild transform), not node --test" },
  { path: "packages/ui/src/components/media-player/types.test.ts", reason: "JSX/TS UI test: runs under `pnpm test:ui` (esbuild transform), not node --test" },
  { path: "packages/ui/src/components/node-content/unknown-node-content.test.tsx", reason: "JSX/TS UI test: runs under `pnpm test:ui` (esbuild transform), not node --test" },
  { path: "packages/ui/src/components/pan-zoom/recognizer.test.ts", reason: "JSX/TS UI test: runs under `pnpm test:ui` (esbuild transform), not node --test" },
  { path: "packages/ui/src/components/pan-zoom/scroll-inertia.test.ts", reason: "JSX/TS UI test: runs under `pnpm test:ui` (esbuild transform), not node --test" },
  { path: "packages/ui/src/components/pan-zoom/transform.test.ts", reason: "JSX/TS UI test: runs under `pnpm test:ui` (esbuild transform), not node --test" },
  { path: "packages/ui/src/components/pdf-viewer/pdf-anchor.test.ts", reason: "JSX/TS UI test: runs under `pnpm test:ui` (esbuild transform), not node --test" },
  { path: "packages/ui/src/components/pdf-viewer/pdf-gesture.test.ts", reason: "JSX/TS UI test: runs under `pnpm test:ui` (esbuild transform), not node --test" },
  { path: "packages/ui/src/components/pdf-viewer/pdf-outline.test.ts", reason: "JSX/TS UI test: runs under `pnpm test:ui` (esbuild transform), not node --test" },
  { path: "packages/ui/src/components/pdf-viewer/pdf-raster.test.ts", reason: "JSX/TS UI test: runs under `pnpm test:ui` (esbuild transform), not node --test" },
  { path: "packages/ui/src/components/pdf-viewer/pdf-slots.test.ts", reason: "JSX/TS UI test: runs under `pnpm test:ui` (esbuild transform), not node --test" },
  { path: "packages/ui/src/components/pdf-viewer/pdf-text.test.ts", reason: "JSX/TS UI test: runs under `pnpm test:ui` (esbuild transform), not node --test" },
  { path: "packages/ui/src/components/pdf-viewer/pdf-zoom.test.ts", reason: "JSX/TS UI test: runs under `pnpm test:ui` (esbuild transform), not node --test" },
  { path: "packages/ui/src/components/plugin-ui/node-content-host.test.tsx", reason: "jsdom client-render test for the lazy host: runs under `pnpm test:ui` (esbuild transform), not node --test" },
  { path: "packages/ui/src/components/node-content/node-content-editor.test.tsx", reason: "jsdom registry-dispatch test for the editor host: runs under `pnpm test:ui` (esbuild transform), not node --test" },
  { path: "packages/ui/src/components/preview-block/node-preview-body.test.tsx", reason: "jsdom registry-dispatch test for the preview slot: runs under `pnpm test:ui` (esbuild transform), not node --test" },
  { path: "packages/ui/src/lib/i18n/runtime.test.ts", reason: "JSX/TS UI test: runs under `pnpm test:ui` (esbuild transform), not node --test" },
  { path: "packages/ui/src/ui-test-runner.test.tsx", reason: "JSX/TS UI test: runs under `pnpm test:ui` (esbuild transform), not node --test" },
];
