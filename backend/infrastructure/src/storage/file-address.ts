// SPDX-License-Identifier: AGPL-3.0-only

/** `/api/files/<collection>/<record>/<filename>` — nothing else is allowed. */
const FILE_PATH_PATTERN = /^\/api\/files\/[A-Za-z0-9_]+\/[A-Za-z0-9]+\/[^/]+$/;

/** Index of the record id in a split file path (`/api/files/<collection>/<id>/<name>`). */
const RECORD_ID_SEGMENT = 4;

/**
 * Record id of the stored file an address points at.
 *
 * The address is validated by {@link toFileEndpointPath} first, so the result
 * always names a record of this store's own `files` endpoint. Callers use it to
 * address the resource row a blob belongs to (caching its analysis, marking a
 * derived artifact as such).
 */
export function recordIdFromFileUrl(fileUrl: string): string {
  return toFileEndpointPath(fileUrl).split("/")[RECORD_ID_SEGMENT]!;
}

export function toFileEndpointPath(fileUrl: string): string {
  let pathname: string;
  try {
    pathname = new URL(fileUrl, "http://pocketbase.invalid").pathname;
  } catch {
    throw new Error(`Not a usable file address: ${fileUrl}`);
  }

  pathname = pathname
    .replace(/^\/pb(?=\/api\/files\/)/, "")
    .replace(/^\/session\/[a-f0-9]+(?=\/api\/files\/)/, "");
  if (!FILE_PATH_PATTERN.test(pathname)) {
    throw new Error(`Refusing to fetch a non file-store address: ${fileUrl}`);
  }
  return pathname;
}
