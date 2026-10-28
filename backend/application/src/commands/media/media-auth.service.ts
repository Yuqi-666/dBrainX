// SPDX-License-Identifier: AGPL-3.0-only

import type {
  IMediaBrowserDetector,
  IMediaProbe,
  IMediaSiteAuthRepository,
  IMediaSiteCatalog,
  MediaKind,
  MediaSiteAuth,
  MediaSiteDefinition,
} from "@workspace/domain";
// Source-path import for the same reason as the import service: the shared
// failure type comes from a dependency-free module and these services are
// exercised by Node's type-stripping test loader.
import { MediaImportFailure } from "../../../../../packages/utils/src/media-import.ts";
import {
  cookiesForSite,
  ignoredCookieDomains,
  parseCookieFile,
  serializeCookieFile,
} from "./cookie-file.ts";
import type {
  MediaBrowserDTO,
  MediaCookieImportDTO,
  MediaSiteDTO,
  MediaSitesDTO,
} from "./command";

/** Credentials one verification probe runs with. */
interface SiteCredentials {
  cookies?: string;
  cookiesFromBrowser?: string;
}

/**
 * Saved media-site logins and the site capsules.
 *
 * This service is the write half of the login panel: it lists the listed sites
 * with the owner's saved state, imports an exported `cookies.txt`, connects a
 * browser on a local backend, re-verifies a saved login, and forgets one. It
 * never returns a cookie to a client — only the non-secret state a capsule
 * needs.
 *
 * Every login is verified by probing the site's known public page. A successful
 * probe marks it `verified` and records the account name the site reported; a
 * failed one marks it `expired` but keeps the login, because the user can often
 * still re-export a fresh file without losing the connected state.
 */
export class MediaAuthService {
  /**
   * Plain field assignments rather than parameter properties: the co-located
   * test runs this module through Node's type-stripping loader (`node --test`),
   * which rejects TypeScript-only syntax that has a runtime effect.
   */
  private readonly sites: IMediaSiteCatalog;
  private readonly siteAuth: IMediaSiteAuthRepository;
  private readonly probe: IMediaProbe;
  private readonly browsers: IMediaBrowserDetector;
  private readonly browserLoginEnabled: boolean;

  constructor(
    sites: IMediaSiteCatalog,
    siteAuth: IMediaSiteAuthRepository,
    probe: IMediaProbe,
    browsers: IMediaBrowserDetector,
    options: { browserLoginEnabled: boolean },
  ) {
    this.sites = sites;
    this.siteAuth = siteAuth;
    this.probe = probe;
    this.browsers = browsers;
    this.browserLoginEnabled = options.browserLoginEnabled;
  }

  /** Every listed site with the owner's saved login, plus method A's browsers. */
  async list(ownerId: string, kind?: MediaKind): Promise<MediaSitesDTO> {
    const auths = await this.siteAuth.list(ownerId);
    const bySite = new Map(auths.map((auth) => [auth.siteKey, auth]));

    const sites = this.sites
      .list(kind)
      .map((site) => this.toSiteDTO(site, bySite.get(site.key) ?? null));

    return {
      sites,
      // A remote deployment cannot read the browser of the *user*; method A is
      // hidden there rather than shown and failing.
      browsers: this.browserLoginEnabled ? this.browserList() : [],
      browserLoginEnabled: this.browserLoginEnabled,
    };
  }

  /**
   * Imports an exported Netscape `cookies.txt`.
   *
   * The file is filtered per listed site first: a cookie for a domain outside
   * the catalog is dropped before anything is stored, and the dropped domains
   * are reported back. Each site's own file is saved and then verified, so the
   * capsules light up for the sites that actually work and name the ones whose
   * cookie is already stale.
   */
  async importCookies(
    ownerId: string,
    cookieText: string,
  ): Promise<MediaCookieImportDTO> {
    const cookies = parseCookieFile(cookieText);
    const allSites = this.sites.list();
    const ignoredDomains = ignoredCookieDomains(cookies, allSites);

    const connected: MediaSiteDTO[] = [];
    const failed: { siteKey: string; message: string }[] = [];

    for (const site of allSites) {
      const siteCookies = cookiesForSite(cookies, site);
      if (siteCookies.length === 0) continue;

      const siteCookieText = serializeCookieFile(siteCookies);
      await this.siteAuth.save(ownerId, {
        siteKey: site.key,
        authMethod: "cookies-file",
        status: "saved",
        cookieText: siteCookieText,
      });

      const outcome = await this.probeSite(ownerId, site, {
        cookies: siteCookieText,
      });
      connected.push(outcome.dto);
      if (!outcome.ok) {
        failed.push({ siteKey: site.key, message: outcome.message });
      }
    }

    return { connected, failed, ignoredDomains };
  }

  /**
   * Saves a browser login (method A) and verifies it.
   *
   * Only a local backend offers this, because yt-dlp reads the browser of the
   * machine the server runs on. The server stores only the browser's name; the
   * cookie itself is read at download time and never persisted.
   */
  async connectWithBrowser(
    ownerId: string,
    siteKey: string,
    browserName: string,
  ): Promise<MediaSiteDTO> {
    if (!this.browserLoginEnabled) {
      throw new MediaImportFailure(
        "unsupported_url",
        "This deployment cannot read a browser on the server",
      );
    }

    const site = this.sites.find(siteKey);
    if (!site) {
      throw new MediaImportFailure("unsupported_url", "Unknown media site");
    }

    const browser = browserName.trim();
    if (!this.browserList().some((option) => option.name === browser)) {
      throw new MediaImportFailure(
        "unsupported_url",
        "That browser is not available on the server",
      );
    }

    await this.siteAuth.save(ownerId, {
      siteKey: site.key,
      authMethod: "browser",
      browserName: browser,
      status: "saved",
    });

    const outcome = await this.probeSite(ownerId, site, {
      cookiesFromBrowser: browser,
    });
    return outcome.dto;
  }

  /**
   * Re-checks a saved login against the site's public page.
   *
   * Never throws for a failed check: the capsule state (`verified` / `expired`)
   * is the answer. An unknown site key is a client bug and does throw.
   */
  async verify(ownerId: string, siteKey: string): Promise<MediaSiteDTO> {
    const site = this.sites.find(siteKey);
    if (!site) {
      throw new MediaImportFailure("unsupported_url", "Unknown media site");
    }

    const auth = await this.siteAuth.find(ownerId, site.key);
    if (!auth) {
      // Nothing saved means there is nothing to verify; report the empty state
      // instead of probing anonymously and claiming the site is unreachable.
      return this.toSiteDTO(site, null);
    }

    const outcome = await this.probeSite(
      ownerId,
      site,
      await this.credentials(ownerId, site, auth),
    );
    return outcome.dto;
  }

  /** Forgets the login of one site. Idempotent. */
  async disconnect(ownerId: string, siteKey: string): Promise<void> {
    await this.siteAuth.remove(ownerId, siteKey);
  }

  /** Probes one site's known page and persists the resulting status. */
  private async probeSite(
    ownerId: string,
    site: MediaSiteDefinition,
    credentials: SiteCredentials,
  ): Promise<{ ok: boolean; dto: MediaSiteDTO; message: string }> {
    try {
      const result = await this.probe.probe({
        url: site.probeUrl,
        kind: site.kinds[0] ?? "video",
        cookies: credentials.cookies,
        cookiesFromBrowser: credentials.cookiesFromBrowser,
      });
      const accountLabel = (result.artist || result.title || "").trim();
      await this.siteAuth
        .setStatus(ownerId, site.key, "verified", accountLabel)
        .catch(() => undefined);
      const saved = await this.siteAuth.find(ownerId, site.key);
      return { ok: true, dto: this.toSiteDTO(site, saved), message: "" };
    } catch (error) {
      const failure =
        error instanceof MediaImportFailure
          ? error
          : new MediaImportFailure("unknown", String(error));
      await this.siteAuth
        .setStatus(ownerId, site.key, "expired")
        .catch(() => undefined);
      const saved = await this.siteAuth.find(ownerId, site.key);
      return {
        ok: false,
        dto: this.toSiteDTO(site, saved),
        // The failure text may carry a temporary path or a site response;
        // collapse it to one bounded sentence before it reaches the client.
        message: oneLineMessage(failure.message) || "Verification failed",
      };
    }
  }

  /** Credentials used to probe a saved login. */
  private async credentials(
    ownerId: string,
    site: MediaSiteDefinition,
    auth: MediaSiteAuth,
  ): Promise<SiteCredentials> {
    if (auth.authMethod === "browser") {
      return { cookiesFromBrowser: auth.browserName };
    }
    const secret = await this.siteAuth.readSecret(ownerId, site.key);
    return secret ? { cookies: secret.cookieText } : {};
  }

  /** Detected browsers, in the DTO shape the panel renders. */
  private browserList(): MediaBrowserDTO[] {
    return this.browsers.list().map((browser) => ({
      name: browser.name,
      label: browser.label,
    }));
  }

  /** Maps one listed site and the owner's saved login onto the client DTO. */
  private toSiteDTO(
    site: MediaSiteDefinition,
    auth: MediaSiteAuth | null,
  ): MediaSiteDTO {
    return {
      key: site.key,
      name: site.name,
      kinds: site.kinds,
      hosts: site.hosts,
      loginHint: site.loginHint,
      loggedIn: auth !== null,
      authMethod: auth?.authMethod ?? null,
      browserName: auth?.browserName ?? "",
      accountLabel: auth?.accountLabel ?? "",
      status: auth?.status ?? "saved",
      lastCheckedAt: auth?.lastCheckedAt ?? "",
    };
  }
}

/** Collapses a failure message onto one bounded line. */
function oneLineMessage(message: string): string {
  return message
    .replace(/[\r\n\t]+/g, " ")
    .trim()
    .slice(0, 300);
}
