// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The reading position of one PDF node, remembered across mounts.
 *
 * It lives in `localStorage` rather than on the node's `content` because
 * `PdfContent` is the server-owned, shared document shape (url, cover, ink) and a
 * reading position is per reader: putting it on the content would send one
 * person's page to everyone who opens the node, and would need a schema and
 * backend change to carry a purely local preference. The key carries the user
 * *and* the node, so two readers sharing a browser never inherit each other's
 * page, and the namespace is versioned so a future shape can be told apart from
 * this one.
 *
 * Storage is always best-effort: private browsing, a quota error or a malformed
 * value answers `null`, which the viewer reads as "start at page 1".
 */

/** Namespace and version of the per-user, per-node reading position. */
const STORAGE_PREFIX = "dbrain:pdf:progress:v1:";

/**
 * The stored 1-based page for `key`, or `null` when there is none that can be
 * trusted. Anything that is not a whole page number is treated as absent rather
 * than clamped, so a half-written value cannot silently open at page 1 *and*
 * overwrite whatever a later write would have recovered.
 */
export function readPdfProgress(key: string): number | null {
  if (!key) return null;
  try {
    const raw = localStorage.getItem(`${STORAGE_PREFIX}${key}`);
    if (raw === null) return null;
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
      return null;
    }
    return value;
  } catch {
    // Private browsing, storage quota and invalid JSON must leave the document
    // readable at its first page.
    return null;
  }
}

/** Remembers `page` as the reading position for `key`; a no-op without storage. */
export function writePdfProgress(key: string, page: number): void {
  if (!key || !Number.isInteger(page) || page < 1) return;
  try {
    localStorage.setItem(`${STORAGE_PREFIX}${key}`, JSON.stringify(page));
  } catch {
    // The position is optional; reading remains available without storage.
  }
}
