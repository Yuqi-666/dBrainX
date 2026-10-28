// SPDX-License-Identifier: AGPL-3.0-only

import type { IViewRepository } from "@workspace/domain";
import type { IEventBus } from "@workspace/domain";
import type { ViewCreated, ViewDeleted, ViewUpdated } from "@workspace/domain";
import type { CreateViewCommand, UpdateViewCommand, DeleteViewCommand } from "./command";
import type { ViewDTO, VisualConfigDTO } from "../../dto/view.dto";
import { View } from "@workspace/domain/models/view/entities";
import { ViewId, VisualConfig, ViewType } from "@workspace/domain/models/view/value-objects";
import { FilterConfig, NodeId } from "@workspace/domain";
function toViewDTO(view: View): ViewDTO {
  return {
    id: view.id.toString(),
    workspaceId: view.workspaceId,
    name: view.name,
    viewType: view.viewType.getValue() as ViewDTO["viewType"],
    visualConfig: {
      backgroundColor: view.visualConfig.backgroundColor,
      colorsSyncTheme: view.visualConfig.colorsSyncTheme,
      backgroundStyle: view.visualConfig.backgroundStyle,
      gridSpacing: view.visualConfig.gridSpacing,
      gridColor: view.visualConfig.gridColor,
      snapToGrid: view.visualConfig.snapToGrid,
      showMinimap: view.visualConfig.showMinimap,
      nodeDensity: view.visualConfig.nodeDensity,
    },
    filterConfig: {
      selectedNodes: view.filterConfig.selectedNodes?.map(nodeId => nodeId.value),
      ruleGroup: view.filterConfig.ruleGroup,
      collectionType: view.filterConfig.collectionType
    }
    ,
    isPinned: view.isPinned,
    isDefault: view.isDefault,
  };
}

export class ViewCommandService {
  constructor(
    private readonly viewRepository: IViewRepository,
    private readonly eventBus: IEventBus,
  ) { }

  async createView(cmd: CreateViewCommand): Promise<ViewDTO> {
    const visualConfig = VisualConfig.create({
      backgroundColor: cmd.visualConfig?.backgroundColor,
      colorsSyncTheme: cmd.visualConfig?.colorsSyncTheme,
    });

    const filterConfig = FilterConfig.create({
      selectedNodes: cmd.filterConfig?.selectedNodes?.map(nodeId => new NodeId(nodeId)) ?? [],
      ruleGroup: cmd.filterConfig?.ruleGroup,
      collectionType: cmd.filterConfig?.collectionType,
    });

    const view = View.create({
      id: cmd.id,
      name: cmd.name,
      viewType: ViewType.fromString(cmd.viewType),
      visualConfig,
      filterConfig,
      isPinned: cmd.isPinned ?? false,
      workspaceId: cmd.workspaceId,
    });

    const saved = await this.viewRepository.save(view);

    const event: ViewCreated = {
      eventType: "ViewCreated",
      aggregateId: saved.id.toString(),
      metadata: {
        workspaceId: saved.workspaceId,
        occurredAt: new Date().toISOString(),
        eventVersion: 1,
        userId: cmd.userId,
        sourceId: cmd.sourceId,
      },
      data: {
        id: saved.id.toString(),
      },
    };
    this.eventBus.publish(event);

    return toViewDTO(saved);
  }

  async updateView(cmd: UpdateViewCommand): Promise<ViewDTO> {
    const id = ViewId.create(cmd.id);
    const view = await this.viewRepository.findById(id);

    if (!view) {
      throw new Error(`View not found: ${cmd.id}`);
    }

    let updated = view;

    if (cmd.name !== undefined) {
      updated = updated.updateName(cmd.name);
    }

    if (cmd.viewType !== undefined) {
      updated = updated.updateViewType(ViewType.fromString(cmd.viewType));
    }

    if (cmd.visualConfig !== undefined) {
      // Merge the partial patch over the existing config — creating a
      // fresh config from only the patch fields would reset every
      // untouched visual setting (backgroundStyle, gridColor, ...) to
      // its default.
      const newVisualConfig = VisualConfig.create({
        ...updated.visualConfig,
        ...cmd.visualConfig,
      });
      updated = updated.updateVisualConfig(newVisualConfig);
    }

    if (cmd.filterConfig !== undefined) {
      const newFilterConfig = FilterConfig.create({
        selectedNodes: cmd.filterConfig.selectedNodes?.map(nodeId => new NodeId(nodeId)) ?? [],
        ruleGroup: cmd.filterConfig.ruleGroup,
        collectionType: cmd.filterConfig.collectionType,
      });
      updated = updated.updateFilterConfig(newFilterConfig);
    }

    if (cmd.isPinned !== undefined) {
      updated = cmd.isPinned ? updated.pin() : updated.unpin();
    }

    const saved = await this.viewRepository.save(updated);

    const event: ViewUpdated = {
      eventType: "ViewUpdated",
      aggregateId: saved.id.toString(),
      metadata: {
        workspaceId: saved.workspaceId,
        occurredAt: new Date().toISOString(),
        eventVersion: 1,
        userId: cmd.userId,
        sourceId: cmd.sourceId,
      },
      data: {
        id: saved.id.toString(),
      },
    };
    this.eventBus.publish(event);

    return toViewDTO(saved);
  }

  async deleteView(cmd: DeleteViewCommand): Promise<void> {
    const id = ViewId.create(cmd.id);
    const existing = await this.viewRepository.findById(id);
    if (!existing) throw new Error("Record not found");
    if (existing.isDefault) {
      throw new Error("The default view cannot be deleted");
    }
    await this.viewRepository.delete(id);

    const event: ViewDeleted = {
      eventType: "ViewDeleted",
      aggregateId: cmd.id,
      metadata: {
        workspaceId: existing.workspaceId,
        occurredAt: new Date().toISOString(),
        eventVersion: 1,
        userId: cmd.userId,
        sourceId: cmd.sourceId,
      },
      data: {
        id: cmd.id,
      },
    };
    this.eventBus.publish(event);
  }
}
