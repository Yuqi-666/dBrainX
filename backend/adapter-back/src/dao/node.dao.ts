// SPDX-License-Identifier: AGPL-3.0-only

import type {
  INodeRepository,
  NodeQuery,
} from "@workspace/domain/repositories";
import type { Node } from "@workspace/domain/models";
import type { NodeId } from "@workspace/domain/models/node/value-objects";
import type { NodeSemanticId, NodeTagId } from "@workspace/interfaces/models/node/base";
import type {
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
} from "@workspace/domain/models";

export class NodeDao implements INodeRepository {
  constructor(private repository: INodeRepository) {}

  async findByTitle(title: string): Promise<Node[]> {
    return this.repository.findAll({ searchTerm: title });
  }

  async findBySemanticId(semanticId: NodeSemanticId): Promise<Node[]> {
    return this.repository.findAll({ semanticId });
  }

  async findByTags(tagIds: NodeTagId[]): Promise<Node[]> {
    if (tagIds.length === 0) {
      return [];
    }
    return this.repository.findAll({ tags: tagIds });
  }

  async findWithFilters(query: NodeQuery): Promise<Node[]> {
    return this.repository.findAll(query);
  }

  async findRecentlyCreated(limit: number): Promise<Node[]> {
    const allNodes = await this.repository.findAll({});
    return allNodes
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, limit);
  }

  async findRecentlyUpdated(limit: number): Promise<Node[]> {
    const allNodes = await this.repository.findAll({});
    return allNodes
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      .slice(0, limit);
  }

  async findPinned(): Promise<Node[]> {
    return this.repository.findAll({ isPinned: true });
  }

  async findByDateRange(startDate: string, endDate: string): Promise<Node[]> {
    return this.repository.findAll({
      createdAfter: startDate,
      createdBefore: endDate,
    });
  }

  async findByNodeType(
    nodeType: "text" | "image" | "pdf" | "video" | "audio" | "webpage" | "website" | "collection" | "rich-text" | "database"
  ): Promise<Node[]> {
    return this.repository.findAll({ nodeType });
  }

  async batchSave(nodes: Node[]): Promise<Node[]> {
    const results: Node[] = [];
    const errors: Error[] = [];

    for (const node of nodes) {
      try {
        const saved = await this.repository.save(node);
        results.push(saved);
      } catch (error) {
        errors.push(error instanceof Error ? error : new Error(String(error)));
      }
    }

    if (errors.length > 0) {
      console.warn(`NodeDao.batchSave: ${errors.length} nodes failed to save`, errors);
    }

    return results;
  }

  async batchUpdateTags(nodeIds: NodeId[], tags: NodeTagId[]): Promise<Node[]> {
    return this.repository.updateTags(nodeIds, tags);
  }

  async batchDelete(nodeIds: NodeId[]): Promise<{ deleted: number; failed: number }> {
    let deleted = 0;
    let failed = 0;

    for (const id of nodeIds) {
      try {
        await this.repository.delete(id);
        deleted++;
      } catch {
        failed++;
      }
    }

    return { deleted, failed };
  }

  async findPaginated(
    query?: NodeQuery,
  ): Promise<{ items: Node[]; total: number }> {
    const items = await this.repository.findAll(query);
    return {
      items,
      total: items.length,
    };
  }

  async exists(id: NodeId): Promise<boolean> {
    const node = await this.repository.findById(id);
    return node !== null;
  }

  async count(query?: NodeQuery): Promise<number> {
    return this.repository.count(query);
  }

  async findById(id: NodeId): Promise<Node | null> {
    return this.repository.findById(id);
  }

  async findByIds(ids: NodeId[]): Promise<Node[]> {
    return this.repository.findByIds(ids);
  }

  // ----- INodeRepository implementation -----

  async save(node: Node): Promise<Node> {
    return this.repository.save(node);
  }

  async delete(id: NodeId): Promise<void> {
    return this.repository.delete(id);
  }

  async findAll(query?: NodeQuery): Promise<Node[]> {
    return this.repository.findAll(query);
  }

  async saveMany(nodes: Node[]): Promise<Node[]> {
    return this.repository.saveMany(nodes);
  }

  async deleteMany(ids: NodeId[]): Promise<void> {
    return this.repository.deleteMany(ids);
  }

  async updateTags(ids: NodeId[], tags: NodeTagId[]): Promise<Node[]> {
    return this.repository.updateTags(ids, tags);
  }

  async findTextNode(id: NodeId): Promise<TextNode | null> {
    return this.repository.findTextNode(id);
  }

  async findImageNode(id: NodeId): Promise<ImageNode | null> {
    return this.repository.findImageNode(id);
  }

  async findPdfNode(id: NodeId): Promise<PdfNode | null> {
    return this.repository.findPdfNode(id);
  }

  async findVideoNode(id: NodeId): Promise<VideoNode | null> {
    return this.repository.findVideoNode(id);
  }

  async findAudioNode(id: NodeId): Promise<AudioNode | null> {
    return this.repository.findAudioNode(id);
  }

  async findWebpageNode(id: NodeId): Promise<WebpageNode | null> {
    return this.repository.findWebpageNode(id);
  }

  async findWebsiteNode(id: NodeId): Promise<WebsiteNode | null> {
    return this.repository.findWebsiteNode(id);
  }

  async findCollectionNode(id: NodeId): Promise<CollectionNode | null> {
    return this.repository.findCollectionNode(id);
  }

  async findRichTextNode(id: NodeId): Promise<RichTextNode | null> {
    return this.repository.findRichTextNode(id);
  }

  async findDatabaseNode(id: NodeId): Promise<DatabaseNode | null> {
    return this.repository.findDatabaseNode(id);
  }
}