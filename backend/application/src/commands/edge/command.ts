// SPDX-License-Identifier: AGPL-3.0-only

import type { EdgeStateData } from "@workspace/interfaces/models/edge/types";

export interface CreateEdgeCommand {
  id: string;
  from: string;
  to: string;
  direction: "forward" | "reverse" | "bidirectional" | "undirected";
  semanticId: string;
  stateData?: EdgeStateData;
  userId: string;
  sourceId?: string;
  workspaceId?: string;
}

export interface UpdateEdgeCommand {
  id: string;
  direction?: "forward" | "reverse" | "bidirectional" | "undirected";
  semanticId?: string;
  stateData?: EdgeStateData;
  userId: string;
  sourceId?: string;
  workspaceId?: string;
}

export interface DeleteEdgeCommand {
  id: string;
  userId: string;
  sourceId?: string;
}
