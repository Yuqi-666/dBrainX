// SPDX-License-Identifier: AGPL-3.0-only

import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  FileUploadSessionStore,
  defaultUploadDir,
} from "./file-upload-sessions.ts";
import type {
  CreateUploadSessionInput,
  UploadPartInput,
} from "@workspace/domain";

/**
 * The store is exercised against a real temporary directory rather than a mocked
 * file system: the interesting failures (a part deleted behind the store's back,
 * a directory swept mid-write) only exist on a real disk.
 */

/** Deterministic clock, so `updatedAt` ordering is testable. */
class Clock {
  private at = Date.parse("2026-01-01T00:00:00.000Z");

  now = (): Date => new Date(this.at);

  advance(ms: number): void {
    this.at += ms;
  }
}

async function tempRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), "dbrain-upload-test-"));
}

function input(
  overrides: Partial<CreateUploadSessionInput> = {},
): CreateUploadSessionInput {
  return {
    ownerId: "user-a",
    fileName: "clip.mp4",
    fileSize: 10,
    contentType: "video/mp4",
    workspaceId: "",
    fingerprint: "fingerprint-1",
    chunkSize: 4,
    chunkCount: 3,
    expiresAt: "2026-01-02T00:00:00.000Z",
    ...overrides,
  };
}

/** A body of exactly `size` bytes with value `marker`, delivered in blocks. */
async function* octets(size: number, marker: number): AsyncIterable<Uint8Array> {
  const block = 3;
  for (let offset = 0; offset < size; offset += block) {
    yield new Uint8Array(Math.min(block, size - offset)).fill(marker);
  }
}

function part(
  index: number,
  bytes: number,
  marker: number,
  actualBytes = bytes,
): UploadPartInput {
  return { index, bytes, data: octets(actualBytes, marker) };
}

test("defaultUploadDir follows DBRAIN_UPLOAD_DIR and falls back to the temp directory", () => {
  const previous = process.env.DBRAIN_UPLOAD_DIR;
  try {
    delete process.env.DBRAIN_UPLOAD_DIR;
    assert.equal(defaultUploadDir(), join(tmpdir(), "dbrain-uploads"));

    process.env.DBRAIN_UPLOAD_DIR = "/mnt/dbrain/spool";
    assert.equal(defaultUploadDir(), "/mnt/dbrain/spool");

    // A compose file passes an unset variable through as an empty string; that
    // must fall back rather than become a relative root.
    process.env.DBRAIN_UPLOAD_DIR = "";
    assert.equal(defaultUploadDir(), join(tmpdir(), "dbrain-uploads"));
    process.env.DBRAIN_UPLOAD_DIR = "   ";
    assert.equal(defaultUploadDir(), join(tmpdir(), "dbrain-uploads"));
  } finally {
    if (previous === undefined) delete process.env.DBRAIN_UPLOAD_DIR;
    else process.env.DBRAIN_UPLOAD_DIR = previous;
  }
});

test("create writes the session record and find scopes it to its owner", async () => {
  const root = await tempRoot();
  try {
    const store = new FileUploadSessionStore(root, new Clock().now);
    const created = await store.create(input({ workspaceId: "ws-1" }));

    assert.match(created.id, /^[a-f0-9]{32}$/);
    assert.equal(created.status, "open");
    assert.deepEqual(created.received, []);
    assert.equal(created.ownerId, "user-a");
    assert.equal(created.workspaceId, "ws-1");
    // The caller's expiry travels with the record unchanged; the sweep has its
    // own cutoff, but a polling client can read this one.
    assert.equal(created.expiresAt, "2026-01-02T00:00:00.000Z");

    const onDisk = JSON.parse(
      await readFile(join(root, created.id, "session.json"), "utf8"),
    );
    assert.deepEqual(onDisk, created);

    assert.deepEqual(await store.find("user-a", created.id), created);
    // A wrong owner is indistinguishable from a missing session.
    assert.equal(await store.find("user-b", created.id), null);
    assert.equal(await store.find("user-a", "0".repeat(32)), null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("writePart stores counted chunks and recounts them from disk", async () => {
  const root = await tempRoot();
  try {
    const clock = new Clock();
    const store = new FileUploadSessionStore(root, clock.now);
    const session = await store.create(input());

    clock.advance(1000);
    assert.equal(await store.writePart("user-a", session.id, part(1, 4, 1)), 1);
    assert.equal((await stat(join(root, session.id, "parts", "1.part"))).size, 4);
    clock.advance(1000);
    assert.equal(await store.writePart("user-a", session.id, part(0, 4, 0)), 2);

    const after = await store.find("user-a", session.id);
    assert.deepEqual(after?.received, [0, 1]);
    assert.notEqual(after?.updatedAt, session.updatedAt);

    // Replacing an existing index overwrites it rather than counting twice.
    clock.advance(1000);
    assert.equal(await store.writePart("user-a", session.id, part(1, 4, 9)), 2);
    assert.equal((await readFile(join(root, session.id, "parts", "1.part")))[0], 9);

    await assert.rejects(
      () => store.writePart("user-b", session.id, part(2, 4, 2)),
      /was not found/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("concurrent chunk writes never make a live session unreadable", async () => {
  const root = await tempRoot();
  try {
    const store = new FileUploadSessionStore(root, new Clock().now);
    const session = await store.create(input({ chunkSize: 1, chunkCount: 60, fileSize: 60 }));

    // Three chunks at a time rewrite the same record, exactly as the client's
    // concurrency does. While that record was written in place, a reader could
    // catch the truncate and see a file it could not parse — which the store
    // has to report as "no such session". That answer is what told a live
    // client its session had expired mid-upload.
    const writers = [0, 1, 2].map(async (offset) => {
      for (let index = offset; index < 60; index += 3) {
        await store.writePart("user-a", session.id, {
          index,
          bytes: 1,
          data: octets(1, index),
        });
      }
    });
    const reader = (async () => {
      for (let attempt = 0; attempt < 120; attempt += 1) {
        assert.notEqual(
          await store.find("user-a", session.id),
          null,
          "a live session was unreadable",
        );
        assert.notEqual(
          await store.findResumable("user-a", "fingerprint-1"),
          null,
          "a live session was missing from the resume lookup",
        );
      }
    })();

    await Promise.all([...writers, reader]);

    // Every writer recomputed `received` from its own listing; none of them may
    // write back a shorter list than a concurrent one already recorded.
    assert.equal((await store.find("user-a", session.id))?.received.length, 60);
    // The staging files were all moved into place, not left behind.
    const leftovers = (await readdir(join(root, session.id, "parts"))).filter((name) =>
      name.endsWith(".tmp"),
    );
    assert.deepEqual(leftovers, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("writePart rejects a wrong byte count and deletes the bad chunk", async () => {
  const root = await tempRoot();
  try {
    const store = new FileUploadSessionStore(root, new Clock().now);
    const session = await store.create(input());

    await assert.rejects(
      () => store.writePart("user-a", session.id, part(0, 5, 0, 4)),
      /was 4 bytes, expected 5/,
    );
    await assert.rejects(
      () => stat(join(root, session.id, "parts", "0.part")),
      /ENOENT/,
    );
    assert.equal((await store.find("user-a", session.id))?.received.length, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("writePart rejects an index outside 0..chunkCount-1", async () => {
  const root = await tempRoot();
  try {
    const store = new FileUploadSessionStore(root, new Clock().now);
    const session = await store.create(input());

    await assert.rejects(
      () => store.writePart("user-a", session.id, part(3, 4, 3)),
      /outside 0\.\.2/,
    );
    await assert.rejects(
      () => store.writePart("user-a", session.id, part(-1, 4, 0)),
      /outside 0\.\.2/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("assemble concatenates the chunks in index order", async () => {
  const root = await tempRoot();
  try {
    const store = new FileUploadSessionStore(root, new Clock().now);
    const session = await store.create(input());

    // Written out of order on purpose: assemble must sort by index, not by the
    // order the chunks happened to arrive in.
    await store.writePart("user-a", session.id, part(2, 2, 3));
    await store.writePart("user-a", session.id, part(0, 4, 1));
    await store.writePart("user-a", session.id, part(1, 4, 2));

    const assembled = await store.assemble("user-a", session.id);
    assert.equal(assembled.path, join(root, session.id, "file"));
    assert.equal(assembled.bytes, 10);
    assert.equal((await stat(assembled.path)).size, 10);
    assert.deepEqual(
      [...(await readFile(assembled.path))],
      [1, 1, 1, 1, 2, 2, 2, 2, 3, 3],
    );

    // A second attempt overwrites the first rather than appending to it.
    const again = await store.assemble("user-a", session.id);
    assert.equal(again.bytes, 10);
    assert.equal((await stat(again.path)).size, 10);

    await assert.rejects(
      () => store.assemble("user-b", session.id),
      /was not found/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("assemble rejects when a chunk is missing and publishes no file", async () => {
  const root = await tempRoot();
  try {
    const store = new FileUploadSessionStore(root, new Clock().now);
    const session = await store.create(input());
    await store.writePart("user-a", session.id, part(0, 4, 1));
    await store.writePart("user-a", session.id, part(2, 2, 3));

    await assert.rejects(
      () => store.assemble("user-a", session.id),
      /missing chunks: 1/,
    );
    await assert.rejects(() => stat(join(root, session.id, "file")), /ENOENT/);
    // Nothing left behind under a name a later call might pick up.
    await assert.rejects(
      () => stat(join(root, session.id, "file.assembling")),
      /ENOENT/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("assemble reports a chunk that disappears between listing and reading", async () => {
  const root = await tempRoot();
  try {
    const store = new FileUploadSessionStore(root, new Clock().now);
    const session = await store.create(input({ chunkCount: 2 }));
    await store.writePart("user-a", session.id, part(0, 4, 1));
    await store.writePart("user-a", session.id, part(1, 4, 2));
    await rm(join(root, session.id, "parts", "1.part"));

    await assert.rejects(
      () => store.assemble("user-a", session.id),
      /missing chunks: 1/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("discardPayload keeps the record and drops the payload", async () => {
  const root = await tempRoot();
  try {
    const store = new FileUploadSessionStore(root, new Clock().now);
    const session = await store.create(input({ chunkCount: 1 }));
    await store.writePart("user-a", session.id, part(0, 4, 1));
    await store.assemble("user-a", session.id);

    await store.discardPayload("user-a", session.id);

    assert.notEqual(await store.find("user-a", session.id), null);
    await assert.rejects(() => stat(join(root, session.id, "parts")), /ENOENT/);
    await assert.rejects(() => stat(join(root, session.id, "file")), /ENOENT/);

    await assert.rejects(
      () => store.discardPayload("user-b", session.id),
      /was not found/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("update persists the caller's record and bumps updatedAt from the clock", async () => {
  const root = await tempRoot();
  try {
    const clock = new Clock();
    const store = new FileUploadSessionStore(root, clock.now);
    const session = await store.create(input());

    const before = session.updatedAt;
    clock.advance(5000);
    await store.update({
      ...session,
      status: "done",
      received: [0, 1, 2],
      result: {
        id: "rec1",
        url: "/api/files/files/rec1/clip.mp4",
        fileName: "clip.mp4",
        fileSize: 10,
        updatedAt: "2026-01-01T00:00:05.000Z",
      },
    });

    const after = await store.find("user-a", session.id);
    assert.equal(after?.status, "done");
    assert.deepEqual(after?.received, [0, 1, 2]);
    assert.equal(after?.result?.id, "rec1");
    assert.notEqual(after?.updatedAt, before);
    assert.equal(after?.updatedAt, clock.now().toISOString());
    assert.equal(after?.createdAt, session.createdAt);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("remove deletes the whole session directory", async () => {
  const root = await tempRoot();
  try {
    const store = new FileUploadSessionStore(root, new Clock().now);
    const session = await store.create(input());
    await store.writePart("user-a", session.id, part(0, 4, 1));

    await assert.rejects(
      () => store.remove("user-b", session.id),
      /was not found/,
    );
    assert.notEqual(await store.find("user-a", session.id), null);

    await store.remove("user-a", session.id);
    assert.equal(await store.find("user-a", session.id), null);
    await assert.rejects(() => stat(join(root, session.id)), /ENOENT/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("sweep deletes old sessions and crash leftovers, keeps fresh ones", async () => {
  const root = await tempRoot();
  try {
    const clock = new Clock();
    const store = new FileUploadSessionStore(root, clock.now);

    const old = await store.create(input({ fingerprint: "old" }));
    clock.advance(60 * 60 * 1000);
    const fresh = await store.create(input({ fingerprint: "fresh" }));

    // Directories an interrupted create can leave behind: one without a record
    // at all, one with a payload but no record.
    await mkdir(join(root, "half-created", "parts"), { recursive: true });
    await mkdir(join(root, "leftover"), { recursive: true });

    const before = new Date(clock.now().getTime() - 30 * 60 * 1000);
    assert.equal(await store.sweep(before), 3);

    assert.equal(await store.find("user-a", old.id), null);
    assert.notEqual(await store.find("user-a", fresh.id), null);
    await assert.rejects(() => stat(join(root, "half-created")), /ENOENT/);
    await assert.rejects(() => stat(join(root, "leftover")), /ENOENT/);

    // A second sweep with nothing to do is a no-op, not an error.
    assert.equal(await store.sweep(before), 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("sweep tolerates a directory that disappears while it is being swept", async () => {
  const root = await tempRoot();
  try {
    const store = new FileUploadSessionStore(root, new Clock().now);
    const session = await store.create(input());

    await rm(join(root, session.id), { recursive: true, force: true });
    assert.equal(await store.sweep(new Date()), 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("findResumable picks the newest unfinished session of the same owner", async () => {
  const root = await tempRoot();
  try {
    const clock = new Clock();
    const store = new FileUploadSessionStore(root, clock.now);
    const open = (overrides: Partial<CreateUploadSessionInput>) =>
      store.create(input({ fingerprint: "shared", ownerId: "user-a", ...overrides }));

    const older = await open({});
    clock.advance(1000);
    const newer = await open({});
    clock.advance(1000);
    const newest = await open({});
    clock.advance(1000);
    // A different owner and a different fingerprint, both newest by timestamp:
    // neither may win a query for `user-a` + `shared`.
    const otherOwner = await open({ ownerId: "user-b" });
    clock.advance(1000);
    const otherFingerprint = await open({ fingerprint: "other", ownerId: "user-b" });

    assert.equal((await store.findResumable("user-a", "shared"))?.id, newest.id);

    // A done session is not resumable even when it is the newest of its group.
    const storedNewest = await store.find("user-a", newest.id);
    assert.ok(storedNewest);
    clock.advance(1000);
    await store.update({ ...storedNewest, status: "done" });
    assert.equal((await store.findResumable("user-a", "shared"))?.id, newer.id);

    // An error session is resumable: that is the retry path.
    const storedNewer = await store.find("user-a", newer.id);
    assert.ok(storedNewer);
    clock.advance(1000);
    await store.update({ ...storedNewer, status: "error" });
    assert.equal((await store.findResumable("user-a", "shared"))?.id, newer.id);

    // Once an update marks the group's newest open session done as well, the
    // next one wins; every update carries a later stamp than every create, so
    // the order here does not depend on directory listing order.
    const storedOlder = await store.find("user-a", older.id);
    assert.ok(storedOlder);
    clock.advance(1000);
    await store.update({ ...storedOlder, status: "error" });
    const storedNewerAgain = await store.find("user-a", newer.id);
    assert.ok(storedNewerAgain);
    clock.advance(1000);
    await store.update({ ...storedNewerAgain, status: "done" });
    assert.equal((await store.findResumable("user-a", "shared"))?.id, older.id);

    // A fingerprint or owner with no open session finds nothing, and the two
    // decoys are only reachable through their own owner and fingerprint.
    assert.equal(await store.findResumable("user-a", "unknown"), null);
    assert.equal(
      (await store.findResumable("user-b", "shared"))?.id,
      otherOwner.id,
    );
    assert.equal(
      (await store.findResumable("user-b", "other"))?.id,
      otherFingerprint.id,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a concurrent sweep makes a later write report a missing session", async () => {
  const root = await tempRoot();
  try {
    const store = new FileUploadSessionStore(root, new Clock().now);
    const session = await store.create(input());

    // The sweeper removes the directory the store is about to write into.
    await rm(join(root, session.id), { recursive: true, force: true });
    await assert.rejects(
      () => store.writePart("user-a", session.id, part(0, 4, 1)),
      /was not found/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
