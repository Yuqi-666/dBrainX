// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Download and cache the self-contained yt-dlp binary used by `pnpm dev`.
 *
 * The video-link import spawns yt-dlp on the server, and a container image has
 * it installed at build time. A development machine must not need a Python
 * install, a package manager, or any manual step: the same way the PocketBase
 * launcher is fed a repository-owned binary, this module fetches the current
 * release for the host platform into `.cache/yt-dlp/` on first use and hands its
 * path back for the development stack's child processes.
 *
 * Two properties matter:
 *
 * - **The version is current, not pinned.** yt-dlp's site extractors change
 *   with the sites they read, so an old binary silently stops working. The
 *   Docker image installs the latest release for the same reason; the dev cache
 *   therefore downloads latest-once instead of a frozen version.
 * - **Every download is checksum-verified.** The release publishes
 *   `SHA2-256SUMS`; the binary is compared against it before it is executable,
 *   so a truncated or substituted download never reaches the server.
 *
 * `YT_DLP_PATH` in the environment (or `.env`) wins and disables the download
 * entirely, which also covers a binary the developer installed another way.
 */

import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { chmod, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** Where a release's assets are published; overridable for a mirror. */
export const DEFAULT_DOWNLOAD_BASE =
  "https://github.com/yt-dlp/yt-dlp/releases/latest/download";

/**
 * Release asset per host platform and architecture.
 *
 * Only the platforms this repository declares for a release are supported.
 * `yt-dlp_macos` is a universal binary, so both Mac architectures share it; an
 * unsupported pair must fail loudly instead of downloading a binary that cannot
 * run.
 */
const TARGETS = {
  "linux-x64": "yt-dlp_linux",
  "linux-arm64": "yt-dlp_linux_aarch64",
  "linux-arm": "yt-dlp_linux_armv7l",
  "darwin-x64": "yt-dlp_macos",
  "darwin-arm64": "yt-dlp_macos",
  "win32-x64": "yt-dlp.exe",
};

/** One asset name for a platform/architecture pair. */
export function ytDlpTarget(platform = process.platform, arch = process.arch) {
  const asset = TARGETS[`${platform}-${arch}`];
  if (!asset) {
    throw new Error(
      `No yt-dlp release asset for ${platform}-${arch}. Install yt-dlp and set YT_DLP_PATH.`,
    );
  }
  return { asset };
}

/** Where the cached binary lives, inside the repository's ignored `.cache/`. */
export function ytDlpBinaryPath(root, platform = process.platform) {
  return join(
    root,
    ".cache",
    "yt-dlp",
    platform === "win32" ? "yt-dlp.exe" : "yt-dlp",
  );
}

/**
 * The SHA-256 a release's `SHA2-256SUMS` manifest declares for `asset`.
 *
 * The manifest format is `<64 hex characters>  <asset name>`, one line per
 * asset. A missing entry is `null` so the caller can report the manifest as
 * unusable instead of downloading an unverified file.
 */
export function checksumFor(manifest, asset) {
  for (const line of String(manifest).split(/\r?\n/)) {
    const match = line.trim().match(/^([0-9a-fA-F]{64})\s+\*?(.+)$/);
    if (match && match[2].trim() === asset) return match[1].toLowerCase();
  }
  return null;
}

/** `true` when the cached binary runs and reports a version. */
async function probeVersion(binary) {
  try {
    const { stdout } = await execFileAsync(binary, ["--version"], {
      encoding: "utf8",
      timeout: 30_000,
    });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

/** Fetches one URL, following the release redirect and bounding the wait. */
async function fetchOrThrow(url, timeoutMs = 5 * 60 * 1000) {
  const response = await fetch(url, {
    redirect: "follow",
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) {
    throw new Error(`Download failed: HTTP ${response.status} for ${url}`);
  }
  return response;
}

/**
 * Ensures a runnable yt-dlp and returns the path/command the server should use.
 *
 * Resolution order:
 * 1. `YT_DLP_PATH` when set (the developer's own install or an explicit path);
 * 2. an already cached and runnable `.cache/yt-dlp/…` binary;
 * 3. a fresh download of the current release, verified against the published
 *    checksum manifest.
 *
 * @param {object} [options]
 * @param {string} options.root repository root
 * @param {string} [options.platform] override for tests
 * @param {string} [options.arch] override for tests
 * @param {Record<string, string | undefined>} [options.env] override for tests
 * @param {(message: string) => void} [options.log]
 * @param {string} [options.downloadBase] release base URL, for a mirror or a test
 * @param {(binary: string) => Promise<string | null>} [options.probe] version probe for tests
 */
export async function ensureYtDlp(options = {}) {
  const {
    root = process.cwd(),
    platform = process.platform,
    arch = process.arch,
    env = process.env,
    log = console.log,
    downloadBase = env.YT_DLP_DOWNLOAD_BASE || DEFAULT_DOWNLOAD_BASE,
    probe = probeVersion,
  } = options;

  const override = String(env.YT_DLP_PATH ?? "").trim();
  if (override) {
    log(`[yt-dlp] using YT_DLP_PATH=${override}`);
    return override;
  }

  const binary = ytDlpBinaryPath(root, platform);
  const cached = await probe(binary);
  if (cached) {
    log(`[yt-dlp] ${cached} (cached at ${binary})`);
    return binary;
  }

  // A partial file, a wrong architecture, or an interrupted earlier run: the
  // download replaces it rather than trusting the name being present.
  await rm(binary, { force: true });

  const { asset } = ytDlpTarget(platform, arch);
  log(`[yt-dlp] downloading ${asset} …`);
  let expected;
  try {
    expected = checksumFor(
      await (await fetchOrThrow(`${downloadBase}/SHA2-256SUMS`)).text(),
      asset,
    );
  } catch (error) {
    throw new Error(
      `Could not fetch the yt-dlp checksum manifest (${error.message}). ` +
        `Install yt-dlp and set YT_DLP_PATH, or set YT_DLP_DOWNLOAD_BASE to a reachable mirror.`,
    );
  }
  if (!expected) {
    throw new Error(`The yt-dlp checksum manifest has no entry for ${asset}`);
  }

  let bytes;
  try {
    bytes = Buffer.from(
      await (await fetchOrThrow(`${downloadBase}/${asset}`)).arrayBuffer(),
    );
  } catch (error) {
    throw new Error(
      `Could not download yt-dlp (${error.message}). Install it and set ` +
        `YT_DLP_PATH, or set YT_DLP_DOWNLOAD_BASE to a reachable mirror.`,
    );
  }

  const actual = createHash("sha256").update(bytes).digest("hex");
  if (actual !== expected) {
    throw new Error(
      `yt-dlp checksum mismatch: expected ${expected}, downloaded ${actual}`,
    );
  }

  // Written beside the destination and renamed into place, so a crash cannot
  // leave a half-written file that the next run would try to execute.
  await mkdir(dirname(binary), { recursive: true });
  const temporary = `${binary}.download-${process.pid}`;
  try {
    await writeFile(temporary, bytes);
    await chmod(temporary, 0o755);
    await rename(temporary, binary);
  } finally {
    await rm(temporary, { force: true });
  }

  const version = await probe(binary);
  if (!version) {
    await rm(binary, { force: true });
    throw new Error(
      `The downloaded yt-dlp binary at ${binary} does not run on this host`,
    );
  }
  log(`[yt-dlp] ${version} ready at ${binary}`);
  return binary;
}
