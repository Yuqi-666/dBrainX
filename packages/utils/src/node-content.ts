// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The "clear the node" action: keep the node, remove the payload.
 *
 * The dialog offers the same choice for every node type that owns one payload,
 * so the shapes live here instead of in the editor or in a node view. A node
 * type without a single payload (`collection`, `database`) is not clearable:
 * silently emptying a table is not the same gesture as emptying a text block,
 * so the caller hides the option when this returns `null`.
 */

/** A rich-text document with no blocks. Shared with the editor's normalizer. */
export function emptyRichTextDocument(): Record<string, unknown> {
  return { type: "doc", content: [] };
}

/**
 * The file name at the end of a stored address
 * (`/api/files/<collection>/<record>/<name>`).
 *
 * Node content stores the address, so a reader that needs the original name —
 * the source editor's language, a download label — reads it from here instead
 * of keeping a second field that could disagree with the file. An address that
 * carries no name reads as the empty string, which callers treat as unknown.
 */
export function storedFileName(storedUrl: string): string {
  if (!storedUrl) return "";
  const path = storedUrl.split(/[?#]/)[0] ?? "";
  const name = path.slice(path.lastIndexOf("/") + 1);
  try {
    return decodeURIComponent(name);
  } catch {
    return name;
  }
}

/** True when a stored document is an HTML page, i.e. a page the preview renders. */
export function isHtmlDocument(storedUrl: string): boolean {
  return /\.(?:html?|xhtml)$/i.test(storedFileName(storedUrl));
}

/**
 * The node updates that clear the node's content, or `null` when the type is
 * not clearable.
 *
 * The merge is a shallow `NodeService.upsert`, so the whole `content` object is
 * replaced. Measurements that belong to the removed payload (size, page count,
 * duration, pixel size) are reset with it; the title, icon, cover, tags, state
 * and edges keep their values, because clearing the content is not deleting the
 * node.
 */
export function clearedNodeUpdates(node: {
  nodeType?: string;
  content?: unknown;
}): Record<string, unknown> | null {
  const content = (node.content ?? {}) as Record<string, unknown>;
  switch (node.nodeType) {
    case "text":
      return { content: { docs: emptyRichTextDocument() } };
    case "rich-text":
      return {
        content: { referencedNodes: [], docs: emptyRichTextDocument() },
      };
    case "webpage":
      // The document is a stored object, not record content: clearing the node
      // drops the address and the recorded byte length, and the resource itself
      // stays in the library until the user deletes it there.
      return { content: { url: "" }, fileSize: 0 };
    case "website":
      return { content: { url: "" } };
    case "image":
      return { content: { url: "" }, width: 0, height: 0, fileSize: 0 };
    case "pdf":
      return { content: { url: "", coverUrl: "" }, pageCount: 0, fileSize: 0 };
    case "video":
      // The timeline is the user's own work, not part of the file payload.
      return {
        content: {
          url: "",
          coverUrl: "",
          hlsUrl: "",
          timestamps:
            Array.isArray(content.timestamps) && content.timestamps.length > 0
              ? content.timestamps
              : undefined,
        },
        duration: 0,
        fileSize: 0,
      };
    case "audio":
      // The content object is replaced whole, so the imported `coverUrl` (and
      // any other field the import added) is dropped with the payload: a cover
      // of a deleted audio file must not survive. The timeline stays, like the
      // video branch above, because it is the user's own work.
      return {
        content: {
          url: "",
          timestamps:
            Array.isArray(content.timestamps) && content.timestamps.length > 0
              ? content.timestamps
              : undefined,
        },
        duration: 0,
        fileSize: 0,
      };
    default:
      return null;
  }
}
