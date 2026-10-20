// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The development downloader for yt-dlp.
 *
 * `pnpm dev` must work on a fresh clone without a manual yt-dlp install, so the
 * cases below pin the three properties that makes safe: the platform selects the
 * right release asset, a cached runnable binary is reused, and a download is
 * only accepted when the release's checksum manifest agrees.
 *
 * The download is exercised against a local HTTP server, so the suite never
 * touches GitHub and runs offline.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:http";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";

import {
  checksumFor,
  ensureYtDlp,
  ytDlpBinaryPath,
  ytDlpTarget,
} from "./yt-dlp-download.mjs";

/** A repository root and cache path under the system temporary directory. */
async function fixtureRoot() {
  const root = await mkdtemp(join(tmpdir(), "dbrain-yt-dlp-download-"));
  return { root, cleanup: () => rm(root, { recursive: true, force: true }) };
}

/** Serves one release's manifest and assets from loopback. */
async function releaseServer(manifest, assets) {
  const server = createServer((request, response) => {
    const path = request.url ?? "/";
    const body = path === "/SHA2-256SUMS" ? manifest : assets[path];
    if (body === undefined) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200).end(body);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise((resolve) => {
        server.close(() => resolve());
      }),
  };
}

/** The manifest line for one asset. */
function manifestFor(name, bytes) {
  return `${createHash("sha256").update(bytes).digest("hex")}  ${name}\n`;
}

/** Reports a version only when the binary is really installed. */
async function installedProbe(binary) {
  try {
    await access(binary);
    return "2026.08.19";
  } catch {
    return null;
  }
}

/** A log sink that keeps what the module reported. */
function recorder() {
  const lines = [];
  return { lines, log: (line) => lines.push(line) };
}

test("selects the release asset of each supported platform", () => {
  assert.equal(ytDlpTarget("linux", "x64").asset, "yt-dlp_linux");
  assert.equal(ytDlpTarget("linux", "arm64").asset, "yt-dlp_linux_aarch64");
  assert.equal(ytDlpTarget("linux", "arm").asset, "yt-dlp_linux_armv7l");
  assert.equal(ytDlpTarget("darwin", "x64").asset, "yt-dlp_macos");
  assert.equal(ytDlpTarget("darwin", "arm64").asset, "yt-dlp_macos");
  assert.equal(ytDlpTarget("win32", "x64").asset, "yt-dlp.exe");
  assert.throws(
    () => ytDlpTarget("freebsd", "x64"),
    /Install yt-dlp and set YT_DLP_PATH/,
  );
});

test("caches the binary under the ignored .cache directory", () => {
  assert.equal(ytDlpBinaryPath("/repo", "linux"), "/repo/.cache/yt-dlp/yt-dlp");
  assert.equal(
    ytDlpBinaryPath("/repo", "win32"),
    "/repo/.cache/yt-dlp/yt-dlp.exe",
  );
});

test("reads one asset's checksum from the release manifest", () => {
  const manifest = [
    `${"a".repeat(64)}  yt-dlp_linux`,
    `${"B".repeat(64)} *yt-dlp.exe`,
    `${"c".repeat(64)}  yt-dlp_macos`,
    "not a manifest line",
  ].join("\r\n");

  assert.equal(checksumFor(manifest, "yt-dlp_linux"), "a".repeat(64));
  assert.equal(checksumFor(manifest, "yt-dlp.exe"), "b".repeat(64));
  assert.equal(checksumFor(manifest, "yt-dlp_macos"), "c".repeat(64));
  assert.equal(checksumFor(manifest, "yt-dlp_linux_aarch64"), null);
});

test("an explicit YT_DLP_PATH disables the download", async () => {
  const root = await fixtureRoot();
  try {
    const log = recorder();
    const path = await ensureYtDlp({
      root: root.root,
      platform: "linux",
      arch: "x64",
      env: { YT_DLP_PATH: "/opt/yt-dlp" },
      downloadBase: "http://127.0.0.1:1",
      log: log.log,
    });

    assert.equal(path, "/opt/yt-dlp");
    assert.match(log.lines.join("\n"), /using YT_DLP_PATH=\/opt\/yt-dlp/);
  } finally {
    await root.cleanup();
  }
});

test("a cached runnable binary is reused without a download", async () => {
  const root = await fixtureRoot();
  try {
    const binary = ytDlpBinaryPath(root.root, "linux");
    await mkdir(dirname(binary), { recursive: true });
    await writeFile(binary, "cached");
    const log = recorder();

    const path = await ensureYtDlp({
      root: root.root,
      platform: "linux",
      arch: "x64",
      env: {},
      probe: async () => "2026.01.01",
      downloadBase: "http://127.0.0.1:1",
      log: log.log,
    });

    assert.equal(path, binary);
    assert.equal(await readFile(binary, "utf8"), "cached");
    assert.match(log.lines.join("\n"), /2026\.01\.01 \(cached/);
  } finally {
    await root.cleanup();
  }
});

test("downloads, verifies, and installs the current release", async () => {
  const root = await fixtureRoot();
  const bytes = "#!/bin/sh\necho 2026.08.19\n";
  const server = await releaseServer(manifestFor("yt-dlp_linux", bytes), {
    "/yt-dlp_linux": bytes,
  });
  try {
    const log = recorder();
    const path = await ensureYtDlp({
      root: root.root,
      platform: "linux",
      arch: "x64",
      env: {},
      probe: installedProbe,
      downloadBase: server.url,
      log: log.log,
    });

    assert.equal(path, ytDlpBinaryPath(root.root, "linux"));
    assert.equal(await readFile(path, "utf8"), bytes);
    assert.match(log.lines.join("\n"), /downloading yt-dlp_linux/);
    assert.match(log.lines.join("\n"), /2026\.08\.19 ready at/);
  } finally {
    await server.close();
    await root.cleanup();
  }
});

test("a checksum mismatch leaves no binary behind", async () => {
  const root = await fixtureRoot();
  const bytes = "tampered";
  const server = await releaseServer(
    manifestFor("yt-dlp_linux", "the real bytes"),
    { "/yt-dlp_linux": bytes },
  );
  try {
    await assert.rejects(
      ensureYtDlp({
        root: root.root,
        platform: "linux",
        arch: "x64",
        env: {},
        probe: installedProbe,
        downloadBase: server.url,
        log: () => undefined,
      }),
      /checksum mismatch/,
    );
    await assert.rejects(access(ytDlpBinaryPath(root.root, "linux")));
  } finally {
    await server.close();
    await root.cleanup();
  }
});

test("an unreachable release suggests YT_DLP_PATH and a mirror", async () => {
  const root = await fixtureRoot();
  try {
    await assert.rejects(
      ensureYtDlp({
        root: root.root,
        platform: "linux",
        arch: "x64",
        env: {},
        probe: async () => null,
        downloadBase: "http://127.0.0.1:1",
        log: () => undefined,
      }),
      /Install yt-dlp and set YT_DLP_PATH, or set YT_DLP_DOWNLOAD_BASE/,
    );
  } finally {
    await root.cleanup();
  }
});

test("an unsupported platform fails before any download", async () => {
  const root = await fixtureRoot();
  try {
    await assert.rejects(
      ensureYtDlp({
        root: root.root,
        platform: "freebsd",
        arch: "x64",
        env: {},
        probe: async () => null,
        downloadBase: "http://127.0.0.1:1",
        log: () => undefined,
      }),
      /No yt-dlp release asset for freebsd-x64/,
    );
  } finally {
    await root.cleanup();
  }
});
