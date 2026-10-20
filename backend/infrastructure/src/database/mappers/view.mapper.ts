// SPDX-License-Identifier: AGPL-3.0-only

import type { RecordModel } from "pocketbase";
import { View } from "@workspace/domain/models/view/entities";
import { ViewId, VisualConfig, ViewType } from "@workspace/domain/models/view/value-objects";
import {
  filterConfigFromRecord,
  filterConfigToRecord,
} from "./filter-config.mapper";

export class ViewMapper {
  static toDomain(record: RecordModel): View {
    return View.create({
      id: ViewId.create(record.id),
      name: record.name as string,
      viewType: ViewType.fromString(record.viewType as string),
      visualConfig: VisualConfig.create(
        record.visualConfig as Partial<VisualConfig>,
      ),
      filterConfig: filterConfigFromRecord(record.filterConfig),
      isPinned: record.isPinned as boolean,
      isDefault: record.isDefault as boolean,
      workspaceId: record.workspaceId as string | undefined,
    });
  }

  static toRecord(view: View): Partial<RecordModel> {
    return {
      id: view.id.value,
      name: view.name,
      viewType: view.viewType.getValue(),
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
      filterConfig: filterConfigToRecord(view.filterConfig),
      isPinned: view.isPinned,
      isDefault: view.isDefault,
      workspaceId: view.workspaceId,
    };
  }
}
