// SPDX-License-Identifier: AGPL-3.0-only

import { useWorkspaceStore } from "@workspace/store";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

import type { IAttachment } from "@workspace/interfaces";
import {
  DIRECT_UPLOAD_MAX_BYTES,
  MAX_UPLOAD_BYTES,
  PDF_ANALYZE_MAX_BYTES,
} from "@workspace/utils/upload";
import { getPocketbaseClient } from "./pocketbase-client";
import { readAuthSessionToken } from "./auth/session";

/**
 * Size limits, re-exported from the frozen shared contract.
 *
 * `@workspace/ui` and the node editors import everything upload-related from
 * `@workspace/api-client`, so the transport switches and the PDF analysis cap
 * are surfaced here; the values themselves are never restated, or the browser
 * and the server could disagree about which request a file takes.
 */
export { DIRECT_UPLOAD_MAX_BYTES, MAX_UPLOAD_BYTES, PDF_ANALYZE_MAX_BYTES };

/**
 * PocketBase collection that every uploaded blob lands in.
 * Created by the `files` block in `pb/pb_migrations_base/0000000001_base_schema.js`.
 */
export const FILES_COLLECTION = "files";

/** Field name of the binary inside {@link FILES_COLLECTION}. */
export const FILES_FIELD = "file";

export interface FileItem {
  /**
   * Unique identifier for the file item
   */
  id: string;
  /**
   * The actual File object being uploaded
   */
  file: File;
  /**
   * Current upload progress as a percentage (0-100)
   */
  progress: number;
  /**
   * Current status of the file upload process
   * @default "uploading"
   */
  status: "uploading" | "success" | "error";

  /**
   * URL to the uploaded file, available after successful upload
   * @optional
   */
  url?: string;
  /**
   * Why the upload failed, as the server reported it.
   *
   * Kept on the item so the drop zone can show the reason next to the file
   * instead of a bare "upload failed": a rejected chunk, an interrupted
   * assembly and a file above the limit all end here, and only the message
   * tells them apart.
   * @optional
   */
  error?: string;
  /**
   * Controller that can be used to abort the upload process
   * @optional
   */
  abortController?: AbortController;
}

export interface UploadOptions {
  /**
   * Maximum allowed file size in bytes
   */
  maxSize: number;
  /**
   * Maximum number of files that can be uploaded
   */
  limit: number;
  /**
   * String specifying acceptable file types (MIME types or extensions)
   * @example ".jpg,.png,image/jpeg" or "image/*"
   */
  accept: string;
  /**
   * Stable identity for this upload list.
   *
   * When set, in-progress and finished items live in module-level state under
   * this key, so a component that unmounts (the edit dialog closing) and mounts
   * again (the dialog reopening) observes the same upload instead of an empty
   * list. Callers that mount more than one zone for the same entity must include
   * the variant in the key. Omit it to keep the list private to the hook
   * instance.
   * @optional
   */
  key?: string;
  /**
   * Function that handles the actual file upload process
   * @param {File} file - The file to be uploaded
   * @param {Function} onProgress - Callback function to report upload progress
   * @param {AbortSignal} signal - Signal that can be used to abort the upload
   * @returns {Promise<string>} Promise resolving to the URL of the uploaded file
   */
  upload: (
    file: File,
    onProgress: (event: { progress: number }) => void,
    signal: AbortSignal,
  ) => Promise<string>;
  /**
   * Callback triggered when a file is uploaded successfully
   * @param {string} url - URL of the successfully uploaded file
   * @param {File} file - The file that was uploaded (handy for per-file metadata)
   * @optional
   */
  onSuccess?: (url: string, file: File) => void;
  /**
   * Callback triggered when an error occurs during upload
   * @param {Error} error - The error that occurred
   * @optional
   */
  onError?: (error: Error) => void;
}

/**
 * Checks a file against an `<input accept>`-style pattern list.
 *
 * Supports the three syntaxes the browser accepts: extensions (`.png`),
 * wildcards (`image/*`) and concrete MIME types (`application/pdf`). Files whose
 * MIME type the browser could not determine fall back to extension matching;
 * when the caller only supplied MIME patterns we accept the file rather than
 * rejecting something we cannot classify.
 */
export function matchesAccept(file: File, accept?: string): boolean {
  const patterns = (accept ?? "")
    .split(",")
    .map((pattern) => pattern.trim().toLowerCase())
    .filter(Boolean);

  if (patterns.length === 0) return true;

  const name = file.name.toLowerCase();
  const type = (file.type || "").toLowerCase();

  const matches = (pattern: string): boolean => {
    if (pattern === "*" || pattern === "*/*") return true;
    if (pattern.startsWith(".")) return name.endsWith(pattern);
    if (pattern.endsWith("/*")) return type.startsWith(pattern.slice(0, -1));
    return type === pattern;
  };

  if (patterns.some(matches)) return true;

  if (!type) {
    // No usable MIME type: only extension patterns can give a verdict.
    const extensions = patterns.filter((pattern) => pattern.startsWith("."));
    return (
      extensions.length === 0 ||
      extensions.some((pattern) => name.endsWith(pattern))
    );
  }

  return false;
}

/** Only object URLs own their blob; PocketBase URLs must never be revoked. */
function revokeIfObjectUrl(url?: string): void {
  if (!url) return;
  if (!url.startsWith("blob:")) return;
  if (typeof URL === "undefined" || typeof URL.revokeObjectURL !== "function")
    return;
  URL.revokeObjectURL(url);
}

/**
 * Resolves a possibly-relative file path against the configured PocketBase
 * origin, so relative `/api/files/...` values written into node content keep
 * working even if the PocketBase port changes.
 *
 * Absolute URLs (`http:`, `https:`, `data:`, `blob:`) are returned untouched,
 * as is any path when the PocketBase client has not been initialised yet.
 */
export function resolveFileUrl(src?: string | null): string {
  if (!src) return "";
  if (/^[a-z][a-z0-9+.-]*:/i.test(src) || src.startsWith("//")) return src;

  let base = "";
  try {
    base = getPocketbaseClient().baseUrl;
  } catch {
    return src;
  }
  if (!base) return src;

  // Stored gateway paths must not duplicate /pb or retain an old desktop
  // session prefix when resolved against the active backend.
  const path = src
    .replace(/^\/pb(?=\/api\/files\/)/, "")
    .replace(/^\/session\/[a-f0-9]+(?=\/api\/files\/)/, "");
  return `${base.replace(/\/+$/, "")}${path.startsWith("/") ? "" : "/"}${path}`;
}

/**
 * Address of a stored blob, in the shape a client writes into node content.
 *
 * Exported because the resource library resolves the same address from a record
 * it read with the PocketBase list API; keeping one builder means a referenced
 * blob and a freshly uploaded one are addressed identically. A caller that
 * renders the URL must pass it through {@link resolveFileUrl}.
 */
export function buildUploadUrl(
  record: Record<string, unknown>,
  storedName: string,
): string {
  const pb = getPocketbaseClient();
  if (
    process.env.NEXT_PUBLIC_DBRAIN_PLATFORM === "desktop" ||
    process.env.NEXT_PUBLIC_DBRAIN_BACKEND_MODE === "same-origin"
  ) {
    return `/api/files/${record.collectionId || FILES_COLLECTION}/${record.id}/${storedName}`;
  }
  try {
    return pb.files.getUrl(record, storedName);
  } catch {
    const collection =
      (record.collectionId as string) ||
      (record.collectionName as string) ||
      FILES_COLLECTION;
    const id = String(record.id ?? "");
    if (!id || !storedName) return "";
    return `${pb.baseUrl.replace(/\/+$/, "")}/api/files/${collection}/${id}/${storedName}`;
  }
}

/** One multipart write against the PocketBase `files` collection. */
interface AttachmentWrite {
  /** Verb used in the error message and the abort reason. */
  kind: "Upload" | "Replace";
  method: "POST" | "PATCH";
  /** Path below the PocketBase base URL, e.g. `/api/collections/.../records/<id>`. */
  path: string;
  file: File;
  onProgress: (event: { progress: number }) => void;
  signal?: AbortSignal;
  /**
   * Extra multipart text fields. A create carries `workspaceId`; a replace
   * carries none, because the record keeps the workspace it was created in.
   */
  fields?: Record<string, string>;
  /**
   * Record id to report when the response omits one. A `PATCH` target already
   * names the record, so its id survives even a minimal response.
   */
  fallbackId?: string;
}

/**
 * Single-request write: the whole file in one XHR `POST` (create) or `PATCH`
 * (replace) to PocketBase.
 *
 * Implemented with `XMLHttpRequest` (instead of `pb.collection().create()` /
 * `.update()`) purely to get `upload.progress` events for the progress bar.
 * Both writers share this function so the form, the Authorization choice and
 * the response parsing cannot drift apart.
 */
const writeAttachment = (write: AttachmentWrite): Promise<IAttachment> => {
  const pb = getPocketbaseClient();
  const { kind, method, path, file, onProgress, signal, fields, fallbackId } =
    write;

  return new Promise<IAttachment>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error(`${kind} aborted`));
      return;
    }

    const xhr = new XMLHttpRequest();

    const onAbort = () => {
      xhr.abort();
      reject(new Error(`${kind} aborted`));
    };
    const cleanup = () => signal?.removeEventListener("abort", onAbort);

    signal?.addEventListener("abort", onAbort, { once: true });

    xhr.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable) {
        onProgress({
          progress: Math.round((event.loaded / event.total) * 100),
        });
      }
    });

    xhr.addEventListener("load", () => {
      cleanup();

      if (xhr.status < 200 || xhr.status >= 300) {
        let detail = "";
        try {
          const body = JSON.parse(xhr.responseText) as { message?: string };
          if (body?.message) detail = `: ${body.message}`;
        } catch {
          // non-JSON error body — status code alone is enough
        }
        reject(new Error(`${kind} failed with status ${xhr.status}${detail}`));
        return;
      }

      let record: Record<string, unknown>;
      try {
        record = JSON.parse(xhr.responseText) as Record<string, unknown>;
      } catch {
        reject(
          new Error(`${kind} failed: server returned an invalid response`),
        );
        return;
      }

      const storedName =
        typeof record[FILES_FIELD] === "string"
          ? (record[FILES_FIELD] as string)
          : "";

      if (!storedName) {
        reject(new Error(`${kind} failed: server response contained no file`));
        return;
      }

      resolve({
        id: String(record.id ?? fallbackId ?? ""),
        // PocketBase renames on disk (`name_ab12cd34.png`); the local File keeps
        // the name the user actually picked.
        fileName: file.name || storedName,
        fileSize: file.size,
        updatedAt: String(record.updated ?? new Date().toISOString()),
        url: buildUploadUrl(record, storedName),
      });
    });

    xhr.addEventListener("error", () => {
      cleanup();
      reject(new Error(`${kind} failed: network error`));
    });

    xhr.addEventListener("abort", () => {
      cleanup();
      reject(new Error(`${kind} aborted`));
    });

    const formData = new FormData();
    formData.append(FILES_FIELD, file);
    for (const [name, value] of Object.entries(fields ?? {})) {
      formData.append(name, value);
    }

    xhr.open(method, pb.buildUrl(path).toString());

    // Web login uses the session cookie; desktop initializes the PB auth store.
    // Read the web cookie for every write so renewal/logout cannot leave a
    // stale SDK token in use. PB requires Authorization for record writes.
    const token =
      process.env.NEXT_PUBLIC_DBRAIN_PLATFORM === "desktop"
        ? pb.authStore?.token
        : readAuthSessionToken();
    if (token) xhr.setRequestHeader("Authorization", token);

    xhr.send(formData);
  });
};

/** Creates a new `files` record; the direct, single-request upload path. */
const uploadDirectAttachment = (
  file: File,
  onProgress: (event: { progress: number }) => void,
  signal?: AbortSignal,
): Promise<IAttachment> => {
  const workspaceId = useWorkspaceStore.getState().currentWorkspaceId;
  return writeAttachment({
    kind: "Upload",
    method: "POST",
    path: `/api/collections/${FILES_COLLECTION}/records`,
    file,
    onProgress,
    signal,
    fields: workspaceId ? { workspaceId } : undefined,
  });
};

/**
 * Replaces the stored file of an existing `files` record, keeping its id.
 *
 * One logical file stays one record: an Excalidraw block writes its preview as
 * a PNG that also embeds the scene (`exportEmbedScene`), so a save replaces
 * that record's bytes instead of creating a second record. The resource library
 * keeps one card, and the quota counts the current bytes instead of every
 * save's leftover. The record id is stable; the stored file name (and the URL
 * the caller renders) changes with the bytes, so the caller rewrites the node's
 * `src` from the response.
 *
 * The owner may replace the `file` field; the PocketBase hook recomputes `size`
 * and `mimeType` from the stored blob and applies the same category ceiling and
 * per-user quota as a create (`pb/pb_hooks/lib/storage-limits.js`).
 *
 * Throws when the record is gone, when the deployment refuses the replacement,
 * or when the server rejects the new bytes. A caller that must stay usable can
 * fall back to {@link uploadAttachment}, which creates a fresh record.
 */
export const replaceAttachment = (
  id: string,
  file: File,
  onProgress: (event: { progress: number }) => void = () => {},
  signal?: AbortSignal,
): Promise<IAttachment> =>
  writeAttachment({
    kind: "Replace",
    method: "PATCH",
    path: `/api/collections/${FILES_COLLECTION}/records/${encodeURIComponent(id)}`,
    file,
    onProgress,
    signal,
    fallbackId: id,
  });

/**
 * Uploads a file to PocketBase and returns the stored file as an
 * {@link IAttachment}.
 *
 * Two transports exist behind this one signature, chosen by size:
 *
 * - `file.size <= DIRECT_UPLOAD_MAX_BYTES` — one `POST`, exactly as before.
 * - larger — a resumable session of chunks, up to {@link MAX_UPLOAD_BYTES}.
 *
 * Callers (drop zones, the Tiptap image node, Excalidraw) never pick a
 * transport and never see the difference beyond the progress events.
 *
 * Always creates a new `files` record. To overwrite the blob of an existing
 * record and keep its id — one storage unit per diagram — use
 * {@link replaceAttachment}.
 */
export const uploadAttachment = async (
  file: File,
  onProgress: (event: { progress: number }) => void = () => {},
  signal?: AbortSignal,
): Promise<IAttachment> => {
  if (file.size <= DIRECT_UPLOAD_MAX_BYTES) {
    return uploadDirectAttachment(file, onProgress, signal);
  }

  // Loaded lazily: the direct path must stay exactly as it was, and the
  // chunked machinery (fingerprint, session store, retry loop) then costs a
  // separate chunk in the bundle that only large uploads pull in.
  const { uploadChunked } = await import("./upload-chunked");
  return uploadChunked(file, onProgress, signal);
};

/**
 * Upload a file to PocketBase using the configured collection.
 * This function matches the UploadOptions.upload signature.
 *
 * @param file - The file to upload
 * @param onProgress - Callback to report upload progress (0-100)
 * @param signal - AbortSignal for cancellation
 * @returns Promise resolving to the URL of the uploaded file
 */
export const uploadFile: UploadOptions["upload"] = async (
  file: File,
  onProgress: (event: { progress: number }) => void,
  signal: AbortSignal,
): Promise<string> => {
  const attachment = await uploadAttachment(file, onProgress, signal);
  return attachment.url;
};

/** One key's upload list plus the components watching it. */
interface UploadStore {
  items: FileItem[];
  listeners: Set<() => void>;
}

/** Shared immutable snapshot for a key that has never stored an upload. */
const EMPTY_FILE_ITEMS: FileItem[] = [];

/**
 * Module-level so an upload started inside the node edit dialog survives the
 * dialog closing. Closing unmounts the drop zone while the in-flight upload
 * promise keeps running; reopening mounts a zone that subscribes to this same
 * entry and renders the live progress, including the finished success / error
 * item and its `url`.
 */
const uploadStores = new Map<string, UploadStore>();

function getUploadStore(key: string): UploadStore {
  let store = uploadStores.get(key);
  if (!store) {
    store = { items: EMPTY_FILE_ITEMS, listeners: new Set() };
    uploadStores.set(key, store);
  }
  return store;
}

function subscribeToUploads(key: string, listener: () => void): () => void {
  const store = getUploadStore(key);
  store.listeners.add(listener);
  return () => {
    store.listeners.delete(listener);
  };
}

function getUploadItems(key: string): FileItem[] {
  return uploadStores.get(key)?.items ?? EMPTY_FILE_ITEMS;
}

function updateUploadItems(
  key: string,
  update: (items: FileItem[]) => FileItem[],
): void {
  const store = getUploadStore(key);
  const next = update(store.items);
  if (next === store.items) return;
  store.items = next;
  store.listeners.forEach((listener) => listener());
}

/**
 * Custom hook for managing multiple file uploads with progress tracking and cancellation
 *
 * State is keyed by {@link UploadOptions.key} and kept outside React, so a
 * remount with the same key observes the upload it started before it unmounted
 * (see {@link UploadStore}). A caller that passes no key — the Tiptap image node
 * — gets a private key per hook instance, matching the previous component-local
 * behaviour.
 */
export function useFileUpload(options: UploadOptions) {
  // Lazy initializer, so the fallback key is stable for the hook's lifetime
  // even though it is unused when the caller supplies a key.
  const [fallbackKey] = useState(() => `__file-upload-${crypto.randomUUID()}`);
  const key = options.key ?? fallbackKey;

  // Drop the private entry of a key-less caller with the component: explicit
  // keys are the ones whose whole purpose is to outlive the component.
  useEffect(() => {
    if (options.key !== undefined) return;
    return () => {
      uploadStores.delete(fallbackKey);
    };
  }, [options.key, fallbackKey]);

  const subscribe = useCallback(
    (listener: () => void) => subscribeToUploads(key, listener),
    [key],
  );
  const getSnapshot = useCallback(() => getUploadItems(key), [key]);

  const fileItems = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const uploadFile = async (file: File): Promise<string | null> => {
    if (!matchesAccept(file, options.accept)) {
      options.onError?.(
        new Error(
          `Unsupported file type: ${file.name}${options.accept ? ` (expected ${options.accept})` : ""}`,
        ),
      );
      return null;
    }

    if (file.size > options.maxSize) {
      const error = new Error(
        `File size exceeds maximum allowed (${options.maxSize / 1024 / 1024}MB)`,
      );
      options.onError?.(error);
      return null;
    }

    const abortController = new AbortController();
    const fileId = crypto.randomUUID();

    const newFileItem: FileItem = {
      id: fileId,
      file,
      progress: 0,
      status: "uploading",
      abortController,
    };

    updateUploadItems(key, (prev) => [...prev, newFileItem]);

    try {
      if (!options.upload) {
        throw new Error("Upload function is not defined");
      }

      const url = await options.upload(
        file,
        (event: { progress: number }) => {
          updateUploadItems(key, (prev) =>
            prev.map((item) =>
              item.id === fileId ? { ...item, progress: event.progress } : item,
            ),
          );
        },
        abortController.signal,
      );

      if (!url) throw new Error("Upload failed: No URL returned");

      if (!abortController.signal.aborted) {
        updateUploadItems(key, (prev) =>
          prev.map((item) =>
            item.id === fileId
              ? { ...item, status: "success", url, progress: 100 }
              : item,
          ),
        );
        options.onSuccess?.(url, file);
        return url;
      }

      return null;
    } catch (error) {
      if (!abortController.signal.aborted) {
        updateUploadItems(key, (prev) =>
          prev.map((item) =>
            item.id === fileId
              ? {
                  ...item,
                  status: "error",
                  progress: 0,
                  error:
                    error instanceof Error && error.message
                      ? error.message
                      : "Upload failed",
                }
              : item,
          ),
        );
        options.onError?.(
          error instanceof Error ? error : new Error("Upload failed"),
        );
      }
      return null;
    }
  };

  const uploadFiles = async (files: File[]): Promise<string[]> => {
    if (!files || files.length === 0) {
      options.onError?.(new Error("No files to upload"));
      return [];
    }

    if (options.limit && files.length > options.limit) {
      options.onError?.(
        new Error(
          `Maximum ${options.limit} file${options.limit === 1 ? "" : "s"} allowed`,
        ),
      );
      return [];
    }

    // Upload all files concurrently
    const uploadPromises = files.map((file) => uploadFile(file));
    const results = await Promise.all(uploadPromises);

    // Filter out null results (failed uploads)
    return results.filter((url): url is string => url !== null);
  };

  const removeFileItem = (fileId: string) => {
    updateUploadItems(key, (prev) => {
      const fileToRemove = prev.find((item) => item.id === fileId);
      fileToRemove?.abortController?.abort();
      revokeIfObjectUrl(fileToRemove?.url);
      return prev.filter((item) => item.id !== fileId);
    });
  };

  const clearAllFiles = () => {
    getUploadItems(key).forEach((item) => {
      item.abortController?.abort();
      revokeIfObjectUrl(item.url);
    });
    updateUploadItems(key, () => EMPTY_FILE_ITEMS);
  };

  return {
    fileItems,
    uploadFiles,
    removeFileItem,
    clearAllFiles,
  };
}
