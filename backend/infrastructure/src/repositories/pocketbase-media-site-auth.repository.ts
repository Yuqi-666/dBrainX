// SPDX-License-Identifier: AGPL-3.0-only

import type { RecordModel } from "pocketbase";

import type {
  IMediaSiteAuthRepository,
  MediaSiteAuth,
  MediaSiteAuthSecret,
  MediaSiteAuthStatus,
  SaveMediaSiteAuthInput,
} from "@workspace/domain";

import { getPocketBaseClient } from "../database/pocketbase-client";
import {
  MediaSiteAuthMapper,
  type EncryptedCookieFields,
} from "../database/mappers/media-site-auth.mapper";
import { MediaCookieCipher } from "../storage/media-cookie-cipher";

const COLLECTION_NAME = "media_site_auths";

/**
 * Saved media-site logins, one record per owner and site.
 *
 * A login is a credential, so the plaintext cookie never reaches PocketBase: the
 * repository encrypts it with {@link MediaCookieCipher} and stores the
 * ciphertext, nonce and tag; a browser login stores only the browser name,
 * because yt-dlp reads that browser's cookie itself at download time. The three
 * cookie columns are cleared when a site switches to the browser method, so a
 * replaced login cannot leave a stale credential behind.
 *
 * The repository owns the encryption so the application layer never sees a
 * ciphertext or a key. The PocketBase collection rules already scope every
 * operation to `@request.auth.id`, and every query here also filters `ownerId`
 * explicitly: a login of somebody else must be indistinguishable from a missing
 * one, even if the rules were ever relaxed.
 *
 * `find`/`list` return the domain model, which carries no cookie; only
 * {@link PocketBaseMediaSiteAuthRepository.readSecret} decrypts, and only for a
 * `cookies-file` login. Timestamps are ISO strings, empty for "never".
 *
 * There is no transaction across the find-then-write of `save`: a concurrent
 * save of the same (owner, site) may make one of them fail on the collection's
 * unique index instead of silently updating the row twice. That is acceptable
 * for a user action that is retried by pressing the button again.
 */
export class PocketBaseMediaSiteAuthRepository implements IMediaSiteAuthRepository {
  private readonly cipher: MediaCookieCipher;
  private readonly mapper: MediaSiteAuthMapper;

  /**
   * A plain assigned field rather than a constructor parameter property: the
   * loader used by the repository's tests strips types and rejects TypeScript
   * syntax with a runtime effect. The cipher defaults to
   * {@link MediaCookieCipher.fromEnvironment}, so the composition root can build
   * the repository with no arguments.
   */
  constructor(cipher: MediaCookieCipher = MediaCookieCipher.fromEnvironment()) {
    this.cipher = cipher;
    this.mapper = new MediaSiteAuthMapper();
  }

  private get collection() {
    return getPocketBaseClient().collection<RecordModel>(COLLECTION_NAME);
  }

  async list(ownerId: string): Promise<MediaSiteAuth[]> {
    const records = await this.collection.getFullList({
      filter: ownerFilter(ownerId),
      sort: "siteKey",
    });
    return records.map((record) => this.mapper.toDomain(record));
  }

  async find(ownerId: string, siteKey: string): Promise<MediaSiteAuth | null> {
    const record = await this.findRecord(ownerId, siteKey);
    return record ? this.mapper.toDomain(record) : null;
  }

  async readSecret(
    ownerId: string,
    siteKey: string,
  ): Promise<MediaSiteAuthSecret | null> {
    const record = await this.findRecord(ownerId, siteKey);
    return record ? this.mapper.toSecret(record, this.cipher) : null;
  }

  async save(
    ownerId: string,
    input: SaveMediaSiteAuthInput,
  ): Promise<MediaSiteAuth> {
    const cookie = this.encryptCookie(input);
    const body = this.mapper.toRecord(ownerId, input, cookie);

    const existing = await this.findRecord(ownerId, input.siteKey);
    const record = existing
      ? await this.collection.update(existing.id, body)
      : await this.collection.create(body);
    return this.mapper.toDomain(record);
  }

  async setStatus(
    ownerId: string,
    siteKey: string,
    status: MediaSiteAuthStatus,
    accountLabel?: string,
  ): Promise<void> {
    const existing = await this.findRecord(ownerId, siteKey);
    // A verification result for a login that was removed meanwhile has nothing
    // to record; it is not an error the caller of a probe should see.
    if (!existing) return;

    const body: Record<string, unknown> = {
      status,
      lastCheckedAt: new Date().toISOString(),
    };
    if (accountLabel !== undefined) body.accountLabel = accountLabel;
    await this.collection.update(existing.id, body);
  }

  async touch(ownerId: string, siteKey: string): Promise<void> {
    const existing = await this.findRecord(ownerId, siteKey);
    if (!existing) return;
    await this.collection.update(existing.id, {
      lastUsedAt: new Date().toISOString(),
    });
  }

  async remove(ownerId: string, siteKey: string): Promise<void> {
    const existing = await this.findRecord(ownerId, siteKey);
    if (!existing) return;
    try {
      await this.collection.delete(existing.id);
    } catch (error) {
      // Lost a race against another remove: the login is gone either way.
      if (!this.isNotFound(error)) throw error;
    }
  }

  /**
   * The three stored parts for a `cookies-file` login, `null` for a browser
   * login. A `cookies-file` login without cookie text is a caller bug: saving it
   * as "connected but empty" would fail every download with a login error and
   * hide the real cause.
   */
  private encryptCookie(
    input: SaveMediaSiteAuthInput,
  ): EncryptedCookieFields | null {
    if (input.authMethod !== "cookies-file") return null;
    const cookieText = input.cookieText ?? "";
    if (cookieText === "") {
      throw new Error("A cookies-file media login needs the cookie text");
    }
    const encrypted = this.cipher.encrypt(cookieText);
    return {
      ciphertext: encrypted.ciphertext,
      nonce: encrypted.nonce,
      tag: encrypted.tag,
    };
  }

  private async findRecord(
    ownerId: string,
    siteKey: string,
  ): Promise<RecordModel | null> {
    try {
      return await this.collection.getFirstListItem(
        `${ownerFilter(ownerId)} && siteKey = "${escapeFilterValue(siteKey)}"`,
      );
    } catch (error) {
      if (this.isNotFound(error)) return null;
      throw error;
    }
  }

  private isNotFound(error: unknown): boolean {
    const pb = getPocketBaseClient();
    return pb.isClientResponseError(error) && error.status === 404;
  }
}

/** Every read is scoped to the verified owner, not only by the collection rule. */
function ownerFilter(ownerId: string): string {
  return `ownerId = "${escapeFilterValue(ownerId)}"`;
}

/**
 * Escapes a value for a PocketBase filter string.
 *
 * The owner id comes from a verified token and the site key from the fixed site
 * catalog, so neither normally carries a quote; escaping keeps a hand-edited
 * record or a future caller from turning a filter into a different query all the
 * same.
 */
function escapeFilterValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
