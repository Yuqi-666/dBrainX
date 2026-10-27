// SPDX-License-Identifier: AGPL-3.0-only

/// <reference path="../pb_data/types.d.ts" />

// A web page node used to keep its whole document in the `nodes.content` JSON
// column, which is why `0000000006_node_content_size.js` had to raise that
// column's ceiling. The node now references a stored blob like a PDF node does:
//
//   * the blob lives in the `files` collection (the same object store every
//     upload lands in, so the resource library lists it and the quota counts it)
//   * `content` holds the stored address `/api/files/files/<record>/<name>`
//   * `fileSize` holds the byte length
//
// This migration converts the records the old shape wrote, so an existing page
// keeps opening after the upgrade instead of reading its address as empty.
// Records that already hold an address (a fresh install has none) are left
// alone, which makes the migration safe to run on a database that a newer build
// already touched.
//
// The record is written directly, not through the upload endpoint, so the hook
// that normally stamps `size` / `mimeType` / `displayName` and the owner does
// not run. The migration fills the same fields itself: the workspace owner is
// the closest thing to "the user who imported the page", and a page with no
// workspace falls back to the only user of a one-user database.
//
// The migration is one-way. The reverse would have to read every blob back into
// a JSON column the node no longer writes, and by then the address may name a
// resource the user uploaded through the library — restoring that resource
// inline would take its bytes out of the library. A downgrade therefore leaves
// the blobs in place and this step does nothing.

// The retired model stored a highlight language beside the source. The new model
// reads the language from the stored file name, so the migration has to choose
// the extension the name carries; an unknown language falls back to HTML below.
const LANGUAGE_EXTENSIONS = {
  html: "html",
  htm: "html",
  xhtml: "xhtml",
  css: "css",
  scss: "scss",
  less: "less",
  js: "js",
  mjs: "js",
  cjs: "js",
  jsx: "jsx",
  ts: "ts",
  tsx: "tsx",
  json: "json",
  jsonc: "json",
  md: "md",
  markdown: "md",
  xml: "xml",
  svg: "svg",
  sql: "sql",
  py: "py",
  txt: "txt",
};
const EXTENSION_MIME_TYPES = {
  html: "text/html",
  xhtml: "application/xhtml+xml",
  css: "text/css",
  scss: "text/x-scss",
  less: "text/x-less",
  js: "text/javascript",
  jsx: "text/javascript",
  ts: "text/typescript",
  tsx: "text/typescript",
  json: "application/json",
  md: "text/markdown",
  xml: "application/xml",
  svg: "image/svg+xml",
  sql: "text/plain",
  py: "text/x-python",
  txt: "text/plain",
};
const DEFAULT_EXTENSION = "html";
const DEFAULT_MIME_TYPE = "text/html";
const STORED_URL = /\/api\/files\/[A-Za-z0-9_]+\/[A-Za-z0-9]+\//;

/** True for a `content` value that already names a stored file. */
function isStoredUrl(value) {
  return typeof value === "string" && STORED_URL.test(value);
}

/**
 * The inline source of a legacy webpage node.
 *
 * `getString` on this PocketBase JSON column returns the *serialized* JSON
 * text, not the decoded value: the column holds a JSON string, so the raw text
 * is `"<!doctype html>\n..."` with its quotes and escapes. Writing that text
 * itself into a file would store a quoted, backslash-escaped document, so the
 * raw value is parsed first. A raw value that does not parse as JSON string is
 * returned untouched, which keeps the migration working if a future runtime
 * starts returning the decoded value.
 */
function pageSource(node) {
  const raw = node.getString("content");
  if (!raw) return "";
  try {
    const value = JSON.parse(raw);
    return typeof value === "string" ? value : "";
  } catch (_) {
    return raw;
  }
}

/**
 * A stored name PocketBase accepts, derived from the node title and the
 * retired language field. The random suffix PocketBase appends keeps two nodes
 * with the same title from colliding.
 */
function resourceName(title, language) {
  const stem = String(title || "")
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 80);
  const extension =
    LANGUAGE_EXTENSIONS[String(language || "").toLowerCase()] ||
    DEFAULT_EXTENSION;
  return `${stem || "webpage"}.${extension}`;
}

/** The MIME type of the stored name, chosen with the extension. */
function resourceMimeType(language) {
  const extension =
    LANGUAGE_EXTENSIONS[String(language || "").toLowerCase()] ||
    DEFAULT_EXTENSION;
  return EXTENSION_MIME_TYPES[extension] || DEFAULT_MIME_TYPE;
}

/** The user that should own the stored blob of `node`. */
function resourceOwnerId(app, node) {
  const workspaceId = node.getString("workspaceId");
  if (workspaceId) {
    try {
      return app.findRecordById("workspaces", workspaceId).getString("ownerId");
    } catch (_) {
      // A node whose workspace is gone is still worth converting; fall through
      // to the single-user fallback below.
    }
  }
  const users = app.findRecordsByFilter("users", "", "", 2);
  return users.length === 1 ? users[0].id : "";
}

migrate(
  (app) => {
    const nodes = app.findRecordsByFilter(
      "nodes",
      "nodeType = {:type}",
      "",
      0,
      0,
      { type: "webpage" },
    );
    if (nodes.length === 0) return;

    const files = app.findCollectionByNameOrId("files");
    for (const node of nodes) {
      const source = pageSource(node);
      if (!source || isStoredUrl(source)) continue;

      const name = resourceName(
        node.getString("title"),
        node.getString("codeLanguage"),
      );
      const file = $filesystem.fileFromBytes(source, name);
      const record = new Record(files);
      record.set("file", file);
      record.set("size", file.size);
      record.set("mimeType", resourceMimeType(node.getString("codeLanguage")));
      record.set(
        "displayName",
        (node.getString("title") || "webpage").slice(0, 300),
      );
      const ownerId = resourceOwnerId(app, node);
      if (ownerId) record.set("ownerId", ownerId);
      record.set("workspaceId", node.getString("workspaceId"));
      app.save(record);

      node.set(
        "content",
        `/api/files/files/${record.id}/${record.getString("file")}`,
      );
      node.set("fileSize", file.size);
      // The language is read from the stored name now; the legacy column keeps
      // an empty value on converted records.
      node.set("codeLanguage", "");
      app.save(node);
    }
  },
  (app) => {
    // One-way, see the header: the blobs stay in the library and the node keeps
    // its address.
  },
);
