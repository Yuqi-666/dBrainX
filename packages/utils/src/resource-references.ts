// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Finds the stored library resources a node points at.
 *
 * A node keeps the file address in different places by type: a media node
 * stores it in `content.url` (with its poster or playlist in `content.coverUrl`
 * / `content.hlsUrl`), the rich-text editor embeds it in an image or an
 * Excalidraw block inside its document, and every node can carry a library
 * image as its `icon` or `cover`. One scanner serves all of them, so the
 * "delete this resource" and "clear this node" dialogs cannot disagree about
 * what a node references.
 *
 * The address itself is the only stable input: the server's record id is a path
 * segment of every stored form (absolute PocketBase URL, the gateway prefix,
 * the desktop same-origin form), so the scanner matches the segment instead of
 * comparing whole URLs.
 */

/** Record id segment of a stored file address. */
const FILE_URL_PATTERN = /\/api\/files\/[A-Za-z0-9_]+\/([A-Za-z0-9]+)\//g;

/** Every `files` record id found in any string inside `value`. */
export function fileRecordIdsInValue(value: unknown): string[] {
  const ids = new Set<string>();
  collectFileRecordIds(value, ids);
  return [...ids];
}

/**
 * Every `files` record id a node references in its content, icon or cover.
 *
 * Title and abstract are deliberately not scanned: a user can paste a file
 * address as text, and deleting the file must not patch that sentence.
 */
export function fileRecordIdsInNode(
  node:
    | { content?: unknown; cover?: unknown; icon?: unknown }
    | null
    | undefined,
): string[] {
  if (!node) return [];
  return fileRecordIdsInValue([node.content, node.cover, node.icon]);
}

/** True when the node points at at least one stored file. */
export function nodeReferencesAnyFile(
  node:
    | { content?: unknown; cover?: unknown; icon?: unknown }
    | null
    | undefined,
): boolean {
  return fileRecordIdsInNode(node).length > 0;
}

function collectFileRecordIds(value: unknown, ids: Set<string>): void {
  if (typeof value === "string") {
    FILE_URL_PATTERN.lastIndex = 0;
    for (
      let match = FILE_URL_PATTERN.exec(value);
      match !== null;
      match = FILE_URL_PATTERN.exec(value)
    ) {
      if (match[1]) ids.add(match[1]);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectFileRecordIds(item, ids);
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const item of Object.values(value as Record<string, unknown>)) {
      collectFileRecordIds(item, ids);
    }
  }
}

/** Sentinel a recursive walk returns when the whole element must be removed. */
const DROP = Symbol("drop");

interface WalkResult {
  value: unknown;
  changed: boolean;
}

/**
 * Copies a Tiptap document, removing what points at a deleted record.
 *
 * An image block is removed: its only meaning is the picture. An Excalidraw
 * block keeps its inline scene (`data`) and loses the preview address, so the
 * diagram stays editable after its preview file is deleted.
 */
function stripDeletedReferences(
  value: unknown,
  isDeleted: (reference: unknown) => boolean,
): WalkResult {
  if (Array.isArray(value)) {
    let changed = false;
    const next: unknown[] = [];
    for (const item of value) {
      const result = stripDeletedReferences(item, isDeleted);
      if (result.value === DROP) {
        changed = true;
        continue;
      }
      if (result.changed) changed = true;
      next.push(result.value);
    }
    return changed ? { value: next, changed: true } : { value, changed: false };
  }

  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const attrs = record.attrs as Record<string, unknown> | undefined;
    if (attrs && typeof attrs === "object") {
      if (record.type === "image" && isDeleted(attrs.src)) {
        return { value: DROP, changed: true };
      }
      if (record.type === "excalidraw" && isDeleted(attrs.src)) {
        return {
          value: {
            ...record,
            attrs: {
              ...attrs,
              src: "",
              attachmentId: undefined,
              size: undefined,
            },
          },
          changed: true,
        };
      }
    }

    let changed = false;
    const next: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(record)) {
      const result = stripDeletedReferences(item, isDeleted);
      if (result.value === DROP) {
        changed = true;
        continue;
      }
      if (result.changed) changed = true;
      next[key] = result.value;
    }
    return changed ? { value: next, changed: true } : { value, changed: false };
  }

  return { value, changed: false };
}

/** A stored file address that belongs to one of `recordIds`. */
function referenceIsDeleted(
  reference: unknown,
  recordIds: ReadonlySet<string>,
): boolean {
  if (typeof reference !== "string" || reference === "") return false;
  return fileRecordIdsInValue(reference).some((id) => recordIds.has(id));
}

/**
 * The node updates that remove references to deleted `files` records, or `null`
 * when the node does not reference any of them.
 *
 * This is the client side of the server's delete hook: the PocketBase hook
 * fixes the stored record for the next reader, and this function fixes the
 * copies the open surfaces already hold. Both must produce the same shape, so
 * keep them in step when a node type gains a file field.
 *
 * The node itself, its title and its edges survive: deleting a file clears the
 * link, it does not delete the node.
 */
export function nodeWithoutFileReferences(
  node: {
    nodeType?: string;
    content?: unknown;
    cover?: unknown;
    icon?: unknown;
  },
  recordIds: ReadonlySet<string>,
): Record<string, unknown> | null {
  if (recordIds.size === 0) return null;

  const updates: Record<string, unknown> = {};
  let changed = false;

  const cover = node.cover as
    | { kind?: string; url?: string }
    | null
    | undefined;
  if (
    cover &&
    cover.kind === "image" &&
    referenceIsDeleted(cover.url, recordIds)
  ) {
    updates.cover = null;
    changed = true;
  }

  const icon = node.icon as
    | { kind?: string; value?: string }
    | null
    | undefined;
  if (
    icon &&
    icon.kind === "image" &&
    referenceIsDeleted(icon.value, recordIds)
  ) {
    updates.icon = null;
    changed = true;
  }

  const content = (node.content ?? {}) as Record<string, unknown>;
  const isDeleted = (reference: unknown) =>
    referenceIsDeleted(reference, recordIds);

  switch (node.nodeType) {
    case "image": {
      if (isDeleted(content.url)) {
        updates.content = { url: "" };
        updates.width = 0;
        updates.height = 0;
        updates.fileSize = 0;
        changed = true;
      }
      break;
    }
    case "pdf": {
      if (isDeleted(content.url)) {
        updates.content = { url: "", coverUrl: "" };
        updates.pageCount = 0;
        updates.fileSize = 0;
        changed = true;
      } else if (isDeleted(content.coverUrl)) {
        updates.content = { ...content, coverUrl: "" };
        changed = true;
      }
      break;
    }
    case "webpage": {
      // The document is a stored object, so deleting the resource clears the
      // address and the byte length the same way it does for a PDF. The node
      // keeps its title, cover and edges.
      if (isDeleted(content.url)) {
        updates.content = { url: "" };
        updates.fileSize = 0;
        changed = true;
      }
      break;
    }
    case "video": {
      const lostSource = isDeleted(content.url);
      const lostCover = lostSource || isDeleted(content.coverUrl);
      const lostPlaylist = lostSource || isDeleted(content.hlsUrl);
      if (lostSource || lostCover || lostPlaylist) {
        updates.content = {
          ...content,
          url: lostSource ? "" : content.url,
          coverUrl: lostCover ? "" : content.coverUrl,
          hlsUrl: lostPlaylist ? "" : content.hlsUrl,
        };
        if (lostSource) {
          updates.duration = 0;
          updates.fileSize = 0;
        }
        changed = true;
      }
      break;
    }
    case "audio": {
      if (isDeleted(content.url)) {
        updates.content = { ...content, url: "" };
        updates.duration = 0;
        updates.fileSize = 0;
        changed = true;
      }
      break;
    }
    case "website": {
      if (
        typeof content.faviconUrl === "string" &&
        isDeleted(content.faviconUrl)
      ) {
        updates.content = { ...content, faviconUrl: undefined };
        changed = true;
      }
      break;
    }
    case "text": {
      const stripped = stripDeletedReferences(content.docs, isDeleted);
      if (stripped.changed) {
        updates.content = { ...content, docs: stripped.value };
        changed = true;
      }
      break;
    }
    case "rich-text": {
      const stripped = stripDeletedReferences(content.docs, isDeleted);
      if (stripped.changed) {
        updates.content = { ...content, docs: stripped.value };
        changed = true;
      }
      break;
    }
    default:
      break;
  }

  return changed ? updates : null;
}
