// SPDX-License-Identifier: AGPL-3.0-only

import {
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
} from "@workspace/domain/models/node/entities";
import type {
  NodeId,
} from "@workspace/domain/models/node/value-objects";
import type {
  INodeRepository,
  NodeQuery,
} from "@workspace/domain/repositories";

import { NodeMapper, type BaseNodeRecord } from "../database/mappers/node.mapper";
import { PocketBaseClient } from "../database/pocketbase-client";

type NodeTagId = string;

const COLLECTION_NAME = "nodes";

export class PocketBaseNodeRepository implements INodeRepository {
  private mapper = new NodeMapper();

  constructor(private pb: PocketBaseClient) {}

  private collection() {
    return this.pb.collection<BaseNodeRecord>(COLLECTION_NAME);
  }

  async findById(id: NodeId): Promise<Node | null> {
    try {
      const record = await this.collection().getOne(id.value);
      return this.mapper.toDomain(record);
    } catch (error) {
      if (this.pb.isClientResponseError(error) && error.status === 404) {
        return null;
      }
      throw error;
    }
  }

  async save(node: Node): Promise<Node> {
    if (!node.id) {
      throw new Error("Domain 校验失败：实体必须包含 id");
    }

    const isTemporaryId = node.id.value.startsWith("tmp_");
    const data = this.mapper.toRecord(node);
    delete data.id;

    let record;
    if (isTemporaryId) {
      record = await this.collection().create(data, { requestKey: node.id.value });
    } else {
      record = await this.collection().update(node.id.value, data, { requestKey: node.id.value });
    }

    return this.mapper.toDomain(record);
  }

  async delete(id: NodeId): Promise<void> {
    await this.collection().delete(id.value);
  }

  async findTextNode(id: NodeId): Promise<TextNode | null> {
    const node = await this.findById(id);
    if (!node || !(node instanceof TextNode)) {
      return null;
    }
    return node;
  }

  async findImageNode(id: NodeId): Promise<ImageNode | null> {
    const node = await this.findById(id);
    if (!node || !(node instanceof ImageNode)) {
      return null;
    }
    return node;
  }

  async findPdfNode(id: NodeId): Promise<PdfNode | null> {
    const node = await this.findById(id);
    if (!node || !(node instanceof PdfNode)) {
      return null;
    }
    return node;
  }

  async findVideoNode(id: NodeId): Promise<VideoNode | null> {
    const node = await this.findById(id);
    if (!node || !(node instanceof VideoNode)) {
      return null;
    }
    return node;
  }

  async findAudioNode(id: NodeId): Promise<AudioNode | null> {
    const node = await this.findById(id);
    if (!node || !(node instanceof AudioNode)) {
      return null;
    }
    return node;
  }

  async findWebpageNode(id: NodeId): Promise<WebpageNode | null> {
    const node = await this.findById(id);
    if (!node || !(node instanceof WebpageNode)) {
      return null;
    }
    return node;
  }

  async findWebsiteNode(id: NodeId): Promise<WebsiteNode | null> {
    const node = await this.findById(id);
    if (!node || !(node instanceof WebsiteNode)) {
      return null;
    }
    return node;
  }

  async findCollectionNode(id: NodeId): Promise<CollectionNode | null> {
    const node = await this.findById(id);
    if (!node || !(node instanceof CollectionNode)) {
      return null;
    }
    return node;
  }

  async findRichTextNode(id: NodeId): Promise<RichTextNode | null> {
    const node = await this.findById(id);
    if (!node || !(node instanceof RichTextNode)) {
      return null;
    }
    return node;
  }

  async findDatabaseNode(id: NodeId): Promise<DatabaseNode | null> {
    const node = await this.findById(id);
    if (!node || !(node instanceof DatabaseNode)) {
      return null;
    }
    return node;
  }

  async findAll(query?: NodeQuery): Promise<Node[]> {
    const filter = this.buildFilter(query);
    const sort = query?.updatedAfter || query?.createdAfter ? "-updated" : "-id";

    const records = await this.collection().getFullList({
      filter: filter || undefined,
      sort,
    });

    return records.map((record) => this.mapper.toDomain(record));
  }

  async findByIds(ids: NodeId[]): Promise<Node[]> {
    if (ids.length === 0) {
      return [];
    }

    const idValues = ids.map((id) => id.value);
    const filter = `id ?= "${idValues.join('" || id ?= "')}"`;

    const records = await this.collection().getFullList({
      filter,
    });

    const nodeMap = new Map(
      records.map((record) => [record.id, this.mapper.toDomain(record)]),
    );

    return ids
      .map((id) => nodeMap.get(id.value))
      .filter((node): node is Node => node !== undefined);
  }

  async count(query?: NodeQuery): Promise<number> {
    const filter = this.buildFilter(query);
    const records = await this.collection().getFullList({
      filter: filter || undefined,
    });
    return records.length;
  }

  async saveMany(nodes: Node[]): Promise<Node[]> {
    if (nodes.length === 0) {
      return [];
    }

    const results: Node[] = [];

    for (const node of nodes) {
      const saved = await this.save(node);
      results.push(saved);
    }

    return results;
  }

  async deleteMany(ids: NodeId[]): Promise<void> {
    if (ids.length === 0) {
      return;
    }

    for (const id of ids) {
      await this.delete(id);
    }
  }

  async updateTags(ids: NodeId[], tags: NodeTagId[]): Promise<Node[]> {
    if (ids.length === 0) {
      return [];
    }

    const results: Node[] = [];

    for (const id of ids) {
      const node = await this.findById(id);
      if (node) {
        await this.collection().update(id.value, { tags });
        const updated = await this.findById(id);
        if (updated) {
          results.push(updated);
        }
      }
    }

    return results;
  }

  async findPinned(): Promise<Node[]> {
    const records = await this.collection().getFullList({
      filter: "isPinned = true",
      sort: "-updated",
    });

    return records.map((record) => this.mapper.toDomain(record));
  }

  async findRecentlyUpdated(limit: number): Promise<Node[]> {
    const records = await this.collection().getFullList({
      sort: "-updated",
    });

    return records.slice(0, limit).map((record) => this.mapper.toDomain(record));
  }

  private buildFilter(query?: NodeQuery): string | undefined {
    if (!query) {
      return undefined;
    }

    const conditions: string[] = [];

    if (query.nodeType) {
      conditions.push(`nodeType = "${query.nodeType}"`);
    }

    if (query.semanticId) {
      conditions.push(`semanticId = "${query.semanticId}"`);
    }

    if (query.isPinned !== undefined) {
      conditions.push(`isPinned = ${query.isPinned}`);
    }

    if (query.permission) {
      conditions.push(`permission = "${query.permission}"`);
    }

    if (query.tags && query.tags.length > 0) {
      const tagFilters = query.tags.map((tag) => `tags ~ "${tag}"`);
      conditions.push(`(${tagFilters.join(" || ")})`);
    }

    if (query.searchTerm) {
      conditions.push(`(title ~ "${query.searchTerm}" || abstract ~ "${query.searchTerm}")`);
    }

    if (query.createdAfter) {
      conditions.push(`created > "${query.createdAfter}"`);
    }

    if (query.createdBefore) {
      conditions.push(`created < "${query.createdBefore}"`);
    }

    if (query.updatedAfter) {
      conditions.push(`updated > "${query.updatedAfter}"`);
    }

    if (query.updatedBefore) {
      conditions.push(`updated < "${query.updatedBefore}"`);
    }

    if (query.workspaceId) {
      conditions.push(`workspaceId = "${query.workspaceId}"`);
    }

    if (conditions.length === 0) {
      return undefined;
    }

    return conditions.join(" && ");
  }
}
