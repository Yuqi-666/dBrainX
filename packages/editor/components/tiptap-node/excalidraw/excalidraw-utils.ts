// SPDX-License-Identifier: AGPL-3.0-only

import type {
  ExcalidrawImperativeAPI,
  ExcalidrawInitialDataState,
} from "@excalidraw/excalidraw/types";
import { resolveFileUrl } from "@workspace/api-client";

/**
 * Resolves an attachment `src` to an absolute URL.
 *
 * Uploads now land in PocketBase's `files` collection, so the base origin comes
 * from the shared PocketBase client (`resolveFileUrl`) instead of a hard-coded
 * `localhost:3001`.
 */
export function getFileUrl(src: string): string {
  return resolveFileUrl(src);
}

/**
 * MIME type of a stored scene file, from the extension in its address.
 *
 * `loadFromBlob` picks the decoder from the blob type: a PNG whose type is not
 * `image/png` is read as text, which hides the scene embedded in its metadata.
 * A reverse proxy that serves a stored file as `application/octet-stream` would
 * therefore make the block unopenable, so the type the name implies wins.
 */
function sceneMimeType(src: string, servedType: string): string {
  const address = src.split(/[?#]/)[0] ?? src;
  if (address.toLowerCase().endsWith(".json")) return "application/json";
  // The only raster preview this block writes is a PNG; legacy PNGs were
  // stored with the same extension.
  if (address.toLowerCase().endsWith(".png")) return "image/png";
  return servedType;
}

/**
 * Loads a scene from the file an attachment `src` points at.
 *
 * Two stored forms exist and `loadFromBlob` reads both:
 *
 * - a legacy `diagram.excalidraw.json` attachment, which holds the scene JSON;
 * - the preview PNG written by this version, which embeds the same scene in its
 *   PNG metadata (`exportEmbedScene`) — the one storage unit the block has.
 *
 * An image without embedded scene data throws (Excalidraw reports
 * `IMAGE_NOT_CONTAINS_SCENE_DATA`), so the caller can open the empty canvas.
 */
export async function loadExcalidrawData(src: string): Promise<{
  elements: NonNullable<ExcalidrawInitialDataState["elements"]>;
  files: NonNullable<ExcalidrawInitialDataState["files"]>;
}> {
  const url = getFileUrl(src);
  const request = await fetch(url, {
    credentials: "include",
    cache: "no-store",
  });

  if (!request.ok) {
    throw new Error(
      `Failed to load Excalidraw diagram (${request.status} ${request.statusText})`,
    );
  }

  const blob = await request.blob();
  const storedName = src.split(/[?#]/)[0]?.split("/").pop() || "diagram";
  const file = new File([blob], storedName, {
    type: sceneMimeType(src, blob.type || "application/octet-stream"),
  });

  const { loadFromBlob } = await import("@excalidraw/excalidraw");
  return loadFromBlob(file, null, null);
}

export async function getExcalidrawInitialData(src: string | null): Promise<{
  elements: NonNullable<ExcalidrawInitialDataState["elements"]>;
  files: NonNullable<ExcalidrawInitialDataState["files"]>;
} | null> {
  if (!src) {
    return null;
  }

  const data = await loadExcalidrawData(src);
  return { elements: data.elements, files: data.files };
}

export async function exportToExcalidrawJSON(api: ExcalidrawImperativeAPI) {
  return {
    elements: api.getSceneElements(),
    files: api.getFiles(),
  };
}
