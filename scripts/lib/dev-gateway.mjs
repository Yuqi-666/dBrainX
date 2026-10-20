// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Routing rules for the development gateway.
 *
 * A browser on a non-loopback host picks its backend from its own address:
 * `packages/api-client/src/backend-urls.ts` sends the app to the same-origin
 * paths `/trpc` and `/pb`, never to the browser's own `localhost:3001` /
 * `localhost:8090`. Those two paths therefore have to be split off somewhere,
 * and a shared reverse proxy only knows one upstream port.
 *
 * The gateway is that split, and it lives in the project, so the shared proxy
 * stays project-agnostic: it only needs this project's entry port. Both
 * deployment shapes use the same rules, see `scripts/dev-gateway.mjs`.
 */

/** @typedef {"web" | "server" | "pocketbase" | "notFound"} RouteKind */
/**
 * @typedef {object} Route
 * @property {RouteKind} kind
 * @property {string} upstreamPath Path to request from the chosen upstream.
 */
/**
 * @typedef {object} GatewayConfig
 * @property {string} host Interface the gateway listens on.
 * @property {number} port Port the gateway listens on.
 * @property {string} web Next dev server, without a trailing slash.
 * @property {string} server tRPC and file gateway listener.
 * @property {string} pocketbase Development PocketBase.
 */

/** The path prefix the browser PocketBase client is configured with. */
const POCKETBASE_PREFIX = "/pb";

/**
 * Decide which upstream owns a request. Only the path takes part in the
 * decision; the caller keeps the query string.
 *
 * @param {string | undefined} rawUrl Request URL, path and query.
 * @returns {Route}
 */
export function resolveRoute(rawUrl) {
  // Collapse leading slashes. Without this, a request line such as
  // `//evil.test/x` would reach the upstream as a protocol-relative URL and
  // `new URL(path, upstream)` would leave the configured host.
  const raw = (rawUrl ?? "/").split("?")[0] || "/";
  const path = "/" + raw.replace(/^\/+/, "");

  // The API performs the WebSocket upgrade itself and admits exactly this path.
  if (path === "/trpc") return { kind: "server", upstreamPath: "/trpc" };

  if (path === POCKETBASE_PREFIX || path.startsWith(`${POCKETBASE_PREFIX}/`)) {
    const rest = path.slice(POCKETBASE_PREFIX.length) || "/";
    // The browser PocketBase client uses `<origin>/pb` as its base URL, so REST
    // calls arrive as `/pb/api/...`. They go straight to PocketBase: the
    // production file gateway (`/pb/` -> server:3001) is not part of this path
    // and would reject these calls through its own allowlist.
    if (rest === "/api" || rest.startsWith("/api/"))
      return { kind: "pocketbase", upstreamPath: rest };
    // Chunked uploads are served by the API, not by PocketBase: the API spools
    // the chunks on its own disk and stores only the assembled file. The path
    // keeps its `/pb` prefix, because the API strips exactly that prefix before
    // it routes (the container's nginx forwards `/pb/` the same way).
    if (rest === "/upload" || rest.startsWith("/upload/"))
      return { kind: "server", upstreamPath: path };
    return { kind: "notFound", upstreamPath: rest };
  }

  return { kind: "web", upstreamPath: path };
}

/**
 * @param {string | undefined} value
 * @param {string} fallback
 * @param {string} name
 * @returns {string}
 */
function readUpstream(value, fallback, name) {
  const raw = (value ?? "").trim() || fallback;
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`Invalid ${name}: ${raw}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:")
    throw new Error(`${name} must be an http(s) URL: ${raw}`);
  return raw.replace(/\/+$/, "");
}

/**
 * Read the gateway configuration. Defaults match `pnpm dev:remote`.
 *
 * @param {Record<string, string | undefined>} [env]
 * @returns {GatewayConfig}
 */
export function readGatewayConfig(env = process.env) {
  const port = Number(env.DBRAIN_GATEWAY_PORT ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error(`Invalid DBRAIN_GATEWAY_PORT: ${env.DBRAIN_GATEWAY_PORT}`);
  return {
    host: (env.DBRAIN_GATEWAY_HOST ?? "").trim() || "0.0.0.0",
    port,
    web: readUpstream(env.DBRAIN_WEB_URL, "http://127.0.0.1:3002", "DBRAIN_WEB_URL"),
    server: readUpstream(env.DBRAIN_SERVER_URL, "http://127.0.0.1:3001", "DBRAIN_SERVER_URL"),
    pocketbase: readUpstream(env.DBRAIN_PB_URL, "http://127.0.0.1:8090", "DBRAIN_PB_URL"),
  };
}

/**
 * @param {Route} route
 * @param {GatewayConfig} config
 * @returns {string | undefined} Upstream base URL, or undefined when the route
 * is deliberately not exposed in development.
 */
export function upstreamFor(route, config) {
  switch (route.kind) {
    case "web":
      return config.web;
    case "server":
      return config.server;
    case "pocketbase":
      return config.pocketbase;
    default:
      return undefined;
  }
}

/**
 * Build the upstream URL for one request, keeping the query string.
 *
 * @param {Route} route
 * @param {string} rawUrl
 * @param {string} upstream
 * @returns {URL}
 */
export function targetUrl(route, rawUrl, upstream) {
  const index = (rawUrl ?? "").indexOf("?");
  const query = index === -1 ? "" : rawUrl.slice(index);
  return new URL(`${route.upstreamPath}${query}`, upstream);
}
