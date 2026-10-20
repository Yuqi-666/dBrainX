// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Client-side auth session cookie helpers.
 *
 * The tRPC WS handshake reads `pb_token` (and the edge middleware checks it),
 * so keep the cookie name and max-age in sync across those two consumers.
 * `pb_userId` was removed: the server never trusts a client-claimed userId, and
 * the raw token is the only identity anchor.
 */

const TOKEN_COOKIE = "pb_token";
const MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

/** Read the current web session, including renewals and logout in another tab. */
export function readAuthSessionToken(): string | undefined {
  if (typeof document === "undefined") return undefined;
  const match = document.cookie.match(/(?:^|;\s*)pb_token=([^;]*)/);
  if (!match?.[1]) return undefined;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return undefined;
  }
}

function secureAttribute(): string {
  // Only add `Secure` on HTTPS/CORS origins. Local dev runs over http://localhost.
  return typeof window !== "undefined" && window.location.protocol === "https:"
    ? "; Secure"
    : "";
}

export function setAuthSession(token: string): void {
  if (typeof document === "undefined") return;
  document.cookie = `${TOKEN_COOKIE}=${encodeURIComponent(token)}; path=/; max-age=${MAX_AGE_SECONDS}; SameSite=Lax${secureAttribute()}`;
}

export function clearAuthSession(): void {
  if (typeof document === "undefined") return;
  document.cookie = `${TOKEN_COOKIE}=; path=/; max-age=0; SameSite=Lax${secureAttribute()}`;
}

/** Decode a JWT payload (unverified) so the client can read the `exp` claim. */
export function decodeJwtPayload(token: string): Record<string, unknown> {
  const part = token.split(".")[1];
  if (!part) {
    return {};
  }
  const base64 = part.replace(/-/g, "+").replace(/_/g, "/");
  try {
    return JSON.parse(decodeURIComponent(escape(atob(base64)))) as Record<string, unknown>;
  } catch {
    return {};
  }
}
