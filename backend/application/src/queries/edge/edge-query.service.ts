// SPDX-License-Identifier: AGPL-3.0-only

import type { Edge, EdgeQuery, IEdgeRepository, NodeQuery } from "@workspace/domain";
import type {
  GetEdgeByIdQuery,
  ListEdgesQuery,
  GetEdgesByNodeQuery,
  GetEdgesByEndpointsQuery,
  GetEdgesByIdsQuery,
} from "./query";
import type { EdgeDTO } from "../../dto/edge.dto";
import { EdgeId, EdgeDirection } from "@workspace/domain/models/edge/value-objects";

function toEdgeDTO(edge: Edge): EdgeDTO {
  return {
    id: edge.id.toString(),
    workspaceId: edge.workspaceId,
    from: edge.from.toString(),
    to: edge.to.toString(),
    direction: edge.direction.getValue(),
    semanticId: edge.semanticId,
    stateData: edge.stateData,
    createdAt: edge.createdAt,
    updatedAt: edge.updatedAt,
  };
}
function toEdgeDirection(dir: string): EdgeDirection {
  switch (dir) {
    case "forward":
      return EdgeDirection.forward();
    case "reverse":
      return EdgeDirection.reverse();
    case "bidirectional":
      return EdgeDirection.bidirectional();
    case "undirected":
      return EdgeDirection.undirected();
    default:
      throw new Error(`Invalid edge direction: ${dir}`);
  }
}

function toEdgeQuery(q: ListEdgesQuery): EdgeQuery {
  return {
    from: q.from as any,
    to: q.to as any,
    semanticId: q.semanticId,
    direction: q.direction ? toEdgeDirection(q.direction) : undefined,
    workspaceId: q.workspaceId,
  }
}
export class EdgeQueryService {
  constructor(private readonly edgeRepository: IEdgeRepository) { }

  async getById(q: GetEdgeByIdQuery): Promise<EdgeDTO | null> {
    const edge = await this.edgeRepository.findById(EdgeId.create(q.id));
    return edge ? toEdgeDTO(edge) : null;
  }

  async list(q: ListEdgesQuery): Promise<EdgeDTO[]> {
    const items = await this.edgeRepository.findAll(toEdgeQuery(q));
    return items.map(toEdgeDTO);
  }

  async listByWorkspace(workspaceId: string): Promise<EdgeDTO[]> {
    const items = await this.edgeRepository.findAll({ workspaceId });
    return items.map(toEdgeDTO);
  }

  async getByNodeId(q: GetEdgesByNodeQuery): Promise<EdgeDTO[]> {
    const edges = await this.edgeRepository.findByNodeId(q.nodeId as any);
    return edges.map(toEdgeDTO);
  }

  async getByEndpoints(q: GetEdgesByEndpointsQuery): Promise<EdgeDTO[]> {
    const edges = await this.edgeRepository.findByEndpoints(
      q.from as any,
      q.to as any,
    );
    return edges.map(toEdgeDTO);
  }

  async getByIds(q: GetEdgesByIdsQuery): Promise<EdgeDTO[]> {
    const edges = await this.edgeRepository.findByIds(
      q.ids.map((id) => EdgeId.create(id)),
    );
    return edges.map(toEdgeDTO);
  }
}
