// SPDX-License-Identifier: AGPL-3.0-only

import { router } from "../server";
import { nodeSemanticRouter } from "./node-semantic";
import { edgeSemanticRouter } from "./edge-semantic";
import { nodeRouter } from "./node";
import { edgeRouter } from "./edge";
import { viewRouter } from "./view";
import { nodeTagRouter } from "./node-tag";
import { eventRouter } from "./event";
import { authRouter } from "./auth";
import { workspaceRouter } from "./workspace";
import { dashboardRouter } from "./dashboard";
import { fileRouter } from "./file";
import { storageRouter } from "./storage";

export const appRouter = router({
  auth: authRouter,
  node: nodeRouter,
  edge: edgeRouter,
  view: viewRouter,
  nodeSemantic: nodeSemanticRouter,
  edgeSemantic: edgeSemanticRouter,
  nodeTag: nodeTagRouter,
  event: eventRouter,
  workspace: workspaceRouter,
  file: fileRouter,
  storage: storageRouter,
  dashboard: dashboardRouter,
});

export type AppRouter = typeof appRouter;
