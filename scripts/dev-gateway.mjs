// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Development gateway: one port in, three upstreams out.
 *
 * Run it with `pnpm dev:remote`. It exists because a browser on a remote dev
 * domain talks to `/trpc` and `/pb` on its own origin
 * (`packages/api-client/src/backend-urls.ts`), so those paths must reach the
 * API and PocketBase while everything else goes to Next. Putting that split in
 * the project keeps the shared reverse proxy free of project-specific rules:
 * the proxy only forwards the domain to this gateway's port.
 *
 *   /trpc        -> DBRAIN_SERVER_URL   (WebSocket upgrade included)
 *   /pb/api/*    -> DBRAIN_PB_URL       (development PocketBase REST/files)
 *   /pb/*        -> 404                 (production file gateway is not used)
 *   everything   -> DBRAIN_WEB_URL      (Next, including /_next/webpack-hmr)
 *
 * The browser's Host header is forwarded unchanged. `apps/server/src/origin.ts`
 * compares it with the browser Origin, so rewriting it to the upstream address
 * turns every API call into a 403.
 *
 * See `docs/development.md` for the two proxy shapes that use this.
 */
import { createServer, request as httpRequest } from "node:http";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  readGatewayConfig,
  resolveRoute,
  targetUrl,
  upstreamFor,
} from "./lib/dev-gateway.mjs";

/** Headers that belong to one hop and are not forwarded verbatim. */
const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

/**
 * Copy headers for the next hop, dropping hop-by-hop fields so this process
 * frames the body it forwards.
 *
 * A WebSocket handshake is the exception: `Connection: Upgrade` and
 * `Upgrade` are the handshake itself, so the upgrade path keeps them.
 *
 * @param {import("node:http").IncomingHttpHeaders} headers
 * @param {boolean} [keepUpgrade]
 * @returns {Record<string, string | string[]>}
 */
function hopByHopFiltered(headers, keepUpgrade = false) {
  const out = {};
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined) continue;
    const lower = name.toLowerCase();
    const keep = keepUpgrade && (lower === "connection" || lower === "upgrade");
    if (HOP_BY_HOP.has(lower) && !keep) continue;
    out[name] = value;
  }
  return out;
}

/**
 * @param {import("node:http").IncomingMessage} req
 * @param {boolean} [keepUpgrade]
 * @returns {import("node:http").OutgoingHttpHeaders}
 */
function forwardedHeaders(req, keepUpgrade = false) {
  /** @type {import("node:http").OutgoingHttpHeaders} */
  const headers = hopByHopFiltered(req.headers, keepUpgrade);
  const address = req.socket.remoteAddress ?? "";
  const previous = req.headers["x-forwarded-for"];
  headers["x-forwarded-for"] = previous ? `${previous}, ${address}` : address;
  headers["x-forwarded-proto"] = req.headers["x-forwarded-proto"] ?? "http";
  headers["x-forwarded-host"] = req.headers.host ?? "";
  return headers;
}

/**
 * @param {string} statusLine
 * @param {import("node:http").IncomingHttpHeaders} headers
 * @param {boolean} [keepUpgrade]
 */
function writeResponseHead(statusLine, headers, keepUpgrade = false) {
  const lines = [statusLine];
  for (const [name, value] of Object.entries(
    hopByHopFiltered(headers, keepUpgrade),
  ))
    lines.push(`${name}: ${Array.isArray(value) ? value.join(", ") : value}`);
  return `${lines.join("\r\n")}\r\n\r\n`;
}

/**
 * Create the gateway without listening, so tests can drive it directly.
 *
 * @param {import("./lib/dev-gateway.mjs").GatewayConfig} config
 * @returns {import("node:http").Server}
 */
export function createGatewayServer(config) {
  const logAll = process.env.DBRAIN_GATEWAY_LOG === "1";

  const server = createServer((req, res) => {
    const route = resolveRoute(req.url);
    const upstream = upstreamFor(route, config);
    if (!upstream) {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end(`404: ${req.url} is not exposed in development\n`);
      return;
    }
    const target = targetUrl(route, req.url ?? "/", upstream);
    if (logAll || route.kind !== "web")
      console.log(`[gateway] ${req.method} ${req.url} -> ${target.href}`);

    const proxyReq = httpRequest(
      target,
      { method: req.method, headers: forwardedHeaders(req) },
      (proxyRes) => {
        res.writeHead(proxyRes.statusCode ?? 502, hopByHopFiltered(proxyRes.headers));
        proxyRes.pipe(res);
      },
    );
    proxyReq.on("error", (error) => {
      if (!res.headersSent)
        res.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
      res.end(
        `502: ${upstream} is unreachable (${error.code ?? error.message}).\n` +
          "Start the development stack with: pnpm dev:remote\n",
      );
    });
    // A closed tab must not leave the upstream connection open.
    res.on("close", () => proxyReq.destroy());
    req.pipe(proxyReq);
  });

  server.on("upgrade", (req, socket, head) => {
    const route = resolveRoute(req.url);
    const upstream = upstreamFor(route, config);
    if (!upstream) {
      socket.end("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
      return;
    }
    const target = targetUrl(route, req.url ?? "/", upstream);
    console.log(`[gateway] upgrade ${req.url} -> ${target.href}`);

    const proxyReq = httpRequest(target, {
      method: req.method,
      headers: forwardedHeaders(req, true),
    });
    // After the handshake the upgraded socket no longer belongs to the request,
    // so `proxyReq.destroy()` alone cannot close it: an abandoned tab would hold
    // one upstream connection open per page.
    /** @type {import("node:net").Socket | undefined} */
    let proxySocket;
    const closeUpstream = () => {
      proxySocket?.destroy();
      proxyReq.destroy();
    };
    socket.on("error", closeUpstream);
    // An HTTP-upgraded socket stays half-open, so a peer that only sends FIN
    // reaches `end` and never `close`; both must tear the upstream down.
    socket.on("end", closeUpstream);
    socket.on("close", closeUpstream);

    proxyReq.on("upgrade", (proxyRes, upstreamSocket, proxyHead) => {
      proxySocket = upstreamSocket;
      socket.write(
        writeResponseHead(
          `HTTP/1.1 ${proxyRes.statusCode} ${proxyRes.statusMessage}`,
          proxyRes.headers,
          true,
        ),
      );
      if (proxyHead?.length) socket.unshift(proxyHead);
      if (head?.length) proxySocket.unshift(head);
      proxySocket.on("error", () => socket.destroy());
      proxySocket.on("close", () => socket.destroy());
      socket.pipe(proxySocket).pipe(socket);
    });

    // The upstream can answer the handshake with a normal response instead of
    // 101, for example the API's 403 when Host and Origin disagree. Forward that
    // status verbatim: it is the fastest way to tell a proxy problem from a code
    // problem.
    proxyReq.on("response", (proxyRes) => {
      proxyRes.on("end", () => socket.end());
      socket.write(
        writeResponseHead(
          `HTTP/1.1 ${proxyRes.statusCode} ${proxyRes.statusMessage}`,
          proxyRes.headers,
        ),
      );
      proxyRes.pipe(socket);
    });
    proxyReq.on("error", () =>
      socket.end("HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n"),
    );
    proxyReq.end();
  });

  // tRPC subscriptions, PocketBase realtime and HMR are long-lived; the default
  // request timeout would cut them.
  server.timeout = 0;
  server.requestTimeout = 0;
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 60_000;
  return server;
}

/**
 * @param {import("./lib/dev-gateway.mjs").GatewayConfig} config
 */
function start(config) {
  const server = createGatewayServer(config);
  // Report a taken port as one line. Without this handler Node prints the
  // EADDRINUSE stack trace and `concurrently` kills the sibling services, which
  // leaves the reverse proxy answering 502 with nothing to point at.
  server.on("error", (error) => {
    if (error.code === "EADDRINUSE")
      console.error(
        `[gateway] port ${config.port} is already in use; stop the other process or change DBRAIN_GATEWAY_PORT in .env`,
      );
    else console.error(`[gateway] ${error.message}`);
    process.exit(1);
  });
  server.listen(config.port, config.host, () => {
    console.log(`[gateway] listening on http://${config.host}:${config.port}`);
    console.log(
      `[gateway] /trpc -> ${config.server}  /pb/api/* -> ${config.pocketbase}  /* -> ${config.web}`,
    );
  });
  const shutdown = () => {
    server.closeAllConnections?.();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1000).unref();
  };
  for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, shutdown);
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    start(readGatewayConfig());
  } catch (error) {
    console.error(`[gateway] ${error.message}`);
    process.exit(1);
  }
}
