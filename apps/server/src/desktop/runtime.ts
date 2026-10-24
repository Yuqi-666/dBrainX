// SPDX-License-Identifier: AGPL-3.0-only

/** Desktop composition root: the SAME container/router as apps/server, with a local lifecycle. */
import { prepareUpgradeBackup, commitReleaseState } from "./upgrade-backup";
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createServer, request as httpRequest } from "node:http";
import { createServer as createTcpServer } from "node:net";
import { mkdir, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import PocketBase from "pocketbase";
import { AppContainer, appRouter, createContext, createWSServer } from "@workspace/adapter-front";
import { allowedFileRequest, allowedOrigin, sessionPath } from "./security";
import { handleUploadRequest, isUploadPath, startUploadSweeper } from "../upload/routes";

const runtimeDir = dirname(fileURLToPath(import.meta.url));
const dataDir = process.argv[2];
const readyFile = process.argv[3];
if (!dataDir || !readyFile) throw new Error("Expected application data directory and readiness file");
const executable = (name: string) => join(runtimeDir, process.platform === "win32" ? `${name}.exe` : name);
const lockFile = join(dataDir, "runtime.lock");
let ownsLock = false;
let pocketbase: ChildProcess | undefined;
let stopping = false;

async function acquireLock() {
  await mkdir(dataDir!, { recursive: true, mode: 0o700 });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const lock = await open(lockFile, "wx", 0o600);
      ownsLock = true;
      await lock.writeFile(String(process.pid));
      await lock.close();
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const pid = Number(await readFile(lockFile, "utf8"));
      if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error("Invalid local backend lock; inspect runtime.lock");
      try { process.kill(pid, 0); } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ESRCH") { await rm(lockFile); continue; }
        throw error;
      }
      throw new Error("本地后端已在运行，请关闭另一个 Desktop 实例。");
    }
  }
  throw new Error("Could not acquire local backend lock");
}

async function freePort(): Promise<number> {
  const probe = createTcpServer();
  await new Promise<void>((resolve, reject) => { probe.once("error", reject); probe.listen(0, "127.0.0.1", resolve); });
  const address = probe.address();
  if (!address || typeof address === "string") throw new Error("No loopback port");
  await new Promise<void>(resolve => probe.close(() => resolve()));
  return address.port;
}

async function shutdown(code = 0) {
  if (stopping) return;
  stopping = true;
  if (pocketbase && pocketbase.exitCode === null) {
    const exited = new Promise<void>(resolve => pocketbase!.once("exit", () => resolve()));
    pocketbase.kill("SIGTERM");
    await Promise.race([exited, new Promise(resolve => setTimeout(resolve, 3000))]);
    if (pocketbase.exitCode === null) pocketbase.kill("SIGKILL");
  }
  if (ownsLock) {
    await rm(lockFile, { force: true });
    await rm(readyFile!, { force: true });
  }
  process.exit(code);
}
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
// Tauri owns stdin: normal exit or a crashed supervisor closes it and reaps PocketBase.
process.stdin.on("data", () => void shutdown());
process.stdin.on("end", () => void shutdown());
process.stdin.resume();

async function main() {
  await acquireLock();
  const manifest = JSON.parse(await readFile(join(runtimeDir, "runtime-manifest.json"), "utf8")) as { fingerprint: string };
  if (!manifest.fingerprint) throw new Error("Packaged runtime manifest is missing its release fingerprint");
  const backup = await prepareUpgradeBackup(dataDir!, manifest.fingerprint);
  if (backup) console.log("[desktop] pre-upgrade backup created", backup);
  const { prepareMigrations } = await import(new URL("./pocketbase-migrations.mjs", import.meta.url).href);
  await prepareMigrations({
    dataDir: join(dataDir!, "pb_data"),
    baseDir: join(runtimeDir, "pb_migrations_base"),
    changesDir: join(runtimeDir, "pb_migrations_changes"),
    runDir: join(dataDir!, "pb_migrations"),
  });
  const pbPort = await freePort();
  const pbUrl = `http://127.0.0.1:${pbPort}`;
  const databaseSecret = randomBytes(32).toString("hex");
  // Keep the private database inaccessible even when a browser guesses its port.
  // The shared SDK/repositories retain their normal authentication behavior.
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    if (new URL(url).origin !== pbUrl) return originalFetch(input, init);
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    headers.set("X-DBrainX-Internal", databaseSecret);
    return originalFetch(input, { ...init, headers });
  };
  pocketbase = spawn(executable("pocketbase"), ["serve", `--http=127.0.0.1:${pbPort}`,
    `--dir=${join(dataDir!, "pb_data")}`, `--migrationsDir=${join(dataDir!, "pb_migrations")}`, `--hooksDir=${join(runtimeDir, "pb_hooks")}`, "--automigrate=0",
    "--origins=http://localhost:3002,http://127.0.0.1:3002,tauri://localhost,http://tauri.localhost,https://tauri.localhost",
  ], { stdio: ["ignore", "ignore", "inherit"], windowsHide: true, env: { ...process.env, DBRAINX_PB_SECRET: databaseSecret } });
  pocketbase.once("error", error => { console.error("PocketBase launch failed", error); void shutdown(1); });
  pocketbase.once("exit", () => { if (!stopping) { console.error("PocketBase stopped unexpectedly"); void shutdown(1); } });
  let healthy = false;
  for (let attempt = 0; attempt < 150 && !stopping; attempt++) {
    try { healthy = (await fetch(`${pbUrl}/api/health`, { signal: AbortSignal.timeout(1000) })).ok; } catch { /* booting */ }
    if (healthy) break;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  if (!healthy) throw new Error("PocketBase startup timed out");

  const identityPath = join(dataDir!, "local-identity.json");
  let identity: { email: string; password: string };
  try { identity = JSON.parse(await readFile(identityPath, "utf8")); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    identity = { email: "desktop@dbrainx.local", password: randomBytes(32).toString("hex") };
    await writeFile(identityPath, JSON.stringify(identity), { mode: 0o600, flag: "wx" });
  }
  const pb = new PocketBase(pbUrl);
  // Account creation and login are idempotent after an interrupted first launch.
  let session;
  try { session = await pb.collection("users").authWithPassword(identity.email, identity.password); } catch (error) {
    if ((error as { status?: number }).status !== 400) throw error;
    await pb.collection("users").create({ ...identity, passwordConfirm: identity.password, nickname: "本地用户" });
    session = await pb.collection("users").authWithPassword(identity.email, identity.password);
  }
  await AppContainer.initialize(pbUrl);
  // The upload pipeline writes to the local PocketBase from this process with
  // raw `node:http` (a 2 GiB multipart body cannot go through `fetch`), where
  // the patched global fetch below cannot add the internal header. Handing the
  // secret to the file store through the environment keeps the local database
  // reachable while it stays unreachable to every other client.
  process.env.DBRAINX_PB_INTERNAL_SECRET = databaseSecret;
  startUploadSweeper(() => AppContainer.getInstance().uploadCommandService);
  const secret = randomBytes(32).toString("hex");
  const localOwnerId = String(session.record?.id ?? "");
  const server = createServer((req, res) => {
    const origin = req.headers.origin;
    const path = sessionPath(req.url ?? "", secret);
    if (!allowedOrigin(origin) || !path) { res.writeHead(403).end(); return; }
    if (origin) res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    if (req.method === "OPTIONS") {
      res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, POST, PUT, DELETE, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type, Range");
      res.writeHead(204).end(); return;
    }
    if (path === "/health") { res.writeHead(200, { "Content-Type": "application/json" }).end('{"ready":true}'); return; }
    if (path === "/session" && req.method === "POST") {
      void pb.collection("users").authWithPassword(identity.email, identity.password).then(session => {
        res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" }).end(JSON.stringify({ token: session.token }));
      }).catch(() => res.writeHead(503).end());
      return;
    }
    if (isUploadPath(path)) {
      // The `/session/<secret>` prefix is the admission ticket here, so there is
      // no cookie to verify: this process owns the local identity.
      void handleUploadRequest(req, res, path, {
        service: () => AppContainer.getInstance().uploadCommandService,
        authenticate: async () => ({ ownerId: localOwnerId, token: pb.authStore.token }),
      });
      return;
    }
    if (!allowedFileRequest(path, req.method)) { res.writeHead(404).end(); return; }
    const headers = { ...req.headers, host: `127.0.0.1:${pbPort}`, authorization: pb.authStore.token, "x-dbrainx-internal": databaseSecret };
    delete headers.origin;
    const upstream = httpRequest(new URL(path, pbUrl), { method: req.method, headers }, response => {
      for (const key of ["content-type", "content-length", "content-range", "accept-ranges", "etag", "last-modified"]) {
        const value = response.headers[key];
        if (value !== undefined) res.setHeader(key, value);
      }
      res.setHeader("Access-Control-Expose-Headers", "Content-Length, Content-Range, Accept-Ranges");
      res.writeHead(response.statusCode ?? 502);
      response.pipe(res);
      response.once("error", () => res.destroy());
    });
    upstream.once("error", () => { if (!res.headersSent) res.writeHead(502); res.end(); });
    req.once("aborted", () => upstream.destroy());
    req.pipe(upstream);
  });
  const { wss } = createWSServer(0, appRouter, createContext, { noServer: true });
  server.on("upgrade", (req, socket, head) => {
    if (!allowedOrigin(req.headers.origin) || sessionPath(req.url ?? "", secret)?.split("?")[0] !== "/trpc") {
      socket.end("HTTP/1.1 403 Forbidden\r\n\r\n"); return;
    }
    wss.handleUpgrade(req, socket, head, ws => wss.emit("connection", ws, req));
  });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No backend address");
  const base = `http://127.0.0.1:${address.port}/session/${secret}`;
  const descriptor = { trpc: `${base.replace("http:", "ws:")}/trpc`, pocketbase: base, token: session.token, dataDir };
  await commitReleaseState(dataDir!, manifest.fingerprint);
  await writeFile(`${readyFile}.tmp`, JSON.stringify(descriptor), { mode: 0o600 });
  await rename(`${readyFile}.tmp`, readyFile!);
  console.log("[desktop] local backend ready");
}

main().catch(error => { console.error("Local backend startup failed", error); void shutdown(1); });
