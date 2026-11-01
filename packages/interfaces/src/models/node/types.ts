// SPDX-License-Identifier: AGPL-3.0-only

import type { NodeBase } from "./base";

/**
 * A node type id (§4.2.6).
 *
 * Node types are runtime data after the plugin upgrade: a plugin declares its
 * own type, so no compile-time list of ids can be complete. The kernel carries
 * the id as a plain string, and the *registry* — not this package — answers
 * which types exist (`packages/ui/src/components/node-content/registry.ts`,
 * §4.9.2).
 */
export type NodeTypeId = string;

/**
 * @deprecated A migration alias for {@link NodeTypeId}, kept while callers that
 * still name the old closed union are retargeted. It no longer restricts the
 * value to the ten builtin types, and it disappears once the last caller moves.
 */
export type NodeDataType = NodeTypeId;

/** The discriminant a node of type `T` carries. */
export interface NodeType<T extends NodeTypeId = NodeTypeId> {
  nodeType: T;
}

/**
 * The media facts the wire flattens onto a node (§4.2.6).
 *
 * The aggregate keeps them apart from `content`; `toNodeDTO` lifts them to the
 * node's top level because a card, a grid row or the island reads them without
 * knowing the type. Optional here — a concrete type requires its own (an
 * `image` node always has `width`), and a type without media carries none.
 */
export interface NodeMediaFacts {
  width?: number;
  height?: number;
  fileSize?: number;
  pageCount?: number;
  duration?: number;
  source?: "local" | "online";
  sourceUrl?: string;
  location?: string;
  shootingTime?: string;
}

/**
 * The open node shape shared by the client, the server and the plugin host.
 *
 * `content` is opaque here: the plugin that owns `nodeType` declares that
 * payload's schema and TypeScript type, so a shared package can carry a node of
 * a type it has never heard of. A builtin concrete type (`TextNodeData`, …) is
 * this same shape with a literal `nodeType`, a typed `content` and its own
 * required media facts.
 */
export interface NodeData<C = unknown>
  extends NodeBase, NodeMediaFacts, NodeType {
  content: C;
}
