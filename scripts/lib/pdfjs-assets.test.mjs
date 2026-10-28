// SPDX-License-Identifier: AGPL-3.0-only

import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  PDFJS_ASSET_DIRECTORIES,
  PDFJS_PATCHED_WORKER_FILE,
  copyPdfjsAssets,
  countPdfjsAssets,
  resolvePdfjsAssets,
} from "./pdfjs-assets.mjs";

test("pdfjs ships the CMap and standard-font trees the viewer fetches", async () => {
  const { directories } = resolvePdfjsAssets();
  assert.deepEqual(
    directories.map((directory) => directory.name),
    PDFJS_ASSET_DIRECTORIES,
  );
  for (const directory of directories) {
    const files = await readdir(directory.path);
    assert.ok(
      files.length > 0,
      directory.name + " is empty in the installed pdfjs-dist",
    );
    // The extension is what pdf.js appends; a mismatch here means the copy
    // would produce files the viewer never asks for.
    const suffix = directory.name === "cmaps" ? ".bcmap" : ".pfb";
    assert.ok(
      files.some((file) => file.endsWith(suffix)),
      directory.name + " holds no " + suffix + " file",
    );
  }
});

test("the copy is idempotent and lands under public/pdfjs", async () => {
  const root = await mkdtemp(join(tmpdir(), "pdfjs-assets-"));
  try {
    const first = await copyPdfjsAssets("web", { root });
    const before = await countPdfjsAssets("web", { root });
    const second = await copyPdfjsAssets("web", { root });
    const after = await countPdfjsAssets("web", { root });

    assert.equal(first, second);
    assert.equal(first, join(root, "apps", "web", "public", "pdfjs"));
    assert.deepEqual(after, before);
    assert.ok(after.cmaps > 0);
    assert.ok(after.standard_fonts > 0);
    // The worker is copied with the page-tree fast path already applied; a
    // missing patch here is a silent return to one range read per page.
    assert.equal(after.worker, 1);
    const worker = await readFile(join(first, PDFJS_PATCHED_WORKER_FILE), "utf8");
    assert.match(worker, /__pdfjsFastTop/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("an unknown app is rejected instead of writing somewhere unexpected", async () => {
  await assert.rejects(() => copyPdfjsAssets("server"), /unknown app/);
});
