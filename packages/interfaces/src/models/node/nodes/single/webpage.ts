// SPDX-License-Identifier: AGPL-3.0-only

import type { NodeBase } from "../../base";
import type { NodeType } from "../../types";

export interface WebpageNodeData extends NodeBase, NodeType<"webpage"> {
  /** Byte length of the stored document; 0 while the node has no file. */
  fileSize: number;

  content: WebpageContent;
}

/**
 * The document a webpage node references.
 *
 * A webpage node is a stored web page, not a JSON payload: the document's bytes
 * live in the `files` collection (the object store behind the resource library)
 * and the node keeps only the address, the way a `pdf` node does. The same
 * resource can therefore be listed, renamed, referenced by another node and
 * deleted from the library; deleting it clears this address and {@link
 * WebpageNodeData.fileSize} but keeps the node, its title and its edges.
 *
 * The source language is not stored on the node: it is read from the stored
 * file's name (`.html` renders as a page, a `.js` / `.css` / … file opens as
 * source), so one node can point at any text resource without a second field
 * that could disagree with the file.
 */
export interface WebpageContent {
  /**
   * Stored address `/api/files/files/<record>/<name>`; empty before the first
   * import. Treat it as opaque: the record id and the generated name both
   * change when the address is rewritten.
   */
  url: string;
}
