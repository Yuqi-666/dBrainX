// SPDX-License-Identifier: AGPL-3.0-only

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * AES-256-GCM for the saved media-site cookies.
 *
 * A cookie is a credential: whoever reads it can act as the user on that site.
 * It must therefore never reach the database, a log line or a client response in
 * plaintext. The repository layer encrypts it here, stores only the ciphertext,
 * its nonce and its authentication tag, and decrypts it again only to write the
 * `0600` `cookies.txt` of a running download.
 *
 * The key is derived from a configured secret with one SHA-256, which maps any
 * passphrase length onto the 32 bytes AES-256 needs. Every call draws a fresh
 * 12-byte nonce (the size GCM is specified for), so encrypting the same cookie
 * twice yields different ciphertext; `${version}` is the first 16 hex characters
 * of `sha256(ciphertext)` and exists to name that ciphertext in a cache key
 * (a probe result is keyed by it), not as a security primitive.
 *
 * GCM authenticates as well as encrypts: a ciphertext, nonce or tag that was
 * changed after it was stored fails `decipher.final()` and is reported as an
 * error instead of producing garbage the caller would send to yt-dlp.
 */
export class MediaCookieCipher {
  /** The 32-byte AES key derived from the configured secret. */
  private readonly key: Buffer;

  /**
   * @param secret The operator's cookie secret. An empty value is a
   * configuration error, not a fallback: encrypting with the SHA-256 of an empty
   * string would look like it worked while protecting nothing. Development
   * runs get a generated secret from {@link MediaCookieCipher.fromEnvironment}.
   */
  constructor(secret: string) {
    if (secret.trim() === "") {
      throw new Error(
        "The media cookie secret is empty. Set DBRAIN_MEDIA_COOKIE_SECRET.",
      );
    }
    this.key = createHash("sha256").update(secret, "utf8").digest();
  }

  /**
   * The instance the server uses: the operator's secret when configured, a
   * generated development secret otherwise.
   *
   * Production must set `DBRAIN_MEDIA_COOKIE_SECRET` (or `MEDIA_COOKIE_SECRET`)
   * for a deployment and keep it stable: changing it makes every saved login
   * undecryptable, and the user has to connect the site again. A development or
   * desktop run with no variable gets a random secret persisted to
   * `<repo>/.cache/media-cookie-secret` (`0600`, git-ignored), so saved logins
   * survive a restart instead of becoming garbage. A bundled server or a
   * container has no writable repository directory: that run persists the
   * secret in the system temporary directory instead.
   */
  static fromEnvironment(): MediaCookieCipher {
    for (const name of SECRET_ENV_NAMES) {
      const configured = process.env[name]?.trim();
      if (configured) return new MediaCookieCipher(configured);
    }
    return new MediaCookieCipher(developmentSecret());
  }

  encrypt(plainText: string): {
    ciphertext: string;
    nonce: string;
    tag: string;
    version: string;
  } {
    const nonce = randomBytes(NONCE_BYTES);
    const cipher = createCipheriv("aes-256-gcm", this.key, nonce);
    const ciphertext = Buffer.concat([
      cipher.update(plainText, "utf8"),
      cipher.final(),
    ]).toString("hex");
    return {
      ciphertext,
      nonce: nonce.toString("hex"),
      tag: cipher.getAuthTag().toString("hex"),
      version: this.version(ciphertext),
    };
  }

  /**
   * The plaintext cookie behind stored parts.
   *
   * Throws for a tampered record: the parts must be exactly what {@link encrypt}
   * produced. This is the only place the plaintext exists in this layer, and it
   * is returned to the caller (the repository), which owns the `0600` file.
   */
  decrypt(parts: { ciphertext: string; nonce: string; tag: string }): string {
    const nonce = decodeHex(parts.nonce, "nonce");
    const tag = decodeHex(parts.tag, "tag");
    const ciphertext = decodeHex(parts.ciphertext, "ciphertext");
    if (nonce.length !== NONCE_BYTES) {
      throw new Error("The media cookie nonce has the wrong length");
    }
    if (tag.length !== TAG_BYTES) {
      throw new Error("The media cookie tag has the wrong length");
    }

    try {
      const decipher = createDecipheriv("aes-256-gcm", this.key, nonce);
      decipher.setAuthTag(tag);
      return Buffer.concat([
        decipher.update(ciphertext),
        decipher.final(),
      ]).toString("utf8");
    } catch {
      // GCM's authentication failure. Deliberately not wrapping the original
      // error: Node may include bytes of the record in its message.
      throw new Error(
        "The saved media cookie could not be decrypted: it was tampered with or the cookie secret changed.",
      );
    }
  }

  /**
   * The stable tag of a stored ciphertext, used in the probe cache key.
   *
   * Hashing the stored hex text (not the decoded bytes) keeps the tag
   * independent of how the caller decoded the record.
   */
  version(ciphertext: string): string {
    return createHash("sha256")
      .update(ciphertext, "utf8")
      .digest("hex")
      .slice(0, 16);
  }
}

const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const GENERATED_SECRET_BYTES = 32;

/** The variables an operator may set, in precedence order. */
const SECRET_ENV_NAMES = [
  "DBRAIN_MEDIA_COOKIE_SECRET",
  "MEDIA_COOKIE_SECRET",
] as const;

/** Development secret file, relative to the repository root. */
const DEVELOPMENT_SECRET_FILE = join(".cache", "media-cookie-secret");

/**
 * Development secret file in the system temporary directory. A bundled server
 * and a container image have no writable repository directory, so the generated
 * secret goes here instead of failing the whole startup with `EACCES`.
 */
const FALLBACK_SECRET_FILE = "dbrain-media-cookie-secret";

/** Parses a hex part, rejecting anything that is not an even-length hex string. */
function decodeHex(value: string, label: string): Buffer {
  if (typeof value !== "string" || !/^(?:[0-9a-fA-F]{2})*$/.test(value)) {
    throw new Error(`The media cookie ${label} is not valid hex`);
  }
  return Buffer.from(value, "hex");
}

/**
 * A generated secret for a run with no configured one, persisted so that a
 * later run can still decrypt the logins the earlier one stored.
 *
 * The repository directory is the first choice: `pnpm dev` and a desktop
 * development run keep the secret next to the source. A bundled server and a
 * container image cannot write there, so the system temporary directory is the
 * second choice. A run that can write neither stays up with an ephemeral
 * secret, and the operator is told that a restart drops the saved logins.
 */
function developmentSecret(): string {
  for (const path of developmentSecretPaths()) {
    try {
      return readOrCreateDevelopmentSecret(path);
    } catch (error) {
      if (!isUnwritableLocation(error)) throw error;
    }
  }
  console.warn(
    "[media-cookie] no writable location for the generated media cookie secret. A restart drops the saved site logins. Set DBRAIN_MEDIA_COOKIE_SECRET.",
  );
  return randomBytes(GENERATED_SECRET_BYTES).toString("base64");
}

/** The candidate secret paths, in order. */
function developmentSecretPaths(): string[] {
  return [
    join(repositoryRoot(), DEVELOPMENT_SECRET_FILE),
    join(tmpdir(), FALLBACK_SECRET_FILE),
  ];
}

/** Reads the stored secret at `path`, or creates it there. */
function readOrCreateDevelopmentSecret(path: string): string {
  try {
    const stored = readFileSync(path, "utf8").trim();
    if (stored) {
      // The file is a credential: keep it private even if it was created by a
      // previous version with a wider mode.
      chmodSync(path, 0o600);
      return stored;
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  const secret = randomBytes(GENERATED_SECRET_BYTES).toString("base64");
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  // `mode` is a request: the process umask can narrow it, never widen it, and
  // the explicit chmod below makes the file private on every run as well.
  writeFileSync(path, `${secret}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);
  return secret;
}

/** True when the filesystem refuses the location, not when the path is wrong. */
function isUnwritableLocation(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code;
  return (
    code === "EACCES" ||
    code === "EPERM" ||
    code === "EROFS" ||
    code === "ENOTDIR"
  );
}

/**
 * The repository root, found by walking up from this module until the workspace
 * manifest is there. A bundled build that no longer contains the manifest falls
 * back to the working directory, which is the same place a desktop build keeps
 * it. A container image has neither a writable repository directory nor a
 * writable working directory, so {@link developmentSecret} falls back to the
 * system temporary directory.
 */
function repositoryRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (;;) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return process.cwd();
    dir = parent;
  }
}
