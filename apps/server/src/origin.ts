// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Browser-origin admission for the API listener.
 *
 * Kept out of `index.ts` so the rule can be tested directly: `index.ts` starts
 * the server on import, which makes it unimportable from a test.
 */

/** The only path the WebSocket upgrade is admitted on. */
export const TRPC_PATH = "/trpc";

export function isLoopbackHostname(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname === "[::1]"
  );
}

/**
 * Whether a browser request may talk to this listener.
 *
 * Two shapes are legitimate, and they disagree about ports:
 *
 * 1. **Proxied** (the container stack, and `DBRAIN_PUBLIC_ORIGIN` when set):
 *    nginx fronts web and API on one public host and forwards `$http_host`, so
 *    `Origin` and `Host` agree exactly.
 * 2. **Split development** (`pnpm dev`): the app is served by the web dev
 *    server on `:3000` while this listener owns `:3001`, so the upgrade carries
 *    a different port by construction. The desktop gateway has the same problem
 *    and solves it the same way — an explicit origin allowlist in
 *    `desktop/security.ts` names its dev frontend port.
 *
 * Identity does not depend on this check: the WebSocket context is built from
 * `connectionParams.token`, verified against PocketBase per connection, and no
 * ambient cookie is ever read for it. So the rule here only has to keep unknown
 * pages from reaching the listener at all, which is why the relaxation is
 * spelled out as loopback-only: a non-loopback origin still has to match `Host`
 * exactly, and production behaviour is untouched.
 *
 * A rejection is worth getting right in both directions, because the failure is
 * silent: tRPC's ws client retries a refused handshake instead of surfacing it,
 * so a false negative leaves the app on its loading screen forever.
 */
export function sameOrigin(
  origin: string | undefined,
  host: string | undefined,
  publicOrigin?: string,
): boolean {
  if (!origin) return true; // CLI clients still need a valid token for protected operations.
  if (publicOrigin) return origin === publicOrigin;
  try {
    const source = new URL(origin);
    if (source.host === host) return true;
    if (!host) return false;
    return (
      isLoopbackHostname(source.hostname) &&
      isLoopbackHostname(new URL(`http://${host}`).hostname)
    );
  } catch {
    return false;
  }
}
