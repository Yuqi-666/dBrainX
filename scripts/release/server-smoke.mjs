// SPDX-License-Identifier: AGPL-3.0-only

/** Fresh DB, isolated bundled backend, and two-user release/security regression. */
import assert from "node:assert/strict";
import { pdfFixture } from "../lib/smoke-fixtures.mjs";
import { spawn, execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { cp, mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createServer } from "node:net";
import { once } from "node:events";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(join(root, "packages/api-client/package.json"));
const { createTRPCClient, createWSClient, wsLink } = await import(
  pathToFileURL(require.resolve("@trpc/client")).href
);
const { default: superjson } = await import(pathToFileURL(require.resolve("superjson")).href);
const temp = await mkdtemp(join(tmpdir(), "dbrainx-server-smoke-"));
const children = [],
  connections = [];
let logs = "";
async function port() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const result = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return result;
}
function launch(exe, args, env = {}) {
  const child = spawn(exe, args, {
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => {
    logs += chunk;
  });
  child.stderr.on("data", (chunk) => {
    logs += chunk;
  });
  child.on("error", (error) => {
    logs += error.message;
  });
  children.push(child);
  return child;
}
async function ready(url) {
  for (let i = 0; i < 150; i++) {
    try {
      if ((await fetch(url, { signal: AbortSignal.timeout(1000) })).ok) return;
    } catch {
      /* booting */
    }
    if (children.some((child) => child.exitCode !== null))
      throw new Error(logs);
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Startup timeout: ${logs}`);
}
function client(token) {
  const ws = createWSClient({
    url: `${serverUrl.replace("http:", "ws:")}/trpc`,
    connectionParams: token ? { token } : {},
  });
  connections.push(ws);
  return createTRPCClient({
    links: [wsLink({ client: ws, transformer: superjson })],
  });
}
async function upload(token, bytes = "private file", workspaceId = "") {
  const body = new FormData();
  body.append("file", new Blob([bytes]), "中文 sample.txt");
  if (workspaceId) body.append("workspaceId", workspaceId);
  const response = await fetch(
    `${serverUrl}/pb/api/collections/files/records`,
    { method: "POST", headers: { Authorization: token }, body },
  );
  assert.equal(response.status, 200, await response.clone().text());
  return response.json();
}
const pbPort = await port(),
  serverPort = await port();
const pbUrl = process.env.DBRAINX_SMOKE_PB_URL ?? `http://127.0.0.1:${pbPort}`;
const serverUrl =
  process.env.DBRAINX_SMOKE_SERVER_URL ?? `http://127.0.0.1:${serverPort}`;
if (
  Boolean(process.env.DBRAINX_SMOKE_PB_URL) !==
  Boolean(process.env.DBRAINX_SMOKE_SERVER_URL)
)
  throw new Error("Supply both smoke URLs");
const deadline = setTimeout(() => {
  console.error(logs);
  children.forEach((child) => child.kill("SIGKILL"));
  process.exitCode = 1;
}, 90_000);
try {
  if (!process.env.DBRAINX_SMOKE_PB_URL) {
    const { prepareMigrations } = await import("../lib/pocketbase-migrations.mjs");
    await prepareMigrations({
      dataDir: join(temp, "data"),
      baseDir: join(root, "pb/pb_migrations_base"),
      changesDir: join(root, "pb/pb_migrations_changes"),
      runDir: join(temp, "migrations"),
    });
    launch(
      process.env.DBRAINX_POCKETBASE_PATH ??
        join(
          root,
          "pb",
          process.platform === "win32" ? "pocketbase.exe" : "pocketbase",
        ),
      [
        "serve",
        `--http=127.0.0.1:${pbPort}`,
        `--dir=${join(temp, "data")}`,
        `--migrationsDir=${join(temp, "migrations")}`,
        `--hooksDir=${join(root, "pb/pb_hooks")}`,
        "--automigrate=0",
      ],
    );
  }
  await ready(`${pbUrl}/api/health`);
  // Only the container job configures an operator account (`docker-compose.yml`
  // requires one and the image entrypoint upserts it before serving); when it is
  // present, prove that the credential it created actually authenticates.
  if (process.env.DBRAINX_SMOKE_ADMIN_EMAIL) {
    const response = await fetch(
      `${pbUrl}/api/collections/_superusers/auth-with-password`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          identity: process.env.DBRAINX_SMOKE_ADMIN_EMAIL,
          password: process.env.DBRAINX_SMOKE_ADMIN_PASSWORD,
        }),
      },
    );
    assert.equal(
      response.status,
      200,
      `operator account login: ${await response.text()}`,
    );
    console.log("PASS container operator account authenticates");
  }
  if (!process.env.DBRAINX_SMOKE_SERVER_URL) {
    await cp(join(root, "apps/server/dist"), join(temp, "server"), {
      recursive: true,
      dereference: true,
    });
    launch(process.execPath, [join(temp, "server/index.mjs")], {
      PB_URL: pbUrl,
      PORT: String(serverPort),
    });
  }
  await ready(`${serverUrl}/health`);
  if (process.env.DBRAINX_SMOKE_WEB_URL) {
    for (const path of ["/", "/login", "/register"])
      assert.ok(
        (await fetch(`${process.env.DBRAINX_SMOKE_WEB_URL}${path}`)).ok,
        `Web ${path}`,
      );
    assert.equal(
      (await fetch(`${process.env.DBRAINX_SMOKE_WEB_URL}/pb/_/`)).status,
      404,
    );
    console.log("PASS production Web endpoints and reverse proxy");
  }
  const anonymous = client();
  const [alice, bob] = await Promise.all(
    ["alice", "bob"].map((name) =>
      anonymous.auth.register.mutate({
        email: `${name}@example.test`,
        password: "release-smoke-password",
        nickname: name,
      }),
    ),
  );
  const a = client(alice.token),
    b = client(bob.token);
  assert.equal((await a.auth.me.query()).id, alice.user.id);
  assert.equal((await b.auth.me.query()).id, bob.user.id);
  const [wa, wb] = await Promise.all([
    a.workspace.provisionDefault.mutate(),
    b.workspace.provisionDefault.mutate(),
  ]);
  assert.notEqual(wa.id, wb.id);
  // Both provisioned instances are the user's defaults: the flag reaches the
  // client and neither instance can be deleted (renaming stays possible).
  assert.equal(wa.isDefault, true);
  assert.equal(wb.isDefault, true);
  const [defaultView] = await a.view.listByWorkspace.query({
    workspaceId: wa.id,
  });
  assert.equal(defaultView.isDefault, true);
  await assert.rejects(
    a.view.delete.mutate({ id: defaultView.id }),
    /The default view cannot be deleted/,
  );
  // Renaming a default instance stays allowed and keeps the flag (the update
  // rule pins only `isDefault`, not the name).
  const renamedWorkspace = await a.workspace.update.mutate({
    id: wa.id,
    updates: { name: "改名后的工作区" },
  });
  assert.equal(renamedWorkspace.name, "改名后的工作区");
  assert.equal(renamedWorkspace.isDefault, true);
  const renamedView = await a.view.update.mutate({
    id: defaultView.id,
    updates: { name: "改名后的视图" },
  });
  assert.equal(renamedView.name, "改名后的视图");
  assert.equal(renamedView.isDefault, true);
  // The picker icon is owner-editable, round-trips through the JSON column, and
  // `null` clears it. It never touches the protection flag.
  const iconWorkspace = await a.workspace.update.mutate({
    id: wa.id,
    updates: { icon: { kind: "icon", value: "Globe" } },
  });
  assert.deepEqual(iconWorkspace.icon, { kind: "icon", value: "Globe" });
  assert.equal(iconWorkspace.isDefault, true);
  const clearedWorkspace = await a.workspace.update.mutate({
    id: wa.id,
    updates: { icon: null },
  });
  assert.equal(clearedWorkspace.icon ?? null, null);
  assert.deepEqual(
    (await a.workspace.list.query()).map((w) => w.id),
    [wa.id],
  );
  assert.deepEqual(
    (await b.workspace.list.query()).map((w) => w.id),
    [wb.id],
  );
  await assert.rejects(anonymous.workspace.list.query());
  assert.equal(await b.workspace.getById.query({ id: wa.id }), null);
  await assert.rejects(
    b.workspace.update.mutate({ id: wa.id, updates: { name: "intrusion" } }),
  );
  await assert.rejects(
    b.nodeSemantic.add.mutate({
      id: "tmp_intrusion",
      name: "intrusion",
      workspaceId: wa.id,
    }),
  );
  await assert.rejects(
    b.workspace.add.mutate({
      id: "tmp_forged",
      name: "forged",
      ownerId: alice.user.id,
    }),
  );
  for (const collection of [
    "nodes",
    "edges",
    "views",
    "workspaces",
    "workspace_members",
    "node_semantics",
    "edge_semantics",
    "node_tags",
    "files",
    "users",
  ]) {
    const result = await fetch(
      `${pbUrl}/api/collections/${collection}/records`,
    );
    assert.equal(result.status, 200);
    assert.equal(
      (await result.json()).items.length,
      0,
      `${collection} anonymous list`,
    );
  }
  console.log(
    "PASS fresh migrations, independent registration, scoped workspace reads/writes and anonymous denial",
  );
  const record = await upload(alice.token);
  assert.equal(record.ownerId, alice.user.id);
  // Server-owned media metadata, written by the PocketBase upload hook.
  assert.equal(record.size, Buffer.byteLength("private file"));
  assert.equal(record.mimeType, "application/octet-stream");
  assert.equal(record.displayName, "中文 sample.txt");
  // The resource library reads the deployment policy from the API.
  assert.deepEqual(await a.storage.limits.query(), {
    userQuotaBytes: 10 * 1024 ** 3,
    maxFileBytes: {
      image: 32 * 1024 ** 2,
      video: 2 * 1024 ** 3,
      audio: 512 * 1024 ** 2,
      pdf: 512 * 1024 ** 2,
      webpage: 16 * 1024 ** 2,
      other: 256 * 1024 ** 2,
    },
  });
  console.log("PASS storage limits and server-stamped file metadata");
  // The gateway admits the files collection so the library can list, rename and
  // delete; PocketBase's rules still scope every row to the verified caller.
  const listedFiles = await fetch(
    `${serverUrl}/pb/api/collections/files/records?perPage=50`,
    { headers: { Authorization: alice.token } },
  );
  assert.equal(listedFiles.status, 200, await listedFiles.clone().text());
  assert.ok(
    (await listedFiles.json()).items.some((item) => item.id === record.id),
    "the owner lists the uploaded file",
  );
  const disposable = await upload(alice.token, "rename me");
  const rename = await fetch(
    `${serverUrl}/pb/api/collections/files/records/${disposable.id}`,
    {
      method: "PATCH",
      headers: {
        Authorization: alice.token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ displayName: "renamed.txt" }),
    },
  );
  assert.equal(rename.status, 200, await rename.clone().text());
  assert.equal((await rename.json()).displayName, "renamed.txt");
  const tamper = await fetch(
    `${serverUrl}/pb/api/collections/files/records/${disposable.id}`,
    {
      method: "PATCH",
      headers: {
        Authorization: alice.token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ size: 1 }),
    },
  );
  assert.equal(tamper.status, 404, await tamper.text());
  const foreignRename = await fetch(
    `${serverUrl}/pb/api/collections/files/records/${disposable.id}`,
    {
      method: "PATCH",
      headers: {
        Authorization: bob.token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ displayName: "stolen.txt" }),
    },
  );
  assert.equal(foreignRename.status, 404, await foreignRename.text());
  const removed = await fetch(
    `${serverUrl}/pb/api/collections/files/records/${disposable.id}`,
    { method: "DELETE", headers: { Authorization: alice.token } },
  );
  assert.equal(removed.status, 204, await removed.text());
  assert.equal(
    (
      await fetch(
        `${serverUrl}/pb/api/files/${disposable.collectionId}/${disposable.id}/${disposable.file}`,
        { headers: { Authorization: alice.token } },
      )
    ).status,
    404,
    "a deleted resource stops being readable",
  );
  console.log(
    "PASS files-collection management through the gateway (list, rename, delete)",
  );
  const path = `/api/files/${record.collectionId}/${record.id}/${record.file}`;
  const direct = await fetch(`${pbUrl}${path}`);
  assert.equal(direct.status, 404, await direct.text());
  assert.equal((await fetch(`${serverUrl}/pb${path}`)).status, 401);
  assert.equal(
    (
      await fetch(`${serverUrl}/pb${path}`, {
        headers: { Authorization: bob.token },
      })
    ).status,
    404,
  );
  const content = await fetch(`${serverUrl}/pb${path}`, {
    headers: { Cookie: `pb_token=${alice.token}` },
  });
  assert.equal(content.status, 200);
  assert.equal(await content.text(), "private file");
  const range = await fetch(`${serverUrl}/pb${path}`, {
    headers: { Cookie: `pb_token=${alice.token}`, Range: "bytes=0-2" },
  });
  assert.equal(range.status, 206);
  assert.equal(await range.text(), "pri");
  assert.equal((await fetch(`${serverUrl}/pb/_/`)).status, 404);
  assert.equal(
    (
      await fetch(`${serverUrl}/pb${path}`, {
        headers: { Authorization: alice.token, Origin: "https://hostile.test" },
      })
    ).status,
    403,
  );
  console.log(
    "PASS file ownership, cookie-authenticated media, Range, administration denial and Origin rejection",
  );
  const sharedFile = await upload(alice.token, "shared file", wa.id);
  const sharedPath = `/api/files/${sharedFile.collectionId}/${sharedFile.id}/${sharedFile.file}`;
  const pdfRecord = await upload(alice.token, pdfFixture(), wa.id);
  const pdfPath = `/api/files/${pdfRecord.collectionId}/${pdfRecord.id}/${pdfRecord.file}`;
  const analysis = await a.file.analyzePdf.mutate({
    fileUrl: `${serverUrl}/pb${pdfPath}`,
  });
  assert.equal(analysis.pageCount, 1);
  assert.ok(analysis.coverUrl.startsWith("/api/files/"));
  assert.equal(
    (
      await fetch(`${serverUrl}/pb${analysis.coverUrl}`, {
        headers: { Cookie: `pb_token=${alice.token}` },
      })
    ).status,
    200,
  );
  const videoFixture = join(temp, "sample.mp4");
  execFileSync(process.env.FFMPEG_PATH || "ffmpeg", [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-f",
    "lavfi",
    "-i",
    "color=c=blue:s=64x64:d=1",
    "-c:v",
    "mpeg4",
    videoFixture,
  ]);
  const videoRecord = await upload(
    alice.token,
    await readFile(videoFixture),
    wa.id,
  );
  const videoPath = `/api/files/${videoRecord.collectionId}/${videoRecord.id}/${videoRecord.file}`;
  const transcode = await a.file.transcodeVideo.mutate({
    fileUrl: `${serverUrl}/pb${videoPath}`,
  });
  assert.equal(transcode.reencoded, true);
  const playlistUrl = `${serverUrl}/pb${transcode.hlsUrl}`;
  const playlistResponse = await fetch(playlistUrl, {
    headers: { Cookie: `pb_token=${alice.token}` },
  });
  assert.equal(playlistResponse.status, 200);
  // The playlist names each segment beside itself (`../<record>/<name>`), so one
  // recording plays through every mount: PocketBase itself in split
  // development, the `/pb` file gateway here and in the container, and
  // `/session/<secret>` in the desktop. Resolving the URI against the playlist's
  // own URL is what a player does, and it rejects the root-relative
  // `/api/files/...` form, which this gateway answers with 404.
  const segment = (await playlistResponse.text())
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line !== "" && !line.startsWith("#"));
  assert.ok(segment, "production HLS names its media segment");
  const segmentUrl = new URL(segment, playlistUrl);
  assert.equal(
    segmentUrl.origin,
    new URL(playlistUrl).origin,
    `HLS segment stays on the playlist origin: ${segment}`,
  );
  assert.equal(
    (
      await fetch(segmentUrl, {
        headers: { Cookie: `pb_token=${alice.token}` },
      })
    ).status,
    200,
    `HLS segment resolves beside its playlist: ${segment}`,
  );
  console.log(
    "PASS production PDF/native canvas, FFmpeg transcoding and same-origin HLS",
  );
  const eventsA = [],
    eventsB = [];
  const sa = a.event.onEvent.subscribe(undefined, {
    onData: (e) => eventsA.push(e),
  });
  const sb = b.event.onEvent.subscribe(undefined, {
    onData: (e) => eventsB.push(e),
  });
  await new Promise((resolve) => setTimeout(resolve, 400));
  const semantic = await a.nodeSemantic.add.mutate({
    id: "tmp_semantic",
    name: "private",
    workspaceId: wa.id,
  });
  const node = await a.node.add.mutate({
    id: "tmp_node",
    nodeType: "text",
    semanticId: semantic.id,
    workspaceId: wa.id,
    content: { docs: {} },
    title: "private",
  });
  assert.equal(await b.node.getById.query({ id: node.id }), null);
  await assert.rejects(b.node.delete.mutate({ id: node.id }));
  const target = await a.node.add.mutate({
    id: "tmp_edge_target", nodeType: "text", semanticId: "",
    workspaceId: wa.id, content: { docs: {} }, title: "edge target",
  });
  const edge = await a.edge.add.mutate({
    id: "tmp_edge", from: node.id, to: target.id,
    direction: "forward", semanticId: "", workspaceId: wa.id,
  });
  assert.equal(edge.semanticId, "");
  assert.equal((await a.edge.getById.query({ id: edge.id })).to, target.id);
  assert.equal(await b.edge.getById.query({ id: edge.id }), null);
  await assert.rejects(b.edge.update.mutate({ id: edge.id, updates: { semanticId: "" } }));
  const edgeSemantic = await a.edgeSemantic.add.mutate({
    id: "tmp_edge_semantic", name: "relates to", category: "association", workspaceId: wa.id,
  });
  await a.edge.update.mutate({ id: edge.id, updates: { semanticId: edgeSemantic.id } });
  assert.equal((await a.edge.getById.query({ id: edge.id })).semanticId, edgeSemantic.id);
  await a.edge.update.mutate({ id: edge.id, updates: { semanticId: "" } });
  const foreignTarget = await b.node.add.mutate({
    id: "tmp_foreign_target", nodeType: "text", semanticId: "",
    workspaceId: wb.id, content: { docs: {} }, title: "foreign target",
  });
  await assert.rejects(a.edge.add.mutate({
    id: "tmp_cross_workspace", from: node.id, to: foreignTarget.id,
    direction: "forward", semanticId: "", workspaceId: wa.id,
  }));
  console.log("PASS untyped edge creation, semantic selection/clearing and workspace isolation");
  await new Promise((resolve) => setTimeout(resolve, 400));
  assert.ok(eventsA.some((e) => e.eventType === "NodeCreated"));
  assert.equal(
    eventsB.filter((event) => event.metadata?.workspaceId === wa.id).length,
    0,
    "another user must not receive private events",
  );
  // Members see authorized events, viewers cannot write, and removal revokes live access.
  const member = await a.workspace.addMember.mutate({
    id: "tmp_member",
    workspaceId: wa.id,
    userId: bob.user.id,
    role: "viewer",
  });
  assert.equal((await b.node.getById.query({ id: node.id })).id, node.id);
  assert.equal(
    (
      await fetch(`${serverUrl}/pb${sharedPath}`, {
        headers: { Authorization: bob.token },
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await fetch(`${serverUrl}/pb${analysis.coverUrl}`, {
        headers: { Authorization: bob.token },
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await fetch(segmentUrl, {
        headers: { Authorization: bob.token },
      })
    ).status,
    200,
  );
  const forbiddenUpload = new FormData();
  forbiddenUpload.append("file", new Blob(["forbidden"]), "forbidden.txt");
  forbiddenUpload.append("workspaceId", wa.id);
  assert.equal(
    (
      await fetch(`${serverUrl}/pb/api/collections/files/records`, {
        method: "POST",
        headers: { Authorization: bob.token },
        body: forbiddenUpload,
      })
    ).status,
    400,
  );
  await assert.rejects(b.node.delete.mutate({ id: node.id }));
  await a.node.update.mutate({ id: node.id, updates: { title: "shared" } });
  await new Promise((resolve) => setTimeout(resolve, 400));
  assert.ok(eventsB.some((e) => e.eventType === "NodeUpdated"));
  await a.workspace.removeMember.mutate({
    id: member.id,
    workspaceId: wa.id,
    userId: bob.user.id,
  });
  await new Promise((resolve) => setTimeout(resolve, 400));
  const count = eventsB.length;
  await a.node.update.mutate({
    id: node.id,
    updates: { title: "private again" },
  });
  await new Promise((resolve) => setTimeout(resolve, 400));
  assert.equal(eventsB.length, count);
  assert.equal(
    (
      await fetch(`${serverUrl}/pb${sharedPath}`, {
        headers: { Authorization: bob.token },
      })
    ).status,
    404,
  );
  assert.equal(
    (
      await fetch(segmentUrl, {
        headers: { Authorization: bob.token },
      })
    ).status,
    404,
  );
  assert.equal(await b.node.getById.query({ id: node.id }), null);
  sa.unsubscribe();
  sb.unsubscribe();
  console.log(
    "PASS cross-user node denial, event isolation, viewer permissions and membership revocation",
  );
  const freshAnon = client();
  const [la, lb] = await Promise.all(
    ["alice", "bob"].map((name) =>
      freshAnon.auth.login.mutate({
        email: `${name}@example.test`,
        password: "release-smoke-password",
      }),
    ),
  );
  assert.equal(la.user.id, alice.user.id);
  assert.equal(lb.user.id, bob.user.id);
  await assert.rejects(freshAnon.workspace.list.query());
  // The provisioned workspace is the user's default instance: it cannot be
  // deleted, while a second, user-created workspace stays deletable.
  await assert.rejects(
    a.workspace.delete.mutate({ id: wa.id }),
    /The default workspace cannot be deleted/,
  );
  const extra = await a.workspace.add.mutate({
    id: `tmp_delete_${Date.now()}`,
    name: "delete me",
    ownerId: alice.user.id,
    // The create dialog sends a picker icon with the new workspace.
    icon: { kind: "emoji", value: "🧪" },
  });
  assert.deepEqual(extra.icon, { kind: "emoji", value: "🧪" });
  await a.workspace.delete.mutate({ id: extra.id });
  assert.equal(await a.workspace.getById.query({ id: extra.id }), null);
  console.log(
    "PASS concurrent login isolation and authorized workspace deletion",
  );
} catch (error) {
  console.error(
    logs.slice(-5000).replace(/eyJ[A-Za-z0-9_.-]+/g, "[redacted token]"),
  );
  throw error;
} finally {
  clearTimeout(deadline);
  connections.forEach((ws) => ws.close());
  for (const child of children.reverse()) {
    if (child.exitCode === null) {
      const exited = once(child, "exit");
      child.kill("SIGTERM");
      await Promise.race([
        exited,
        new Promise((resolve) => setTimeout(resolve, 5000)),
      ]);
      if (child.exitCode === null) {
        child.kill("SIGKILL");
        await exited;
      }
    }
  }
  await rm(temp, { recursive: true, force: true });
}
