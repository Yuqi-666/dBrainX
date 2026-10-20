// SPDX-License-Identifier: AGPL-3.0-only

/** Exercise the packaged backend outside the checkout, with a fresh device database. */
import { pdfFixture } from "../../../scripts/lib/smoke-fixtures.mjs";
import { stopRuntimeChild } from "../../../scripts/lib/stop-runtime-child.mjs";
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { cp, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const requireClient = createRequire(join(root, "packages/api-client/package.json"));
const { createTRPCClient, createWSClient, wsLink } = await import(pathToFileURL(requireClient.resolve("@trpc/client")).href);
const { default: superjson } = await import(pathToFileURL(requireClient.resolve("superjson")).href);
const scratch = await mkdtemp(join(tmpdir(), "dbrain-backend-smoke-"));
const runtime = join(scratch, "runtime");
const runtimeSource = process.env.DBRAIN_SMOKE_RUNTIME_DIR
  ? resolve(process.env.DBRAIN_SMOKE_RUNTIME_DIR)
  : join(root, "apps/desktop/src-tauri/runtime");
await cp(runtimeSource, runtime, { recursive: true, dereference: true });
const data = join(scratch, "data");
const readyFile = join(scratch, "ready.json");
const exe = name => join(runtime, process.platform === "win32" ? `${name}.exe` : name);
let child, descriptor, ws, client;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
let logs = "";
const env = { ...process.env, DBRAIN_DESKTOP: "1", FFMPEG_PATH: exe("ffmpeg"), FFPROBE_PATH: exe("ffprobe"), LD_LIBRARY_PATH: join(runtime, "lib") };
async function start() {
  child = spawn(exe("node"), [join(runtime, "backend.mjs"), data, readyFile], { env, stdio: ["pipe", "pipe", "pipe"] });
  child.stdout.on("data", chunk => { logs += chunk; });
  child.stderr.on("data", chunk => { logs += chunk; });
  child.on("error", error => { logs += error.message; });
  for (let attempt = 0; attempt < 450; attempt++) {
    if (child.exitCode !== null || child.signalCode !== null) throw new Error(`Backend stopped (${child.exitCode ?? child.signalCode}): ${logs}`);
    try { descriptor = JSON.parse(await readFile(readyFile, "utf8")); break; } catch { await pause(100); }
  }
  assert.ok(descriptor, "runtime ready");
  ws = createWSClient({ url: descriptor.trpc, connectionParams: { token: descriptor.token, sourceId: "smoke-client" } });
  client = createTRPCClient({ links: [wsLink({ client: ws, transformer: superjson })] });
}
async function stop() {
  ws?.close();
  if (child && child.exitCode === null && child.signalCode === null) {
    const [code, signal] = await stopRuntimeChild(child);
    assert.equal(code, 0, `Backend shutdown ${signal ?? code}: ${logs}`);
  }
  descriptor = undefined;
}
async function upload(bytes, name, type) {
  const form = new FormData(); form.append("file", new Blob([bytes], { type }), name);
  const response = await fetch(`${descriptor.pocketbase}/api/collections/files/records`, { method: "POST", body: form });
  assert.equal(response.status, 200, await response.clone().text());
  const record = await response.json();
  return `/api/files/${record.collectionId}/${record.id}/${record.file}`;
}
/**
 * Drives one chunked upload through the desktop listener.
 *
 * The desktop base is `/session/<secret>`, so the upload routes ride on the same
 * session ticket as a file read. One chunk is enough here — the splitting and
 * the resume logic are covered by the client tests — and it proves the listener
 * authenticates the request, spools the part, assembles it and stores it into
 * its own local PocketBase.
 */
async function chunkedUpload(bytes, name, type) {
  const base = `${descriptor.pocketbase}/upload`;
  const created = await fetch(`${base}/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ fileName: name, fileSize: bytes.length, contentType: type, workspaceId: "", fingerprint: `smoke-${name}-${bytes.length}` }),
  });
  assert.equal(created.status, 201, await created.clone().text());
  const session = await created.json();
  assert.equal(session.chunkCount, 1, "a small smoke file is one chunk");
  const put = await fetch(`${base}/sessions/${session.uploadId}/parts/0`, {
    method: "PUT",
    headers: { "content-type": "application/octet-stream", "content-length": String(bytes.length) },
    body: bytes,
  });
  assert.equal(put.status, 200, await put.clone().text());
  const completing = await fetch(`${base}/sessions/${session.uploadId}/complete`, { method: "POST" });
  assert.equal(completing.status, 202, await completing.clone().text());
  let state = await completing.json();
  const assemblyDeadline = Date.now() + 30_000;
  while (state.status !== "done" && state.status !== "error" && Date.now() < assemblyDeadline) {
    await pause(100);
    state = await (await fetch(`${base}/sessions/${session.uploadId}`)).json();
  }
  assert.equal(state.status, "done", `assembly ended as ${state.status}: ${state.error ?? ""}`);
  assert.ok(state.attachment?.url, "the finished session carries its attachment");
  return state.attachment.url;
}
const deadline = setTimeout(() => {
  console.error("Backend smoke test timed out\n" + logs);
  child?.stdin.end("shutdown\n");
  setTimeout(() => process.exit(1), 1000);
}, 90_000);
const tmpId = () => `tmp_${crypto.randomUUID()}`;
function firstSegmentUrl(playlist, playlistUrl, gatewayBase) {
  const segment = playlist.split("\n").find(line => line && !line.startsWith("#"));
  assert.ok(segment, "HLS playlist names a media segment");
  const url = new URL(segment, playlistUrl);
  assert.ok(url.href.startsWith(`${gatewayBase}/api/files/`), "HLS segment uses the authenticated gateway");
  return url;
}
async function createVideoFixture(path) {
  console.log("STEP packaged FFmpeg media fixture");
  await new Promise((resolve, reject) => {
    const fixtureProcess = spawn(exe("ffmpeg"), ["-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-f", "lavfi", "-i", "color=c=blue:s=64x64:d=1", "-c:v", "mpeg4", path], { env, stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "", timedOut = false;
    fixtureProcess.stderr.on("data", chunk => { stderr += chunk; });
    const timer = setTimeout(() => {
      timedOut = true;
      if (process.platform === "darwin" && fixtureProcess.pid) {
        try {
          console.error(execFileSync("/usr/bin/sample", [String(fixtureProcess.pid), "1", "1"], { encoding: "utf8", timeout: 5000 }));
        } catch (error) { console.error("FFmpeg stack capture failed:", error.message); }
      }
      fixtureProcess.kill("SIGKILL");
    }, 30_000);
    fixtureProcess.once("error", error => { clearTimeout(timer); reject(error); });
    fixtureProcess.once("close", (code, signal) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`Packaged FFmpeg fixture ${timedOut ? "timed out" : "failed"} (${code ?? signal}): ${stderr}`));
    });
  });
}
try {
  await start();
  const originalGateway = descriptor.pocketbase;
  const base = new URL(descriptor.pocketbase).origin;
  assert.equal((await fetch(`${base}/health`)).status, 403);
  assert.equal((await fetch(`${descriptor.pocketbase}/health`, { headers: { Origin: "https://hostile.example" } })).status, 403);
  assert.equal((await fetch(`${descriptor.pocketbase}/api/collections/users/records`)).status, 404);
  const freshSession = await fetch(`${descriptor.pocketbase}/session`, { method: "POST" });
  assert.ok((await freshSession.json()).token);
  const anonymousWS = createWSClient({ url: descriptor.trpc });
  const anonymous = createTRPCClient({ links: [wsLink({ client: anonymousWS, transformer: superjson })] });
  try { await assert.rejects(anonymous.auth.me.query(), error => error.data?.code === "UNAUTHORIZED"); } finally { anonymousWS.close(); }
  if (process.platform === "linux") {
    const children = execFileSync("pgrep", ["-P", String(child.pid)], { encoding: "utf8" }).trim().split("\n");
    let checked = false;
    for (const pid of children) {
      const command = await readFile(`/proc/${pid}/cmdline`, "utf8");
      const port = command.match(/--http=127\.0\.0\.1:(\d+)/)?.[1];
      if (port) { assert.equal((await fetch(`http://127.0.0.1:${port}/api/health`)).status, 403); checked = true; }
    }
    assert.ok(checked, "private database rejects requests bypassing the gateway");
  }
  console.log("PASS session gate, origin checks, private database gate and authentication");

  console.log("STEP local identity");
  const user = await client.auth.me.query();
  assert.equal(user.nickname, "本地用户");
  console.log("STEP provision workspace");
  const workspace = await client.workspace.provisionDefault.mutate();
  assert.equal(workspace.ownerId, user.id);
  const workspaceId = workspace.id;
  assert.equal((await client.workspace.listByUser.query({})).length, 1);
  console.log("STEP workspace models");
  const views = await client.view.listByWorkspace.query({ workspaceId });
  assert.equal(views.length, 1);
  await client.view.update.mutate({ id: views[0].id, updates: { visualConfig: { showMinimap: false } } });
  const semantic = await client.nodeSemantic.add.mutate({ id: tmpId(), name: "离线笔记", workspaceId });
  const tag = await client.nodeTag.add.mutate({ id: tmpId(), name: "本地", workspaceId });
  const edgeSemantic = await client.edgeSemantic.add.mutate({ id: tmpId(), name: "关联", category: "association", workspaceId });
  const inputs = [
    { nodeType: "text", content: { docs: {} } },
    { nodeType: "image", width: 10, height: 10, fileSize: 0, content: { url: "" } },
    { nodeType: "pdf", pageCount: 0, fileSize: 0, content: { url: "", coverUrl: "" } },
    { nodeType: "video", duration: 0, source: "local", content: { url: "", coverUrl: "", hlsUrl: "" } },
    { nodeType: "audio", duration: 0, fileSize: 0, content: { url: "" } },
    { nodeType: "webpage", content: { code: "<p>offline</p>", language: "html" } },
    { nodeType: "website", content: { url: "https://example.com", faviconUrl: "" } },
    { nodeType: "collection", content: {} },
    { nodeType: "rich-text", content: { referencedNodes: [], docs: {} } },
    { nodeType: "database", content: { fields: [], rows: [] } },
  ];
  console.log("STEP ten node types");
  const nodes = [];
  for (const input of inputs) nodes.push(await client.node.add.mutate({ ...input, id: tmpId(), title: input.nodeType, semanticId: semantic.id, tags: [tag.id], workspaceId }));
  assert.equal((await client.node.listByWorkspace.query({ workspaceId })).length, 10);
  const edge = await client.edge.add.mutate({ id: tmpId(), from: nodes[0].id, to: nodes[1].id, direction: "forward", semanticId: edgeSemantic.id, workspaceId });
  console.log("STEP subscription");
  const event = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Subscription timed out")), 5000);
    const subscription = client.event.onEvent.subscribe(undefined, {
      onStarted() { void client.node.update.mutate({ id: nodes[0].id, updates: { title: "重启后保留" } }).catch(reject); },
      onData(data) { if (data.eventType === "NodeUpdated") { clearTimeout(timeout); subscription.unsubscribe(); resolve(data); } }, onError: reject,
    });
  });
  assert.equal((await event).metadata.sourceId, "smoke-client");
  console.log("PASS workspace, view, semantics, tags, all 10 node types, edges and live events");

  const dashboard = await client.dashboard.get.query({ workspaceId });
  const state = { ...dashboard, pages: [{ id: "offline-page", name: "离线 Dashboard", widgets: [] }], activePageId: "offline-page" };
  const saved = await client.dashboard.save.mutate({ workspaceId, state });
  assert.equal(saved.revision, 1);
  await assert.rejects(client.dashboard.save.mutate({ workspaceId, state }), error => error.data?.code === "CONFLICT");
  console.log("PASS Dashboard persistence and optimistic conflicts");

  const file = await upload(Buffer.from("local attachment"), "offline.txt", "text/plain");
  assert.equal(await (await fetch(`${descriptor.pocketbase}${file}`)).text(), "local attachment");
  assert.equal((await fetch(`${descriptor.pocketbase}${file}`, { headers: { Range: "bytes=0-4" } })).status, 206);
  const chunked = await chunkedUpload(Buffer.from("chunked desktop attachment"), "chunked.txt", "text/plain");
  assert.equal(await (await fetch(`${descriptor.pocketbase}${chunked}`)).text(), "chunked desktop attachment");
  console.log("PASS desktop chunked upload session, assembly and download");
  const pdf = await upload(pdfFixture(), "offline.pdf", "application/pdf");
  console.log("STEP packaged PDF/native canvas");
  const analysis = await client.file.analyzePdf.mutate({ fileUrl: pdf });
  assert.equal(analysis.pageCount, 1);
  assert.ok(analysis.coverUrl.startsWith("/api/files/"), "PDF cover rendered by packaged native canvas");
  assert.equal((await fetch(`${descriptor.pocketbase}${analysis.coverUrl}`)).status, 200);
  const videoPath = join(scratch, "offline.mp4");
  await createVideoFixture(videoPath);
  const video = await upload(await readFile(videoPath), "offline.mp4", "video/mp4");
  const transcode = await client.file.transcodeVideo.mutate({ fileUrl: video });
  assert.equal(transcode.reencoded, true);
  assert.ok(transcode.coverUrl.startsWith("/api/files/"));
  const playlist = await (await fetch(`${descriptor.pocketbase}${transcode.hlsUrl}`)).text();
  const segmentUrl = firstSegmentUrl(playlist, `${descriptor.pocketbase}${transcode.hlsUrl}`, descriptor.pocketbase);
  assert.equal((await fetch(segmentUrl)).status, 200);
  console.log("PASS disk attachments, range requests, PDF parsing/covers and FFmpeg video transcoding/HLS");

  await stop();
  await assert.rejects(stat(join(data, "runtime.lock")), error => error.code === "ENOENT");
  await start();
  assert.notEqual(descriptor.pocketbase, originalGateway);
  assert.equal((await client.auth.me.query()).id, user.id);
  assert.equal((await client.node.getById.query({ id: nodes[0].id })).title, "重启后保留");
  assert.equal((await client.dashboard.get.query({ workspaceId })).pages[0].name, "离线 Dashboard");
  assert.equal(await (await fetch(`${descriptor.pocketbase}${file}`)).text(), "local attachment");
  assert.equal(await (await fetch(`${descriptor.pocketbase}${chunked}`)).text(), "chunked desktop attachment");
  const newPlaylist = await (await fetch(`${descriptor.pocketbase}${transcode.hlsUrl}`)).text();
  const newSegmentUrl = firstSegmentUrl(newPlaylist, `${descriptor.pocketbase}${transcode.hlsUrl}`, descriptor.pocketbase);
  assert.notEqual(newSegmentUrl.href, segmentUrl.href);
  assert.equal((await fetch(newSegmentUrl)).status, 200);
  await client.edge.delete.mutate({ id: edge.id });
  await client.node.delete.mutate({ id: nodes[0].id });
  console.log("PASS clean shutdown, same local identity, restart persistence and portable file/HLS paths");
} catch (error) {
  console.error(logs); throw error;
} finally { clearTimeout(deadline); await stop(); await rm(scratch, { recursive: true, force: true }); }
