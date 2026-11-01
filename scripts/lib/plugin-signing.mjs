// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The `checksum` and `signature` of a plugin manifest, shared by
 * `scripts/plugin-sign.mjs` and the plugin host's enablement gate.
 *
 * ## What the checksum covers
 *
 * Every regular file below the plugin directory, except:
 *
 * - the entries under a `node_modules` directory (an installed dependency
 *   tree is a build input, not plugin code, and `pnpm install` would otherwise
 *   change the checksum of an untouched plugin);
 * - `plugin.json`, which is covered in a canonical form instead of its raw
 *   bytes: the parsed manifest with the `checksum` and `signature` fields
 *   removed, keys sorted by code point, and no whitespace. The raw file cannot
 *   be hashed because it holds the checksum, and the canonical form still
 *   covers every other declared field (id, version, entries, node types,
 *   permissions). Reformating the manifest therefore never invalidates a
 *   signature, while editing a field does.
 *
 * Entries are sorted by the UTF-8 bytes of their `/`-separated path relative to
 * the plugin directory. The digest input is, for each entry in that order:
 * the path bytes, one `0x00`, the decimal byte length of the content, one
 * `0x00`, the content bytes, and one `0x00`. The checksum is the SHA-256 of
 * that stream, written as `sha256:<lowercase hex>`.
 *
 * ## What the signature covers
 *
 * The signature is Ed25519 over these UTF-8 lines (one trailing newline after
 * the checksum):
 *
 * ```text
 * dbrainx-plugin-signature-v1
 * <manifest id>
 * <manifest version>
 * <checksum>
 * ```
 *
 * The domain tag keeps a signature from being reused as any other statement,
 * and the id and version stop a checksum from being replayed into another
 * plugin's manifest. It is written as `ed25519:<base64>`.
 *
 * ## Keys
 *
 * Trusted keys arrive as the JSON object of `DBRAINX_PLUGIN_TRUSTED_KEYS`, a
 * mapping of key id to a base64 DER SubjectPublicKeyInfo. The repository also
 * commits one **test-only** key pair in `plugin-test-key.json` so the counter
 * fixture can carry a real signature. {@link readTrustedKeys} refuses that key
 * unless the caller passes `allowTestKey`, so a production loader that reads
 * only the environment variable can never accept it, even if an operator pastes
 * it in. `DBRAINX_PLUGIN_TEST_KEY` names the test key; a deployment sets only
 * `DBRAINX_PLUGIN_TRUSTED_KEYS`.
 */
import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign as cryptoSign,
  verify as cryptoVerify,
} from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { manifestName } from "./plugin-packages.mjs";

/** The hash of the file stream, spelled in the checksum value. */
export const checksumAlgorithm = "sha256";

/** The signature algorithm, spelled in the signature value. */
export const signatureAlgorithm = "ed25519";

/** The domain tag of the signed statement. */
export const signatureContext = "dbrainx-plugin-signature-v1";

/** The id of the committed test-only key. */
export const testKeyId = "dbrainx.test-key";

/** The environment variable a deployment sets; the test key is never in it. */
export const trustedKeysVariable = "DBRAINX_PLUGIN_TRUSTED_KEYS";

/** The environment variable that would name the test key. Test only. */
export const testKeyVariable = "DBRAINX_PLUGIN_TEST_KEY";

/** The committed test-only key pair. */
export const testKeyPath = fileURLToPath(
  new URL("./plugin-test-key.json", import.meta.url),
);

/** The fixture file that holds the trusted-key value of the counter plugin. */
export const trustedKeysFixtureName = "trusted-keys.test.json";

/** The error code the plugin host reports for a failed trust check. */
export const untrustedPlugin = "UNTRUSTED_PLUGIN";

const zero = Buffer.alloc(1);

/** JSON with sorted object keys and no whitespace, so the bytes are stable. */
export function canonicalJson(value) {
  if (Array.isArray(value))
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  return JSON.stringify(value);
}

/**
 * The bytes `plugin.json` contributes to the checksum: the manifest without
 * `checksum` and `signature`, canonically serialized.
 */
export function canonicalManifestBytes(manifest) {
  const covered = { ...manifest };
  delete covered.checksum;
  delete covered.signature;
  return Buffer.from(canonicalJson(covered), "utf8");
}

/** Every regular file below `directory`, excluding `node_modules`. */
async function collectFiles(directory, prefix, found) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const path = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    const absolute = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules") continue;
      await collectFiles(absolute, path, found);
    } else if (entry.isFile()) {
      found.push({ path, absolute });
    } else {
      // A link or a socket has no single stable byte stream. `preparePlugins`
      // dereferences what it copies, so a signed tree must hold plain files.
      throw new Error(
        `plugins/${path}: the checksum covers regular files only; replace the link with the file it names`,
      );
    }
  }
  return found;
}

/** Sort paths by UTF-8 bytes, which every implementation can reproduce. */
export function comparePaths(left, right) {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

/**
 * The checksum of one plugin directory and the files it covers.
 *
 * @param {string} directory absolute path of the plugin directory
 * @param {{manifest?: Record<string, unknown>}} [options] a manifest already
 *   read by the caller; otherwise `plugin.json` is read here
 * @returns {Promise<{checksum: string, files: Array<{path: string,
 *   size: number}>}>}
 */
export async function pluginChecksum(directory, options = {}) {
  const manifest =
    options.manifest ??
    JSON.parse(await readFile(join(directory, manifestName), "utf8"));
  const collected = await collectFiles(directory, "", []);
  const entries = [];
  for (const file of collected) {
    const bytes =
      file.path === manifestName
        ? canonicalManifestBytes(manifest)
        : await readFile(file.absolute);
    entries.push({ path: file.path, bytes });
  }
  entries.sort((left, right) => comparePaths(left.path, right.path));
  const hash = createHash(checksumAlgorithm);
  for (const entry of entries) {
    hash.update(Buffer.from(entry.path, "utf8"));
    hash.update(zero);
    hash.update(Buffer.from(String(entry.bytes.length), "utf8"));
    hash.update(zero);
    hash.update(entry.bytes);
    hash.update(zero);
  }
  const digest = hash.digest("hex");
  return {
    checksum: `${checksumAlgorithm}:${digest}`,
    files: entries.map((entry) => ({
      path: entry.path,
      size: entry.bytes.length,
    })),
  };
}

/** The exact bytes the signature covers. */
export function signaturePayload(manifest, checksum) {
  if (typeof manifest.id !== "string" || manifest.id.trim() === "")
    throw new Error(`${manifestName}: "id" is required to sign a manifest`);
  if (typeof manifest.version !== "string" || manifest.version.trim() === "")
    throw new Error(`${manifestName}: "version" is required to sign a manifest`);
  if (typeof checksum !== "string" || checksum.trim() === "")
    throw new Error("a signature covers a checksum, and none was given");
  return Buffer.from(
    [signatureContext, manifest.id, manifest.version, checksum, ""].join("\n"),
    "utf8",
  );
}

/** Sign a checksum as `ed25519:<base64>`. */
export function signChecksum({ manifest, checksum, privateKey }) {
  const signature = cryptoSign(
    null,
    signaturePayload(manifest, checksum),
    privateKey,
  );
  return `${signatureAlgorithm}:${signature.toString("base64")}`;
}

/** Verify an `ed25519:<base64>` signature over a checksum. */
export function verifyChecksumSignature({
  manifest,
  checksum,
  signature,
  publicKey,
}) {
  const prefix = `${signatureAlgorithm}:`;
  if (typeof signature !== "string" || !signature.startsWith(prefix))
    return false;
  const bytes = Buffer.from(signature.slice(prefix.length), "base64");
  if (bytes.length !== 64) return false;
  return cryptoVerify(
    null,
    signaturePayload(manifest, checksum),
    publicKey,
    bytes,
  );
}

/** The committed test-only key pair, parsed. */
export async function loadTestKey() {
  let stored;
  try {
    stored = JSON.parse(await readFile(testKeyPath, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    throw new Error(
      `no test key at scripts/lib/plugin-test-key.json; run \`node scripts/plugin-sign.mjs --test-key\` once to create it`,
    );
  }
  if (stored.id !== testKeyId)
    throw new Error(
      `scripts/lib/plugin-test-key.json: expected the test key id "${testKeyId}"`,
    );
  if (stored.algorithm !== signatureAlgorithm)
    throw new Error(
      `scripts/lib/plugin-test-key.json: expected algorithm "${signatureAlgorithm}"`,
    );
  return {
    id: stored.id,
    publicKeyBase64: stored.publicKey,
    privateKey: createPrivateKey({
      key: Buffer.from(stored.privateKey, "base64"),
      format: "der",
      type: "pkcs8",
    }),
    publicKey: createPublicKey({
      key: Buffer.from(stored.publicKey, "base64"),
      format: "der",
      type: "spki",
    }),
  };
}

/** Create the committed test key pair when it is missing; load it otherwise. */
export async function ensureTestKey() {
  if (existsSync(testKeyPath)) return loadTestKey();
  const { publicKey, privateKey } = generateKeyPairSync(signatureAlgorithm);
  const stored = {
    warning:
      "TEST ONLY. This key pair is committed so the counter fixture carries a real signature. No deployment may trust it; production supplies its own keys in DBRAINX_PLUGIN_TRUSTED_KEYS.",
    id: testKeyId,
    algorithm: signatureAlgorithm,
    publicKey: publicKey.export({ format: "der", type: "spki" }).toString("base64"),
    privateKey: privateKey
      .export({ format: "der", type: "pkcs8" })
      .toString("base64"),
  };
  await writeFile(
    testKeyPath,
    `${JSON.stringify(stored, null, 2)}\n`,
    "utf8",
  );
  return loadTestKey();
}

/**
 * Parse a `DBRAINX_PLUGIN_TRUSTED_KEYS` value into a map of key id to key.
 *
 * A malformed entry and the test key are configuration errors, so both throw:
 * a deployment that pastes the repository's test key into its trusted keys is
 * stopped here, not at the first plugin that happens to be signed with it.
 *
 * @param {string | Record<string, string>} spec the JSON value or its text
 * @param {{allowTestKey?: boolean}} [options] tests of the fixture pass `true`
 * @returns {Promise<Map<string, import("node:crypto").KeyObject>>}
 */
export async function readTrustedKeys(spec, options = {}) {
  const allowTestKey = options.allowTestKey === true;
  let value = spec;
  if (typeof spec === "string")
    try {
      value = JSON.parse(spec);
    } catch (error) {
      throw new Error(`${trustedKeysVariable} is not valid JSON: ${error.message}`);
    }
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new Error(
      `${trustedKeysVariable} must be a JSON object that maps a key id to a base64 public key`,
    );
  const testKey = await loadTestKey().catch(() => undefined);
  const keys = new Map();
  for (const [id, encoded] of Object.entries(value)) {
    if (id.trim() === "")
      throw new Error(`${trustedKeysVariable} has an empty key id`);
    if (typeof encoded !== "string" || encoded.trim() === "")
      throw new Error(`${trustedKeysVariable}: "${id}" is not a base64 public key`);
    let key;
    try {
      key = createPublicKey({
        key: Buffer.from(encoded, "base64"),
        format: "der",
        type: "spki",
      });
    } catch (error) {
      throw new Error(
        `${trustedKeysVariable}: "${id}" is not a base64 DER public key (${error.message})`,
      );
    }
    const isTestKey =
      testKey !== undefined && (id === testKey.id || encoded === testKey.publicKeyBase64);
    if (isTestKey && !allowTestKey)
      throw new Error(
        `${trustedKeysVariable} lists the test-only key "${id}"; ${testKeyVariable} exists for tests and a deployment must supply its own keys`,
      );
    keys.set(id, key);
  }
  if (keys.size === 0)
    throw new Error(`${trustedKeysVariable} lists no key, so no plugin can be trusted`);
  return keys;
}

function refused(reason) {
  return { ok: false, code: untrustedPlugin, reason };
}

/**
 * Check one plugin directory against a trusted key set.
 *
 * Nothing throws for a plugin that fails the check; the result carries the
 * `UNTRUSTED_PLUGIN` code the plugin host reports. A broken key configuration
 * still throws, because that is not a property of the plugin.
 *
 * @param {{directory: string, trustedKeys: string | Record<string, string>,
 *   allowTestKey?: boolean}} input
 * @returns {Promise<{ok: true, checksum: string, publicKeyId: string,
 *   files: string[], manifest: Record<string, unknown>} |
 *   {ok: false, code: string, reason: string}>}
 */
export async function verifyPlugin({ directory, trustedKeys, allowTestKey = false }) {
  let manifest;
  try {
    manifest = JSON.parse(await readFile(join(directory, manifestName), "utf8"));
  } catch (error) {
    return refused(`cannot read ${manifestName}: ${error.message}`);
  }
  if (manifest === null || typeof manifest !== "object" || Array.isArray(manifest))
    return refused(`${manifestName} is not a JSON object`);
  const keys = await readTrustedKeys(trustedKeys, { allowTestKey });
  if (typeof manifest.checksum !== "string" || manifest.checksum.trim() === "")
    return refused("the manifest declares no checksum");
  if (typeof manifest.signature !== "string" || manifest.signature.trim() === "")
    return refused("the manifest declares no signature");
  if (!manifest.signature.startsWith(`${signatureAlgorithm}:`))
    return refused(
      `the signature is not "${signatureAlgorithm}:<base64>" and no host key verifies it`,
    );
  const { checksum, files } = await pluginChecksum(directory, { manifest });
  if (manifest.checksum !== checksum)
    return refused(
      `the manifest declares ${manifest.checksum}, but the plugin files hash to ${checksum}`,
    );
  const declared =
    typeof manifest.publicKeyId === "string" ? manifest.publicKeyId : undefined;
  if (declared !== undefined && !keys.has(declared))
    return refused(`the manifest names the untrusted key "${declared}"`);
  const candidates =
    declared === undefined ? [...keys.entries()] : [[declared, keys.get(declared)]];
  const trusted = candidates.find(([, publicKey]) =>
    verifyChecksumSignature({
      manifest,
      checksum,
      signature: manifest.signature,
      publicKey,
    }),
  );
  if (trusted === undefined)
    return refused(
      declared === undefined
        ? "the signature does not verify with any trusted key"
        : `the signature does not verify with the trusted key "${declared}"`,
    );
  return {
    ok: true,
    checksum,
    publicKeyId: trusted[0],
    files: files.map((file) => file.path),
    manifest,
  };
}
