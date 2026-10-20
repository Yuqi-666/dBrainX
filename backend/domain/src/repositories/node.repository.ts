// SPDX-License-Identifier: AGPL-3.0-only

import type {
  Node,
  TextNode,
  ImageNode,
  PdfNode,
  VideoNode,
  AudioNode,
  WebpageNode,
  WebsiteNode,
  CollectionNode,
  RichTextNode,
  DatabaseNode,
} from "../models/node/entities";
import type {
  NodeId,
  Permission,
  NodeType,
} from "../models/node/value-objects";

type NodeSemanticId = string;
type NodeTagId = string;

// ============================================================
// Query Objects (Plain objects for flexible querying)
// ============================================================

/**
 * Node query object for flexible filtering.
 * Plain object - not a value object to keep domain pure.
 */
export interface NodeQuery {
  nodeType?: NodeType["value"];
  semanticId?: NodeSemanticId;
  tags?: NodeTagId[];
  isPinned?: boolean;
  searchTerm?: string;
  createdAfter?: string;
  createdBefore?: string;
  updatedAfter?: string;
  updatedBefore?: string;
  permission?: Permission["value"];
  workspaceId?: string;
}

// ============================================================
// INodeRepository - Node Aggregate Root
// ============================================================

/**
 * Repository port for Node aggregate root.
 *
 * Single repository handles all 10 node types (TextNode, ImageNode, …,
 * DatabaseNode) Type-specific finders return exact types for type safety.
 */
export interface INodeRepository {
  // ----- Single Entity Operations -----

  /**
   * Find a node by its ID.
   * Returns the base Node type - use type-specific finders for exact types.
   */
  findById(id: NodeId): Promise<Node | null>;

  /**
   * Save (create or update) a node.
   */
  save(node: Node): Promise<Node>;

  /**
   * Delete a node by ID.
   */
  delete(id: NodeId): Promise<void>;

  // ----- Type-Specific Finders -----

  findTextNode(id: NodeId): Promise<TextNode | null>;
  findImageNode(id: NodeId): Promise<ImageNode | null>;
  findPdfNode(id: NodeId): Promise<PdfNode | null>;
  findVideoNode(id: NodeId): Promise<VideoNode | null>;
  findAudioNode(id: NodeId): Promise<AudioNode | null>;
  findWebpageNode(id: NodeId): Promise<WebpageNode | null>;
  findWebsiteNode(id: NodeId): Promise<WebsiteNode | null>;
  findCollectionNode(id: NodeId): Promise<CollectionNode | null>;
  findRichTextNode(id: NodeId): Promise<RichTextNode | null>;
  findDatabaseNode(id: NodeId): Promise<DatabaseNode | null>;

  // ----- Collection Operations -----

  /**
   * Find all nodes matching query (no pagination).
   */
  findAll(query?: NodeQuery): Promise<Node[]>;

  /**
   * Find multiple nodes by their IDs.
   * Preserves order of input IDs in result.
   */
  findByIds(ids: NodeId[]): Promise<Node[]>;

  /**
   * Count nodes matching query.
   */
  count(query?: NodeQuery): Promise<number>;

  // ----- Batch Operations -----

  /**
   * Save multiple nodes in batch.
   * Implementations should use bulk insert/update for performance.
   */
  saveMany(nodes: Node[]): Promise<Node[]>;

  /**
   * Delete multiple nodes in batch.
   */
  deleteMany(ids: NodeId[]): Promise<void>;

  /**
   * Update tags for multiple nodes.
   */
  updateTags(ids: NodeId[], tags: NodeTagId[]): Promise<Node[]>;

  // ----- Quick Access Operations -----

  /**
   * Find all pinned nodes.
   */
  findPinned(): Promise<Node[]>;

  /**
   * Find recently updated nodes.
   * @param limit Maximum number of results
   */
  findRecentlyUpdated(limit: number): Promise<Node[]>;
}
