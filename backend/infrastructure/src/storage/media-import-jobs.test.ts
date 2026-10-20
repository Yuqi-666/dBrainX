// SPDX-License-Identifier: AGPL-3.0-only

import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  FileMediaImportJobStore,
  defaultMediaImportDir,
} from "./media-import-jobs.ts";
import type { CreateMediaImportJobInput } from "@workspace/domain";

/**
 * The store is exercised against a real temporary directory rather than a mocked
 * file system: the interesting failures (a directory swept mid-write, a crash
 * leftover without a record) only exist on a real disk.
 */

/** Deterministic clock, so `updatedAt` ordering and the TTL are testable. */
class Clock {
  private at = Date.parse("2026-01-01T00:00:00.000Z");

  now = (): Date => new Date(this.at);

  advance(ms: number): void {
    this.at += ms;
  }
}

async function tempRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), "dbrain-media-import-test-"));
}

function input(
  overrides: Partial<CreateMediaImportJobInput> = {},
): CreateMediaImportJobInput {
  return {
    jobId: "job-1",
    ownerId: "user-a",
    nodeId: "node-1",
    kind: "video",
    url: "https://www.bilibili.com/video/BV1GJ411x7h7",
    formatId: "1080p",
    cookieVersion: "",
    ...overrides,
  };
}

const HOUR = 60 * 60 * 1000;

test("defaultMediaImportDir follows DBRAIN_MEDIA_IMPORT_DIR and falls back to the temp directory", () => {
  const previous = process.env.DBRAIN_MEDIA_IMPORT_DIR;
  try {
    delete process.env.DBRAIN_MEDIA_IMPORT_DIR;
    assert.equal(
      defaultMediaImportDir(),
      join(tmpdir(), "dbrain-media-imports"),
    );

    process.env.DBRAIN_MEDIA_IMPORT_DIR = "/mnt/dbrain/media-imports";
    assert.equal(defaultMediaImportDir(), "/mnt/dbrain/media-imports");

    // A compose file passes an unset variable through as an empty string; that
    // must fall back rather than become a relative root.
    process.env.DBRAIN_MEDIA_IMPORT_DIR = "";
    assert.equal(
      defaultMediaImportDir(),
      join(tmpdir(), "dbrain-media-imports"),
    );
    process.env.DBRAIN_MEDIA_IMPORT_DIR = "   ";
    assert.equal(
      defaultMediaImportDir(),
      join(tmpdir(), "dbrain-media-imports"),
    );
  } finally {
    if (previous === undefined) delete process.env.DBRAIN_MEDIA_IMPORT_DIR;
    else process.env.DBRAIN_MEDIA_IMPORT_DIR = previous;
  }
});

test("create writes a running job under its owner and exposes the download directory", async () => {
  const root = await tempRoot();
  try {
    const store = new FileMediaImportJobStore(root, new Clock().now);
    const job = await store.create(input());

    assert.deepEqual(job, {
      jobId: "job-1",
      ownerId: "user-a",
      nodeId: "node-1",
      kind: "video",
      url: "https://www.bilibili.com/video/BV1GJ411x7h7",
      formatId: "1080p",
      cookieVersion: "",
      state: "running",
      stage: "downloading",
      percent: 0,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      result: null,
    });

    // The record lives at `<root>/<ownerId>/<jobId>/session.json` and the
    // downloader gets a directory that already exists.
    const jobDir = join(root, "user-a", "job-1");
    const onDisk = JSON.parse(
      await readFile(join(jobDir, "session.json"), "utf8"),
    );
    assert.deepEqual(onDisk, job);
    assert.equal((await stat(join(jobDir, "download"))).isDirectory(), true);
    assert.equal(store.workDir("user-a", "job-1"), join(jobDir, "download"));

    // No staging file was left behind by the atomic write.
    assert.deepEqual(
      (await readdir(jobDir)).filter((name) => name.includes(".tmp")),
      [],
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("read and findForNode scope every job to its owner", async () => {
  const root = await tempRoot();
  try {
    const clock = new Clock();
    const store = new FileMediaImportJobStore(root, clock.now);

    clock.advance(1000);
    const older = await store.create(input({ jobId: "job-older" }));
    clock.advance(1000);
    const newest = await store.create(input({ jobId: "job-newest" }));
    clock.advance(1000);
    // Same owner and a different node, plus another owner's job with the same
    // node id and a later timestamp: neither may win the query below.
    const otherNode = await store.create(
      input({ jobId: "job-other-node", nodeId: "node-2" }),
    );
    clock.advance(1000);
    const otherOwner = await store.create(
      input({ jobId: "job-other-owner", ownerId: "user-b" }),
    );

    assert.deepEqual(await store.read("user-a", newest.jobId), newest);
    assert.notEqual(await store.read("user-a", older.jobId), null);
    // A wrong owner is indistinguishable from a missing job.
    assert.equal(await store.read("user-b", newest.jobId), null);
    assert.equal(await store.read("user-a", "0".repeat(36)), null);

    assert.equal(
      (await store.findForNode("user-a", "node-1"))?.jobId,
      newest.jobId,
    );
    assert.equal(
      (await store.findForNode("user-b", "node-1"))?.jobId,
      otherOwner.jobId,
    );
    assert.equal(
      (await store.findForNode("user-a", "node-2"))?.jobId,
      otherNode.jobId,
    );
    assert.equal(await store.findForNode("user-a", "node-missing"), null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("update patches the record and bumps updatedAt from the clock", async () => {
  const root = await tempRoot();
  try {
    const clock = new Clock();
    const store = new FileMediaImportJobStore(root, clock.now);
    const job = await store.create(input());

    clock.advance(5000);
    const updated = await store.update("user-a", job.jobId, {
      stage: "storing",
      percent: 78,
    });
    assert.equal(updated?.stage, "storing");
    assert.equal(updated?.percent, 78);
    assert.equal(updated?.updatedAt, clock.now().toISOString());
    assert.equal(updated?.createdAt, job.createdAt);
    assert.equal(updated?.nodeId, job.nodeId);
    assert.deepEqual(await store.read("user-a", job.jobId), updated);

    // A completed result is a patch value; so is clearing it back to `null`.
    clock.advance(1000);
    const result = {
      fileName: "source.mp4",
      url: "/api/files/files/rec1/source.mp4",
      coverUrl: "",
      hlsUrl: "",
      duration: 12,
      fileSize: 1024,
      title: "clip",
      artist: "",
      album: "",
      sourceUrl: job.url,
      extractorKey: "bilibili",
      width: 1920,
      height: 1080,
      subtitle: null,
    };
    const completed = await store.update("user-a", job.jobId, {
      state: "completed",
      result,
    });
    assert.equal(completed?.state, "completed");
    assert.deepEqual(completed?.result, result);
    clock.advance(1000);
    assert.equal(
      (await store.update("user-a", job.jobId, { result: null }))?.result,
      null,
    );

    // Another owner cannot patch it, and a missing job is reported, not thrown.
    assert.equal(await store.update("user-b", job.jobId, { percent: 1 }), null);
    assert.equal(
      await store.update("user-a", "job-missing", { percent: 1 }),
      null,
    );
    assert.equal((await store.read("user-a", job.jobId))?.percent, 78);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("remove deletes the whole directory and is idempotent", async () => {
  const root = await tempRoot();
  try {
    const store = new FileMediaImportJobStore(root, new Clock().now);
    const job = await store.create(input());
    // A partial download, the thing the directory exists for.
    await writeFile(
      join(store.workDir("user-a", job.jobId), "source.mp4.part"),
      "bytes",
    );

    // Another owner's remove must not touch it.
    await store.remove("user-b", job.jobId);
    assert.notEqual(await store.read("user-a", job.jobId), null);

    await store.remove("user-a", job.jobId);
    assert.equal(await store.read("user-a", job.jobId), null);
    await assert.rejects(() => stat(join(root, "user-a", "job-1")), /ENOENT/);

    // A second call is a no-op, like a sweeper that already removed it.
    await store.remove("user-a", job.jobId);
    await store.remove("user-a", "../user-b");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("an unsafe job id never reaches the path, and create rejects it", async () => {
  const root = await tempRoot();
  try {
    const store = new FileMediaImportJobStore(root, new Clock().now);
    const job = await store.create(input());

    // The job id comes from the client, so path traversal must be refused by
    // every method that would join it into a path.
    await assert.rejects(
      () => store.create(input({ jobId: "../../escape" })),
      /Invalid media import job id/,
    );
    assert.equal(await store.read("user-a", "../../user-b"), null);
    assert.equal(
      await store.update("user-a", "../job-1", { percent: 1 }),
      null,
    );
    await store.remove("user-a", "../../user-b");
    assert.throws(
      () => store.workDir("user-a", "../job-1"),
      /Invalid media import job id/,
    );

    // The unsafe attempts left the real job alone.
    assert.deepEqual(await store.read("user-a", job.jobId), job);

    // The alphabet matches the one the application accepts from a client, so a
    // leading `-` (which that pattern allows) is a valid job id here too.
    const dashed = await store.create(input({ jobId: "-client-generated" }));
    assert.deepEqual(await store.read("user-a", dashed.jobId), dashed);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("markInterrupted flips every running job and keeps its partial download", async () => {
  const root = await tempRoot();
  try {
    const clock = new Clock();
    const store = new FileMediaImportJobStore(root, clock.now);

    const running = await store.create(input({ jobId: "job-running" }));
    await writeFile(
      join(store.workDir("user-a", running.jobId), "source.mp4.part"),
      "partial",
    );
    const done = await store.create(input({ jobId: "job-done" }));
    await store.update("user-a", done.jobId, { state: "completed" });
    const otherOwner = await store.create(
      input({ jobId: "job-other", ownerId: "user-b" }),
    );

    clock.advance(HOUR);
    assert.equal(await store.markInterrupted(), 2);

    assert.equal(
      (await store.read("user-a", running.jobId))?.state,
      "interrupted",
    );
    assert.equal(
      (await store.read("user-b", otherOwner.jobId))?.state,
      "interrupted",
    );
    assert.equal((await store.read("user-a", done.jobId))?.state, "completed");
    assert.equal(
      (await store.read("user-a", running.jobId))?.updatedAt,
      clock.now().toISOString(),
    );
    // The bytes yt-dlp will resume from are still there.
    assert.equal(
      (
        await stat(
          join(store.workDir("user-a", running.jobId), "source.mp4.part"),
        )
      ).size,
      7,
    );

    // A second startup finds nothing left to interrupt.
    assert.equal(await store.markInterrupted(), 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("sweep deletes stale finished jobs and crash leftovers, never a running one", async () => {
  const root = await tempRoot();
  try {
    const clock = new Clock();
    const store = new FileMediaImportJobStore(root, clock.now);

    const staleInterrupted = await store.create(
      input({ jobId: "job-interrupted" }),
    );
    await store.update("user-a", staleInterrupted.jobId, {
      state: "interrupted",
    });
    const staleCompleted = await store.create(
      input({ jobId: "job-completed" }),
    );
    await store.update("user-a", staleCompleted.jobId, { state: "completed" });
    const running = await store.create(input({ jobId: "job-running" }));

    clock.advance(25 * HOUR);
    // A job interrupted by this startup is fresh even though its directory was
    // created long ago: `updatedAt` was re-stamped when it was interrupted.
    const freshInterrupted = await store.create(
      input({ jobId: "job-fresh-interrupted" }),
    );
    await store.update("user-a", freshInterrupted.jobId, {
      state: "interrupted",
    });

    // Crash leftovers: one directory with no record, one with an unparseable
    // record. Both are swept rather than thrown.
    await mkdir(join(root, "user-a", "job-no-record", "download"), {
      recursive: true,
    });
    await mkdir(join(root, "user-b", "job-corrupt"), { recursive: true });
    await writeFile(
      join(root, "user-b", "job-corrupt", "session.json"),
      "{ not json",
    );

    assert.equal(await store.sweep(24 * HOUR), 4);

    assert.equal(await store.read("user-a", staleInterrupted.jobId), null);
    assert.equal(await store.read("user-a", staleCompleted.jobId), null);
    assert.notEqual(await store.read("user-a", running.jobId), null);
    assert.notEqual(await store.read("user-a", freshInterrupted.jobId), null);
    await assert.rejects(
      () => stat(join(root, "user-a", "job-no-record")),
      /ENOENT/,
    );
    await assert.rejects(
      () => stat(join(root, "user-b", "job-corrupt")),
      /ENOENT/,
    );

    // A second sweep with nothing to do is a no-op, not an error.
    assert.equal(await store.sweep(24 * HOUR), 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("update after a concurrent sweep reports a missing job instead of resurrecting it", async () => {
  const root = await tempRoot();
  try {
    const store = new FileMediaImportJobStore(root, new Clock().now);
    const job = await store.create(input());

    await rm(join(root, "user-a", job.jobId), { recursive: true, force: true });
    assert.equal(
      await store.update("user-a", job.jobId, { percent: 50 }),
      null,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
