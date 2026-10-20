// SPDX-License-Identifier: AGPL-3.0-only

/** Only the native WebView and the documented development frontend can reach the gateway. */
const origins = new Set([
  "tauri://localhost", "http://tauri.localhost", "https://tauri.localhost",
  "http://localhost:3002", "http://127.0.0.1:3002",
]);
export function allowedOrigin(origin?: string): boolean {
  return origin === undefined || origins.has(origin);
}
export function sessionPath(url: string, secret: string): string | undefined {
  const prefix = `/session/${secret}`;
  if (!url.startsWith(`${prefix}/`)) return undefined;
  return url.slice(prefix.length);
}

/** `GET`/`HEAD` on one stored blob: media elements, downloads, PDF and HLS reads. */
const FILE_READ = /^\/api\/files\/[a-zA-Z0-9_]+\/[a-zA-Z0-9]+\/[^/]+$/;

/**
 * The `files` collection, which the resource library manages.
 *
 * Listing, renaming and deleting a resource all happen on the record itself, so
 * the gateway has to admit those methods on this one collection. The boundary is
 * still the collection: PocketBase's own rules decide which rows a caller may
 * see or change, and every request below is forwarded with the caller's verified
 * token, so this cannot become an open proxy to the administration API.
 */
const FILES_COLLECTION = "/api/collections/files/records";
const FILES_RECORD = /^\/api\/collections\/files\/records\/[a-zA-Z0-9]+$/;

export function allowedFileRequest(path: string, method?: string): boolean {
  const pathname = path.split("?")[0] ?? "";
  if ((method === "GET" || method === "HEAD") && FILE_READ.test(pathname)) {
    return true;
  }
  if (pathname === FILES_COLLECTION) {
    // `GET` lists the resources the collection rules expose; `POST` is the
    // direct upload.
    return method === "GET" || method === "POST";
  }
  if (FILES_RECORD.test(pathname)) {
    // `PATCH` renames the label, `DELETE` removes the record and its bytes.
    return method === "GET" || method === "PATCH" || method === "DELETE";
  }
  return false;
}
