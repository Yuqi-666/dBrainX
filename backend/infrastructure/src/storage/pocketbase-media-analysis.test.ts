// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The cache on a resource record is what makes a second reference cheap, so the
 * cases below pin its contract: the analysis maps from the record, a refused or
 * impossible write is reported instead of thrown, and only the fields a caller
 * asked to cache are sent.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import type { PocketBaseClient } from "../database/pocketbase-client";
import { PocketBaseMediaAnalysis } from "./pocketbase-media-analysis.ts";

const FILE_URL = "/api/files/files/resource123/paper.pdf";

/** A PocketBase client stub that answers one `files` record. */
function client(
  record: Record<string, unknown>,
  options: { readError?: unknown; writeError?: unknown } = {},
) {
  const calls: unknown[][] = [];
  const stub = {
    collection(name: string) {
      return {
        async getOne(id: string, query: unknown) {
          calls.push(["getOne", name, id, query]);
          if (options.readError) throw options.readError;
          return record;
        },
        async update(id: string, body: Record<string, unknown>) {
          calls.push(["update", name, id, body]);
          if (options.writeError) throw options.writeError;
          return { id, ...body };
        },
      };
    },
    isClientResponseError(error: unknown) {
      return (
        typeof error === "object" &&
        error !== null &&
        typeof (error as { status?: unknown }).status === "number"
      );
    },
  };
  return { calls, stub: stub as unknown as PocketBaseClient };
}

test("reads the cached analysis together with the recorded size", async () => {
  const { calls, stub } = client({
    id: "resource123",
    size: 4096,
    pageCount: 3,
    width: 0,
    height: 0,
    duration: 0,
    coverUrl: "/api/files/files/cover123/cover.jpg",
    hlsUrl: "",
  });

  const analysis = await new PocketBaseMediaAnalysis(stub).read(FILE_URL);

  assert.deepEqual(analysis, {
    pageCount: 3,
    width: 0,
    height: 0,
    duration: 0,
    coverUrl: "/api/files/files/cover123/cover.jpg",
    hlsUrl: "",
    fileSize: 4096,
  });
  assert.deepEqual(calls, [
    [
      "getOne",
      "files",
      "resource123",
      { fields: "size,pageCount,width,height,duration,coverUrl,hlsUrl" },
    ],
  ]);
});

test("a record without a measurement has no cached analysis", async () => {
  const { stub } = client({
    id: "resource123",
    size: 4096,
    pageCount: 0,
    width: 0,
    height: 0,
    duration: 0,
    coverUrl: "",
    hlsUrl: "",
  });

  assert.equal(await new PocketBaseMediaAnalysis(stub).read(FILE_URL), null);
});

test("caches only the fields the analysis produced", async () => {
  const { calls, stub } = client({ id: "resource123" });
  const service = new PocketBaseMediaAnalysis(stub);

  const stored = await service.write(FILE_URL, {
    hlsUrl: "/api/files/files/playlist123/index.m3u8",
    coverUrl: "",
    duration: 12.5,
    width: 640,
    height: 360,
  });

  assert.equal(stored, true);
  assert.deepEqual(calls, [
    [
      "update",
      "files",
      "resource123",
      {
        hlsUrl: "/api/files/files/playlist123/index.m3u8",
        coverUrl: "",
        duration: 12.5,
        width: 640,
        height: 360,
      },
    ],
  ]);
});

test("a refused or impossible write is reported, never thrown", async () => {
  const refused = client(
    { id: "resource123" },
    { writeError: Object.assign(new Error("denied"), { status: 403 }) },
  );
  assert.equal(
    await new PocketBaseMediaAnalysis(refused.stub).write(FILE_URL, {
      pageCount: 3,
    }),
    false,
  );

  const outside = client({ id: "resource123" });
  assert.equal(
    await new PocketBaseMediaAnalysis(outside.stub).write(
      "https://example.test/api/collections/users/records",
      { pageCount: 3 },
    ),
    false,
  );
  assert.deepEqual(outside.calls, []);
});

test("an address outside the file store has no cache", async () => {
  const { calls, stub } = client({ id: "resource123" });

  assert.equal(
    await new PocketBaseMediaAnalysis(stub).read("https://example.test/x.pdf"),
    null,
  );
  assert.deepEqual(calls, []);
});
