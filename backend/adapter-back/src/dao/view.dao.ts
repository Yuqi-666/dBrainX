// SPDX-License-Identifier: AGPL-3.0-only

import type {
  IViewRepository,
  ViewQuery,
} from "@workspace/domain/repositories";
import type { View, ViewType } from "@workspace/domain/models";
import { ViewId } from "@workspace/domain/models/view/value-objects";
import type { NodeId } from "@workspace/domain/models/node/value-objects";

export class ViewDao implements IViewRepository {
  constructor(private repository: IViewRepository) { }

  async findById(id: ViewId): Promise<View | null> {
    return this.repository.findById(id);
  }

  async save(view: View): Promise<View> {
    return this.repository.save(view);
  }

  async delete(id: ViewId): Promise<void> {
    return this.repository.delete(id);
  }

  async findAll(query?: ViewQuery): Promise<View[]> {
    return this.repository.findAll(query);
  }

  async findByNodeId(nodeId: NodeId): Promise<View[]> {
    return this.repository.findByNodeId(nodeId);
  }

  async findPinned(): Promise<View[]> {
    return this.repository.findPinned();
  }

  async count(query?: ViewQuery): Promise<number> {
    return this.repository.count(query);
  }

  async saveMany(views: View[]): Promise<View[]> {
    return this.repository.saveMany(views);
  }

  async deleteMany(ids: ViewId[]): Promise<void> {
    return this.repository.deleteMany(ids);
  }

  async findByViewType(viewType: ViewType): Promise<View[]> {
    return this.repository.findAll({ viewType: viewType.getValue() });
  }

  async findContainingNodes(nodeIds: NodeId[]): Promise<View[]> {
    if (nodeIds.length === 0) {
      return [];
    }

    const allViews = await this.repository.findAll({});
    const matchingViews: View[] = [];

    for (const view of allViews) {
      const config = view.filterConfig;
      const selectedNodes = config.selectedNodes;
      if (selectedNodes && selectedNodes.length > 0) {
        const hasMatchingNode = nodeIds.some((nodeId) =>
          selectedNodes.some((selected) => selected === nodeId)
        );
        if (hasMatchingNode) {
          matchingViews.push(view);
        }
      }
    }

    return matchingViews;
  }

  async findWithFilters(query: ViewQuery): Promise<View[]> {
    return this.repository.findAll(query);
  }

  async findPaginated(
    query?: ViewQuery,
  ): Promise<{ items: View[]; total: number }> {
    const items = await this.repository.findAll(query);
    return {
      items,
      total: items.length,
    };
  }

  async batchSave(views: View[]): Promise<{ saved: View[]; failed: number }> {
    const saved: View[] = [];
    let failed = 0;

    for (const view of views) {
      try {
        const result = await this.repository.save(view);
        saved.push(result);
      } catch {
        failed++;
      }
    }

    return { saved, failed };
  }

  async batchDelete(viewIds: ViewId[]): Promise<{ deleted: number; failed: number }> {
    let deleted = 0;
    let failed = 0;

    for (const id of viewIds) {
      try {
        await this.repository.delete(id);
        deleted++;
      } catch {
        failed++;
      }
    }

    return { deleted, failed };
  }

  async exists(id: ViewId): Promise<boolean> {
    const view = await this.repository.findById(id);
    return view !== null;
  }

  async getNodeCount(viewId: ViewId): Promise<number> {
    const view = await this.repository.findById(viewId);
    if (!view) {
      return 0;
    }
    return view.filterConfig.selectedNodes?.length ?? 0;
  }

  async pinView(viewId: ViewId): Promise<View | null> {
    const view = await this.repository.findById(viewId);
    if (!view) {
      return null;
    }
    const pinned = view.pin();
    return this.repository.save(pinned);
  }

  async unpinView(viewId: ViewId): Promise<View | null> {
    const view = await this.repository.findById(viewId);
    if (!view) {
      return null;
    }
    const unpinned = view.unpin();
    return this.repository.save(unpinned);
  }
}
