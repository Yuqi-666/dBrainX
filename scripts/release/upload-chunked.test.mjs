// SPDX-License-Identifier: AGPL-3.0-only

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as uploadContract from "../../packages/utils/src/upload.ts";

/**
 * Client-side behaviour of the resumable upload protocol.
 *
 * The source is transpiled and run in a `node:vm` context, like
 * `upload-auth.test.mjs`: the browser globals the uploaders need
 * (`XMLHttpRequest`, `FormData`, `crypto.subtle`, `localStorage`) are fake, so
 * a test can decide exactly which chunk fails, when a request is slow, and what
 * the server reports as already received. Every assertion about chunk geometry
 * is made through the frozen `chunkLengthFor` / `chunkCountFor` helpers, so a
 * change to the shared arithmetic cannot silently pass here.
 *
 * The chunked-path files are `{ name, size, type, lastModified, slice() }`
 * objects rather than real `File`s: the path only ever reads those members, and
 * a real 32 MiB+ fixture would cost memory without proving anything extra. The
 * direct path with a real `File` is pinned by `upload-auth.test.mjs`.
 */

const {
  DIRECT_UPLOAD_MAX_BYTES,
  MAX_UPLOAD_BYTES,
  chunkCountFor,
  chunkLengthFor,
} = uploadContract;

/** One byte over the direct limit: the smallest file the chunked path sees. */
const CHUNKED_FILE_SIZE = DIRECT_UPLOAD_MAX_BYTES + 5;

/** Chunk size the fake server answers with in most tests (not the default). */
const SERVER_CHUNK_SIZE = DIRECT_UPLOAD_MAX_BYTES / 2;

/** A file-shaped object with the members the chunked path touches. */
function fakeFile(name, size, options = {}) {
  return {
    name,
    size,
    type: options.type ?? "application/octet-stream",
    lastModified: options.lastModified ?? 1,
    slice: (start, end) => ({ size: end - start }),
  };
}

const SOURCE_DIR = fileURLToPath(new URL("../../packages/api-client/src/", import.meta.url));

/** The client modules this test loads; everything else is a stub. */
const LOCAL_MODULES = new Map([
  ["./upload", "upload.ts"],
  ["./upload-chunked", "upload-chunked.ts"],
  ["./backend-urls", "backend-urls.ts"],
]);

const transpiled = new Map();

function sourceOf(file) {
  if (!transpiled.has(file)) {
    transpiled.set(
      file,
      ts.transpileModule(readFileSync(SOURCE_DIR + file, "utf8"), {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022,
        },
      }).outputText,
    );
  }
  return transpiled.get(file);
}

/** `localStorage` stand-in that survives a simulated page reload. */
function memoryStorage() {
  const entries = new Map();
  return {
    getItem: (key) => (entries.has(key) ? entries.get(key) : null),
    setItem: (key, value) => entries.set(String(key), String(value)),
    removeItem: (key) => entries.delete(key),
    clear: () => entries.clear(),
    snapshot: () => Object.fromEntries(entries),
  };
}

const ATTACHMENT = {
  id: "rec-1",
  fileName: "server-renamed.bin",
  fileSize: CHUNKED_FILE_SIZE,
  updatedAt: "2024-05-06T07:08:09.000Z",
  url: "/api/files/files/rec-1/server-renamed.bin",
};

/**
 * Fake server for the frozen routes plus the direct path's PocketBase record
 * endpoint.
 *
 * `received` is the server's own truth: a part is only added once the request
 * was accepted, which is what the resume tests read back through a session
 * `POST`. `rejectPart` and `partDelayMs` let one test fail or stall one chunk
 * without affecting the others.
 *
 * `options` is deliberately read at request time, so a test can switch a
 * behaviour off between two simulated page loads.
 */
function createServer(options = {}) {
  const state = {
    uploadId: "upload-1",
    sessionPosts: 0,
    completes: 0,
    polls: 0,
    deletes: 0,
    recordPosts: 0,
    chunkSize: options.chunkSize ?? SERVER_CHUNK_SIZE,
    chunkCount: 0,
    fileSize: 0,
    fingerprint: undefined,
    workspaceId: undefined,
    sessionBody: undefined,
    received: new Set(options.received ?? []),
    partAttempts: new Map(),
    parts: [],
    requests: [],
    /** Chunks one session holds; the tests that split a file read this. */
    receivedFor: undefined,
  };

  /**
   * What one session has stored, keyed by its id.
   *
   * Per session rather than per test, because a `404` can make the client
   * continue in a second session for the same file, and the point of that path
   * is which chunks end up in which one. `state.received` stays the union,
   * which is what the single-session tests read.
   *
   * A new session starts with the union by default: that is the server's normal
   * fingerprint lookup, which answers with the chunks a file already has. A
   * test that wants the split state — a second session that really is empty,
   * the way a record the server could not read produces one — passes
   * `resume: false`.
   */
  const receivedBySession = new Map();
  const receivedFor = (uploadId) => {
    let set = receivedBySession.get(uploadId);
    if (!set) {
      set = new Set(options.resume === false ? [] : state.received);
      receivedBySession.set(uploadId, set);
    }
    return set;
  };
  state.receivedFor = receivedFor;

  let resolveFirstPart;
  const firstPart = new Promise((resolve) => {
    resolveFirstPart = resolve;
  });

  const dto = (overrides = {}) => ({
    uploadId: state.uploadId,
    status: "open",
    chunkSize: state.chunkSize,
    chunkCount: state.chunkCount,
    fileSize: state.fileSize,
    fileName: "server-side-name.bin",
    received: [...receivedFor(state.uploadId)].sort((a, b) => a - b),
    expiresAt: "2099-01-01T00:00:00.000Z",
    ...overrides,
  });

  const respond = (status, body) => ({ status, body: JSON.stringify(body) });

  function handle(request) {
    const { pathname } = new URL(request.url, "http://upload.test");
    const { method } = request;

    if (method === "POST" && pathname === "/upload/sessions") {
      state.sessionPosts += 1;
      state.uploadId = `upload-${state.sessionPosts}`;
      const body = JSON.parse(request.body);
      state.sessionBody = body;
      state.fileSize = body.fileSize;
      state.fingerprint = body.fingerprint;
      state.workspaceId = body.workspaceId;
      state.chunkCount = chunkCountFor(body.fileSize, state.chunkSize);
      return respond(201, dto());
    }

    const part = pathname.match(/^\/upload\/sessions\/([^/]+)\/parts\/(\d+)$/);
    if (method === "PUT" && part) {
      const index = Number(part[2]);
      const attempt = (state.partAttempts.get(index) ?? 0) + 1;
      state.partAttempts.set(index, attempt);
      state.parts.push({ index, size: request.body?.size, uploadId: part[1] });
      if (state.parts.length === 1) resolveFirstPart();
      const rejection = options.rejectPart?.(index, attempt, state);
      if (rejection) return rejection;
      if (options.partDelayMs) {
        return new Promise((resolve) => {
          setTimeout(() => {
            receivedFor(part[1]).add(index);
            resolve(respond(200, dto()));
          }, options.partDelayMs);
        });
      }
      receivedFor(part[1]).add(index);
      state.received.add(index);
      return respond(200, dto());
    }

    if (method === "GET" && pathname === `/upload/sessions/${state.uploadId}`) {
      state.polls += 1;
      return respond(
        200,
        options.poll?.(state.polls, state, dto) ??
          dto({ status: "done", attachment: { ...ATTACHMENT, fileSize: state.fileSize } }),
      );
    }

    if (method === "POST" && pathname === `/upload/sessions/${state.uploadId}/complete`) {
      state.completes += 1;
      // The hook answers with a plain DTO (the accepted case) or with a whole
      // response, which is how a test makes the first `complete` fail.
      const custom = options.complete?.(state, dto);
      if (custom && typeof custom.status === "number" && typeof custom.body === "string") {
        return custom;
      }
      return respond(202, custom ?? dto({ status: "assembling" }));
    }

    if (method === "DELETE" && pathname.startsWith("/upload/sessions/")) {
      state.deletes += 1;
      return { status: 204, body: "" };
    }

    // The direct path posts the whole file to the file store.
    if (method === "POST" && pathname.includes("/api/collections/")) {
      state.recordPosts += 1;
      return respond(200, { id: "record-1", collectionId: "files", file: "file.txt" });
    }

    return respond(404, { message: `no route for ${method} ${pathname}` });
  }

  async function dispatch(xhr) {
    const request = {
      method: xhr.method,
      url: xhr.url,
      headers: xhr.headers,
      body: xhr.body,
    };
    state.requests.push(request);
    const response = await handle(request);
    if (response === undefined) return;
    xhr.finish(response);
  }

  return {
    state,
    firstPart,
    dispatch,
    partIndexes: () =>
      state.parts.map((part) => part.index).sort((a, b) => a - b),
  };
}

/** PocketBase SDK stand-in; only the members the upload paths touch. */
function pocketbaseStub() {
  return {
    baseUrl: "https://example.test/pb",
    authStore: { token: "desktop-token" },
    buildUrl: (path) => `https://example.test/pb${path}`,
    files: {
      getUrl: () => "https://example.test/pb/api/files/files/record-1/file.txt",
    },
  };
}

/** Loads `upload.ts` (and the chunked module) in one fresh vm context. */
function loadClient({
  server = createServer(),
  storage = memoryStorage(),
  platform,
  token = "token-1",
  workspaceId = "workspace",
  pocketbase = pocketbaseStub(),
  crypto: cryptoImpl = globalThis.crypto,
} = {}) {
  const cache = new Map();

  class FakeXMLHttpRequest {
    constructor() {
      this.status = 0;
      this.responseText = "";
      this.timeout = 0;
      this.headers = {};
      this.listeners = {};
      this.uploadListeners = {};
      this.settled = false;
      const self = this;
      this.upload = {
        addEventListener: (name, callback) => {
          self.uploadListeners[name] = callback;
        },
      };
    }
    addEventListener(name, callback) {
      this.listeners[name] = callback;
    }
    open(method, url) {
      this.method = method;
      this.url = url;
    }
    setRequestHeader(name, value) {
      this.headers[name] = value;
    }
    send(body) {
      this.body = body;
      void server.dispatch(this);
    }
    abort() {
      if (this.settled) return;
      this.settled = true;
      this.aborted = true;
      this.listeners.abort?.();
    }
    finish(response) {
      if (this.settled) return;
      this.settled = true;
      this.status = response.status;
      this.responseText = response.body ?? "";
      if (typeof this.body?.size === "number") {
        this.uploadListeners.progress?.({
          lengthComputable: true,
          loaded: this.body.size,
          total: this.body.size,
        });
      }
      this.listeners.load?.();
    }
  }

  function loadModule(file) {
    if (cache.has(file)) return cache.get(file);
    const module = { exports: {} };
    cache.set(file, module.exports);
    runInNewContext(sourceOf(file), {
      module,
      exports: module.exports,
      require,
      XMLHttpRequest: FakeXMLHttpRequest,
      FormData,
      TextEncoder,
      crypto: cryptoImpl,
      setTimeout,
      clearTimeout,
      console,
      window: {
        location: {
          hostname: "localhost",
          host: "localhost:3000",
          origin: "http://localhost:3000",
          protocol: "http:",
        },
        localStorage: storage,
      },
      process: {
        env: platform ? { NEXT_PUBLIC_DBRAINX_PLATFORM: platform } : {},
      },
    });
    cache.set(file, module.exports);
    return module.exports;
  }

  function require(id) {
    const file = LOCAL_MODULES.get(id);
    if (file) return loadModule(file);
    if (id === "@workspace/utils/upload") return uploadContract;
    if (id === "@workspace/store") {
      return {
        useWorkspaceStore: {
          getState: () => ({ currentWorkspaceId: workspaceId }),
        },
      };
    }
    if (id === "react") return {};
    if (id === "./pocketbase-client") {
      return { getPocketbaseClient: () => pocketbase };
    }
    if (id === "./auth/session") {
      return { readAuthSessionToken: () => token };
    }
    if (id === "./desktop-backend") {
      return {
        getDesktopBackend: () => {
          throw new Error("desktop backend not initialised");
        },
      };
    }
    throw new Error(`Unexpected import ${id} in the upload test`);
  }

  return {
    upload: loadModule("upload.ts"),
    chunked: loadModule("upload-chunked.ts"),
    server,
    storage,
  };
}

function browserWindow(href) {
  const url = new URL(href);
  return {
    location: {
      hostname: url.hostname,
      host: url.host,
      origin: url.origin,
      protocol: url.protocol,
    },
    localStorage: memoryStorage(),
  };
}

function loadBackendUrls({ window: windowValue, env = {}, platform, desktopBackend } = {}) {
  const module = { exports: {} };
  runInNewContext(sourceOf("backend-urls.ts"), {
    module,
    exports: module.exports,
    require(id) {
      if (id === "./desktop-backend") {
        return { getDesktopBackend: () => desktopBackend };
      }
      throw new Error(`Unexpected import ${id} in the backend-urls test`);
    },
    process: {
      env: {
        ...env,
        ...(platform ? { NEXT_PUBLIC_DBRAINX_PLATFORM: platform } : {}),
      },
    },
    // `window: null` means "server side": no window at all, so the resolver
    // takes its loopback fallback.
    ...(windowValue !== null
      ? { window: windowValue ?? browserWindow("http://localhost:3000") }
      : {}),
  });
  return module.exports;
}

test("the transport switches at DIRECT_UPLOAD_MAX_BYTES", async () => {
  const directServer = createServer();
  const direct = loadClient({ server: directServer });
  await direct.upload.uploadAttachment(
    fakeFile("at-limit.bin", DIRECT_UPLOAD_MAX_BYTES),
  );
  assert.equal(directServer.state.recordPosts, 1);
  assert.equal(directServer.state.sessionPosts, 0);

  // One byte over the threshold takes the chunked path, planned from the chunk
  // size the *server* chose (here the whole threshold, so two parts).
  const chunkedServer = createServer({ chunkSize: DIRECT_UPLOAD_MAX_BYTES });
  const chunked = loadClient({ server: chunkedServer });
  const size = DIRECT_UPLOAD_MAX_BYTES + 1;
  await chunked.upload.uploadAttachment(fakeFile("over-limit.bin", size));
  assert.equal(chunkedServer.state.sessionPosts, 1);
  assert.equal(chunkedServer.state.recordPosts, 0);
  assert.equal(chunkedServer.state.chunkCount, chunkCountFor(size, DIRECT_UPLOAD_MAX_BYTES));
  assert.deepEqual(chunkedServer.partIndexes(), [0, 1]);
  assert.deepEqual(
    chunkedServer.state.parts.map((part) => part.size),
    [DIRECT_UPLOAD_MAX_BYTES, 1],
  );
});

test("a chunked upload uses the server's plan, completes and polls to done", async () => {
  const server = createServer({ chunkSize: SERVER_CHUNK_SIZE });
  const client = loadClient({ server });
  const file = fakeFile("report.bin", CHUNKED_FILE_SIZE, { lastModified: 1234 });
  const progress = [];
  const attachment = await client.upload.uploadAttachment(
    file,
    (event) => progress.push(event.progress),
    new AbortController().signal,
  );

  const session = server.state.sessionBody;
  assert.deepEqual(
    { ...session, fingerprint: undefined },
    {
      fileName: "report.bin",
      fileSize: CHUNKED_FILE_SIZE,
      contentType: "application/octet-stream",
      workspaceId: "workspace",
      fingerprint: undefined,
    },
  );
  assert.match(session.fingerprint, /^[0-9a-f]{64}$/);

  // The server answered with its own chunk size, not `UPLOAD_CHUNK_BYTES`; the
  // client must slice on the answered size, including the short final chunk.
  assert.deepEqual(server.partIndexes(), [0, 1, 2]);
  assert.deepEqual(
    server.state.parts.map((part) => part.size),
    [SERVER_CHUNK_SIZE, SERVER_CHUNK_SIZE, 5],
  );
  for (const part of server.state.parts) {
    assert.equal(part.size, chunkLengthFor(CHUNKED_FILE_SIZE, part.index, SERVER_CHUNK_SIZE));
  }

  for (const request of server.state.requests.filter((r) => /\/parts\//.test(r.url))) {
    assert.equal(request.method, "PUT");
    assert.equal(request.headers["Content-Type"], "application/octet-stream");
    assert.equal(request.headers.Authorization, "token-1");
  }
  assert.equal(server.state.completes, 1);
  assert.equal(server.state.polls, 1);
  assert.equal(server.state.deletes, 0);

  assert.deepEqual(
    { ...attachment },
    {
      id: "rec-1",
      // The server renamed the stored file; the caller keeps its own name.
      fileName: "report.bin",
      fileSize: CHUNKED_FILE_SIZE,
      updatedAt: "2024-05-06T07:08:09.000Z",
      url: "https://example.test/pb/api/files/files/rec-1/server-renamed.bin",
    },
  );

  assert.deepEqual([...progress].sort((a, b) => a - b), progress);
  assert.equal(progress.at(-1), 100);
  // The resume hint is dropped once the file is stored.
  assert.deepEqual(Object.keys(client.storage.snapshot()), []);
});

test("a resumed session only uploads the missing chunks", async () => {
  const server = createServer({ received: [0, 2] });
  const client = loadClient({ server });
  await client.upload.uploadAttachment(fakeFile("resume.bin", CHUNKED_FILE_SIZE));
  assert.deepEqual(server.partIndexes(), [1]);
  assert.deepEqual(
    server.state.parts.map((part) => part.size),
    [SERVER_CHUNK_SIZE],
  );
});

test("a reload resumes from the persisted fingerprint", async () => {
  const options = {
    rejectPart: (index) =>
      index === 2
        ? { status: 413, body: JSON.stringify({ message: "chunk rejected" }) }
        : undefined,
  };
  const server = createServer(options);
  const storage = memoryStorage();
  const file = () => fakeFile("reload.bin", CHUNKED_FILE_SIZE, { lastModified: 99 });

  const first = loadClient({ server, storage });
  await assert.rejects(first.upload.uploadAttachment(file()), /chunk rejected/);

  const hints = storage.snapshot();
  const keys = Object.keys(hints);
  assert.equal(keys.length, 1);
  assert.match(keys[0], /^dbrainx\.upload\.session:[0-9a-f]{64}$/);
  assert.deepEqual(JSON.parse(hints[keys[0]]), {
    uploadId: "upload-1",
    fingerprint: keys[0].slice("dbrainx.upload.session:".length),
    fileName: "reload.bin",
    fileSize: CHUNKED_FILE_SIZE,
  });
  // The two chunks that made it are on the server; the failing one is not.
  assert.deepEqual(server.partIndexes(), [0, 1, 2]);
  assert.deepEqual([...server.state.received].sort((a, b) => a - b), [0, 1]);

  // A fresh page load shares only `localStorage` with the first one.
  options.rejectPart = undefined;
  const second = loadClient({ server, storage });
  await second.upload.uploadAttachment(file());
  assert.equal(server.state.sessionPosts, 2);
  assert.deepEqual(
    server.state.parts.slice(3).map((part) => part.index),
    [2],
  );
  assert.deepEqual(Object.keys(storage.snapshot()), []);
});

test("a chunk that fails with a 500 is retried and then succeeds", async () => {
  const server = createServer({
    chunkSize: DIRECT_UPLOAD_MAX_BYTES,
    rejectPart: (index, attempt) =>
      index === 0 && attempt === 1
        ? { status: 500, body: JSON.stringify({ message: "temporary" }) }
        : undefined,
  });
  const client = loadClient({ server });
  const attachment = await client.upload.uploadAttachment(
    fakeFile("retry.bin", DIRECT_UPLOAD_MAX_BYTES + 1, { lastModified: 3 }),
  );
  assert.equal(server.state.partAttempts.get(0), 2);
  assert.equal(server.state.completes, 1);
  assert.equal(attachment.fileName, "retry.bin");
});

test("a swept session is re-opened and the chunk continues", async () => {
  const server = createServer({
    chunkSize: DIRECT_UPLOAD_MAX_BYTES,
    rejectPart: (index, attempt) =>
      index === 0 && attempt === 1
        ? { status: 404, body: JSON.stringify({ message: "unknown session" }) }
        : undefined,
  });
  const client = loadClient({ server });
  const attachment = await client.upload.uploadAttachment(
    fakeFile("swept.bin", DIRECT_UPLOAD_MAX_BYTES + 1, { lastModified: 23 }),
  );
  // The 404 cost one extra session instead of a backoff retry, and the chunk
  // was sent again against the new session.
  assert.equal(server.state.sessionPosts, 2);
  assert.equal(server.state.partAttempts.get(0), 2);
  assert.equal(server.state.completes, 1);
  assert.equal(attachment.id, "rec-1");
});

test("a re-opened session is re-sent the chunks the previous one held", async () => {
  // The live failure: a part `PUT` answered `404` for a session that was in
  // fact still there, so the client continued in a second session while the
  // chunks already stored in the first stayed behind. `complete` then rejected
  // a file whose every byte had been uploaded — the user saw "100%, then the
  // upload failed".
  const server = createServer({
    chunkSize: DIRECT_UPLOAD_MAX_BYTES,
    // The second session really is empty here: the server could not read the
    // first one's record, which is what opened it in the first place.
    resume: false,
    rejectPart: (index, attempt) =>
      index === 1 && attempt === 1
        ? { status: 404, body: JSON.stringify({ message: "unknown session" }) }
        : undefined,
  });
  const client = loadClient({ server });
  const attachment = await client.upload.uploadAttachment(
    fakeFile("split.bin", DIRECT_UPLOAD_MAX_BYTES + 1, { lastModified: 41 }),
  );

  assert.equal(server.state.sessionPosts, 2);
  // Chunk 0 is only in the abandoned session; the new one has to receive it
  // again, or it can never be completed.
  assert.deepEqual([...server.state.receivedFor("upload-1")], [0]);
  assert.deepEqual(
    [...server.state.receivedFor("upload-2")].sort((a, b) => a - b),
    [0, 1],
  );
  assert.equal(server.state.completes, 1);
  assert.equal(attachment.id, "rec-1");
});

test("an incomplete complete re-sends the chunks the server is missing", async () => {
  // The safety net under the session bookkeeping: the server names the chunks
  // it does not have, the client still holds the file, so the upload finishes
  // instead of failing after all of its bytes were sent.
  const server = createServer({
    chunkSize: DIRECT_UPLOAD_MAX_BYTES,
    complete: (state, dto) =>
      state.completes === 1
        ? {
            status: 409,
            body: JSON.stringify({
              message: "1 of 2 chunks are still missing",
              missing: [0],
            }),
          }
        : dto({ status: "assembling" }),
  });
  const client = loadClient({ server });
  const attachment = await client.upload.uploadAttachment(
    fakeFile("heal.bin", DIRECT_UPLOAD_MAX_BYTES + 1, { lastModified: 43 }),
  );

  assert.equal(server.state.completes, 2);
  assert.equal(server.state.partAttempts.get(0), 2);
  assert.equal(server.state.partAttempts.get(1), 1);
  assert.deepEqual(
    [...server.state.receivedFor("upload-1")].sort((a, b) => a - b),
    [0, 1],
  );
  assert.equal(server.state.polls, 1);
  assert.equal(attachment.id, "rec-1");
});

test("a complete that keeps losing chunks fails with the server's message", async () => {
  const server = createServer({
    chunkSize: DIRECT_UPLOAD_MAX_BYTES,
    complete: () => ({
      status: 409,
      body: JSON.stringify({ message: "2 chunks are still missing", missing: [1] }),
    }),
  });
  const client = loadClient({ server });
  await assert.rejects(
    client.upload.uploadAttachment(
      fakeFile("hopeless.bin", DIRECT_UPLOAD_MAX_BYTES + 1, { lastModified: 47 }),
    ),
    { message: "2 chunks are still missing" },
  );
  // One call plus the capped number of re-sends, and no polling of a session
  // that never started assembling.
  assert.equal(server.state.completes, 4);
  assert.equal(server.state.polls, 0);
});

test("a 413 fails immediately with the server's message", async () => {  const server = createServer({
    chunkSize: DIRECT_UPLOAD_MAX_BYTES,
    rejectPart: () => ({
      status: 413,
      body: JSON.stringify({ message: "file too large for this deployment" }),
    }),
  });
  const client = loadClient({ server });
  await assert.rejects(
    client.upload.uploadAttachment(
      fakeFile("too-big.bin", DIRECT_UPLOAD_MAX_BYTES + 1, { lastModified: 11 }),
    ),
    { message: "file too large for this deployment" },
  );
  assert.equal(server.state.parts.length, 2);
  for (const attempts of server.state.partAttempts.values()) {
    assert.equal(attempts, 1);
  }
  assert.equal(server.state.completes, 0);
  assert.equal(server.state.polls, 0);
});

test("an abort rejects with Upload aborted and leaves the session alone", async () => {
  const server = createServer({
    chunkSize: DIRECT_UPLOAD_MAX_BYTES,
    partDelayMs: 40,
  });
  const client = loadClient({ server });
  const controller = new AbortController();
  const pending = client.upload.uploadAttachment(
    fakeFile("abort.bin", DIRECT_UPLOAD_MAX_BYTES + 1, { lastModified: 17 }),
    () => {},
    controller.signal,
  );

  await server.firstPart;
  controller.abort();
  await assert.rejects(pending, { message: "Upload aborted" });

  // The chunks are the resume point, so an abort must not delete the session.
  assert.equal(server.state.deletes, 0);
  assert.equal(server.state.completes, 0);
  assert.equal(Object.keys(client.storage.snapshot()).length, 1);
});

test("an error status from the assembler surfaces the server message", async () => {
  const server = createServer({
    chunkSize: DIRECT_UPLOAD_MAX_BYTES,
    // The error DTO is a session DTO too, so build it with the same helper.
    poll: (polls, state, dto) => dto({ status: "error", error: "assembler exploded" }),
  });
  const client = loadClient({ server });
  await assert.rejects(
    client.upload.uploadAttachment(
      fakeFile("broken.bin", DIRECT_UPLOAD_MAX_BYTES + 1, { lastModified: 13 }),
    ),
    { message: "assembler exploded" },
  );
  assert.equal(server.state.completes, 1);
  assert.equal(server.state.polls, 1);
});

test("the fingerprint is deterministic and falls back without crypto.subtle", async () => {
  const file = fakeFile("hash.bin", CHUNKED_FILE_SIZE, { lastModified: 42 });
  const secure = loadClient({ server: createServer() });
  const insecure = loadClient({ server: createServer(), crypto: null });

  const digest = await secure.chunked.uploadFingerprint(file, "workspace");
  assert.match(digest, /^[0-9a-f]{64}$/);
  assert.equal(digest, await secure.chunked.uploadFingerprint(file, "workspace"));
  assert.notEqual(digest, await secure.chunked.uploadFingerprint(file, "other"));

  const fallback = await insecure.chunked.uploadFingerprint(file, "workspace");
  assert.match(fallback, /^fnv1a64-[0-9a-f]{16}$/);
  assert.equal(fallback, await insecure.chunked.uploadFingerprint(file, "workspace"));
  assert.notEqual(fallback, digest);

  // Resume still works where `crypto.subtle` is missing: the hint is keyed by
  // the deterministic fallback and the server decides what is missing.
  const server = createServer({ received: [0, 1] });
  const client = loadClient({ server, crypto: null });
  await client.upload.uploadAttachment(fakeFile("hash.bin", CHUNKED_FILE_SIZE, { lastModified: 42 }));
  assert.deepEqual(server.partIndexes(), [2]);
});

test("a file above MAX_UPLOAD_BYTES is refused before any request", async () => {
  const server = createServer({ chunkSize: DIRECT_UPLOAD_MAX_BYTES });
  const client = loadClient({ server });
  await assert.rejects(
    client.upload.uploadAttachment(fakeFile("huge.bin", MAX_UPLOAD_BYTES + 1)),
    { message: `Upload failed: the file is larger than ${MAX_UPLOAD_BYTES} bytes` },
  );
  assert.equal(server.state.sessionPosts, 0);
});

test("resolveBackendUrls resolves the upload base per deployment shape", () => {
  const loopback = loadBackendUrls({ window: browserWindow("http://127.0.0.1:3000") });
  assert.deepEqual(
    { ...loopback.resolveBackendUrls() },
    {
      trpc: "ws://127.0.0.1:3001/trpc",
      pocketbase: "http://127.0.0.1:8090",
      upload: "http://127.0.0.1:3001",
    },
  );

  // A proxied deployment reuses the existing `/pb` rule, so no proxy change.
  const proxied = loadBackendUrls({ window: browserWindow("https://dbrainx.example") });
  assert.deepEqual(
    { ...proxied.resolveBackendUrls() },
    {
      trpc: "wss://dbrainx.example/trpc",
      pocketbase: "https://dbrainx.example/pb",
      upload: "https://dbrainx.example/pb",
    },
  );

  const forced = loadBackendUrls({
    window: browserWindow("http://localhost:3000"),
    env: { NEXT_PUBLIC_DBRAINX_BACKEND_MODE: "same-origin" },
  });
  assert.equal(forced.resolveBackendUrls().upload, "http://localhost:3000/pb");

  const desktop = loadBackendUrls({
    window: browserWindow("http://localhost:3000"),
    platform: "desktop",
    desktopBackend: {
      trpc: "ws://127.0.0.1:1111/trpc",
      pocketbase: "http://127.0.0.1:1111/session/abc",
    },
  });
  assert.deepEqual(
    { ...desktop.resolveBackendUrls() },
    {
      trpc: "ws://127.0.0.1:1111/trpc",
      pocketbase: "http://127.0.0.1:1111/session/abc",
      upload: "http://127.0.0.1:1111/session/abc",
    },
  );

  const serverSide = loadBackendUrls({ window: null });
  assert.equal(serverSide.resolveBackendUrls().upload, "http://localhost:3001");
});
