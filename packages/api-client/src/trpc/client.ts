// SPDX-License-Identifier: AGPL-3.0-only

import {
  createTRPCClient,
  wsLink,
  createWSClient,
  type TRPCWebSocketClient,
} from "@trpc/client";
import superjson from "superjson";
import type { AppRouter } from "@workspace/adapter-front";
import { useSourceIdStore, useWorkspaceStore } from "@workspace/store";
import { isTokenExpired } from "pocketbase";
import {
  setAuthSession,
  clearAuthSession,
  decodeJwtPayload,
  readAuthSessionToken,
} from "../auth/session";
import { activeWorkspaceId } from "../active-workspace.ts";
import { resolveBackendUrls } from "../backend-urls";
import { getDesktopBackend } from "../desktop-backend";
import { connectionParamsOf } from "./connection-params.ts";
import { createReconnectGate, createReconnectQueue } from "./reconnect-gate.ts";

const isDesktop = process.env.NEXT_PUBLIC_DBRAINX_PLATFORM === "desktop";

function getConnectionParams() {
  return connectionParamsOf({
    token: isDesktop ? getDesktopBackend().token : readAuthSessionToken(),
    sourceId: useSourceIdStore.getState().getSourceId(),
    workspaceId: activeWorkspaceId(),
  });
}

const wsClient: TRPCWebSocketClient = createWSClient({
  lazy: { enabled: true, closeMs: 30_000 },
  url: () => isDesktop ? getDesktopBackend().trpc : resolveBackendUrls().trpc,
  connectionParams: getConnectionParams,
});

/**
 * Every outgoing request waits on an in-flight re-handshake (`reconnect-gate.ts`).
 * A workspace switch closes the socket and immediately loads six models; without
 * this the socket link answers those with `Active connection is not open`.
 */
const reconnects = createReconnectQueue();
const reconnectGate = createReconnectGate<AppRouter>(reconnects);

export function createClient() {
  return createTRPCClient<AppRouter>({
    links: [reconnectGate, wsLink({ client: wsClient, transformer: superjson })],
  });
}

export const trpcClient = createClient();

/**
 * Close the underlying WebSocket so the next operation re-handshakes with the
 * freshly set/cleared cookie. Call after login/register/logout.
 *
 * Await it when more calls follow immediately (a workspace switch loads six
 * models right after this); a caller that navigates away can ignore it.
 */
export function reconnectTRPCClient(): Promise<void> {
  return reconnects.run(() => wsClient.close());
}

/**
 * A connection declares its workspace in the handshake, and the server keeps
 * that value for the life of the socket. Switching workspace therefore has to
 * re-handshake; otherwise the next write would still carry the previous id and
 * be refused or applied to the wrong workspace.
 */
useWorkspaceStore.subscribe((state, previous) => {
  if (state.currentWorkspaceId !== previous.currentWorkspaceId) {
    reconnectTRPCClient();
  }
});

/**
 * Silently renew the auth token before it lapses.
 * PocketBase `token` is a JWT with an `exp` claim; when it is within the renewal
 * window, call `auth.refresh`, persist the new token to the same cookie, and
 * reconnect the WS so the new token is used for subsequent operations.
 */
export function scheduleTokenRefresh(token: string): number {
  if (isTokenExpired(token)) {
    return NaN;
  }
  const payload = decodeJwtPayload(token) as { exp?: number };
  if (typeof payload.exp !== "number") {
    return NaN;
  }
  const msUntilExpiry = payload.exp * 1000 - Date.now();
  const delay = Math.max(msUntilExpiry - 60_000, 5_000);
  return window.setTimeout(async () => {
    try {
      const res = await trpcClient.auth.refresh.mutate();
      if (res?.token) {
        setAuthSession(res.token);
        reconnectTRPCClient();
        scheduleTokenRefresh(res.token);
      }
    } catch {
      // Session exhausted; clear client state so the UI redirects to login.
      clearAuthSession();
      window.location.href = "/login";
    }
  }, delay);
}
