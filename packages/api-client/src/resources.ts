// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The media resource library, as the client sees it.
 *
 * Blobs live in the PocketBase `files` collection, so this module reads that
 * collection directly: the same transport the uploads already use, and the only
 * one both the browser app and the desktop local mode share. It reads the
 * record metadata (`size`, `mimeType`, `displayName`) that the PocketBase hook
 * writes server-side; it never trusts a client-supplied size for accounting. It
 * also exposes the analysis the server caches on a resource (page count,
 * duration, cover, HLS playlist) so a node references the stored file once
 * instead of asking the backend to parse or package it again.
 *
 * The storage *limits* are deployment configuration, not collection data, so
 * they come from the API (`storage.limits`) through the typed tRPC client. Both
 * halves live here so a component has one import for the whole resource model.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { useAuthStore } from "@workspace/store";
import type { IAttachment } from "@workspace/interfaces";
import {
  DEFAULT_STORAGE_LIMITS,
  STORAGE_CATEGORIES,
  fileExtension,
  maxFileBytesFor,
  storageCategoryFor,
  type StorageCategory,
  type StorageLimits,
} from "@workspace/utils/storage-limits";
import { readAuthSessionToken, decodeJwtPayload } from "./auth/session";
import { getPocketbaseClient } from "./pocketbase-client";
import { trpc } from "./trpc/provider";
import { buildUploadUrl, resolveFileUrl, uploadAttachment } from "./upload";

/** PocketBase collection every stored blob lands in. Re-exported for clarity. */
const COLLECTION = "files";

/** Which records a resource query lists. */
export type ResourceScope =
  /** Records this user owns; this is what the per-user quota counts. */
  | "mine"
  /** Every record the access rules expose, including workspace teammates'. */
  | "visible";

/** One stored blob, mapped to what the library and the selector render. */
export interface ResourceRecord {
  id: string;
  /** Name PocketBase stores on disk (with its random suffix). */
  fileName: string;
  /** User-editable label; empty on a record that was never renamed. */
  displayName: string;
  /** `displayName` when set, otherwise a readable form of {@link fileName}. */
  name: string;
  /** Byte length recorded by the server when the blob was stored. */
  fileSize: number;
  /** MIME type derived from the stored file name by the PocketBase hook. */
  mimeType: string;
  category: StorageCategory;
  /** Address to write into node content (root-relative in desktop mode). */
  storedUrl: string;
  /** Address ready for `src`, resolved against the active PocketBase origin. */
  url: string;
  ownerId: string;
  workspaceId: string;
  createdAt: string;
  updatedAt: string;
  /**
   * True for an artifact the server derived from a resource: a PDF cover, an
   * HLS playlist, its segments, a video poster. The library hides these rows —
   * they are listed only for the storage view, which charges their bytes.
   */
  derived: boolean;
  /** Id of the resource an artifact belongs to; `""` on a resource. */
  derivedFrom: string;
  /** Cached PDF page count; 0 when the resource was never parsed. */
  pageCount: number;
  /** Cached pixel width of an image or a video; 0 when it was not measured. */
  width: number;
  /** Cached pixel height of an image or a video; 0 when it was not measured. */
  height: number;
  /** Cached duration of an audio file or a video, in seconds. */
  duration: number;
  /** Stored address of the cached cover; write it into node content unchanged. */
  storedCoverUrl: string;
  /** Stored address of the cached HLS playlist; `""` when not packaged. */
  storedHlsUrl: string;
}

/** One user's storage occupation, split by category. */
export interface StorageUsage {
  /** Bytes across every category. */
  total: number;
  /** Bytes per category, always carrying all six keys. */
  byCategory: Record<StorageCategory, number>;
  /** Number of records counted. */
  count: number;
}

/** Why a picked file would be rejected before it is uploaded. */
export interface ResourceLimitViolation {
  kind: "category";
  category: StorageCategory;
  fileSize: number;
  limitBytes: number;
}

/** Empty per-category totals, spread so callers cannot mutate the shared object. */
function emptyUsage(): StorageUsage {
  return {
    total: 0,
    byCategory: { image: 0, video: 0, audio: 0, pdf: 0, webpage: 0, other: 0 },
    count: 0,
  };
}

/**
 * Removes the random suffix PocketBase appends to a stored name, so a record
 * that was never renamed still reads like the file the user picked.
 *
 * The suffix is exactly ten lower-case alphanumerics before the final extension
 * (`report_ab12cd34ef.pdf`). Only a name shaped that way is rewritten; anything
 * else is returned verbatim, because guessing could mangle a real file name.
 */
export function prettyStoredFileName(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  const base = dot > 0 ? fileName.slice(0, dot) : fileName;
  const extension = dot > 0 ? fileName.slice(dot) : "";
  if (fileExtension(fileName) === "") return fileName;
  return base.replace(/_[a-z0-9]{10}$/, "") + extension;
}

/** The label a resource should show: the rename, else a readable stored name. */
export function resourceDisplayName(resource: {
  displayName: string;
  fileName: string;
}): string {
  const renamed = resource.displayName.trim();
  return renamed || prettyStoredFileName(resource.fileName);
}

/**
 * The id of the PocketBase user that owns files written by this browser.
 *
 * Exported for the selector's "shared" badge: the graph user id and the
 * PocketBase user id are the same in the browser app, but not in the desktop
 * local mode, where the graph user is the fixed local identity. Reading the
 * token claim is the one source that is correct in both.
 */
export function currentResourceOwnerId(): string {
  return currentOwnerId();
}

/** The id of the PocketBase user that owns files written by this browser. */
function currentOwnerId(): string {
  const token =
    process.env.NEXT_PUBLIC_DBRAINX_PLATFORM === "desktop"
      ? getPocketbaseClient().authStore?.token
      : readAuthSessionToken();
  if (token) {
    const id = decodeJwtPayload(token).id;
    if (typeof id === "string" && id) return id;
  }
  // No token (a test or a pre-session render): fall back to the graph user.
  return useAuthStore.getState().user?.id ?? "";
}

/** A finite, non-negative number from a record field; anything else is 0. */
function nonNegativeNumber(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

/** Maps one PocketBase record onto {@link ResourceRecord}. */
function toResourceRecord(raw: Record<string, unknown>): ResourceRecord {
  const fileName = typeof raw.file === "string" ? raw.file : "";
  const mimeType = typeof raw.mimeType === "string" ? raw.mimeType : "";
  const displayName =
    typeof raw.displayName === "string" ? raw.displayName : "";
  const storedUrl = fileName ? buildUploadUrl(raw, fileName) : "";
  const size = Number(raw.size);
  const derivedFrom =
    typeof raw.derivedFrom === "string" ? raw.derivedFrom : "";
  const record: ResourceRecord = {
    id: String(raw.id ?? ""),
    fileName,
    displayName,
    name: "",
    fileSize: Number.isFinite(size) && size > 0 ? size : 0,
    mimeType,
    category: storageCategoryFor(fileName, mimeType),
    storedUrl,
    url: storedUrl ? resolveFileUrl(storedUrl) : "",
    ownerId: typeof raw.ownerId === "string" ? raw.ownerId : "",
    workspaceId: typeof raw.workspaceId === "string" ? raw.workspaceId : "",
    createdAt: typeof raw.created === "string" ? raw.created : "",
    updatedAt: typeof raw.updated === "string" ? raw.updated : "",
    derived: derivedFrom !== "",
    derivedFrom,
    pageCount: nonNegativeNumber(raw.pageCount),
    width: nonNegativeNumber(raw.width),
    height: nonNegativeNumber(raw.height),
    duration: nonNegativeNumber(raw.duration),
    storedCoverUrl: typeof raw.coverUrl === "string" ? raw.coverUrl : "",
    storedHlsUrl: typeof raw.hlsUrl === "string" ? raw.hlsUrl : "",
  };
  record.name = resourceDisplayName(record);
  return record;
}

/** Which records {@link listResources} returns for a scope. */
export interface ListResourceOptions {
  scope?: ResourceScope;
  /**
   * Include the artifacts the server derived from a resource (covers, HLS
   * playlists, segments). The management page asks for them because they occupy
   * quota; the card list and the selector hide them by default.
   */
  includeDerived?: boolean;
}

/**
 * Lists stored resources, newest first.
 *
 * `mine` filters on `ownerId` because that is the set the quota charges; it is
 * also the scope the management page shows. `visible` leaves the filter off and
 * lets the collection rules decide, so a workspace member can reference a
 * teammate's upload without gaining ownership of it.
 *
 * Derived artifacts are hidden unless asked for: a packaged video would
 * otherwise appear as a playlist, a poster and dozens of segments. Their bytes
 * still count against the quota, which is why the storage view reads them too.
 */
/**
 * The `files` fields {@link toResourceRecord} reads.
 *
 * Requested explicitly so a future server-side field does not travel to the
 * browser by accident. {@link listResourcesByIds} and the node dialog read the
 * same set, so a resource looks identical wherever it was fetched.
 */
const RESOURCE_FIELDS =
  "id,collectionId,collectionName,file,size,mimeType,displayName,ownerId,workspaceId,created,updated,derivedFrom,pageCount,width,height,duration,coverUrl,hlsUrl";

export async function listResources(
  options?: ListResourceOptions,
): Promise<ResourceRecord[]> {
  const scope = options?.scope ?? "mine";
  const includeDerived = options?.includeDerived ?? false;
  const pb = getPocketbaseClient();
  const filters: string[] = [];
  if (scope === "mine") filters.push("ownerId = {:owner}");
  if (!includeDerived) filters.push('derivedFrom = ""');
  const filter = filters.join(" && ");
  const records = await pb.collection(COLLECTION).getFullList({
    filter: filter ? pb.filter(filter, { owner: currentOwnerId() }) : undefined,
    sort: "-created",
    fields: RESOURCE_FIELDS,
  });
  return records.map((record) =>
    toResourceRecord(record as unknown as Record<string, unknown>),
  );
}

/**
 * The library records named by stored file addresses (the ids a node embeds).
 *
 * The node dialogs ask "which uploaded files does this node use?" and answer it
 * from the addresses in the node, not from a stored relation: a node can embed
 * a file inside a rich-text document, so a single column could not describe it.
 *
 * Derived artifacts are not returned by default: a PDF cover or an HLS playlist
 * belongs to its resource and disappears with it, so offering it as a separate
 * deletion would delete the same bytes twice. The ids come from the user's own
 * node content, but the collection rules still decide which records are
 * readable.
 */
export async function listResourcesByIds(
  ids: readonly string[],
  options?: { includeDerived?: boolean },
): Promise<ResourceRecord[]> {
  const unique = [...new Set(ids.filter((id) => /^[A-Za-z0-9]+$/.test(id)))];
  if (unique.length === 0) return [];
  const pb = getPocketbaseClient();
  const filter = unique.map((id) => `id = "${id}"`).join(" || ");
  const records = await pb.collection(COLLECTION).getFullList({
    filter,
    sort: "-created",
    fields: RESOURCE_FIELDS,
  });
  const resources = records.map((record) =>
    toResourceRecord(record as unknown as Record<string, unknown>),
  );
  return options?.includeDerived
    ? resources
    : resources.filter((resource) => !resource.derived);
}

/** A node that points at a stored resource; enough to name it in a dialog. */
export interface NodeFileReference {
  id: string;
  title: string;
  nodeType: string;
}

/**
 * Nodes whose content, document, cover, icon or favicon points at the record
 * behind `storedUrl`.
 *
 * The PocketBase filter matches the record id as a path segment
 * (`/<id>/`) of the stored address, so it works for the absolute, gateway and
 * desktop forms of the URL without normalising them here. The match is a
 * substring on JSON columns (`content`, `docs`, `cover`, `icon`) and on the
 * plain columns the media types keep; a resource that no node references
 * returns an empty list.
 *
 * The list is advisory: the delete hook is what actually clears the references.
 * A caller uses this list to warn the user and to refresh the nodes afterwards.
 */
export async function listNodesReferencingResource(
  storedUrl: string,
): Promise<NodeFileReference[]> {
  const recordId = resourceIdFromStoredUrl(storedUrl);
  if (!recordId) return [];
  const pb = getPocketbaseClient();
  try {
    const records = await pb.collection("nodes").getFullList({
      filter: pb.filter(
        "content ~ {:needle} || docs ~ {:needle} || coverUrl ~ {:needle} || hlsUrl ~ {:needle} || faviconUrl ~ {:needle} || cover ~ {:needle} || icon ~ {:needle}",
        { needle: `/${recordId}/` },
      ),
      fields: "id,title,nodeType",
      sort: "title",
    });
    return records.map((record) => ({
      id: String(record.id ?? ""),
      title: typeof record.title === "string" ? record.title : "",
      nodeType: typeof record.nodeType === "string" ? record.nodeType : "",
    }));
  } catch {
    // A read failure must not stop a deletion the user already confirmed: the
    // dialog shows no nodes and the server hook still clears the references.
    return [];
  }
}

/**
 * Record id in a stored file address (`/api/files/<collection>/<id>/<name>`).
 *
 * The empty string is returned for anything else, so a caller never sends a
 * write at a guessed id.
 */
export function resourceIdFromStoredUrl(storedUrl: string): string {
  const match = /\/api\/files\/[A-Za-z0-9_]+\/([A-Za-z0-9]+)\//.exec(storedUrl);
  return match ? match[1]! : "";
}

/**
 * Caches measurements the browser read from a stored resource.
 *
 * Image and audio metadata is read locally by the browser — no server work and
 * no derived artifact — but it is read once per reference. Writing it once
 * keeps the reference path uniform: whatever the resource record carries is
 * reused, and only a record without it is measured again.
 *
 * Best effort: a workspace teammate's resource is not the caller's to update,
 * and an older deployment may lack the fields. Either way the caller has the
 * measurements it just read and does not need this write to succeed.
 */
export async function cacheResourceMeasurements(
  storedUrl: string,
  measurements: { width?: number; height?: number; duration?: number },
): Promise<void> {
  const id = resourceIdFromStoredUrl(storedUrl);
  if (!id) return;

  const body: Record<string, number> = {};
  const width = Math.round(measurements.width ?? 0);
  const height = Math.round(measurements.height ?? 0);
  if (width > 0) body.width = width;
  if (height > 0) body.height = height;
  if (measurements.duration !== undefined && measurements.duration > 0) {
    body.duration = measurements.duration;
  }
  if (Object.keys(body).length === 0) return;

  try {
    await getPocketbaseClient().collection(COLLECTION).update(id, body);
  } catch {
    // The cache is an optimisation; a refused write must not fail a reference.
  }
}

/** Renames a resource's label. The stored blob and its URL do not change. */
export async function renameResource(
  id: string,
  displayName: string,
): Promise<void> {
  const trimmed = displayName.trim();
  if (!trimmed) throw new Error("A resource name is required");
  await getPocketbaseClient().collection(COLLECTION).update(id, {
    displayName: trimmed,
  });
}

/**
 * Deletes a resource record, which also deletes the stored bytes. Nodes that
 * still point at the record keep their URL and start failing to load it.
 */
export async function deleteResource(id: string): Promise<void> {
  await getPocketbaseClient().collection(COLLECTION).delete(id);
}

/** Uploads one file into the library, with the same transports as a node upload. */
export async function uploadResource(
  file: File,
  onProgress?: (event: { progress: number }) => void,
  signal?: AbortSignal,
): Promise<IAttachment> {
  return uploadAttachment(file, onProgress, signal);
}

/**
 * Sums a resource list into the storage view.
 *
 * `records` may be the whole library; a record without a usable `size` cannot
 * be counted and is skipped — the metadata field is written by the server hook,
 * so a zero here means a record that predates the field.
 */
export function storageUsageOf(resources: ResourceRecord[]): StorageUsage {
  const usage = emptyUsage();
  for (const resource of resources) {
    usage.total += resource.fileSize;
    usage.byCategory[resource.category] += resource.fileSize;
    usage.count += 1;
  }
  return usage;
}

/**
 * Checks one file against the per-category ceiling before any byte is sent.
 *
 * The server enforces the same rule authoritatively; this only spares the user
 * a failed upload of a file that cannot be accepted.
 */
export function checkResourceLimit(
  file: Pick<File, "name" | "size" | "type">,
  limits: StorageLimits,
): ResourceLimitViolation | null {
  const category = storageCategoryFor(file.name, file.type);
  const limitBytes = maxFileBytesFor(limits, file.name, file.type);
  if (file.size <= limitBytes) return null;
  return { kind: "category", category, fileSize: file.size, limitBytes };
}

/** What one resource query is currently doing. */
export interface UseResourcesResult {
  resources: ResourceRecord[];
  loading: boolean;
  /** Human-readable failure of the last load; `null` when it succeeded. */
  error: string | null;
  /** Re-reads the list, e.g. after an upload, a rename or a delete. */
  reload: () => void;
}

/**
 * Reads a resource list for a component.
 *
 * A counter guards against an out-of-order response replacing a newer list —
 * `reload` may be triggered by a delete while the previous read is still in
 * flight.
 */
export function useResources(options?: {
  scope?: ResourceScope;
  includeDerived?: boolean;
  enabled?: boolean;
}): UseResourcesResult {
  const scope = options?.scope ?? "mine";
  const includeDerived = options?.includeDerived ?? false;
  const enabled = options?.enabled ?? true;

  const [resources, setResources] = useState<ResourceRecord[]>([]);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const generation = useRef(0);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    const ticket = ++generation.current;
    setLoading(true);
    void listResources({ scope, includeDerived })
      .then((next) => {
        if (generation.current !== ticket) return;
        setResources(next);
        setError(null);
      })
      .catch((cause: unknown) => {
        if (generation.current !== ticket) return;
        setResources([]);
        setError(
          cause instanceof Error && cause.message
            ? cause.message
            : "Could not read the resource library",
        );
      })
      .finally(() => {
        if (generation.current !== ticket) return;
        setLoading(false);
      });
  }, [enabled, scope, includeDerived, revision]);

  const reload = useCallback(() => setRevision((value) => value + 1), []);

  return { resources, loading, error, reload };
}

/**
 * The storage limits the server enforces.
 *
 * In the browser this is a query against the API; in the desktop local mode the
 * local engine answers with the same built-in defaults. Until the answer (or if
 * it fails), the built-in defaults are displayed so the page never renders an
 * empty quota bar.
 */
export function useStorageLimits(): StorageLimits {
  const { data } = trpc.storage.limits.useQuery(undefined, {
    staleTime: Infinity,
    retry: false,
  });
  return data ?? DEFAULT_STORAGE_LIMITS;
}

export { STORAGE_CATEGORIES };
export type { StorageCategory, StorageLimits };
