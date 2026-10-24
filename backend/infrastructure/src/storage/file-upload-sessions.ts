// SPDX-License-Identifier: AGPL-3.0-only

import { randomBytes } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";

import type {
  AssembledUpload,
  CreateUploadSessionInput,
  IUploadSessionStore,
  UploadPartInput,
  UploadSession,
} from "@workspace/domain";

/**
 * Chunk spool for the resumable upload path.
 *
 * A 2 GiB upload is too large to hold in the process heap and too long to finish
 * in one request, so the application layer splits it into chunks and this store
 * lands them on the local file system:
 *
 * ```text
 * <root>/<uploadId>/session.json   the UploadSession record (tiny JSON)
 * <root>/<uploadId>/parts/<n>.part chunk `n`, named by its index
 * <root>/<uploadId>/file           the assembled file, once every chunk is in
 * ```
 *
 * The file system is the spool rather than a table because a chunk is up to a
 * few megabytes of opaque bytes: a directory of parts can be listed, resumed and
 * deleted with the tools already in this layer, and a crash leaves a directory
 * that {@link FileUploadSessionStore.sweep} can remove in one call.
 *
 * Four rules are load-bearing:
 *
 * - **Owner scoping is mandatory.** Every method takes the verified `ownerId` and
 *   a session belonging to somebody else must be indistinguishable from a
 *   missing one: answering "forbidden" would confirm that the id exists.
 * - **A part is all-or-nothing.** The declared byte count is checked after the
 *   body has been streamed, and a mismatch deletes the file rather than leaving
 *   a truncated chunk behind that a later resume would happily assemble.
 * - **Every published file is replaced atomically.** The client uploads three
 *   chunks at once and every chunk rewrites `session.json`, so a plain
 *   truncate-and-write left readers staring at a half-written record. Since a
 *   record that cannot be parsed is indistinguishable from a session that does
 *   not exist, that race answered `404` for a live session: the client opened a
 *   second session for the same file and split its chunks across both, and the
 *   later `complete` was rejected for the chunks that stayed behind. Both files
 *   are therefore written to a temporary name and moved into place in one
 *   `rename`, so a reader sees either the old file or the new one.
 * - **`session.json` is the only truth.** Chunk locations are derived from it, so
 *   a part file the record does not mention is ignored and a part the record
 *   mentions but the disk has lost is a hard error, not a silent short file.
 *
 * A concurrent {@link FileUploadSessionStore.sweep} can delete a session at any
 * moment. A write that loses that race reports "the session is gone" instead of
 * resurrecting a directory the sweeper has already enumerated.
 */
/**
 * Root of the chunk spool.
 *
 * A blank value counts as unset, exactly like the other environment variables in
 * this repository: a compose file that passes `DBRAINX_UPLOAD_DIR=` through
 * verbatim must not turn the spool root into an empty (relative) path.
 */
export function defaultUploadDir(): string {
  const configured = process.env.DBRAINX_UPLOAD_DIR?.trim();
  return configured ? configured : join(tmpdir(), "dbrainx-uploads");
}

/** Directory name under the root; the caller never sees this value. */
const SESSION_FILE = "session.json";
const PARTS_DIR = "parts";
const PART_SUFFIX = ".part";
const ASSEMBLED_FILE = "file";

/** Reads the parts already on disk. Missing directory means no parts yet. */
async function listPartIndexes(partsDir: string): Promise<number[]> {
  let names: string[];
  try {
    names = await readdir(partsDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }

  return names
    .filter((name) => name.endsWith(PART_SUFFIX))
    .map((name) => Number.parseInt(name.slice(0, -PART_SUFFIX.length), 10))
    .filter((index) => Number.isInteger(index) && index >= 0);
}

/** True when the wrapped error means "this file is not there". */
function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === "ENOENT";
}

export class FileUploadSessionStore implements IUploadSessionStore {
  private readonly rootDir: string;
  private readonly now: () => Date;

  /**
   * Plain field assignments rather than parameter properties: the co-located
   * test runs the file through Node's type-stripping loader (`node --test`),
   * which rejects TypeScript-only syntax that has a runtime effect.
   */
  constructor(rootDir: string = defaultUploadDir(), now: () => Date = () => new Date()) {
    this.rootDir = rootDir;
    this.now = now;
  }

  async create(input: CreateUploadSessionInput): Promise<UploadSession> {
    const stamp = this.now().toISOString();
    const session: UploadSession = {
      id: randomBytes(16).toString("hex"),
      ownerId: input.ownerId,
      fileName: input.fileName,
      fileSize: input.fileSize,
      contentType: input.contentType,
      workspaceId: input.workspaceId,
      fingerprint: input.fingerprint,
      chunkSize: input.chunkSize,
      chunkCount: input.chunkCount,
      status: "open",
      received: [],
      createdAt: stamp,
      updatedAt: stamp,
      // Kept on the record as well as being enforced by the sweep: a caller that
      // only reads a session (a polling client, a status endpoint) can then tell
      // how long a resume is still possible without knowing the TTL policy.
      expiresAt: input.expiresAt,
    };

    const dir = this.sessionDir(session.id);
    await mkdir(join(dir, PARTS_DIR), { recursive: true });
    await this.writeSessionJson(dir, session);

    return session;
  }

  async find(ownerId: string, id: string): Promise<UploadSession | null> {
    const session = await this.readSession(id);
    // A wrong owner must look exactly like a missing session.
    return session && session.ownerId === ownerId ? session : null;
  }

  async findResumable(
    ownerId: string,
    fingerprint: string,
  ): Promise<UploadSession | null> {
    const sessions = await this.listSessions();
    const candidates = sessions.filter(
      (session) =>
        session.ownerId === ownerId &&
        session.fingerprint === fingerprint &&
        // `assembling` counts: the chunks are all there, and answering with the
        // session avoids making the client send the file again.
        session.status !== "done",
    );
    if (candidates.length === 0) return null;

    // ISO timestamps sort lexicographically, so a string comparison is enough.
    return candidates.reduce((newest, session) =>
      session.updatedAt > newest.updatedAt ? session : newest,
    );
  }

  async writePart(
    ownerId: string,
    id: string,
    part: UploadPartInput,
  ): Promise<number> {
    const session = await this.requireSession(ownerId, id);
    if (
      !Number.isInteger(part.index) ||
      part.index < 0 ||
      (Number.isInteger(session.chunkCount) && part.index >= session.chunkCount)
    ) {
      throw new Error(
        `Chunk ${part.index} is outside 0..${session.chunkCount - 1} of upload ${id}`,
      );
    }

    const partsDir = join(this.sessionDir(id), PARTS_DIR);
    const partPath = join(partsDir, `${part.index}${PART_SUFFIX}`);
    // Streamed to a temporary name and moved in one `rename`: a reader that
    // lists this directory while the body is still arriving (another chunk
    // recounting `received`, or the assembly) must never see a short chunk.
    // The temporary name is unique per request and deliberately does not end in
    // `.part`, so a listing skips it, a crash leaves only a file the sweep
    // collects, and a retry of the same chunk cannot truncate the file the
    // previous attempt is still streaming into.
    const stagingPath = `${partPath}.${randomBytes(4).toString("hex")}.tmp`;

    try {
      await mkdir(partsDir, { recursive: true });
      // `pipeline` over the async iterable honours backpressure; a plain
      // `for await` loop would drop the tail of the part as soon as the write
      // buffer filled up, which is exactly the corruption the byte check below
      // exists to catch but must not create.
      await pipeline(part.data, createWriteStream(stagingPath));
    } catch (error) {
      await rm(stagingPath, { force: true }).catch(() => undefined);
      // The session may have been swept between the read and the write.
      if (isMissing(error)) {
        throw new Error(`Upload ${id} is no longer available`);
      }
      throw error;
    }

    const stored = (await stat(stagingPath)).size;
    if (stored !== part.bytes) {
      // Delete the bad part: leaving it would let a later resume assemble a file
      // that is silently the wrong length.
      await rm(stagingPath, { force: true }).catch(() => undefined);
      throw new Error(
        `Chunk ${part.index} of upload ${id} was ${stored} bytes, expected ${part.bytes}`,
      );
    }
    try {
      await rename(stagingPath, partPath);
    } catch (error) {
      await rm(stagingPath, { force: true }).catch(() => undefined);
      if (isMissing(error)) {
        throw new Error(`Upload ${id} is no longer available`);
      }
      throw error;
    }

    // The record is merged with the disk and with the freshest copy on disk
    // rather than from the read at the top: two chunks that land together each
    // recount the directory, and the loser of that race must not write back a
    // shorter `received` than the record already has.
    const current = await this.readSession(id);
    if (!current) throw new Error(`Upload ${id} is no longer available`);
    const received = [
      ...new Set([...current.received, ...(await listPartIndexes(partsDir))]),
    ].sort((a, b) => a - b);
    await this.persist(id, { ...current, received });

    // Recounted from disk rather than derived from `received`, so the caller's
    // progress agrees with what an assemble call would actually find.
    return received.length;
  }

  async assemble(ownerId: string, id: string): Promise<AssembledUpload> {
    const session = await this.requireSession(ownerId, id);
    const dir = this.sessionDir(id);
    const partsDir = join(dir, PARTS_DIR);
    const stored = new Set(await listPartIndexes(partsDir));

    const missing: number[] = [];
    for (let index = 0; index < session.chunkCount; index += 1) {
      if (!stored.has(index)) missing.push(index);
    }
    if (missing.length > 0) {
      throw new Error(
        `Upload ${id} is missing chunks: ${missing.slice(0, 10).join(", ")}` +
          (missing.length > 10 ? ` (+${missing.length - 10} more)` : ""),
      );
    }

    // Assembled next to the session and moved into place only after every byte
    // is written, so a failed attempt cannot be mistaken for a usable `file`.
    const target = join(dir, ASSEMBLED_FILE);
    const partial = `${target}.assembling`;

    // Opened here so the failure path below can close it: a stream left open
    // would keep the partial file locked until the process exits.
    const output = createWriteStream(partial);

    // One readable that yields every chunk in order, piped once. Piping each
    // part into the same stream separately would attach a listener set per
    // chunk, which on a 256-chunk file trips Node's max-listener warning and
    // leaves the stream carrying hundreds of listeners.
    let bytes = 0;
    const parts = (async function* parts() {
      for (let index = 0; index < session.chunkCount; index += 1) {
        const partPath = join(partsDir, `${index}${PART_SUFFIX}`);
        for await (const block of createReadStream(partPath)) {
          const buffer = block as Buffer;
          bytes += buffer.length;
          yield buffer;
        }
      }
    })();

    try {
      // A chunk at a time, never `readFile`, which is the whole reason this
      // port exists.
      await pipeline(Readable.from(parts), output);
      await rename(partial, target);
      return { path: target, bytes };
    } catch (error) {
      output.destroy();
      await rm(partial, { force: true }).catch(() => undefined);
      if (isMissing(error)) {
        // A part disappeared between the listing and the read: a sweep, or an
        // operator. Report it as a missing chunk rather than as a bare ENOENT.
        throw new Error(`Upload ${id} lost a chunk while assembling`);
      }
      throw error;
    }
  }

  async discardPayload(ownerId: string, id: string): Promise<void> {
    await this.requireSession(ownerId, id);
    const dir = this.sessionDir(id);
    await rm(join(dir, PARTS_DIR), { recursive: true, force: true });
    await rm(join(dir, ASSEMBLED_FILE), { force: true });
  }

  async update(session: UploadSession): Promise<void> {
    await this.persist(session.id, session);
  }

  async remove(ownerId: string, id: string): Promise<void> {
    await this.requireSession(ownerId, id);
    await rm(this.sessionDir(id), { recursive: true, force: true });
  }

  async sweep(before: Date): Promise<number> {
    const cutoff = before.getTime();
    let removed = 0;

    for (const id of await this.listSessionIds()) {
      const dir = this.sessionDir(id);
      const session = await this.readSession(id);

      // A directory without a readable record is a crash leftover: there is no
      // session to resume and no owner to ask, so it is swept as well.
      const expired =
        session === null || new Date(session.updatedAt).getTime() < cutoff;
      if (!expired) continue;

      try {
        await rm(dir, { recursive: true, force: true });
        removed += 1;
      } catch (error) {
        // Losing the race against a concurrent `remove` is not a failure.
        if (!isMissing(error)) throw error;
      }
    }

    return removed;
  }

  /** `<root>/<uploadId>`. */
  private sessionDir(id: string): string {
    return join(this.rootDir, id);
  }

  /**
   * Reads a session by id without checking the owner, `null` when the file is
   * not there. Used by the owner-scoped paths and by the sweep, which has no
   * owner to check.
   */
  private async readSession(id: string): Promise<UploadSession | null> {
    try {
      const raw = await readFile(join(this.sessionDir(id), SESSION_FILE), "utf8");
      return JSON.parse(raw) as UploadSession;
    } catch {
      // Missing, unreadable or half-written: from the caller's point of view the
      // session simply does not exist.
      return null;
    }
  }

  /** Reads a session the caller is allowed to touch, or throws. */
  private async requireSession(
    ownerId: string,
    id: string,
  ): Promise<UploadSession> {
    const session = await this.readSession(id);
    if (!session || session.ownerId !== ownerId) {
      throw new Error(`Upload ${id} was not found`);
    }
    return session;
  }

  /**
   * Persists `session`, stamping `updatedAt` from the injected clock.
   *
   * `expiresAt` is left exactly as the caller passed it: only the application
   * layer knows the TTL policy, and it re-stamps it on every write it makes.
   */
  private async persist(id: string, session: UploadSession): Promise<void> {
    const dir = this.sessionDir(id);
    const stored: UploadSession = { ...session, updatedAt: this.now().toISOString() };

    try {
      await this.writeSessionJson(dir, stored);
    } catch (error) {
      // The directory was swept between the read and the write: reporting a hard
      // error would be misleading, the session is simply gone.
      if (isMissing(error)) throw new Error(`Upload ${id} is no longer available`);
      throw error;
    }
  }

  private writeSessionJson(dir: string, session: UploadSession): Promise<void> {
    // Atomic replace, for the reason in the class comment: several chunk writes
    // persist this same record at once, and a reader that catches a truncated
    // file treats the session as missing. `rename` on one file system is
    // atomic, so a reader sees the previous record or the new one, never half
    // of either. The temporary name is unique per writer so two concurrent
    // writers cannot move each other's file.
    const target = join(dir, SESSION_FILE);
    const staging = `${target}.${randomBytes(4).toString("hex")}.tmp`;

    return writeFile(staging, `${JSON.stringify(session, null, 2)}\n`, "utf8")
      .then(() => rename(staging, target))
      .catch(async (error: unknown) => {
        await rm(staging, { force: true }).catch(() => undefined);
        throw error;
      });
  }

  /** Every id-shaped directory under the root, newest first is not needed. */
  private async listSessionIds(): Promise<string[]> {
    let entries: string[];
    try {
      entries = await readdir(this.rootDir);
    } catch (error) {
      if (isMissing(error)) return [];
      throw error;
    }
    return entries;
  }

  /** Every readable session record, skipping unreadable directories. */
  private async listSessions(): Promise<UploadSession[]> {
    const sessions: UploadSession[] = [];
    for (const id of await this.listSessionIds()) {
      const session = await this.readSession(id);
      if (session) sessions.push(session);
    }
    return sessions;
  }
}
