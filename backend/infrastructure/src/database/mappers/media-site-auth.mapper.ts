// SPDX-License-Identifier: AGPL-3.0-only

import type { RecordModel } from "pocketbase";

import type {
  MediaSiteAuth,
  MediaSiteAuthMethod,
  MediaSiteAuthSecret,
  MediaSiteAuthStatus,
  SaveMediaSiteAuthInput,
} from "@workspace/domain";

import type { MediaCookieCipher } from "../../storage/media-cookie-cipher";

/**
 * One record of the `media_site_auths` collection.
 *
 * This interface is the only description of the collection's field names outside
 * the PocketBase migrations, and the mapper below is the only code that reads or
 * writes them (`backend/infrastructure/AGENTS.md`).
 *
 * The login itself is spread over three columns — `cookieCiphertext`, `nonce`
 * and `tag` — because that is how AES-GCM stores it; the domain model never sees
 * them, only the decrypted `MediaSiteAuthSecret`. `hosts` is reserved for the
 * site domains a login was stored for; the current domain model derives the
 * hosts from the site catalog instead, so the column is written empty and kept
 * for a future cache/debug use. It is intentionally not part of the wire model.
 */
export interface MediaSiteAuthRecord extends RecordModel {
  ownerId: string;
  siteKey: string;
  hosts: string;
  cookieCiphertext: string;
  nonce: string;
  tag: string;
  accountLabel: string;
  authMethod: string;
  browserName: string;
  status: string;
  lastCheckedAt: string;
  lastUsedAt: string;
}

/** The three stored parts of one encrypted cookie. */
export interface EncryptedCookieFields {
  ciphertext: string;
  nonce: string;
  tag: string;
}

const AUTH_METHODS: readonly MediaSiteAuthMethod[] = [
  "browser",
  "cookies-file",
];
const AUTH_STATUSES: readonly MediaSiteAuthStatus[] = [
  "saved",
  "verified",
  "expired",
];

/** A record text field, or `""` when the store has none. */
function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * A stored `authMethod`; an unknown value reads as `cookies-file` because that is
 * the method whose secret is encrypted (a corrupt record then fails to decrypt
 * instead of silently being reported as a browser login that yt-dlp would try to
 * read from a browser that was never named).
 */
function authMethod(value: unknown): MediaSiteAuthMethod {
  return AUTH_METHODS.includes(value as MediaSiteAuthMethod)
    ? (value as MediaSiteAuthMethod)
    : "cookies-file";
}

/** A stored `status`; an unknown value reads as the neutral `saved`. */
function authStatus(value: unknown): MediaSiteAuthStatus {
  return AUTH_STATUSES.includes(value as MediaSiteAuthStatus)
    ? (value as MediaSiteAuthStatus)
    : "saved";
}

/**
 * Converts between a `media_site_auths` record and the domain login model.
 *
 * Decryption lives here too (not in the repository) so the record's three cookie
 * columns are read in the one module that knows them; the flow is still
 * record → cipher → domain secret.
 */
export class MediaSiteAuthMapper {
  toDomain(record: RecordModel): MediaSiteAuth {
    const method = authMethod(record.authMethod);
    return {
      siteKey: text(record.siteKey),
      authMethod: method,
      // The browser name only means something for the browser method.
      browserName: method === "browser" ? text(record.browserName) : "",
      accountLabel: text(record.accountLabel),
      status: authStatus(record.status),
      lastCheckedAt: text(record.lastCheckedAt),
      lastUsedAt: text(record.lastUsedAt),
    };
  }

  /**
   * Builds the full record body for a create or a replace.
   *
   * `cookie` is `null` for the browser method: the three cookie columns are then
   * written as `""` rather than left out, because a replace must clear the
   * cookie a previous `cookies-file` login stored for the same site.
   *
   * The two timestamps are reset: this is a different login, it has not been
   * verified or used yet, and the caller verifies it right after saving.
   */
  toRecord(
    ownerId: string,
    input: SaveMediaSiteAuthInput,
    cookie: EncryptedCookieFields | null,
  ): Partial<RecordModel> {
    return {
      ownerId,
      siteKey: input.siteKey,
      cookieCiphertext: cookie ? cookie.ciphertext : "",
      nonce: cookie ? cookie.nonce : "",
      tag: cookie ? cookie.tag : "",
      accountLabel: input.accountLabel ?? "",
      authMethod: input.authMethod,
      browserName:
        input.authMethod === "browser" ? (input.browserName ?? "") : "",
      status: input.status,
      lastCheckedAt: "",
      lastUsedAt: "",
    };
  }

  /**
   * The decrypted cookie of one record, `null` for a browser login or an
   * incomplete/corrupt record an operator may have edited by hand.
   *
   * A tampered ciphertext throws from {@link MediaCookieCipher.decrypt}; the
   * repository lets that reach the caller, because silently reporting "no
   * login" would make the import run anonymously and fail with a misleading
   * error.
   */
  toSecret(
    record: RecordModel,
    cipher: MediaCookieCipher,
  ): MediaSiteAuthSecret | null {
    if (authMethod(record.authMethod) !== "cookies-file") return null;

    const ciphertext = text(record.cookieCiphertext);
    const nonce = text(record.nonce);
    const tag = text(record.tag);
    if (ciphertext === "" || nonce === "" || tag === "") return null;

    return {
      cookieText: cipher.decrypt({ ciphertext, nonce, tag }),
      // The tag names the stored ciphertext for the probe cache key. The column
      // is not stored separately: it is derived, so it cannot drift from the
      // ciphertext it describes.
      version: cipher.version(ciphertext),
    };
  }
}
