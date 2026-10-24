// SPDX-License-Identifier: AGPL-3.0-only

// Storage policy for uploads into the `files` collection.
//
// This module is the server-side enforcement of the contract in
// `packages/utils/src/storage-limits.ts`. PocketBase hooks run in a Go-hosted
// JavaScript runtime, so the module cannot import the TypeScript source; it
// repeats the defaults, the category table and the MIME table, and
// `scripts/release/storage-limits-hook.test.mjs` compares the two copies so a
// change on one side cannot silently pass.
//
// The hook is the authoritative enforcement for both upload transports:
//   * a small file is POSTed straight to PocketBase by the browser;
//   * a large file is assembled by the API and stored by it through this same
//     collection-create path.
// The API also checks the category ceiling before it spools any chunk, but only
// this hook sees every write, including the derived artifacts (PDF covers, HLS
// segments and playlists) that the API creates while it packages a file.
//
// An owner may also replace the stored blob in place (same record id) — the
// Excalidraw save rewrites its preview that way. That path is
// `enforceFileUpdate`: it recomputes the metadata from the replacement and
// charges only the difference against the quota.

var MIB = 1024 * 1024;
var GIB = 1024 * 1024 * 1024;

// Keep equal to DEFAULT_STORAGE_LIMITS in packages/utils/src/storage-limits.ts.
var DEFAULT_LIMITS = {
  userQuotaBytes: 10 * GIB,
  maxFileBytes: {
    image: 32 * MIB,
    video: 2 * GIB,
    audio: 512 * MIB,
    pdf: 512 * MIB,
    webpage: 16 * MIB,
    other: 256 * MIB,
  },
};

var QUOTA_ENV = "DBRAINX_STORAGE_USER_QUOTA_BYTES";
var CATEGORY_ENV = {
  image: "DBRAINX_STORAGE_MAX_IMAGE_BYTES",
  video: "DBRAINX_STORAGE_MAX_VIDEO_BYTES",
  audio: "DBRAINX_STORAGE_MAX_AUDIO_BYTES",
  pdf: "DBRAINX_STORAGE_MAX_PDF_BYTES",
  webpage: "DBRAINX_STORAGE_MAX_WEBPAGE_BYTES",
  other: "DBRAINX_STORAGE_MAX_OTHER_BYTES",
};

// Extension → category. Keep equal to CATEGORY_EXTENSIONS in the TypeScript
// contract; the comparison test walks every entry.
var CATEGORY_EXTENSIONS = {
  image: ["png", "jpg", "jpeg", "gif", "webp", "avif", "bmp", "svg", "ico", "heic", "heif", "tif", "tiff"],
  video: ["mp4", "m4v", "mov", "webm", "mkv", "avi", "mpg", "mpeg", "ogv", "3gp", "ts", "m3u8"],
  audio: ["mp3", "wav", "ogg", "oga", "flac", "m4a", "aac", "opus", "wma", "aiff", "aif"],
  pdf: ["pdf"],
  webpage: ["html", "htm", "xhtml"],
};

// Extension → MIME type, used only to fill the stored `mimeType` field. An
// unknown extension stays binary, and the library's category falls back to the
// name exactly as it does in the browser.
var MIME_TYPES = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  bmp: "image/bmp",
  svg: "image/svg+xml",
  ico: "image/x-icon",
  heic: "image/heic",
  heif: "image/heif",
  tif: "image/tiff",
  tiff: "image/tiff",
  mp4: "video/mp4",
  m4v: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
  mkv: "video/x-matroska",
  avi: "video/x-msvideo",
  mpg: "video/mpeg",
  mpeg: "video/mpeg",
  ogv: "video/ogg",
  "3gp": "video/3gpp",
  ts: "video/mp2t",
  m3u8: "application/vnd.apple.mpegurl",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  oga: "audio/ogg",
  flac: "audio/flac",
  m4a: "audio/mp4",
  aac: "audio/aac",
  opus: "audio/opus",
  wma: "audio/x-ms-wma",
  aiff: "audio/aiff",
  aif: "audio/aiff",
  pdf: "application/pdf",
  html: "text/html",
  htm: "text/html",
  xhtml: "application/xhtml+xml",
};

var EXTENSION_CATEGORY = {};
for (var category in CATEGORY_EXTENSIONS) {
  var extensions = CATEGORY_EXTENSIONS[category];
  for (var index = 0; index < extensions.length; index += 1) {
    EXTENSION_CATEGORY[extensions[index]] = category;
  }
}

function fileExtension(fileName) {
  var name = String(fileName || "");
  var dot = name.lastIndexOf(".");
  if (dot <= 0 || dot === name.length - 1) return "";
  return name.slice(dot + 1).toLowerCase();
}

function categoryForName(fileName) {
  return EXTENSION_CATEGORY[fileExtension(fileName)] || "other";
}

function mimeTypeForName(fileName) {
  return MIME_TYPES[fileExtension(fileName)] || "application/octet-stream";
}

// Reads one integer out of the environment. A typo falls back to the default
// instead of throwing: PocketBase must still boot with a malformed `.env`.
function readBytes(value, fallback, allowZero) {
  if (value === undefined || value === null) return fallback;
  var trimmed = String(value).trim();
  if (trimmed === "") return fallback;
  var bytes = Number(trimmed);
  if (!isFinite(bytes) || Math.floor(bytes) !== bytes) return fallback;
  if (bytes === 0) return allowZero ? 0 : fallback;
  if (bytes < 0 || !isFinite(bytes) || bytes > Number.MAX_SAFE_INTEGER) return fallback;
  return bytes;
}

// The effective limits. `getenv` is a parameter so the comparison test can run
// this module without a PocketBase runtime; the hook calls it with the real
// `$os.getenv`.
function resolveLimits(getenv) {
  var read = getenv || (typeof $os !== "undefined" ? function (name) { return $os.getenv(name); } : function () { return undefined; });
  return {
    userQuotaBytes: readBytes(read(QUOTA_ENV), DEFAULT_LIMITS.userQuotaBytes, true),
    maxFileBytes: {
      image: readBytes(read(CATEGORY_ENV.image), DEFAULT_LIMITS.maxFileBytes.image, false),
      video: readBytes(read(CATEGORY_ENV.video), DEFAULT_LIMITS.maxFileBytes.video, false),
      audio: readBytes(read(CATEGORY_ENV.audio), DEFAULT_LIMITS.maxFileBytes.audio, false),
      pdf: readBytes(read(CATEGORY_ENV.pdf), DEFAULT_LIMITS.maxFileBytes.pdf, false),
      webpage: readBytes(read(CATEGORY_ENV.webpage), DEFAULT_LIMITS.maxFileBytes.webpage, false),
      other: readBytes(read(CATEGORY_ENV.other), DEFAULT_LIMITS.maxFileBytes.other, false),
    },
  };
}

// Adds the record's stored byte length to one running total.
function recordSize(record) {
  var size = record.getFloat("size");
  return typeof size === "number" && size > 0 ? size : 0;
}

// Applies the category ceiling to one upload and totals its byte length.
// `firstName` is the name the upload was sent under (PocketBase stores the blob
// under a randomized name), so the caller can default the display label.
function measureIncoming(files, limits) {
  var incoming = 0;
  var firstName = "";
  var firstMime = "";

  for (var index = 0; index < files.length; index += 1) {
    var file = files[index];
    if (!file) continue;
    var name = file.originalName || file.name || "";
    if (!firstName) {
      firstName = name;
      firstMime = mimeTypeForName(name);
    }
    var category = categoryForName(name);
    var ceiling = limits.maxFileBytes[category];
    if (typeof file.size === "number" && file.size > ceiling) {
      throw new BadRequestError(
        "The file is " + file.size + " bytes; the " + category + " limit is " + ceiling,
      );
    }
    if (typeof file.size === "number" && file.size > 0) incoming += file.size;
  }

  return { bytes: incoming, firstName: firstName, mimeType: firstMime };
}

// The stored byte length of every record the owner has.
function storedBytesForOwner(e, ownerId) {
  var existing = e.app.findRecordsByFilter(
    "files",
    "ownerId = {:owner}",
    "",
    0,
    0,
    { owner: ownerId },
  );
  var used = 0;
  for (var existingIndex = 0; existingIndex < existing.length; existingIndex += 1) {
    used += recordSize(existing[existingIndex]);
  }
  return used;
}

// Enforces the category ceiling and the per-user quota, then stamps the
// server-owned metadata. Runs for every create request on `files`, which covers
// the direct browser upload and the API's own store writes alike.
function enforceFileCreate(e) {
  if (!e.auth) throw new UnauthorizedError("Authentication required");
  var ownerId = e.auth.id;
  e.record.set("ownerId", ownerId);

  var limits = resolveLimits();
  var files = e.record.getUnsavedFiles("file") || [];
  var measured = measureIncoming(files, limits);

  e.record.set("size", measured.bytes);
  if (!e.record.getString("mimeType")) e.record.set("mimeType", measured.mimeType);
  if (!e.record.getString("displayName") && measured.firstName) {
    e.record.set("displayName", measured.firstName);
  }

  if (limits.userQuotaBytes > 0 && measured.bytes > 0) {
    var used = storedBytesForOwner(e, ownerId);
    if (used + measured.bytes > limits.userQuotaBytes) {
      throw new BadRequestError(
        "Storage quota exceeded: " + (used + measured.bytes) + " of " + limits.userQuotaBytes + " bytes",
      );
    }
  }

  return e.next();
}

// Enforces the same policy when an update replaces the stored blob in place.
//
// The record id and the owner stay the same; only the bytes change. That makes
// the quota a delta: the bytes already charged for this record are removed from
// the owner's total before the replacement is added, so a replacement can never
// pass by counting the record against itself.
//
// An update that carries no new file (a rename, the analysis cache) is left
// untouched: the rule pins the fields that make up the file payload, and the
// request body cannot set `size` or `mimeType`.
function enforceFileUpdate(e) {
  if (!e.auth) throw new UnauthorizedError("Authentication required");
  var files = e.record.getUnsavedFiles("file") || [];
  if (!files.length) return e.next();

  var original = typeof e.record.original === "function" ? e.record.original() : e.record;
  var ownerId = original.getString("ownerId") || e.record.getString("ownerId");
  var previousSize = recordSize(original);
  var limits = resolveLimits();
  var measured = measureIncoming(files, limits);

  // The replacement decides the stored metadata, exactly like a create.
  e.record.set("size", measured.bytes);
  e.record.set("mimeType", measured.mimeType);
  if (!e.record.getString("displayName") && measured.firstName) {
    e.record.set("displayName", measured.firstName);
  }

  if (limits.userQuotaBytes > 0 && measured.bytes > 0 && ownerId) {
    var usedOther = storedBytesForOwner(e, ownerId) - previousSize;
    if (usedOther < 0) usedOther = 0;
    if (usedOther + measured.bytes > limits.userQuotaBytes) {
      throw new BadRequestError(
        "Storage quota exceeded: " + (usedOther + measured.bytes) + " of " + limits.userQuotaBytes + " bytes",
      );
    }
  }

  return e.next();
}

module.exports = {
  DEFAULT_LIMITS: DEFAULT_LIMITS,
  CATEGORY_EXTENSIONS: CATEGORY_EXTENSIONS,
  MIME_TYPES: MIME_TYPES,
  categoryForName: categoryForName,
  fileExtension: fileExtension,
  mimeTypeForName: mimeTypeForName,
  resolveLimits: resolveLimits,
  enforceFileCreate: enforceFileCreate,
  enforceFileUpdate: enforceFileUpdate,
};
