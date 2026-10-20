// SPDX-License-Identifier: AGPL-3.0-only

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { MediaCookieCipher } from "./media-cookie-cipher.ts";

/**
 * The cipher is the only thing between a saved site login and the database, so
 * the cases below pin its contract: a round trip, a different nonce per call, a
 * stable version tag and a hard failure on any tampering.
 */

const SECRET = "development-test-secret";
const COOKIE = [
  "# Netscape HTTP Cookie File",
  ".bilibili.com\tTRUE\t/\tTRUE\t1999999999\tSESSDATA\tsecret-value",
  "",
].join("\n");

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

test("encrypts and decrypts a cookie without storing the plaintext", () => {
  const cipher = new MediaCookieCipher(SECRET);
  const encrypted = cipher.encrypt(COOKIE);

  assert.equal(encrypted.ciphertext.includes("secret-value"), false);
  assert.match(encrypted.ciphertext, /^[0-9a-f]+$/);
  assert.match(encrypted.nonce, /^[0-9a-f]{24}$/); // 12 bytes
  assert.match(encrypted.tag, /^[0-9a-f]{32}$/); // 16 bytes

  assert.equal(cipher.decrypt(encrypted), COOKIE);

  // A second instance with the same secret reads the same stored parts.
  assert.equal(
    new MediaCookieCipher(SECRET).decrypt({
      ciphertext: encrypted.ciphertext,
      nonce: encrypted.nonce,
      tag: encrypted.tag,
    }),
    COOKIE,
  );
});

test("every encryption uses a fresh nonce", () => {
  const cipher = new MediaCookieCipher(SECRET);
  const first = cipher.encrypt(COOKIE);
  const second = cipher.encrypt(COOKIE);

  assert.notEqual(first.nonce, second.nonce);
  assert.notEqual(first.ciphertext, second.ciphertext);
  assert.notEqual(first.tag, second.tag);
  // Same plaintext, different ciphertext: the version tags differ as well.
  assert.notEqual(first.version, second.version);
  assert.equal(cipher.decrypt(first), COOKIE);
  assert.equal(cipher.decrypt(second), COOKIE);
});

test("version is the first 16 hex characters of sha256(ciphertext)", () => {
  const cipher = new MediaCookieCipher(SECRET);
  const encrypted = cipher.encrypt(COOKIE);

  assert.equal(encrypted.version, sha256(encrypted.ciphertext).slice(0, 16));
  assert.equal(cipher.version(encrypted.ciphertext), encrypted.version);
  // Stable for a stored ciphertext, which is what the probe cache uses.
  assert.equal(
    cipher.version(encrypted.ciphertext),
    cipher.version(encrypted.ciphertext),
  );
});

test("decrypt rejects a tampered ciphertext, nonce or tag", () => {
  const cipher = new MediaCookieCipher(SECRET);
  const encrypted = cipher.encrypt(COOKIE);

  /** Flips the last hex digit of a value, keeping it valid hex. */
  const tamper = (value: string): string =>
    value.slice(0, -1) + (value.endsWith("0") ? "1" : "0");

  assert.throws(
    () =>
      cipher.decrypt({
        ...encrypted,
        ciphertext: tamper(encrypted.ciphertext),
      }),
    /could not be decrypted/,
  );
  assert.throws(
    () => cipher.decrypt({ ...encrypted, nonce: tamper(encrypted.nonce) }),
    /could not be decrypted/,
  );
  assert.throws(
    () => cipher.decrypt({ ...encrypted, tag: tamper(encrypted.tag) }),
    /could not be decrypted/,
  );
  // A different secret is just another kind of tampering.
  assert.throws(
    () => new MediaCookieCipher("another-secret").decrypt(encrypted),
    /could not be decrypted/,
  );
  // Malformed parts are rejected before reaching the cipher.
  assert.throws(
    () => cipher.decrypt({ ...encrypted, ciphertext: "zz" }),
    /not valid hex/,
  );
  assert.throws(
    () => cipher.decrypt({ ...encrypted, nonce: "" }),
    /wrong length/,
  );
});

test("an empty secret is a configuration error, not an unprotected cipher", () => {
  assert.throws(() => new MediaCookieCipher(""), /cookie secret is empty/);
  assert.throws(() => new MediaCookieCipher("   "), /cookie secret is empty/);
});

test("fromEnvironment reads the configured secret before generating one", () => {
  const previousBranded = process.env.DBRAIN_MEDIA_COOKIE_SECRET;
  const previousLegacy = process.env.MEDIA_COOKIE_SECRET;
  try {
    process.env.MEDIA_COOKIE_SECRET = "legacy-secret";
    process.env.DBRAIN_MEDIA_COOKIE_SECRET = "branded-secret";
    // The branded variable wins.
    assert.equal(
      new MediaCookieCipher("branded-secret").decrypt(
        MediaCookieCipher.fromEnvironment().encrypt("cookie"),
      ),
      "cookie",
    );

    // The legacy variable is the fallback for a deployment written before the
    // rename.
    delete process.env.DBRAIN_MEDIA_COOKIE_SECRET;
    assert.equal(
      new MediaCookieCipher("legacy-secret").decrypt(
        MediaCookieCipher.fromEnvironment().encrypt("cookie"),
      ),
      "cookie",
    );

    // A blank value counts as unset, exactly like every other variable here.
    process.env.DBRAIN_MEDIA_COOKIE_SECRET = "   ";
    assert.equal(
      new MediaCookieCipher("legacy-secret").decrypt(
        MediaCookieCipher.fromEnvironment().encrypt("cookie"),
      ),
      "cookie",
    );
  } finally {
    if (previousBranded === undefined)
      delete process.env.DBRAIN_MEDIA_COOKIE_SECRET;
    else process.env.DBRAIN_MEDIA_COOKIE_SECRET = previousBranded;
    if (previousLegacy === undefined) delete process.env.MEDIA_COOKIE_SECRET;
    else process.env.MEDIA_COOKIE_SECRET = previousLegacy;
  }
});

test("fromEnvironment generates and reuses a private development secret", () => {
  const previousBranded = process.env.DBRAIN_MEDIA_COOKIE_SECRET;
  const previousLegacy = process.env.MEDIA_COOKIE_SECRET;
  try {
    delete process.env.DBRAIN_MEDIA_COOKIE_SECRET;
    delete process.env.MEDIA_COOKIE_SECRET;

    const first = MediaCookieCipher.fromEnvironment();
    const encrypted = first.encrypt("cookie");

    // A later call (a restart) must decrypt what the earlier one stored: the
    // secret was persisted rather than generated again.
    const second = MediaCookieCipher.fromEnvironment();
    assert.equal(second.decrypt(encrypted), "cookie");

    // The generated file is a credential: `<repo>/.cache/media-cookie-secret`
    // exists and is readable only by the owner.
    const repositoryRoot = fileURLToPath(
      new URL("../../../../", import.meta.url),
    );
    const mode =
      statSync(join(repositoryRoot, ".cache", "media-cookie-secret")).mode &
      0o777;
    assert.equal(mode, 0o600);
  } finally {
    if (previousBranded === undefined)
      delete process.env.DBRAIN_MEDIA_COOKIE_SECRET;
    else process.env.DBRAIN_MEDIA_COOKIE_SECRET = previousBranded;
    if (previousLegacy === undefined) delete process.env.MEDIA_COOKIE_SECRET;
    else process.env.MEDIA_COOKIE_SECRET = previousLegacy;
  }
});
