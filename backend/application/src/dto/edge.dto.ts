// SPDX-License-Identifier: AGPL-3.0-only

import type { EdgeStateData } from "@workspace/interfaces/models/edge/types";

export interface EdgeDTO {
  id: string;
  workspaceId?: string;
  from: string;
  to: string;
  direction: "forward" | "reverse" | "bidirectional" | "undirected";
  semanticId: string;
  stateData?: EdgeStateData;
  createdAt: string;
  updatedAt: string;
}

