// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The edge and view catalogue (§4.3.4): the graph writes that are not node
 * writes.
 *
 * Two shapes:
 *
 * - `edge.create` / `view.create` target the workspace, because a create has no
 *   object to address yet and the server generates the identity. `edge.create`
 *   names its two endpoints in the input, and the gateway loads both of them
 *   before the write, so a workspace target is not a way around the run's
 *   `ExecutionScope`.
 * - Every other operation targets its edge or view. An edge target carries its
 *   endpoints in the resolved record, so the same endpoint check applies.
 *
 * Capabilities come from the closed domain vocabulary (§4.6.3). It has
 * `edge.create` / `edge.delete` for the structural writes and no `edge.write`
 * or `view.*` entry, so the metadata writes declare `node.write`: they annotate
 * the graph the node grants already cover, and the user branch does not read a
 * capability at all.
 *
 * Handlers are not exported here, for the same reason as `type-operations.ts`:
 * `defineOperationDefinition` names the export the plugin host binds, and a
 * declared-but-unbound operation must refuse enablement rather than run as a
 * silent no-op.
 */

import type { JsonSchema, OperationDefinition } from "@workspace/plugin-sdk";
import { defineOperationDefinition } from "@workspace/plugin-sdk";

import { builtinPluginId } from "./plugin-id.ts";
import { closedObject } from "./operations.ts";

type Capabilities = OperationDefinition["requiredCapabilities"];

const EDGE_CREATE: Capabilities = ["edge.create"];
const EDGE_DELETE: Capabilities = ["edge.delete"];
const GRAPH_WRITE: Capabilities = ["node.write"];

const EDGE_DIRECTION: JsonSchema = {
  enum: ["forward", "reverse", "bidirectional", "undirected"],
};

/** Client and server halves of an edge's own state; both are opaque here. */
const EDGE_STATE_DATA = closedObject(
  { client: { type: "object" }, server: { type: "object" } },
  [],
);

/** The graph renderer's settings; the data view package owns every field. */
const VISUAL_CONFIG = closedObject(
  {
    backgroundColor: { type: "string" },
    colorsSyncTheme: { type: "boolean" },
    backgroundStyle: { enum: ["solid", "grid", "dots", "none"] },
    gridSpacing: { type: "number" },
    gridColor: { type: "string" },
    snapToGrid: { type: "boolean" },
    showMinimap: { type: "boolean" },
    nodeDensity: { type: "number" },
  },
  [],
);

/** A stored filter; `ruleGroup` is the query builder's own recursive shape. */
const FILTER_CONFIG = closedObject(
  {
    selectedNodes: { type: "array", items: { type: "string", minLength: 1 } },
    ruleGroup: { type: "object" },
    collectionType: { type: "string" },
  },
  [],
);

export const graphOperations: readonly OperationDefinition[] = [
  defineOperationDefinition({
    id: "edge.create",
    pluginId: builtinPluginId,
    exportName: "edgeCreate",
    target: "workspace",
    effect: "create",
    inputSchema: closedObject(
      {
        from: { type: "string", minLength: 1 },
        to: { type: "string", minLength: 1 },
        // Empty is allowed: the graph's "add edge" gesture creates an
        // unlabelled edge and the user names it afterwards (`edge.setLabel` or
        // `edge.setSemanticId`). Requiring a non-empty id here left the gesture
        // with no operation to call at all.
        semanticId: { type: "string" },
        direction: EDGE_DIRECTION,
        stateData: EDGE_STATE_DATA,
      },
      ["from", "to", "semanticId", "direction"],
    ),
    requiredCapabilities: EDGE_CREATE,
    idempotent: false,
  }),
  defineOperationDefinition({
    id: "edge.setLabel",
    pluginId: builtinPluginId,
    exportName: "edgeSetLabel",
    target: "edge",
    effect: "update",
    inputSchema: closedObject({ label: { type: "string" } }),
    requiredCapabilities: GRAPH_WRITE,
    idempotent: true,
  }),
  defineOperationDefinition({
    id: "edge.setSemanticId",
    pluginId: builtinPluginId,
    exportName: "edgeSetSemanticId",
    target: "edge",
    effect: "update",
    inputSchema: closedObject({ semanticId: { type: "string", minLength: 1 } }),
    requiredCapabilities: GRAPH_WRITE,
    idempotent: true,
  }),
  defineOperationDefinition({
    id: "edge.setDirection",
    pluginId: builtinPluginId,
    exportName: "edgeSetDirection",
    target: "edge",
    effect: "update",
    inputSchema: closedObject({ direction: EDGE_DIRECTION }),
    requiredCapabilities: GRAPH_WRITE,
    idempotent: true,
  }),
  defineOperationDefinition({
    id: "edge.delete",
    pluginId: builtinPluginId,
    exportName: "edgeDelete",
    target: "edge",
    effect: "delete",
    inputSchema: closedObject({}),
    requiredCapabilities: EDGE_DELETE,
    idempotent: true,
  }),
  defineOperationDefinition({
    id: "view.create",
    pluginId: builtinPluginId,
    exportName: "viewCreate",
    target: "workspace",
    effect: "create",
    inputSchema: closedObject(
      {
        name: { type: "string", minLength: 1 },
        viewType: { enum: ["Force", "Flow"] },
        visualConfig: VISUAL_CONFIG,
        filterConfig: FILTER_CONFIG,
        isPinned: { type: "boolean" },
      },
      ["name", "viewType"],
    ),
    requiredCapabilities: GRAPH_WRITE,
    idempotent: false,
  }),
  defineOperationDefinition({
    id: "view.setLayout",
    pluginId: builtinPluginId,
    exportName: "viewSetLayout",
    target: "view",
    effect: "update",
    inputSchema: closedObject({ visualConfig: VISUAL_CONFIG }),
    requiredCapabilities: GRAPH_WRITE,
    idempotent: true,
  }),
  defineOperationDefinition({
    id: "view.setFilter",
    pluginId: builtinPluginId,
    exportName: "viewSetFilter",
    target: "view",
    effect: "update",
    inputSchema: closedObject({ filterConfig: FILTER_CONFIG }),
    requiredCapabilities: GRAPH_WRITE,
    idempotent: true,
  }),
  defineOperationDefinition({
    id: "view.setName",
    pluginId: builtinPluginId,
    exportName: "viewSetName",
    target: "view",
    effect: "update",
    inputSchema: closedObject({ name: { type: "string", minLength: 1 } }),
    requiredCapabilities: GRAPH_WRITE,
    idempotent: true,
  }),
  defineOperationDefinition({
    id: "view.setType",
    pluginId: builtinPluginId,
    exportName: "viewSetType",
    target: "view",
    effect: "update",
    inputSchema: closedObject({ viewType: { enum: ["Force", "Flow"] } }),
    requiredCapabilities: GRAPH_WRITE,
    idempotent: true,
  }),
  defineOperationDefinition({
    id: "view.setPinned",
    pluginId: builtinPluginId,
    exportName: "viewSetPinned",
    target: "view",
    effect: "update",
    inputSchema: closedObject({ isPinned: { type: "boolean" } }),
    requiredCapabilities: GRAPH_WRITE,
    idempotent: true,
  }),
  defineOperationDefinition({
    id: "view.delete",
    pluginId: builtinPluginId,
    exportName: "viewDelete",
    target: "view",
    effect: "delete",
    inputSchema: closedObject({}),
    requiredCapabilities: GRAPH_WRITE,
    idempotent: true,
  }),
];
