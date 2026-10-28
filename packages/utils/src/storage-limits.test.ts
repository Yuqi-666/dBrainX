// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The storage contract decides which blob belongs in which quota bucket, so the
 * categories, the parsing and the fallbacks are pinned here. The PocketBase hook
 * carries a JavaScript copy of the same rules; `scripts/release/
 * storage-limits-hook.test.mjs` compares the two, which keeps this file about
 * the TypeScript side only.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_STORAGE_LIMITS,
  STORAGE_CATEGORY_ENV,
  STORAGE_QUOTA_ENV,
  fileExtension,
  maxFileBytesFor,
  remainingQuotaBytes,
  resolveStorageLimits,
  storageCategoryFor,
} from "./storage-limits.ts";
import { MAX_UPLOAD_BYTES } from "./upload.ts";

test("classifies by reported MIME type before falling back to the extension", () => {
  assert.equal(storageCategoryFor("photo.png"), "image");
  assert.equal(storageCategoryFor("clip.MOV"), "video");
  assert.equal(storageCategoryFor("voice.m4a"), "audio");
  assert.equal(storageCategoryFor("paper.pdf"), "pdf");
  assert.equal(storageCategoryFor("page.html"), "webpage");
  assert.equal(storageCategoryFor("page.htm"), "webpage");
  assert.equal(storageCategoryFor("page.xhtml"), "webpage");
  assert.equal(storageCategoryFor("archive.zip"), "other");
  assert.equal(storageCategoryFor("no-extension"), "other");
  assert.equal(storageCategoryFor(".gitignore"), "other");

  // The browser-reported type wins over a misleading or missing extension.
  assert.equal(storageCategoryFor("download", "image/jpeg"), "image");
  assert.equal(storageCategoryFor("paper.bin", "application/pdf"), "pdf");
  assert.equal(storageCategoryFor("sound.dat", "audio/mpeg"), "audio");
  assert.equal(storageCategoryFor("movie.dat", "video/mp4"), "video");
  assert.equal(storageCategoryFor("page.bin", "text/html"), "webpage");
  assert.equal(
    storageCategoryFor("page.bin", "application/xhtml+xml"),
    "webpage",
  );
  // An unknown MIME type still lets the name decide.
  assert.equal(
    storageCategoryFor("diagram.png", "application/octet-stream"),
    "image",
  );
});

test("extracts a lower-case extension without trusting a leading dot", () => {
  assert.equal(fileExtension("archive.tar.gz"), "gz");
  assert.equal(fileExtension("UPPER.PDF"), "pdf");
  assert.equal(fileExtension(".hidden"), "");
  assert.equal(fileExtension("trailing."), "");
  assert.equal(fileExtension("plain"), "");
});

test("defaults are internally consistent and usable", () => {
  assert.equal(DEFAULT_STORAGE_LIMITS.maxFileBytes.video, MAX_UPLOAD_BYTES);
  assert.equal(DEFAULT_STORAGE_LIMITS.maxFileBytes.webpage, 16 * 1024 ** 2);
  assert.ok(DEFAULT_STORAGE_LIMITS.userQuotaBytes > 0);
  assert.ok(
    DEFAULT_STORAGE_LIMITS.userQuotaBytes >=
      DEFAULT_STORAGE_LIMITS.maxFileBytes.video,
  );
  for (const bytes of Object.values(DEFAULT_STORAGE_LIMITS.maxFileBytes)) {
    assert.ok(bytes > 0);
  }
});

test("environment overrides win and the quota accepts an explicit zero", () => {
  const limits = resolveStorageLimits({
    [STORAGE_QUOTA_ENV]: "0",
    [STORAGE_CATEGORY_ENV.image]: String(5 * 1024 ** 2),
    [STORAGE_CATEGORY_ENV.video]: "123456",
  });

  assert.equal(limits.userQuotaBytes, 0);
  assert.equal(limits.maxFileBytes.image, 5 * 1024 ** 2);
  assert.equal(limits.maxFileBytes.video, 123456);
  // Untouched categories keep their default.
  assert.equal(
    limits.maxFileBytes.audio,
    DEFAULT_STORAGE_LIMITS.maxFileBytes.audio,
  );
});

test("invalid values fall back instead of throwing or locking storage", () => {
  const limits = resolveStorageLimits({
    [STORAGE_QUOTA_ENV]: "not-a-number",
    [STORAGE_CATEGORY_ENV.image]: "-1",
    [STORAGE_CATEGORY_ENV.video]: "1.5",
    [STORAGE_CATEGORY_ENV.audio]: "",
    [STORAGE_CATEGORY_ENV.pdf]: "99999999999999999999",
  });

  assert.equal(limits.userQuotaBytes, DEFAULT_STORAGE_LIMITS.userQuotaBytes);
  assert.equal(
    limits.maxFileBytes.image,
    DEFAULT_STORAGE_LIMITS.maxFileBytes.image,
  );
  assert.equal(
    limits.maxFileBytes.video,
    DEFAULT_STORAGE_LIMITS.maxFileBytes.video,
  );
  assert.equal(
    limits.maxFileBytes.audio,
    DEFAULT_STORAGE_LIMITS.maxFileBytes.audio,
  );
  assert.equal(
    limits.maxFileBytes.pdf,
    DEFAULT_STORAGE_LIMITS.maxFileBytes.pdf,
  );
});

test("a per-category ceiling is resolved by the same classification", () => {
  const limits = resolveStorageLimits({
    [STORAGE_CATEGORY_ENV.image]: "1000",
    [STORAGE_CATEGORY_ENV.video]: "2000",
  });
  assert.equal(maxFileBytesFor(limits, "a.png"), 1000);
  assert.equal(maxFileBytesFor(limits, "a.bin", "video/mp4"), 2000);
  assert.equal(
    maxFileBytesFor(limits, "a.pdf"),
    DEFAULT_STORAGE_LIMITS.maxFileBytes.pdf,
  );
});

test("remaining quota is null when unlimited or already exceeded", () => {
  assert.equal(
    remainingQuotaBytes({ ...DEFAULT_STORAGE_LIMITS, userQuotaBytes: 0 }, 5),
    null,
  );
  assert.equal(
    remainingQuotaBytes({ ...DEFAULT_STORAGE_LIMITS, userQuotaBytes: 100 }, 30),
    70,
  );
  assert.equal(
    remainingQuotaBytes(
      { ...DEFAULT_STORAGE_LIMITS, userQuotaBytes: 100 },
      300,
    ),
    0,
  );
});
