// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The pdf.js data trees the browser viewer fetches at run time.
 *
 * pdf.js resolves a predefined CMap as `<cMapUrl><name>.bcmap` and a standard
 * font as `<standardFontDataUrl><name>.pfb`. Without either, a CID-keyed font
 * that names a predefined CMap fails `translateFont` and every one of its
 * glyphs is drawn blank — the latin text on the same page still renders, which
 * is what makes an otherwise valid file look broken. The server-side analyzer
 * already passes both URLs (backend/infrastructure/src/parsers/pdf-document-analyzer.ts);
 * the browser viewer needs the same two trees reachable over HTTP.
 *
 * They are copied out of the installed `pdfjs-dist` into each app's `public/`
 * tree instead of being fetched from a CDN, so the desktop build keeps working
 * offline and a self-hosted server never depends on a third party.
 *
 * The worker is copied too, but not verbatim: `pdfjs-worker-patch.mjs` adds the
 * page-tree fast path first, because a flat page tree otherwise costs one range
 * read per page just to open page 1.
 */
import { cp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  PDFJS_PATCHED_WORKER_FILE,
  patchInstalledPdfjsWorker,
} from "./pdfjs-worker-patch.mjs";

/** The repository root, seen from `scripts/lib/`. */
export const REPO_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);

/** The asset directories copied out of `pdfjs-dist`, named as pdf.js expects. */
export const PDFJS_ASSET_DIRECTORIES = ["cmaps", "standard_fonts"];

/** The apps whose `public/` tree serves the viewer. */
export const PDFJS_ASSET_APPS = ["apps/web", "apps/desktop"];

export { PDFJS_PATCHED_WORKER_FILE };

const require = createRequire(join(REPO_ROOT, "packages/ui/package.json"));

/** Locates the installed pdf.js package and the two directories inside it. */
export function resolvePdfjsAssets() {
  const source = dirname(require.resolve("pdfjs-dist/package.json"));
  return {
    source,
    directories: PDFJS_ASSET_DIRECTORIES.map((name) => ({
      name,
      path: join(source, name),
    })),
  };
}

/** Accepts "web", "desktop" or the full path, and rejects anything else. */
function normalizeApp(app) {
  const name = app.replace(/^.*\//, "").replace(/\/+$/, "");
  const target = "apps/" + name;
  const known = PDFJS_ASSET_APPS.includes(target);
  if (!known) {
    throw new Error(
      'unknown app "' + app + '"; expected one of ' + PDFJS_ASSET_APPS.join(", "),
    );
  }
  return target;
}

/**
 * Copies both trees and the patched worker into `<root>/<app>/public/pdfjs/`.
 *
 * Idempotent: the destination directory is replaced, so a pdf.js upgrade cannot
 * leave a stale CMap or an unpatched worker beside a new parser. Returns the
 * directory that now holds the assets, which the CLI prints.
 */
export async function copyPdfjsAssets(app, { root = REPO_ROOT } = {}) {
  const target = normalizeApp(app);
  const { directories } = resolvePdfjsAssets();
  const destination = join(root, target, "public", "pdfjs");
  await rm(destination, { recursive: true, force: true });
  await mkdir(destination, { recursive: true });
  for (const directory of directories) {
    const into = join(destination, directory.name);
    await cp(directory.path, into, { recursive: true });
  }
  const { source } = await patchInstalledPdfjsWorker();
  await writeFile(join(destination, PDFJS_PATCHED_WORKER_FILE), source);
  return destination;
}

/** The number of files in each copied location, for the CLI's log line. */
export async function countPdfjsAssets(app, { root = REPO_ROOT } = {}) {
  const destination = join(root, normalizeApp(app), "public", "pdfjs");
  const counts = {};
  for (const name of PDFJS_ASSET_DIRECTORIES) {
    counts[name] = (await readdir(join(destination, name))).length;
  }
  counts.worker = (await readdir(destination)).filter(
    (file) => file === PDFJS_PATCHED_WORKER_FILE,
  ).length;
  return counts;
}
