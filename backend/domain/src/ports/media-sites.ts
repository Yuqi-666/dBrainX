// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Media sites the import flow knows by name.
 *
 * A pasted address is turned into a downloaded file by yt-dlp, which supports
 * far more sites than this product shows. The UI needs a short, stable list:
 * one capsule per site, one saved login per site. This module owns that list.
 *
 * Two kinds share the same catalog. A video node imports from the five video
 * sites, an audio node from the three music sites, and both use the same login
 * storage: one exported `cookies.txt` can carry several sites at once, so the
 * capsule state must be shared rather than duplicated per kind.
 *
 * An address that matches none of the listed sites still imports — the site is
 * simply not shown as a capsule. Refusing it would hide a working yt-dlp site
 * for no user-visible reason.
 */

import type { MediaKind } from "@workspace/interfaces";

/** The media a node holds; also which site list a dialog shows. */
export type { MediaKind };

/** One listed site: its key, its display name, and the hosts it owns. */
export interface MediaSiteDefinition {
  /** Stable key stored with a saved login, e.g. `bilibili`. */
  key: string;
  /** Display name, e.g. 「B 站」. */
  name: string;
  /** Kinds this site can provide. */
  kinds: MediaKind[];
  /**
   * Lowercase host suffixes matched against a pasted address, e.g.
   * [`bilibili.com`, `b23.tv`]. A host matches when it equals an entry or ends
   * with `.` + an entry, so `www.bilibili.com` and `b23.tv` both match.
   */
  hosts: string[];
  /** One line explaining what a login unlocks, shown in the login panel. */
  loginHint: string;
  /** Page used to verify a saved login; must be public enough to answer. */
  probeUrl: string;
}

/**
 * The one catalog both the media import and the login panel read.
 *
 * The catalog is static configuration, not state, which is why this is a port
 * and not a repository: an implementation only needs to know the list and how
 * to match a URL against it.
 */
export interface IMediaSiteCatalog {
  /** Every site of one kind (or every site when `kind` is omitted). */
  list(kind?: MediaKind): MediaSiteDefinition[];
  /** The site a pasted address belongs to, or `null` for an unlisted site. */
  match(url: string): MediaSiteDefinition | null;
  /** The site with this key, or `null` when the key is unknown. */
  find(key: string): MediaSiteDefinition | null;
}
