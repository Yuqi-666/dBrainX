// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Signs one plugin manifest with a key.
 *
 * `node scripts/plugin-sign.mjs --test-key [plugin directory]` uses the
 * repository's **test-only** key pair (`scripts/lib/plugin-test-key.json`),
 * writes the public key into the fixture's `trusted-keys.test.json` (the value
 * a test passes as `DBRAINX_PLUGIN_TRUSTED_KEYS`), and writes the `checksum`,
 * `publicKeyId` and `signature` fields into the plugin's `plugin.json`. The
 * default plugin directory is `plugins/counter`, the fixture the plugin-host
 * tests load.
 *
 * `node scripts/plugin-sign.mjs --verify [plugin directory]` recomputes the
 * checksum and checks the signature with the fixture's trusted keys. It never
 * writes. It is the same primitive the plugin host calls during enablement
 * (`scripts/lib/plugin-signing.mjs`), so a passing `--verify` is the artifact
 * the host must also accept.
 *
 * The test key never reaches production: a deployment sets
 * `DBRAINX_PLUGIN_TRUSTED_KEYS` to its own `keyId -> base64 public key` map,
 * and the verification module refuses the test key id and public key unless a
 * test explicitly allows them. The private half exists so the fixture is real;
 * it is committed on purpose and must never be trusted.
 *
 * Signing is idempotent: the same files and manifest produce the same checksum
 * and the same Ed25519 signature, so re-running the command changes no byte.
 */
import { readFile, writeFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { manifestName } from "./lib/plugin-packages.mjs";
import {
  ensureTestKey,
  pluginChecksum,
  signChecksum,
  trustedKeysFixtureName,
  verifyPlugin,
} from "./lib/plugin-signing.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));

/** The fixture the plugin-host tests load. */
export const defaultPluginDirectory = "plugins/counter";

function fail(message) {
  console.error(message);
  process.exitCode = 1;
}

function displayName(path) {
  return relative(root, path).split("\\").join("/");
}

/** Sign the manifest of `directory` with the test key; returns what it wrote. */
export async function signWithTestKey(directory) {
  if (process.env.NODE_ENV === "production")
    throw new Error(
      "the repository key is test-only; a production manifest is signed with the deployment's own key",
    );
  const key = await ensureTestKey();
  const manifestPath = resolve(directory, manifestName);
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const trustedKeysPath = resolve(directory, trustedKeysFixtureName);
  await writeFile(
    trustedKeysPath,
    `${JSON.stringify({ [key.id]: key.publicKeyBase64 }, null, 2)}\n`,
    "utf8",
  );
  // `publicKeyId` is part of the covered manifest, so set it before hashing:
  // the first run and every later run must hash the same manifest.
  const signed = { ...manifest, publicKeyId: key.id };
  const { checksum } = await pluginChecksum(directory, { manifest: signed });
  const signature = signChecksum({
    manifest: signed,
    checksum,
    privateKey: key.privateKey,
  });
  await writeFile(
    manifestPath,
    `${JSON.stringify(
      { ...manifest, checksum, publicKeyId: key.id, signature },
      null,
      2,
    )}\n`,
    "utf8",
  );
  return {
    keyId: key.id,
    publicKey: key.publicKeyBase64,
    checksum,
    signature,
    manifestPath,
    trustedKeysPath,
  };
}

/** Verify `directory` with the fixture's trusted keys. */
export async function verifyFixture(directory) {
  const trustedKeysPath = resolve(directory, trustedKeysFixtureName);
  const trustedKeys = await readFile(trustedKeysPath, "utf8").catch(() => {
    throw new Error(
      `no ${trustedKeysFixtureName} in ${displayName(directory)}; run \`node scripts/plugin-sign.mjs --test-key ${displayName(directory)}\` first`,
    );
  });
  return verifyPlugin({ directory, trustedKeys, allowTestKey: true });
}

const usage = [
  "Usage:",
  "  node scripts/plugin-sign.mjs --test-key [plugin directory]",
  "  node scripts/plugin-sign.mjs --verify [plugin directory]",
  "",
  `The plugin directory defaults to ${defaultPluginDirectory}.`,
].join("\n");

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const args = process.argv.slice(2);
  const [mode, ...rest] = args;
  const unknown = rest.filter((arg) => arg.startsWith("-"));
  if (
    (mode !== "--test-key" && mode !== "--verify") ||
    unknown.length > 0 ||
    rest.length > 1
  ) {
    if (mode !== undefined) fail(`Unknown argument: ${args.join(" ")}`);
    console.error(usage);
    process.exitCode = 2;
  } else {
    const directory = resolve(root, rest[0] ?? defaultPluginDirectory);
    try {
      if (mode === "--test-key") {
        const signed = await signWithTestKey(directory);
        console.log(`key id: ${signed.keyId}`);
        console.log(`public key: ${signed.publicKey}`);
        console.log(`checksum: ${signed.checksum}`);
        console.log(`signature: ${signed.signature}`);
        console.log(`manifest: ${displayName(signed.manifestPath)}`);
        console.log(
          `trusted keys fixture: ${displayName(signed.trustedKeysPath)}`,
        );
      } else {
        const result = await verifyFixture(directory);
        if (result.ok) {
          console.log(
            `OK ${result.checksum} verified with "${result.publicKeyId}" (${result.files.length} files)`,
          );
        } else {
          console.error(`${result.code}: ${result.reason}`);
          process.exitCode = 1;
        }
      }
    } catch (error) {
      fail(error.message);
    }
  }
}
