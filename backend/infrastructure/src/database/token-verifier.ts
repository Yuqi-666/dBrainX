// SPDX-License-Identifier: AGPL-3.0-only

import PocketBase, {
  getTokenPayload,
  isTokenExpired,
  type RecordModel,
} from "pocketbase";
import { getPocketBaseClient } from "./pocketbase-client";

interface VerifiedToken {
  userId: string;
  exp: number;
}

// Explicit-logout denylist. PocketBase has no server-side token-revocation API
// (it is fully stateless), so a deliberately logged-out token is rejected here
// before any caching or the HMAC round-trip. Keyed on the raw token string: the
// PocketBase auth JWT has no `jti` claim, only `id`/`type`/`collectionId`/
// `refreshable`/`exp`.
const denylist = new Map<string, { exp: number }>();
const MAX_DENYLIST_SIZE = 5000;

const cache = new Map<string, VerifiedToken>();
const MAX_CACHE_SIZE = 1000;

function pruneExpired(): void {
  const now = Math.floor(Date.now() / 1000);
  for (const [token, entry] of cache) {
    if (entry.exp <= now) {
      cache.delete(token);
    }
  }
  if (cache.size > MAX_CACHE_SIZE) {
    const overflow = cache.size - MAX_CACHE_SIZE;
    let removed = 0;
    for (const key of cache.keys()) {
      if (removed >= overflow) break;
      cache.delete(key);
      removed++;
    }
  }
}

function pruneDenylist(): void {
  const now = Math.floor(Date.now() / 1000);
  for (const [token, entry] of denylist) {
    if (entry.exp <= now) {
      denylist.delete(token);
    }
  }
  if (denylist.size > MAX_DENYLIST_SIZE) {
    const overflow = denylist.size - MAX_DENYLIST_SIZE;
    let removed = 0;
    for (const key of denylist.keys()) {
      if (removed >= overflow) break;
      denylist.delete(key);
      removed++;
    }
  }
}

function isTokenDenylisted(token: string, now: number): boolean {
  const entry = denylist.get(token);
  if (!entry) {
    return false;
  }
  if (entry.exp <= now) {
    denylist.delete(token);
    return false;
  }
  return true;
}

/**
 * Add a token to the logout denylist.
 * `exp` is the JWT `exp` claim in unix seconds; the entry auto-prunes at expiry.
 */
export function denylistToken(token: string, exp: number): void {
  denylist.set(token, { exp });
  pruneDenylist();
}

/**
 * Returns the JWT `exp` claim in unix seconds, or `null` if unreadable.
 */
export function getTokenExp(token: string): number | null {
  if (!token) {
    return null;
  }
  const payload = getTokenPayload(token);
  return typeof payload?.exp === "number" ? payload.exp : null;
}

export async function verifyToken(token: string): Promise<string> {
  if (!token) {
    throw new Error("Missing token");
  }

  // Fail fast on malformed / expired tokens without a server round-trip.
  if (isTokenExpired(token)) {
    throw new Error("Token expired");
  }
  const payload = getTokenPayload(token);
  if (!payload || !payload.id) {
    throw new Error("Invalid token payload");
  }

  const now = Math.floor(Date.now() / 1000);

  // Reject tokens explicitly invalidated by logout before any caching.
  if (isTokenDenylisted(token, now)) {
    throw new Error("Token revoked");
  }

  const cached = cache.get(token);
  if (cached && cached.exp > now) {
    return cached.userId;
  }

  // Never reuse the shared singleton: its authStore is overwritten per login
  // and would race across concurrent users. Verify on a per-token instance so
  // PocketBase's server-side HMAC check runs against THIS token.
  const url = getPocketBaseClient().baseUrl;
  const pb = new PocketBase(url);
  pb.authStore.save(token);

  try {
    const authData = await pb.collection("users").authRefresh();
    const userId = authData.record.id as string;
    const exp =
      typeof payload.exp === "number"
        ? payload.exp
        : now + 60 * 60;
    cache.set(token, { userId, exp });
    pruneExpired();
    return userId;
  } catch {
    throw new Error("Invalid token");
  }
}

/**
 * Issue a fresh token + record for a still-valid session.
 * PocketBase `authRefresh()` requires a currently-valid (non-expired) token, so
 * this is a silent renewal used to extend a live session before its JWT lapses.
 */
export async function refreshToken(
  token: string,
): Promise<{ token: string; record: RecordModel }> {
  if (!token) {
    throw new Error("Missing token");
  }
  const url = getPocketBaseClient().baseUrl;
  const pb = new PocketBase(url);
  pb.authStore.save(token);
  const authData = await pb.collection<RecordModel>("users").authRefresh();
  return { token: authData.token, record: authData.record };
}
