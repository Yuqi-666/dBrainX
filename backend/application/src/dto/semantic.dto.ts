// SPDX-License-Identifier: AGPL-3.0-only

import type { EdgeType } from "@workspace/interfaces/models/edge/types";

export interface NodeSemanticDTO {
  id: string;
  name: string;
  description?: string;
  color?: string;
  icon?: string;
  workspaceId?: string;
}

export interface EdgeSemanticDTO {
  id: string;
  name: string;
  category: EdgeType;
  color?: string;
  icon?: string;
  description?: string;
  workspaceId?: string;
}

export interface NodeTagDTO {
  id: string;
  name: string;
  color?: string;
  workspaceId?: string;
}
