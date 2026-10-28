// SPDX-License-Identifier: AGPL-3.0-only

import type { IViewRepository, ViewQuery } from '@workspace/domain';
import { ViewId } from '@workspace/domain';
import type {
  GetViewByIdQuery,
  ListViewsQuery,
  GetViewsByNodeQuery,
  GetPinnedViewsQuery,
} from './query';
import type { ViewDTO } from '../../dto/view.dto';
import type { View } from '@workspace/domain';

function toViewDTO(view: View): ViewDTO {
  return {
    id: view.id.toString(),
    workspaceId: view.workspaceId,
    name: view.name,
    viewType: view.viewType.getValue() as ViewDTO['viewType'],
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
    },
    isPinned: view.isPinned,
    isDefault: view.isDefault,
  };
}

function toViewQuery(q: ListViewsQuery): ViewQuery {
  return {
    isPinned: q.isPinned,
    viewType: q.viewType as ViewQuery['viewType'],
    workspaceId: q.workspaceId,
  };
}

export class ViewQueryService {
  constructor(private readonly viewRepository: IViewRepository) { }

  async getById(q: GetViewByIdQuery): Promise<ViewDTO | null> {
    const view = await this.viewRepository.findById(ViewId.create(q.id));
    return view ? toViewDTO(view) : null;
  }

  async list(q: ListViewsQuery): Promise<ViewDTO[]> {
    const items = await this.viewRepository.findAll(toViewQuery(q));
    return items.map(toViewDTO);
  }

  async listByWorkspace(workspaceId: string): Promise<ViewDTO[]> {
    const items = await this.viewRepository.findAll({ workspaceId });
    return items.map(toViewDTO);
  }

  async getByNodeId(q: GetViewsByNodeQuery): Promise<ViewDTO[]> {
    const views = await this.viewRepository.findByNodeId(q.nodeId as any);
    return views.map(toViewDTO);
  }

  async getPinned(): Promise<ViewDTO[]> {
    const views = await this.viewRepository.findPinned();
    return views.map(toViewDTO);
  }
}
