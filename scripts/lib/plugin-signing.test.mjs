// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Guards the plugin manifest signature: the counter fixture must verify with
 * the committed test public key, any edit to a shipped file must break the
 * checksum, and a manifest without a signature must never be accepted.
 *
 * The fixture is copied into a temporary directory for each tamper case, so the
 * repository tree is never written by this suite.
 */
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  loadTestKey,
  pluginChecksum,
  readTrustedKeys,
  signChecksum,
  testKeyId,
  trustedKeysFixtureName,
  untrustedPlugin,
  verifyPlugin,
} from "./plugin-signing.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const counterDirectory = join(root, "plugins", "counter");

/** The value of `DBRAINX_PLUGIN_TRUSTED_KEYS` the fixture ships. */
async function fixtureTrustedKeys() {
  return readFile(join(counterDirectory, trustedKeysFixtureName), "utf8");
}

/** A throwaway copy of the counter plugin, without its dependency tree. */
async function copyFixture() {
  const temporary = await mkdtemp(join(tmpdir(), "dbrainx-plugin-signing-"));
  const directory = join(temporary, "counter");
  await cp(counterDirectory, directory, {
    recursive: true,
    filter: (source) => !source.split(sep).includes("node_modules"),
  });
  return {
    directory,
    cleanup: () => rm(temporary, { recursive: true, force: true }),
  };
}

/** Verify a copied fixture with the committed trusted keys. */
async function verifyCopy(directory) {
  return verifyPlugin({
    directory,
    trustedKeys: await fixtureTrustedKeys(),
    allowTestKey: true,
  });
}

describe("the signed counter fixture", () => {
  it("verifies with the committed test public key", async () => {
    const trustedKeys = await fixtureTrustedKeys();
    assert.deepEqual(Object.keys(JSON.parse(trustedKeys)), [testKeyId]);
    const result = await verifyPlugin({
      directory: counterDirectory,
      trustedKeys,
      allowTestKey: true,
    });
    assert.equal(result.ok, true, result.reason);
    const manifest = JSON.parse(
      await readFile(join(counterDirectory, "plugin.json"), "utf8"),
    );
    assert.equal(result.checksum, manifest.checksum);
    assert.equal(result.publicKeyId, testKeyId);
    assert.match(manifest.signature, /^ed25519:[A-Za-z0-9+/]{86}==$/);
    for (const covered of [
      "plugin.json",
      "package.json",
      "plugin-id.ts",
      "server/index.ts",
      "server/index.test.ts",
      "ui/index.ts",
      "ui/counter-content.ts",
      trustedKeysFixtureName,
    ])
      assert.ok(result.files.includes(covered), `${covered} is not covered`);
    assert.equal(
      result.files.some((path) => path.includes("node_modules")),
      false,
      "an installed dependency tree is not plugin code",
    );
  });

  it("signs the same files into the same checksum and signature", async () => {
    const key = await loadTestKey();
    const manifest = JSON.parse(
      await readFile(join(counterDirectory, "plugin.json"), "utf8"),
    );
    const first = await pluginChecksum(counterDirectory);
    const second = await pluginChecksum(counterDirectory);
    assert.equal(first.checksum, second.checksum);
    assert.deepEqual(first.files, second.files);
    assert.deepEqual(
      first.files.map((file) => file.path),
      [...first.files.map((file) => file.path)].sort(),
      "covered paths are sorted",
    );
    const signature = signChecksum({
      manifest,
      checksum: first.checksum,
      privateKey: key.privateKey,
    });
    assert.equal(signature, manifest.signature);
    assert.equal(
      signChecksum({
        manifest,
        checksum: first.checksum,
        privateKey: key.privateKey,
      }),
      signature,
    );
  });

  it("produces the same signature from a manifest without the three fields", async () => {
    // A first run signs a manifest that holds no `checksum`, `signature` or
    // `publicKeyId`. It must still reach the committed values, otherwise the
    // second run would rewrite the file.
    const committed = JSON.parse(
      await readFile(join(counterDirectory, "plugin.json"), "utf8"),
    );
    const { directory, cleanup } = await copyFixture();
    try {
      const unsigned = { ...committed };
      delete unsigned.checksum;
      delete unsigned.signature;
      delete unsigned.publicKeyId;
      await writeFile(
        join(directory, "plugin.json"),
        `${JSON.stringify(unsigned, null, 2)}\n`,
      );
      const signed = { ...unsigned, publicKeyId: committed.publicKeyId };
      const { checksum } = await pluginChecksum(directory, { manifest: signed });
      assert.equal(checksum, committed.checksum);
      assert.equal(
        signChecksum({
          manifest: signed,
          checksum,
          privateKey: (await loadTestKey()).privateKey,
        }),
        committed.signature,
      );
    } finally {
      await cleanup();
    }
  });
});

describe("plugin tampering", () => {
  it("fails the checksum for every covered source file", async () => {
    const { files } = await pluginChecksum(counterDirectory);
    const sources = files
      .map((file) => file.path)
      .filter(
        (path) => path !== "plugin.json" && path !== trustedKeysFixtureName,
      );
    assert.ok(sources.length >= 8, `too few sources: ${sources.join(", ")}`);
    for (const path of sources) {
      const { directory, cleanup } = await copyFixture();
      try {
        const file = join(directory, path);
        const bytes = Buffer.from(await readFile(file));
        bytes[0] ^= 0xff;
        await writeFile(file, bytes);
        const result = await verifyCopy(directory);
        assert.equal(result.ok, false, `${path} still verified`);
        assert.equal(result.code, untrustedPlugin);
        assert.match(result.reason, /hash to/, `${path}: ${result.reason}`);
      } finally {
        await cleanup();
      }
    }
  });

  it("fails the checksum for an edited manifest field", async () => {
    const { directory, cleanup } = await copyFixture();
    try {
      const path = join(directory, "plugin.json");
      const manifest = JSON.parse(await readFile(path, "utf8"));
      manifest.nodeTypes = ["counter", "counter-copy"];
      await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`);
      const result = await verifyCopy(directory);
      assert.equal(result.ok, false);
      assert.equal(result.code, untrustedPlugin);
      assert.match(result.reason, /hash to/);
    } finally {
      await cleanup();
    }
  });

  it("refuses a checksum that has no signature", async () => {
    const { directory, cleanup } = await copyFixture();
    try {
      const path = join(directory, "plugin.json");
      const manifest = JSON.parse(await readFile(path, "utf8"));
      delete manifest.signature;
      await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`);
      const result = await verifyCopy(directory);
      assert.equal(result.ok, false);
      assert.equal(result.code, untrustedPlugin);
      assert.match(result.reason, /no signature/);
    } finally {
      await cleanup();
    }
  });

  it("refuses a manifest that declares no checksum", async () => {
    const { directory, cleanup } = await copyFixture();
    try {
      const path = join(directory, "plugin.json");
      const manifest = JSON.parse(await readFile(path, "utf8"));
      delete manifest.checksum;
      await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`);
      const result = await verifyCopy(directory);
      assert.equal(result.ok, false);
      assert.equal(result.code, untrustedPlugin);
      assert.match(result.reason, /no checksum/);
    } finally {
      await cleanup();
    }
  });
});

describe("the trusted key set", () => {
  it("refuses the test key unless the caller allows it", async () => {
    const trustedKeys = await fixtureTrustedKeys();
    await assert.rejects(
      readTrustedKeys(trustedKeys),
      /lists the test-only key "dbrainx\.test-key"/,
    );
    await assert.rejects(
      verifyPlugin({ directory: counterDirectory, trustedKeys }),
      /test-only key/,
    );
  });

  it("refuses a manifest whose key id is not trusted", async () => {
    const { publicKey } = generateKeyPairSync("ed25519");
    const trustedKeys = {
      "elsewhere.key": publicKey.export({ format: "der", type: "spki" }).toString(
        "base64",
      ),
    };
    const result = await verifyPlugin({
      directory: counterDirectory,
      trustedKeys,
      allowTestKey: true,
    });
    assert.equal(result.ok, false);
    assert.equal(result.code, untrustedPlugin);
    assert.match(result.reason, /untrusted key "dbrainx\.test-key"/);
  });

  it("refuses a signature that the named key does not produce", async () => {
    const { publicKey } = generateKeyPairSync("ed25519");
    const trustedKeys = {
      [testKeyId]: publicKey.export({ format: "der", type: "spki" }).toString(
        "base64",
      ),
    };
    const result = await verifyPlugin({
      directory: counterDirectory,
      trustedKeys,
      allowTestKey: true,
    });
    assert.equal(result.ok, false);
    assert.equal(result.code, untrustedPlugin);
    assert.match(result.reason, /does not verify/);
  });

  it("rejects a malformed key map", async () => {
    await assert.rejects(readTrustedKeys("not json"), /not valid JSON/);
    await assert.rejects(readTrustedKeys({}), /lists no key/);
    await assert.rejects(readTrustedKeys({ "broken.key": "not a key" }), {
      message: /"broken\.key" is not a base64 DER public key/,
    });
  });
});
