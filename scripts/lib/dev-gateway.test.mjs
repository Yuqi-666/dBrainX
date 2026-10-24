// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Tests for the development gateway: routing decisions and the live proxy path.
 *
 * The integration cases start throwaway upstreams, so they prove the three
 * behaviours the remote dev setup depends on: the browser Host survives, the
 * PocketBase prefix is rewritten, and the tRPC WebSocket upgrade is forwarded.
 */
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import {
  createServer as createHttpServer,
  request as httpRequest,
} from "node:http";
import { connect } from "node:net";
import { createGatewayServer } from "../dev-gateway.mjs";
import {
  readGatewayConfig,
  resolveRoute,
  targetUrl,
  upstreamFor,
} from "./dev-gateway.mjs";

test("routes every same-origin path the browser client can choose", () => {
  assert.deepEqual(resolveRoute(undefined), { kind: "web", upstreamPath: "/" });
  assert.deepEqual(resolveRoute("/"), { kind: "web", upstreamPath: "/" });
  assert.deepEqual(resolveRoute("/graph?x=1"), {
    kind: "web",
    upstreamPath: "/graph",
  });
  assert.deepEqual(resolveRoute("/_next/webpack-hmr"), {
    kind: "web",
    upstreamPath: "/_next/webpack-hmr",
  });
  // Only the exact prefix is reserved.
  assert.deepEqual(resolveRoute("/pocketbase"), {
    kind: "web",
    upstreamPath: "/pocketbase",
  });
  assert.deepEqual(resolveRoute("/trpc"), { kind: "server", upstreamPath: "/trpc" });
  assert.deepEqual(resolveRoute("/trpc?batch=1"), {
    kind: "server",
    upstreamPath: "/trpc",
  });
  assert.deepEqual(resolveRoute("/pb/api/health"), {
    kind: "pocketbase",
    upstreamPath: "/api/health",
  });
  assert.deepEqual(resolveRoute("/pb/api/collections/users/records?perPage=1"), {
    kind: "pocketbase",
    upstreamPath: "/api/collections/users/records",
  });
  // The production file gateway is deliberately not part of the dev path.
  assert.deepEqual(resolveRoute("/pb"), { kind: "notFound", upstreamPath: "/" });
  assert.deepEqual(resolveRoute("/pb/"), { kind: "notFound", upstreamPath: "/" });
  assert.deepEqual(resolveRoute("/pb/other"), {
    kind: "notFound",
    upstreamPath: "/other",
  });
  // Chunked uploads belong to the API (it spools and assembles them), and the
  // `/pb` prefix is kept because the API strips it before routing.
  assert.deepEqual(resolveRoute("/pb/upload/sessions"), {
    kind: "server",
    upstreamPath: "/pb/upload/sessions",
  });
  assert.deepEqual(resolveRoute("/pb/upload/sessions/ab/parts/3?x=1"), {
    kind: "server",
    upstreamPath: "/pb/upload/sessions/ab/parts/3",
  });
});

test("cannot be tricked into proxying another host", () => {
  // A request line may arrive as "//host/path"; the scheme-relative form must
  // not survive into `new URL`, which would otherwise resolve to that host.
  const route = resolveRoute("//evil.test/graph");
  assert.equal(route.upstreamPath, "/evil.test/graph");
  assert.equal(
    targetUrl(route, "//evil.test/graph", "http://127.0.0.1:3002").href,
    "http://127.0.0.1:3002/evil.test/graph",
  );
  assert.deepEqual(resolveRoute("///trpc"), {
    kind: "server",
    upstreamPath: "/trpc",
  });
});

test("keeps the query string when it builds the upstream URL", () => {
  const files = "/pb/api/files/rec/1/pic.png?thumb=100x100";
  assert.equal(
    targetUrl(resolveRoute(files), files, "http://127.0.0.1:8090").href,
    "http://127.0.0.1:8090/api/files/rec/1/pic.png?thumb=100x100",
  );
  assert.equal(
    targetUrl(resolveRoute("/graph?x=1"), "/graph?x=1", "http://127.0.0.1:3002").href,
    "http://127.0.0.1:3002/graph?x=1",
  );
});

test("reads gateway configuration from the environment", () => {
  assert.deepEqual(readGatewayConfig({}), {
    host: "0.0.0.0",
    port: 3000,
    web: "http://127.0.0.1:3002",
    server: "http://127.0.0.1:3001",
    pocketbase: "http://127.0.0.1:8090",
  });
  const custom = readGatewayConfig({
    DBRAINX_GATEWAY_HOST: "127.0.0.1",
    DBRAINX_GATEWAY_PORT: "8080",
    DBRAINX_WEB_URL: "http://127.0.0.1:4100/",
    DBRAINX_SERVER_URL: "http://127.0.0.1:4101",
    DBRAINX_PB_URL: "http://127.0.0.1:8091",
  });
  assert.equal(custom.host, "127.0.0.1");
  assert.equal(custom.port, 8080);
  assert.equal(custom.web, "http://127.0.0.1:4100");
  assert.equal(custom.server, "http://127.0.0.1:4101");
  assert.equal(custom.pocketbase, "http://127.0.0.1:8091");
  // A blank value counts as unset, so an empty line in .env cannot stop startup.
  assert.equal(
    readGatewayConfig({ DBRAINX_PB_URL: "   " }).pocketbase,
    "http://127.0.0.1:8090",
  );
  assert.throws(
    () => readGatewayConfig({ DBRAINX_GATEWAY_PORT: "0" }),
    /DBRAINX_GATEWAY_PORT/,
  );
  assert.throws(
    () => readGatewayConfig({ DBRAINX_WEB_URL: "ftp://example.test" }),
    /DBRAINX_WEB_URL/,
  );
  assert.throws(
    () => readGatewayConfig({ DBRAINX_SERVER_URL: "not a url" }),
    /DBRAINX_SERVER_URL/,
  );
});

test("maps a notFound route to no upstream", () => {
  const config = readGatewayConfig({});
  assert.equal(upstreamFor(resolveRoute("/pb/other"), config), undefined);
  assert.equal(upstreamFor(resolveRoute("/trpc"), config), config.server);
  assert.equal(upstreamFor(resolveRoute("/pb/api/health"), config), config.pocketbase);
  assert.equal(upstreamFor(resolveRoute("/"), config), config.web);
});

/** @type {{web: object[], server: object[], pocketbase: object[]}} */
const seen = { web: [], server: [], pocketbase: [] };
/**
 * Upgraded sockets on the throwaway API. An upgraded socket is half-open, so it
 * never emits `close` by itself and would hold `server.close()` open; a real
 * API reacts to `end`, and the sweep in `after` covers a missed case.
 */
const upgraded = new Set();
let gateway;
let gatewayPort;

function listen(server) {
  return new Promise((resolvePromise) =>
    server.listen(0, "127.0.0.1", () => resolvePromise(server.address().port)),
  );
}

function request(pathname) {
  return new Promise((resolvePromise, reject) => {
    const req = httpRequest(
      {
        host: "127.0.0.1",
        port: gatewayPort,
        path: pathname,
        method: "GET",
        headers: { host: "dev.yuqi-666.cn" },
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () =>
          resolvePromise({
            status: res.statusCode,
            body: Buffer.concat(chunks).toString("utf8"),
          }),
        );
      },
    );
    req.on("error", reject);
    req.end();
  });
}

function upgrade(pathname) {
  return new Promise((resolvePromise, reject) => {
    const socket = connect(gatewayPort, "127.0.0.1");
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error("upgrade timed out"));
    }, 5000);
    let buffer = "";
    let status = "";
    let phase = "headers";
    socket.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    socket.on("connect", () => {
      socket.write(
        [
          "GET " + pathname + " HTTP/1.1",
          "Host: dev.yuqi-666.cn",
          "Origin: https://dev.yuqi-666.cn",
          "Connection: Upgrade",
          "Upgrade: websocket",
          "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==",
          "Sec-WebSocket-Version: 13",
          "",
          "",
        ].join("\r\n"),
      );
    });
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      if (phase === "headers") {
        const end = buffer.indexOf("\r\n\r\n");
        if (end === -1) return;
        status = buffer.slice(0, end).split("\r\n")[0];
        buffer = buffer.slice(end + 4);
        phase = "echo";
        socket.write("ping");
      }
      if (phase === "echo" && buffer.includes("ping")) {
        clearTimeout(timer);
        socket.destroy();
        resolvePromise({ status, echo: "ping" });
      }
    });
  });
}

before(async () => {
  const web = createHttpServer((req, res) => {
    seen.web.push({ url: req.url, host: req.headers.host });
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("web");
  });
  const pocketbase = createHttpServer((req, res) => {
    seen.pocketbase.push({ url: req.url, host: req.headers.host });
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ code: 200 }));
  });
  const api = createHttpServer((req, res) => {
    res.writeHead(404);
    res.end();
  });
  api.on("upgrade", (req, socket) => {
    seen.server.push({ url: req.url, host: req.headers.host });
    upgraded.add(socket);
    socket.on("close", () => upgraded.delete(socket));
    socket.on("end", () => socket.destroy());
    socket.write(
      "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n",
    );
    socket.on("data", (chunk) => socket.write(chunk));
  });

  const webPort = await listen(web);
  const pbPort = await listen(pocketbase);
  const apiPort = await listen(api);
  gateway = createGatewayServer({
    host: "127.0.0.1",
    port: 0,
    web: "http://127.0.0.1:" + webPort,
    server: "http://127.0.0.1:" + apiPort,
    pocketbase: "http://127.0.0.1:" + pbPort,
  });
  gatewayPort = await listen(gateway);
  gateway.__upstreams = [web, pocketbase, api];
});

after(async () => {
  for (const socket of upgraded) socket.destroy();
  for (const server of [gateway, ...gateway.__upstreams]) {
    server.closeAllConnections?.();
    await new Promise((resolvePromise) => server.close(resolvePromise));
  }
});

test("sends everything else to the web upstream and keeps the browser Host", async () => {
  const response = await request("/graph?x=1");
  assert.equal(response.status, 200);
  assert.equal(response.body, "web");
  assert.deepEqual(seen.web.at(-1), {
    url: "/graph?x=1",
    host: "dev.yuqi-666.cn",
  });
});

test("rewrites the PocketBase prefix and keeps the query", async () => {
  const response = await request("/pb/api/health?a=b");
  assert.equal(response.status, 200);
  assert.equal(response.body, JSON.stringify({ code: 200 }));
  assert.deepEqual(seen.pocketbase.at(-1), {
    url: "/api/health?a=b",
    host: "dev.yuqi-666.cn",
  });
});

test("does not expose other /pb paths", async () => {
  const before = seen.pocketbase.length;
  const response = await request("/pb/other");
  assert.equal(response.status, 404);
  assert.equal(seen.pocketbase.length, before);
});

test("forwards the tRPC WebSocket upgrade to the API", async () => {
  const result = await upgrade("/trpc");
  assert.match(result.status, /^HTTP\/1\.1 101/);
  assert.equal(result.echo, "ping");
  assert.deepEqual(seen.server.at(-1), {
    url: "/trpc",
    host: "dev.yuqi-666.cn",
  });
});

test("answers 502 with a hint when an upstream is down", async () => {
  const dead = createGatewayServer({
    host: "127.0.0.1",
    port: 0,
    web: "http://127.0.0.1:1",
    server: "http://127.0.0.1:1",
    pocketbase: "http://127.0.0.1:1",
  });
  const port = await listen(dead);
  try {
    const response = await new Promise((resolvePromise, reject) => {
      const req = httpRequest(
        {
          host: "127.0.0.1",
          port,
          path: "/pb/api/health",
          headers: { host: "dev.yuqi-666.cn" },
        },
        (res) => {
          const chunks = [];
          res.on("data", (chunk) => chunks.push(chunk));
          res.on("end", () =>
            resolvePromise({
              status: res.statusCode,
              body: Buffer.concat(chunks).toString("utf8"),
            }),
          );
        },
      );
      req.on("error", reject);
      req.end();
    });
    assert.equal(response.status, 502);
    assert.match(response.body, /pnpm dev:remote/);
  } finally {
    dead.closeAllConnections?.();
    await new Promise((resolvePromise) => dead.close(resolvePromise));
  }
});
