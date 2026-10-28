// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The upload hook and the TypeScript storage contract must agree.
 *
 * `pb/pb_hooks/lib/storage-limits.js` repeats the defaults, the category table
 * and the MIME table because PocketBase's hook runtime cannot import TypeScript.
 * This test loads the hook through a `node:vm` context (the same way
 * `edge-hook.test.mjs` loads the edge validator) and compares both copies:
 *
 *   * defaults and environment parsing,
 *   * the category every known extension maps to,
 *   * the enforcement itself — the ceiling, the quota, and the metadata the hook
 *     stamps on the record.
 *
 * It also pins the wiring: `files.pb.js` must call the module for every create
 * request, or the policy would simply not run.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";

import * as contract from "../../packages/utils/src/storage-limits.ts";

const HOOK_SOURCE = readFileSync(
  new URL("../../pb/pb_hooks/lib/storage-limits.js", import.meta.url),
  "utf8",
);

/**
 * Copies a value out of the hook's `node:vm` realm.
 *
 * Values built inside the context have that realm's `Object.prototype`, and
 * `assert.deepEqual` (strict) compares prototypes, so the comparison has to be
 * made on plain JSON shapes.
 */
function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

/** Loads the hook module with a fake `$os` and fake PocketBase error classes. */
function loadHook(env = {}) {
  class BadRequestError extends Error {}
  class UnauthorizedError extends Error {}
  const scope = {
    module: { exports: {} },
    BadRequestError,
    UnauthorizedError,
    $os: {
      getenv: (name) => env[name],
    },
  };
  runInNewContext(HOOK_SOURCE, scope);
  return { ...scope.module.exports, BadRequestError, UnauthorizedError };
}

test("the hook repeats the TypeScript defaults", () => {
  const hook = loadHook();
  assert.deepEqual(plain(hook.DEFAULT_LIMITS), contract.DEFAULT_STORAGE_LIMITS);
  assert.deepEqual(plain(hook.CATEGORY_EXTENSIONS), {
    image: [
      "png", "jpg", "jpeg", "gif", "webp", "avif", "bmp", "svg", "ico",
      "heic", "heif", "tif", "tiff",
    ],
    video: [
      "mp4", "m4v", "mov", "webm", "mkv", "avi", "mpg", "mpeg", "ogv", "3gp",
      "ts", "m3u8",
    ],
    audio: [
      "mp3", "wav", "ogg", "oga", "flac", "m4a", "aac", "opus", "wma", "aiff",
      "aif",
    ],
    pdf: ["pdf"],
    webpage: ["html", "htm", "xhtml"],
  });
});

test("the hook classifies every known extension exactly like the contract", () => {
  const hook = loadHook();
  for (const [category, extensions] of Object.entries(hook.CATEGORY_EXTENSIONS)) {
    for (const extension of extensions) {
      const fileName = `fixture.${extension}`;
      assert.equal(
        hook.categoryForName(fileName),
        category,
        `${fileName}: hook category`,
      );
      assert.equal(
        contract.storageCategoryFor(fileName),
        category,
        `${fileName}: contract category`,
      );
      // The MIME type the hook writes must classify back to the same category
      // through the contract's MIME-first path.
      const mimeType = hook.mimeTypeForName(fileName);
      assert.equal(
        contract.storageCategoryFor(fileName, mimeType),
        category,
        `${fileName}: contract category from ${mimeType}`,
      );
    }
  }

  for (const name of ["archive.zip", "no-extension", ".gitignore", "trailing."]) {
    assert.equal(hook.categoryForName(name), "other", name);
    assert.equal(contract.storageCategoryFor(name), "other", name);
  }
});

test("the hook resolves the same limits from the same environment", () => {
  const environments = [
    {},
    {
      DBRAINX_STORAGE_USER_QUOTA_BYTES: "0",
      DBRAINX_STORAGE_MAX_IMAGE_BYTES: "1024",
      DBRAINX_STORAGE_MAX_VIDEO_BYTES: "2048",
      DBRAINX_STORAGE_MAX_WEBPAGE_BYTES: "123456",
    },
    {
      DBRAINX_STORAGE_USER_QUOTA_BYTES: "not-a-number",
      DBRAINX_STORAGE_MAX_IMAGE_BYTES: "-1",
      DBRAINX_STORAGE_MAX_VIDEO_BYTES: "1.5",
      DBRAINX_STORAGE_MAX_AUDIO_BYTES: "",
      DBRAINX_STORAGE_MAX_PDF_BYTES: "99999999999999999999",
    },
  ];

  for (const env of environments) {
    assert.deepEqual(
      plain(loadHook(env).resolveLimits()),
      contract.resolveStorageLimits(env),
    );
  }
});

/** A PocketBase-shaped create event the hook can be called with. */
function createEvent({
  auth = { id: "owner" },
  files = [{ originalName: "photo.png", name: "photo.png", size: 100 }],
  existingSizes = [],
} = {}) {
  const values = new Map();
  const event = {
    auth,
    values,
    record: {
      set: (key, value) => values.set(key, value),
      getString: (key) => values.get(key) ?? "",
      getUnsavedFiles: () => files,
    },
    app: {
      findRecordsByFilter: () =>
        existingSizes.map((size) => ({ getFloat: () => size })),
    },
    next: () => "saved",
  };
  return event;
}

test("the hook stamps owner, size, MIME type and default display name", () => {
  const hook = loadHook();
  const event = createEvent();
  assert.equal(hook.enforceFileCreate(event), "saved");
  assert.equal(event.values.get("ownerId"), "owner");
  assert.equal(event.values.get("size"), 100);
  assert.equal(event.values.get("mimeType"), "image/png");
  assert.equal(event.values.get("displayName"), "photo.png");
});

test("an unauthenticated create is rejected", () => {
  const hook = loadHook();
  assert.throws(
    () => hook.enforceFileCreate(createEvent({ auth: null })),
    /Authentication required/,
  );
});

test("the category ceiling is enforced", () => {
  const hook = loadHook({ DBRAINX_STORAGE_MAX_IMAGE_BYTES: "50" });
  const event = createEvent({
    files: [{ originalName: "photo.png", name: "photo.png", size: 51 }],
  });
  assert.throws(() => hook.enforceFileCreate(event), /image limit is 50/);
});

test("the per-user quota counts what is already stored", () => {
  const hook = loadHook({ DBRAINX_STORAGE_USER_QUOTA_BYTES: "1000" });

  // 900 stored + 100 incoming fits exactly.
  const fits = createEvent({
    files: [{ originalName: "photo.png", name: "photo.png", size: 100 }],
    existingSizes: [400, 500],
  });
  assert.equal(hook.enforceFileCreate(fits), "saved");

  const exceeds = createEvent({
    files: [{ originalName: "photo.png", name: "photo.png", size: 101 }],
    existingSizes: [900],
  });
  assert.throws(() => hook.enforceFileCreate(exceeds), /Storage quota exceeded/);
});

test("a zero quota disables only the total check", () => {
  const hook = loadHook({ DBRAINX_STORAGE_USER_QUOTA_BYTES: "0" });
  const event = createEvent({
    files: [{ originalName: "photo.png", name: "photo.png", size: 100 }],
    existingSizes: [10 * 1024 ** 3],
  });
  assert.equal(hook.enforceFileCreate(event), "saved");
});

/** A PocketBase-shaped update event the hook can be called with. */
function updateEvent({
  auth = { id: "owner" },
  files = [{ originalName: "drawing.png", name: "drawing.png", size: 100 }],
  previous = { size: 0, ownerId: "owner", displayName: "" },
  storedSizes = [],
  findFails = false,
} = {}) {
  const values = new Map();
  const original = {
    id: "record-1",
    getString: (key) => previous[key] ?? "",
    getFloat: (key) => previous[key] ?? 0,
  };
  const event = {
    auth,
    values,
    queries: [],
    record: {
      id: "record-1",
      set: (key, value) => values.set(key, value),
      getString: (key) => values.get(key) ?? previous[key] ?? "",
      getUnsavedFiles: () => files,
      original: () => original,
    },
    app: {
      findRecordsByFilter: (...query) => {
        event.queries.push(query);
        if (findFails) throw new Error("filter failed");
        return storedSizes.map((size) => ({ getFloat: () => size }));
      },
    },
    next: () => "saved",
  };
  return event;
}

test("an update that replaces the file recomputes size and MIME type", () => {
  const hook = loadHook();
  const event = updateEvent();
  assert.equal(hook.enforceFileUpdate(event), "saved");
  assert.equal(event.values.get("size"), 100);
  assert.equal(event.values.get("mimeType"), "image/png");
  // The owner and the record id stay; the hook never re-stamps the owner.
  assert.equal(event.values.has("ownerId"), false);
});

test("a replacement changes the MIME type together with the bytes", () => {
  const hook = loadHook();
  const event = updateEvent({
    files: [{ originalName: "drawing.png", name: "drawing.png", size: 50 }],
    previous: { size: 400, ownerId: "owner", displayName: "Drawing" },
    storedSizes: [50],
  });
  assert.equal(hook.enforceFileUpdate(event), "saved");
  assert.equal(event.values.get("size"), 50);
  assert.equal(event.values.get("mimeType"), "image/png");
});

test("a non-empty display name is kept when the file is replaced", () => {
  const hook = loadHook();
  const event = updateEvent({
    previous: { size: 10, ownerId: "owner", displayName: "My drawing" },
    storedSizes: [10],
  });
  // The record stub has no `displayName` in the new values, but the original
  // carries one, so the hook must not overwrite it.
  assert.equal(hook.enforceFileUpdate(event), "saved");
  assert.equal(event.values.get("displayName"), undefined);
});

test("an empty display name falls back to the replacement file name", () => {
  const hook = loadHook();
  const event = updateEvent();
  assert.equal(hook.enforceFileUpdate(event), "saved");
  assert.equal(event.values.get("displayName"), "drawing.png");
});

test("an update without a new file passes straight through", () => {
  const hook = loadHook();
  const event = updateEvent({ files: [] });
  assert.equal(hook.enforceFileUpdate(event), "saved");
  assert.equal(event.values.size, 0);
  // No quota query is needed for a rename or an analysis-cache write.
  assert.deepEqual(event.queries, []);
});

test("an unauthenticated update is rejected", () => {
  const hook = loadHook();
  assert.throws(
    () => hook.enforceFileUpdate(updateEvent({ auth: null })),
    /Authentication required/,
  );
});

test("the category ceiling applies to the replacement", () => {
  const hook = loadHook({ DBRAINX_STORAGE_MAX_IMAGE_BYTES: "50" });
  const event = updateEvent({
    files: [{ originalName: "drawing.png", name: "drawing.png", size: 51 }],
  });
  assert.throws(() => hook.enforceFileUpdate(event), /image limit is 50/);
});

test("the quota charges only the difference the replacement adds", () => {
  const hook = loadHook({ DBRAINX_STORAGE_USER_QUOTA_BYTES: "1000" });

  // The record itself holds 600 of the 1000 stored bytes; the owner's other
  // records hold 400. Replacing 600 with 600 therefore fits exactly.
  const fits = updateEvent({
    files: [{ originalName: "drawing.png", name: "drawing.png", size: 600 }],
    previous: { size: 600, ownerId: "owner", displayName: "" },
    storedSizes: [400, 600],
  });
  assert.equal(hook.enforceFileUpdate(fits), "saved");

  // A replacement also works when the record alone fills the quota: its old
  // bytes are removed before the new ones are added.
  const sameSize = updateEvent({
    files: [{ originalName: "drawing.png", name: "drawing.png", size: 1000 }],
    previous: { size: 1000, ownerId: "owner", displayName: "" },
    storedSizes: [1000],
  });
  assert.equal(hook.enforceFileUpdate(sameSize), "saved");

  const exceeds = updateEvent({
    files: [{ originalName: "drawing.png", name: "drawing.png", size: 601 }],
    previous: { size: 600, ownerId: "owner", displayName: "" },
    storedSizes: [400, 600],
  });
  assert.throws(() => hook.enforceFileUpdate(exceeds), /Storage quota exceeded/);
});

test("a zero quota disables only the total check on update", () => {
  const hook = loadHook({ DBRAINX_STORAGE_USER_QUOTA_BYTES: "0" });
  const event = updateEvent({
    files: [{ originalName: "drawing.png", name: "drawing.png", size: 100 }],
    previous: { size: 10 * 1024 ** 3, ownerId: "owner", displayName: "" },
    storedSizes: [10 * 1024 ** 3],
  });
  assert.equal(hook.enforceFileUpdate(event), "saved");
});

test("files.pb.js routes every create request through the hook module", () => {
  const source = readFileSync(
    new URL("../../pb/pb_hooks/files.pb.js", import.meta.url),
    "utf8",
  );
  assert.match(source, /lib\/storage-limits\.js/);
  assert.match(source, /enforceFileCreate/);
  assert.match(source, /onRecordCreateRequest/);
  // The in-place replacement must be enforced on the update path too.
  assert.match(source, /enforceFileUpdate/);
  assert.match(source, /onRecordUpdateRequest\([\s\S]*?"files"\)/);
});
