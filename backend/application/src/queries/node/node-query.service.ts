// SPDX-License-Identifier: AGPL-3.0-only

import type { INodeRepository, NodeQuery } from "@workspace/domain";
import { NodeId } from "@workspace/domain";
import type {
  GetNodeByIdQuery,
  ListNodesQuery,
  GetNodesByIdsQuery,
  GetPinnedNodesQuery,
  GetRecentlyUpdatedNodesQuery,
} from "./query";
import type { NodeDTO } from "../../dto/node.dto";
import { toNodeDTO } from "../../dto/node-dto.mapper";

function toNodeQuery(q: ListNodesQuery): NodeQuery {
  return {
    nodeType: q.nodeType as NodeQuery["nodeType"],
    semanticId: q.semanticId,
    tags: q.tags,
    isPinned: q.isPinned,
    searchTerm: q.searchTerm,
    createdAfter: q.createdAfter,
    createdBefore: q.createdBefore,
    updatedAfter: q.updatedAfter,
    updatedBefore: q.updatedBefore,
    permission: q.permission,
    workspaceId: q.workspaceId,
  };
}

export class NodeQueryService {
  constructor(private readonly nodeRepository: INodeRepository) {}

  async getById(q: GetNodeByIdQuery): Promise<NodeDTO | null> {
    const node = await this.nodeRepository.findById(new NodeId(q.id));
    return node ? toNodeDTO(node) : null;
  }

  async list(q: ListNodesQuery): Promise<NodeDTO[]> {
    const items = await this.nodeRepository.findAll(toNodeQuery(q));
    return items.map(toNodeDTO);
  }

  async listByWorkspace(workspaceId: string): Promise<NodeDTO[]> {
    const items = await this.nodeRepository.findAll({ workspaceId });
    return items.map(toNodeDTO);
  }

  async getByIds(q: GetNodesByIdsQuery): Promise<NodeDTO[]> {
    const nodeIds = q.ids.map((id) => new NodeId(id));
    const nodes = await this.nodeRepository.findByIds(nodeIds);
    return nodes.map(toNodeDTO);
  }

  async getPinned(): Promise<NodeDTO[]> {
    const nodes = await this.nodeRepository.findPinned();
    return nodes.map(toNodeDTO);
  }

  async getRecentlyUpdated(
    q: GetRecentlyUpdatedNodesQuery,
  ): Promise<NodeDTO[]> {
    const nodes = await this.nodeRepository.findRecentlyUpdated(q.limit);
    return nodes.map(toNodeDTO);
  }
}
