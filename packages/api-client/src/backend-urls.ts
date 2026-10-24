// SPDX-License-Identifier: AGPL-3.0-only

import { getDesktopBackend } from "./desktop-backend";

/**
 * Browser-side backend URLs.
 *
 * The two browser clients (tRPC over WebSocket, PocketBase REST/files) must
 * reach the dev backends on `:3001` / `:8090`. Two deployment shapes exist:
 *
 * 1. **Loopback** — the browser runs on the same host as `pnpm dev`
 *    (`http://localhost:3000`). The backends listen on their own ports, so we
 *    keep talking to `localhost:3001` / `localhost:8090` directly. This is the
 *    local development path and must not change.
 * 2. **Proxied same-origin** — the browser reaches the app through a reverse
 *    proxy on a real hostname (this repo's dev box: `https://dev.yuqi-666.cn`
 *    → nginx → `:3000`). From such a browser `localhost` means the *browser's*
 *    machine, so the direct ports are unreachable. We instead use same-origin
 *    paths that the proxy is expected to route:
 *
 *        /trpc  → http://127.0.0.1:3001   (WebSocket upgrade; any path is
 *                                          accepted — the server is
 *                                          `new WebSocketServer({ port })`)
 *        /pb/   → server:3001 (authenticated file gateway → PocketBase, and
 *                                          the resumable upload-session routes)
 *
 * Container routing lives in `deploy/nginx.conf`; see `docs/development.md`
 * and `docs/operations.md` for development and deployment proxy configuration.
 *
 * Anything else (e.g. opening `http://10.21.188.14:3000` directly) cannot work
 * in either shape and falls back to the same-origin paths, which is no worse
 * than the previous always-`localhost` behaviour.
 */

export interface BackendUrls {
  /** tRPC WebSocket endpoint (queries, mutations, subscriptions). */
  trpc: string;
  /** PocketBase origin (REST, file URLs, direct uploads). */
  pocketbase: string;
  /**
   * HTTP base of the Node server that accepts resumable upload sessions.
   *
   * Deliberately separate from {@link BackendUrls.pocketbase}: a chunked
   * upload talks to the server (which spools the parts and streams the
   * assembled file into PocketBase), while the single-request path still posts
   * straight to the file store. The `/upload/...` sub-paths are appended by
   * `@workspace/utils/upload`, never written out here.
   */
  upload: string;
}

// The `/trpc` path is part of the contract, not decoration: the server owns the
// HTTP listener and performs the WebSocket upgrade itself, admitting only
// `req.url === "/trpc"` (and rejecting anything else with a 403 handshake).
// Every other shape already spells it out — `deploy/nginx.conf`'s
// `location = /trpc`, the desktop runtime's `${base}/trpc`, and
// `scripts/release/server-smoke.mjs`. A URL without it fails the handshake, and
// because tRPC's ws client silently retries a rejected socket, the caller's
// promise never settles: the app sits on its loading gate forever instead of
// erroring.
const LOOPBACK_URLS: BackendUrls = {
  trpc: "ws://localhost:3001/trpc",
  pocketbase: "http://localhost:8090",
  upload: "http://localhost:3001",
};

function isLoopbackHostname(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname === "[::1]"
  );
}

/**
 * Resolve the backend URLs for the current browsing context. Safe to call on
 * the server: without a `window` it returns the loopback defaults.
 */
export function resolveBackendUrls(): BackendUrls {
  if (typeof window === "undefined") {
    return LOOPBACK_URLS;
  }

  if (process.env.NEXT_PUBLIC_DBRAINX_PLATFORM === "desktop") {
    // Desktop reaches everything through the per-run session base
    // (`/session/<secret>`), which the native supervisor routes to the local
    // server; the upload routes ride on the same base as PocketBase.
    const backend = getDesktopBackend();
    return {
      trpc: backend.trpc,
      pocketbase: backend.pocketbase,
      upload: backend.pocketbase,
    };
  }

  const { hostname, host, origin, protocol } = window.location;
  if (isLoopbackHostname(hostname) && process.env.NEXT_PUBLIC_DBRAINX_BACKEND_MODE !== "same-origin") {
    // Cookies are scoped by hostname, not port. Keep the browser's hostname
    // so media requests opened at 127.0.0.1 also carry its session to PB.
    const loopbackHost = hostname === "::1" ? "[::1]" : hostname;
    return {
      trpc: `ws://${loopbackHost}:3001/trpc`,
      pocketbase: `http://${loopbackHost}:8090`,
      upload: `http://${loopbackHost}:3001`,
    };
  }

  return {
    trpc: `${protocol === "https:" ? "wss:" : "ws:"}//${host}/trpc`,
    // `/pb` is not a new route: nginx already forwards `location /pb/` to the
    // server, and the server strips the `/pb` prefix before its own routing, so
    // pointing the upload sessions at `${origin}/pb` needs no proxy change.
    // The same prefix must be used for the tRPC-less HTTP calls here as for
    // PocketBase, or a remote deployment would have to add an upload rewrite.
    pocketbase: `${origin}/pb`,
    upload: `${origin}/pb`,
  };
}
