// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Storage accounting contract shared by the browser, the API and PocketBase.
 *
 * One uploaded blob is classified into one of six categories. Each category has
 * a single-file ceiling, and the owner of the blob has one total quota that
 * counts every blob they stored (originals, PDF covers, HLS segments and
 * playlists alike). The defaults below are what a deployment gets without any
 * environment variable; the operator can override every one of them through the
 * root `.env` file, and `resolveStorageLimits` translates an environment record
 * into this shape.
 *
 * The values are runtime constants, not types, so they live in
 * `@workspace/utils` like the upload contract: the client, the API and the
 * PocketBase hook all read this module (the hook carries a JavaScript copy that
 * `scripts/release/storage-limits-hook.test.mjs` keeps identical), so a single
 * edit cannot make two sides disagree.
 */

/** Category one stored blob is accounted under. */
export type StorageCategory =
  | "image"
  | "video"
  | "audio"
  | "pdf"
  | "webpage"
  | "other";

/** Every category, in the order the management UI shows them. */
export const STORAGE_CATEGORIES: readonly StorageCategory[] = [
  "image",
  "video",
  "audio",
  "pdf",
  "webpage",
  "other",
];

/** Limits the server enforces and the clients display. */
export interface StorageLimits {
  /**
   * Total bytes one user may store across every workspace, counting every
   * record the file store owns. `0` disables the quota (only the per-file
   * ceilings remain).
   */
  userQuotaBytes: number;
  /** Largest single blob per category, in bytes. Always positive. */
  maxFileBytes: Record<StorageCategory, number>;
}

/** One mebibyte, the unit the defaults are written in. */
const MIB = 1024 ** 2;
/** One gibibyte. */
const GIB = 1024 ** 3;

/**
 * The built-in limits, applied when the matching environment variable is absent
 * or invalid.
 *
 * The video ceiling equals the pipeline ceiling ({@link MAX_UPLOAD_BYTES}): the
 * resumable path already refuses a bigger file, and a lower default would make
 * an upload that the transport can carry fail for a policy reason nobody set.
 * The total quota is deliberately generous — it exists so one account cannot
 * fill the host disk, not to ration space on a personal deployment.
 */
export const DEFAULT_STORAGE_LIMITS: StorageLimits = {
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

/** Environment variable holding the per-user total quota. */
export const STORAGE_QUOTA_ENV = "DBRAIN_STORAGE_USER_QUOTA_BYTES";

/** Environment variable holding the single-file ceiling of each category. */
export const STORAGE_CATEGORY_ENV: Record<StorageCategory, string> = {
  image: "DBRAIN_STORAGE_MAX_IMAGE_BYTES",
  video: "DBRAIN_STORAGE_MAX_VIDEO_BYTES",
  audio: "DBRAIN_STORAGE_MAX_AUDIO_BYTES",
  pdf: "DBRAIN_STORAGE_MAX_PDF_BYTES",
  webpage: "DBRAIN_STORAGE_MAX_WEBPAGE_BYTES",
  other: "DBRAIN_STORAGE_MAX_OTHER_BYTES",
};

/** File extensions per category. Lower case, no leading dot. */
const CATEGORY_EXTENSIONS: Record<
  Exclude<StorageCategory, "other">,
  string[]
> = {
  image: [
    "png",
    "jpg",
    "jpeg",
    "gif",
    "webp",
    "avif",
    "bmp",
    "svg",
    "ico",
    "heic",
    "heif",
    "tif",
    "tiff",
  ],
  video: [
    "mp4",
    "m4v",
    "mov",
    "webm",
    "mkv",
    "avi",
    "mpg",
    "mpeg",
    "ogv",
    "3gp",
    "ts",
    "m3u8",
  ],
  audio: [
    "mp3",
    "wav",
    "ogg",
    "oga",
    "flac",
    "m4a",
    "aac",
    "opus",
    "wma",
    "aiff",
    "aif",
  ],
  pdf: ["pdf"],
  webpage: ["html", "htm", "xhtml"],
};

/** Reverse lookup: extension → category. Built once, at module load. */
const EXTENSION_CATEGORY = new Map<string, Exclude<StorageCategory, "other">>();
for (const category of Object.keys(CATEGORY_EXTENSIONS) as Array<
  Exclude<StorageCategory, "other">
>) {
  for (const extension of CATEGORY_EXTENSIONS[category]) {
    EXTENSION_CATEGORY.set(extension, category);
  }
}

/** The lower-case extension of a file name, or an empty string. */
export function fileExtension(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  if (dot <= 0 || dot === fileName.length - 1) return "";
  return fileName.slice(dot + 1).toLowerCase();
}

/**
 * Category of one stored blob.
 *
 * The MIME type wins when the browser reported a usable one, because a
 * mislabelled extension is common (`.bin`, an OCR-scanned PDF saved as `.dat`)
 * while the reported type is usually right. The name is the fallback, and it is
 * the only input PocketBase's hook has, so both paths must agree for a normally
 * named file.
 */
export function storageCategoryFor(
  fileName: string,
  mimeType?: string | null,
): StorageCategory {
  const mime = (mimeType ?? "").trim().toLowerCase();
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  if (mime === "application/pdf" || mime === "application/x-pdf") return "pdf";
  if (mime === "text/html" || mime === "application/xhtml+xml")
    return "webpage";

  return EXTENSION_CATEGORY.get(fileExtension(fileName)) ?? "other";
}

/**
 * Parses one positive integer out of an environment record.
 *
 * Invalid input falls back to `fallback` instead of throwing: a typo in `.env`
 * must not stop the server from booting, and the alternative — silently
 * accepting a negative or fractional byte count — would let a misconfiguration
 * restrict storage in a way nobody intended. `allowZero` admits the `0`
 * "unlimited" sentinel the quota understands.
 */
function readBytes(
  value: string | undefined,
  fallback: number,
  options: { allowZero: boolean },
): number {
  if (value === undefined) return fallback;
  const trimmed = value.trim();
  if (trimmed === "") return fallback;

  const bytes = Number(trimmed);
  if (!Number.isSafeInteger(bytes)) return fallback;
  if (bytes === 0) return options.allowZero ? 0 : fallback;
  return bytes > 0 ? bytes : fallback;
}

/**
 * Resolves the effective limits from an environment record.
 *
 * Both browsers and the server call this: the server with `process.env`, the
 * management UI with whatever the server reported. Unknown or invalid values
 * fall back to {@link DEFAULT_STORAGE_LIMITS}, so the returned limits are always
 * usable.
 */
export function resolveStorageLimits(
  env: Record<string, string | undefined>,
  defaults: StorageLimits = DEFAULT_STORAGE_LIMITS,
): StorageLimits {
  const resolveCategory = (category: StorageCategory): number =>
    readBytes(
      env[STORAGE_CATEGORY_ENV[category]],
      defaults.maxFileBytes[category],
      {
        allowZero: false,
      },
    );

  return {
    userQuotaBytes: readBytes(env[STORAGE_QUOTA_ENV], defaults.userQuotaBytes, {
      allowZero: true,
    }),
    maxFileBytes: {
      image: resolveCategory("image"),
      video: resolveCategory("video"),
      audio: resolveCategory("audio"),
      pdf: resolveCategory("pdf"),
      webpage: resolveCategory("webpage"),
      other: resolveCategory("other"),
    },
  };
}

/** The single-file ceiling that applies to one blob. */
export function maxFileBytesFor(
  limits: StorageLimits,
  fileName: string,
  mimeType?: string | null,
): number {
  return limits.maxFileBytes[storageCategoryFor(fileName, mimeType)];
}

/**
 * Bytes still available under the quota, or `null` when it is unlimited or the
 * caller already stored more than the quota allows.
 */
export function remainingQuotaBytes(
  limits: StorageLimits,
  usedBytes: number,
): number | null {
  if (limits.userQuotaBytes <= 0) return null;
  return Math.max(0, limits.userQuotaBytes - usedBytes);
}
