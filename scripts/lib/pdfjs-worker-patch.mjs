// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The pdf.js worker patch that makes a flat page tree cheap to address.
 *
 * pdf.js resolves page N by walking the page tree from the root, one page at a
 * time. While it walks the top-level `/Pages` node it also starts a fetch for
 * *every* top-level kid (`Catalog.getPageDict`), so a flat page tree — the root
 * `/Kids` array holds one reference per page — turns the first `getPage` into
 * one range read per page before any page can be shown. Measured against the
 * 84 MB / 209-page scan in this repository's development database, opening
 * page 1 issued 211 range reads for 13.8 MB, while page 1 itself needs exactly
 * one page dictionary. The cost depends on the tree shape, not on the file
 * size, which is why two similarly sized PDFs open at very different speeds.
 *
 * For such a tree `Count` equals the length of `Kids`: each kid contributes
 * exactly one page, so page N *is* `Kids[N]` and no sibling has to be read to
 * find it. The patch adds that fast path before the walk and returns the same
 * `[pageDict, pageRef]` the walk would have returned. It does not reinterpret
 * any document: a kid that is itself a `/Pages` node with `/Count 1` is not a
 * `/Page`, so the code falls through to the normal walk instead of guessing.
 * Nested and compressed page trees keep their current behaviour because their
 * root never satisfies the `Kids.length === Count` condition.
 *
 * The patch is applied to the installed `pdfjs-dist` worker when the two client
 * apps copy their pdf.js assets (`scripts/lib/pdfjs-assets.mjs`), and the viewer
 * serves the result from `/pdfjs/pdf.worker.patched.mjs`. A test pins the two
 * source anchors and fails loudly when a pdf.js upgrade moves them, rather than
 * silently shipping an unpatched worker.
 */

import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** The repository root, seen from `scripts/lib/`. */
const REPO_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);

const require = createRequire(join(REPO_ROOT, "packages/ui/package.json"));

/** File name of the patched worker inside an app's `public/pdfjs/`. */
export const PDFJS_PATCHED_WORKER_FILE = "pdf.worker.patched.mjs";

/**
 * The worker build the browser viewer loads. `legacy/` is the same parser built
 * for older browsers and for Node; the patch is applied to both so the test that
 * exercises it can use the Node-friendly build.
 */
export const PDFJS_WORKER_BUILD = "build";

/** Marker a patched worker carries; also makes `patchPdfWorker` idempotent. */
const PATCH_MARKER = "__pdfjsFastTop";

/**
 * The injected fast path.
 *
 * `identifiers` names the variables of one worker build (`xref`,
 * `pageKidsCountCache`, …). The names are the same in the unminified build and
 * are read out of the minified one, so no minified single-letter name is
 * hard-coded here.
 */
function fastPath(identifiers) {
  const { pageIndex, xref, kidsCount, indexCache, pageDictCache } =
    identifiers;
  return `const ${PATCH_MARKER} =
      this.toplevelPagesDict instanceof Dict ? this.toplevelPagesDict : null;
    if (${PATCH_MARKER}) {
      let __pdfjsFastKids = ${PATCH_MARKER}.getRaw("Kids");
      let __pdfjsFastCount = ${PATCH_MARKER}.getRaw("Count");
      if (__pdfjsFastKids instanceof Ref) {
        __pdfjsFastKids = await ${xref}.fetchAsync(__pdfjsFastKids);
      }
      if (__pdfjsFastCount instanceof Ref) {
        __pdfjsFastCount = await ${xref}.fetchAsync(__pdfjsFastCount);
      }
      if (
        Array.isArray(__pdfjsFastKids) &&
        Number.isInteger(__pdfjsFastCount) &&
        __pdfjsFastKids.length === __pdfjsFastCount &&
        ${pageIndex} >= 0 &&
        ${pageIndex} < __pdfjsFastKids.length
      ) {
        const __pdfjsFastKid = __pdfjsFastKids[${pageIndex}];
        let __pdfjsFastPage =
          __pdfjsFastKid instanceof Ref
            ? await (${pageDictCache}.get(__pdfjsFastKid) ||
                ${xref}.fetchAsync(__pdfjsFastKid))
            : __pdfjsFastKid;
        if (__pdfjsFastPage instanceof Dict) {
          let __pdfjsFastType = __pdfjsFastPage.getRaw("Type");
          if (__pdfjsFastType instanceof Ref) {
            __pdfjsFastType = await ${xref}.fetchAsync(__pdfjsFastType);
          }
          if (
            isName(__pdfjsFastType, "Page") ||
            !__pdfjsFastPage.has("Kids")
          ) {
            if (__pdfjsFastKid instanceof Ref) {
              if (!${kidsCount}.has(__pdfjsFastKid)) {
                ${kidsCount}.put(__pdfjsFastKid, 1);
              }
              if (!${indexCache}.has(__pdfjsFastKid)) {
                ${indexCache}.put(__pdfjsFastKid, ${pageIndex});
              }
            }
            return [
              __pdfjsFastPage,
              __pdfjsFastKid instanceof Ref ? __pdfjsFastKid : null,
            ];
          }
        }
      }
    }
    `;
}

/**
 * Returns `source` with the fast path added, or the source unchanged when it
 * already carries the marker.
 *
 * Supports the unminified worker and the minified worker that ships to the
 * browser. Throws when neither anchor is found: that is a pdf.js upgrade, and an
 * unpatched worker has to fail the release checks instead of quietly restoring
 * the slow open.
 */
export function patchPdfWorker(source) {
  if (source.includes(PATCH_MARKER)) return source;

  const unminified =
    /async getPageDict\(pageIndex\) \{[\s\S]{0,800}?let currentPageIndex = 0;\n    while \(nodesToVisit\.length\) \{/;
  if (unminified.test(source)) {
    const fast = fastPath({
      pageIndex: "pageIndex",
      xref: "xref",
      kidsCount: "pageKidsCountCache",
      indexCache: "pageIndexCache",
      pageDictCache: "pageDictCache",
    });
    return source.replace(
      unminified,
      (match) =>
        `${match.slice(0, match.indexOf("while"))}${fast}while (nodesToVisit.length) {`,
    );
  }

  const minified =
    /async getPageDict\((\w+)\)\{const (\w+)=\[this\.toplevelPagesDict\],(\w+)=new RefSet,(\w+)=this\._catDict\.getRaw\("Pages"\);\4 instanceof Ref&&\3\.put\(\4\);const (\w+)=this\.xref,(\w+)=this\.pageKidsCountCache,(\w+)=this\.pageIndexCache,(\w+)=this\.pageDictCache;let (\w+)=0;for\(;(\w+)\.length;\)\{/;
  const match = minified.exec(source);
  if (!match) {
    throw new Error(
      "[pdfjs-worker-patch] could not find Catalog.getPageDict in the installed pdfjs-dist worker; " +
        "pdf.js changed shape and scripts/lib/pdfjs-worker-patch.mjs needs the new anchors",
    );
  }
  const [, pageIndex, , , , xref, kidsCount, indexCache, pageDictCache, , nodes] =
    match;
  const fast = fastPath({
    pageIndex,
    xref,
    kidsCount,
    indexCache,
    pageDictCache,
  });
  const replaced = match[0].replace(
    `for(;${nodes}.length;){`,
    `${fast}for(;${nodes}.length;){`,
  );
  return source.slice(0, match.index) + replaced + source.slice(match.index + match[0].length);
}

/** Locates the installed `pdfjs-dist` worker build. */
export function resolvePdfjsWorkerPath(build = PDFJS_WORKER_BUILD) {
  const packageRoot = dirname(require.resolve("pdfjs-dist/package.json"));
  return join(packageRoot, build, "pdf.worker.min.mjs");
}

/**
 * Reads the worker from the installed `pdfjs-dist` and returns its patched
 * source, plus the path it came from (for a useful test failure message).
 */
export async function patchInstalledPdfjsWorker({
  build = PDFJS_WORKER_BUILD,
} = {}) {
  const path = resolvePdfjsWorkerPath(build);
  return { path, source: patchPdfWorker(await readFile(path, "utf8")) };
}
