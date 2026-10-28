// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Saved media-site logins.
 *
 * A site that needs a login needs a cookie, and a cookie is a credential: it is
 * stored encrypted, never returned to a client, and never logged. This port is
 * the only way the application layer touches one.
 *
 * Two methods produce a login, and they behave differently on purpose:
 *
 * - `browser` (desktop local backend only): only the browser's *name* is stored.
 *   yt-dlp reads the cookie from that browser at download time, so it never goes
 *   stale and the server never holds the credential.
 * - `cookies-file`: the user exports a Netscape `cookies.txt` with a browser
 *   extension. Only the cookies of the listed sites are kept; every other domain
 *   is dropped before anything is stored, and the ciphertext is what reaches the
 *   database.
 *
 * Either way the plaintext lives only long enough to run one download or one
 * verification, in a `0600` file inside that job's directory, and is removed
 * with it.
 */

/** How a saved login was produced. */
export type MediaSiteAuthMethod = "browser" | "cookies-file";

/**
 * What the last check said about a saved login.
 *
 * - `saved` — stored, not checked yet (or checked long ago).
 * - `verified` — the most recent probe succeeded.
 * - `expired` — the most recent probe failed, or an import hit a login error.
 */
export type MediaSiteAuthStatus = "saved" | "verified" | "expired";

/** One saved login, as a client may see it. Never carries the cookie itself. */
export interface MediaSiteAuth {
  /** Listed site key, e.g. `bilibili`. */
  siteKey: string;
  /** How this login was produced. */
  authMethod: MediaSiteAuthMethod;
  /** Browser name for the `browser` method, `""` otherwise. */
  browserName: string;
  /** Account name reported by the verification probe, `""` when unknown. */
  accountLabel: string;
  /** Result of the most recent verification. */
  status: MediaSiteAuthStatus;
  /** ISO timestamp of the most recent verification, `""` when never checked. */
  lastCheckedAt: string;
  /** ISO timestamp of the most recent import that used it, `""` when unused. */
  lastUsedAt: string;
}

/** The decrypted cookie of one saved login. Server-side only. */
export interface MediaSiteAuthSecret {
  /** Netscape `cookies.txt` content. */
  cookieText: string;
  /** Stable tag of the stored ciphertext, used in the probe cache key. */
  version: string;
}

/** What a newly connected login is saved from. */
export interface SaveMediaSiteAuthInput {
  /** Listed site key. */
  siteKey: string;
  /** How the login was produced. */
  authMethod: MediaSiteAuthMethod;
  /** Browser name for the `browser` method. */
  browserName?: string;
  /** Account name reported by the verification probe. */
  accountLabel?: string;
  /** Initial status; the caller verifies and updates it. */
  status: MediaSiteAuthStatus;
  /**
   * Netscape `cookies.txt` content, already filtered to the listed sites.
   * Required for `cookies-file`, ignored for `browser`.
   */
  cookieText?: string;
}

/** One browser the local backend can ask yt-dlp to read cookies from. */
export interface MediaBrowserOption {
  /** Name yt-dlp accepts, e.g. `chrome`. */
  name: string;
  /** Label to show, e.g. `Chrome`. */
  label: string;
}

/** Detects which browsers are installed on the machine the server runs on. */
export interface IMediaBrowserDetector {
  /** Installed browsers, best-effort; an empty list hides the desktop method. */
  list(): MediaBrowserOption[];
}

/**
 * Saved logins, one per owner and site.
 *
 * Every method takes the verified owner id: a login belonging to somebody else
 * must be indistinguishable from a missing one. The repository owns the
 * encryption, so the application layer never sees ciphertext or a key.
 */
export interface IMediaSiteAuthRepository {
  /** Every saved login of one owner; never includes the cookie. */
  list(ownerId: string): Promise<MediaSiteAuth[]>;
  /** One saved login, or `null` when the owner has none for the site. */
  find(ownerId: string, siteKey: string): Promise<MediaSiteAuth | null>;
  /** The decrypted cookie, or `null` for a browser login / a missing one. */
  readSecret(
    ownerId: string,
    siteKey: string,
  ): Promise<MediaSiteAuthSecret | null>;
  /** Creates or replaces the login of one site. */
  save(ownerId: string, input: SaveMediaSiteAuthInput): Promise<MediaSiteAuth>;
  /** Records the result of a verification. */
  setStatus(
    ownerId: string,
    siteKey: string,
    status: MediaSiteAuthStatus,
    accountLabel?: string,
  ): Promise<void>;
  /** Records that the login was just used for an import. */
  touch(ownerId: string, siteKey: string): Promise<void>;
  /** Forgets the login of one site; a missing one is not an error. */
  remove(ownerId: string, siteKey: string): Promise<void>;
}
