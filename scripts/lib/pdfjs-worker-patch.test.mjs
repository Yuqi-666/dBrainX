// SPDX-License-Identifier: AGPL-3.0-only

import assert from "node:assert/strict";
import test from "node:test";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

import {
  PDFJS_WORKER_BUILD,
  patchInstalledPdfjsWorker,
  patchPdfWorker,
  resolvePdfjsWorkerPath,
} from "./pdfjs-worker-patch.mjs";

/**
 * The worker patch that keeps a flat page tree from costing one range read per
 * page before page 1 opens.
 *
 * The structural tests pin the two source anchors (minified and unminified), so
 * a pdf.js upgrade fails here instead of silently shipping an unpatched worker.
 * The end-to-end test builds a small *flat* PDF whose page dictionaries sit in
 * separate 64 KB chunks, serves it with byte ranges like PocketBase does, and
 * checks that opening pages 1 and N now reads a handful of ranges instead of one
 * per page.
 */

/** Builds a PDF with `pages` pages, each separated by a large unreferenced stream. */
function buildFlatPdf({ pages, fillerBytes }) {
  const latin = (text) => Buffer.from(text, "latin1");
  const objects = [];
  const add = (body) => {
    objects.push(body);
    return objects.length;
  };

  const catalog = add(latin("<< /Type /Catalog /Pages 2 0 R >>"));
  // Kids is filled in after the page objects exist.
  const pagesObject = add(null);
  const pageRefs = [];
  for (let index = 0; index < pages; index += 1) {
    // A stream between two page dictionaries keeps them in different range chunks.
    const filler = Buffer.alloc(fillerBytes, 0x41);
    add(
      Buffer.concat([
        latin(`<< /Length ${filler.length} >>\nstream\n`),
        filler,
        latin("\nendstream"),
      ]),
    );
    pageRefs.push(add(latin(
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << >> >>",
    )));
  }
  objects[pagesObject - 1] = latin(
    `<< /Type /Pages /Kids [${pageRefs.map((ref) => `${ref} 0 R`).join(" ")}] /Count ${pages} >>`,
  );

  let pdf = latin("%PDF-1.7\n");
  const offsets = [];
  objects.forEach((body, index) => {
    offsets.push(pdf.length);
    pdf = Buffer.concat([
      pdf,
      latin(`${index + 1} 0 obj\n`),
      body,
      latin("\nendobj\n"),
    ]);
  });
  const startxref = pdf.length;
  let xref = latin(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`);
  for (const offset of offsets) {
    xref = Buffer.concat([
      xref,
      latin(`${String(offset).padStart(10, "0")} 00000 n \n`),
    ]);
  }
  assert.equal(catalog, 1);
  return Buffer.concat([
    pdf,
    xref,
    latin(
      `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${startxref}\n%%EOF\n`,
    ),
  ]);
}

const FIXTURE = buildFlatPdf({ pages: 40, fillerBytes: 70 * 1024 });

/** A free loopback port, so several tests can run side by side. */
function freePort() {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.listen(0, "127.0.0.1", () => {
      const port = probe.address().port;
      probe.close(() => resolve(port));
    });
  });
}

/** Serves the fixture with `Accept-Ranges`, counting every range request. */
async function serve(body) {
  const port = await freePort();
  const stats = { ranges: 0, bytes: 0 };
  const server = createServer((request, response) => {
    const match = /bytes=(\d+)-(\d+)/.exec(request.headers.range ?? "");
    if (match) {
      const start = Number(match[1]);
      const end = Number(match[2]);
      stats.ranges += 1;
      stats.bytes += end - start + 1;
      response.writeHead(206, {
        "content-type": "application/pdf",
        "accept-ranges": "bytes",
        "content-range": `bytes ${start}-${end}/${body.length}`,
        "content-length": String(end - start + 1),
      });
      response.end(body.subarray(start, end + 1));
      return;
    }
    // The first request asks for the whole body; a range-capable server answers
    // headers and the browser aborts it, which is what this does.
    response.writeHead(200, {
      "content-type": "application/pdf",
      "accept-ranges": "bytes",
      "content-length": String(body.length),
    });
    response.flushHeaders();
    response.destroy();
  });
  await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
  return {
    url: `http://127.0.0.1:${port}/flat.pdf`,
    stats,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

/** Copies the installed legacy build so the worker can be patched in isolation. */
async function copyLegacyBuild() {
  const source = resolvePdfjsWorkerPath("legacy/build");
  const directory = await mkdtemp(join(tmpdir(), "pdfjs-patch-"));
  await cp(dirname(source), directory, { recursive: true });
  return directory;
}

/** Patches both workers in a copied build, the way the asset copy step patches. */
async function patchCopiedBuild(directory) {
  for (const file of ["pdf.worker.mjs", "pdf.worker.min.mjs"]) {
    const path = join(directory, file);
    await writeFile(path, patchPdfWorker(await readFile(path, "utf8")));
  }
}

/** Opens the served fixture and reports the range reads needed for its pages. */
async function measure(pdfjs, url, pageNumbers) {
  const document = await pdfjs.getDocument({
    url,
    disableStream: true,
    disableAutoFetch: true,
  }).promise;
  try {
    for (const pageNumber of pageNumbers) {
      const page = await document.getPage(pageNumber);
      assert.equal(page.pageNumber, pageNumber);
    }
    // Give the range manager a beat to issue anything still queued.
    await new Promise((resolve) => setTimeout(resolve, 100));
    return document.numPages;
  } finally {
    await document.destroy();
  }
}

test("the patch applies to the worker pdf.js ships today", async () => {
  const { path, source } = await patchInstalledPdfjsWorker({
    build: PDFJS_WORKER_BUILD,
  });
  assert.ok(source.includes("__pdfjsFastTop"), `${path} was not patched`);
  // Idempotent: copying the assets twice must not inject the path twice.
  assert.equal(patchPdfWorker(source), source);
  // The worker that ships to the browser and the one the test above copies must
  // both carry the anchors; a version bump that moves one fails here.
  const legacy = await readFile(resolvePdfjsWorkerPath("legacy/build"), "utf8");
  assert.ok(
    patchPdfWorker(legacy).includes("__pdfjsFastTop"),
    "the legacy worker could not be patched",
  );
});

test("an unknown worker shape fails instead of shipping unpatched", () => {
  assert.throws(
    () => patchPdfWorker("async getPageDict(pageIndex) { return null; }"),
    /could not find Catalog\.getPageDict/,
  );
});

test("a flat page tree opens page 1 and a late page in a few range reads", async () => {
  const { url, stats, close } = await serve(FIXTURE);
  const directory = await copyLegacyBuild();
  try {
    const original = await import(
      pathToFileURL(join(directory, "pdf.mjs")).href
    );

    stats.ranges = 0;
    stats.bytes = 0;
    assert.equal(await measure(original, url, [1]), 40);
    const unpatched = { ...stats };

    // pdf.js caches the fake Node worker on `globalThis`; the next import would
    // otherwise reuse the unpatched module.
    globalThis.pdfjsWorker = undefined;
    await patchCopiedBuild(directory);

    // A second copy keeps the already imported, unpatched worker module out of
    // this copy's module graph.
    const patchedDirectory = await copyLegacyBuild();
    try {
      await patchCopiedBuild(patchedDirectory);
      const patched = await import(
        pathToFileURL(join(patchedDirectory, "pdf.mjs")).href
      );

      stats.ranges = 0;
      stats.bytes = 0;
      assert.equal(await measure(patched, url, [1]), 40);
      const firstPage = { ...stats };

      stats.ranges = 0;
      stats.bytes = 0;
      assert.equal(await measure(patched, url, [40]), 40);
      const lastPage = { ...stats };

      console.log(
        `[pdfjs-patch] page 1 ranges=${unpatched.ranges} -> ${firstPage.ranges}, ` +
          `page 40 ranges=${lastPage.ranges}`,
      );
      // One range read per page is exactly what the patch removes.
      assert.ok(
        unpatched.ranges >= 20,
        `the unpatched worker should need at least a range per page, got ${unpatched.ranges}`,
      );
      assert.ok(
        firstPage.ranges <= 8,
        `page 1 should need a few ranges, got ${firstPage.ranges}`,
      );
      assert.ok(
        lastPage.ranges <= 8,
        `page 40 should need a few ranges, got ${lastPage.ranges}`,
      );
      assert.ok(
        firstPage.bytes < FIXTURE.length / 4,
        `page 1 should read a fraction of the file, got ${firstPage.bytes} of ${FIXTURE.length}`,
      );
    } finally {
      await rm(patchedDirectory, { recursive: true, force: true });
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
    await close();
  }
});
