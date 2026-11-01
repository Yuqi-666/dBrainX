// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The builtin operation catalogue: the shared operations every node type gets
 * (§4.3.4), declared once for the whole plugin.
 *
 * Three groups live here and only here:
 *
 * - `node.add`, the single creation entry. It targets the workspace and takes
 *   `{ nodeType }` and nothing else; the server generates the id, the
 *   workspace, the default content and the timestamps, so `content`, `title`,
 *   `id` and `workspaceId` are refused by the schema instead of ignored.
 * - The public metadata operations. They target a node and omit `appliesTo`,
 *   which the domain contract defines as "every node type" — declaring the
 *   same list on ten types would let the copies drift.
 * - `*.attachFile` for the four media types. They declare `appliesTo` because a
 *   file operation on a `text` node is meaningless, and the metadata (size,
 *   duration, page count) is read server side from the upload result, never
 *   assembled by the client.
 *
 * `handler` is the export the plugin host binds later; it is not a
 * `run` function, because the metadata behaviour is host code and the executor
 * that calls it lands in a later plan todo. A definition without a handler is
 * still a full registry entry: the host refuses to enable a plugin whose
 * declared export is missing.
 *
 * The plan's operation catalogue is closed: a test asserts this set exactly, so
 * a new operation is a deliberate change to `operations` and to that test.
 */

import type { JsonSchema, OperationDefinition } from "@workspace/plugin-sdk";
import { defineOperationDefinition } from "@workspace/plugin-sdk";

import { builtinPluginId } from "./plugin-id.ts";

/**
 * Closed input object: undeclared fields are refused, never dropped.
 * Shared with `type-operations.ts`, so both catalogues close inputs one way.
 */
export function closedObject(
  properties: Readonly<Record<string, JsonSchema>>,
  required: readonly string[] = Object.keys(properties),
): JsonSchema {
  return {
    type: "object",
    properties,
    ...(required.length > 0 ? { required: [...required] } : {}),
    additionalProperties: false,
  };
}

/** Shared state of a node; per-user view state does not live here (§4.3.4). */
const NODE_STATE_DATA: JsonSchema = closedObject({
  client: { type: "object" },
  server: { type: "object" },
});

/**
 * Display icon; clearing is `node.clearIcon`, so `null` is not accepted.
 *
 * `color` is optional because `NodeIcon.color` is: a user who picks an emoji
 * without a background sends `{ kind, value }`, and a schema that required the
 * colour would refuse the ordinary case.
 */
const NODE_ICON: JsonSchema = closedObject(
  {
    kind: { enum: ["emoji", "icon", "image"] },
    value: { type: "string", minLength: 1 },
    color: { type: "string", pattern: "^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$" },
  },
  ["kind", "value"],
);

/** Cover; clearing is `node.clearCover`, so `null` is not accepted. */
const NODE_COVER: JsonSchema = {
  oneOf: [
    closedObject({
      kind: { const: "image" },
      url: { type: "string", minLength: 1 },
    }),
    closedObject({
      kind: { const: "node" },
      nodeId: { type: "string", minLength: 1 },
    }),
  ],
};

const NODE_PERMISSION: JsonSchema = {
  enum: ["private", "public", "restricted"],
};

/**
 * Declares one shared operation under the builtin plugin.
 *
 * The gateway checks only the capability named here; the owner rule of
 * `node.setPermission` / `node.setSemanticId` and their uniqueness lookup stay
 * handler rules, so the gateway never becomes a second permission layer.
 */
function defineShared(
  spec: Omit<
    Parameters<typeof defineOperationDefinition>[0],
    "pluginId"
  >,
): OperationDefinition {
  return defineOperationDefinition({ ...spec, pluginId: builtinPluginId });
}

const NODE_WRITE = ["node.write"] as const;

/**
 * Input of every `*.attachFile` operation.
 *
 * `uploadId` is the id of the stored upload result (a `files` record). The two
 * optional fields name provenance only — the file's size, duration, page count
 * and renditions are always read from the record, never sent.
 */
const ATTACH_FILE_INPUT: JsonSchema = closedObject(
  {
    uploadId: { type: "string", minLength: 1 },
    source: { enum: ["local", "online"] },
    sourceUrl: { type: "string" },
  },
  ["uploadId"],
);

export const operations: readonly OperationDefinition[] = [
  defineShared({
    id: "node.add",
    exportName: "nodeAdd",
    target: "workspace",
    effect: "create",
    inputSchema: closedObject({ nodeType: { type: "string", minLength: 1 } }),
    requiredCapabilities: ["node.create"],
    idempotent: false,
  }),

  // Public metadata operations: target `node`, every node type.
  defineShared({
    id: "node.setTitle",
    exportName: "nodeSetTitle",
    target: "node",
    effect: "update",
    inputSchema: closedObject({ title: { type: "string" } }),
    requiredCapabilities: NODE_WRITE,
    idempotent: true,
  }),
  defineShared({
    id: "node.setAbstract",
    exportName: "nodeSetAbstract",
    target: "node",
    effect: "update",
    inputSchema: closedObject({ abstract: { type: "string" } }),
    requiredCapabilities: NODE_WRITE,
    idempotent: true,
  }),
  defineShared({
    id: "node.setSemanticId",
    exportName: "nodeSetSemanticId",
    target: "node",
    effect: "update",
    inputSchema: closedObject({ semanticId: { type: "string", minLength: 1 } }),
    requiredCapabilities: NODE_WRITE,
    idempotent: true,
  }),
  defineShared({
    id: "node.setIcon",
    exportName: "nodeSetIcon",
    target: "node",
    effect: "update",
    inputSchema: closedObject({ icon: NODE_ICON }),
    requiredCapabilities: NODE_WRITE,
    idempotent: true,
  }),
  defineShared({
    id: "node.clearIcon",
    exportName: "nodeClearIcon",
    target: "node",
    effect: "update",
    inputSchema: closedObject({}),
    requiredCapabilities: NODE_WRITE,
    idempotent: true,
  }),
  defineShared({
    id: "node.setCover",
    exportName: "nodeSetCover",
    target: "node",
    effect: "update",
    inputSchema: closedObject({ cover: NODE_COVER }),
    requiredCapabilities: NODE_WRITE,
    idempotent: true,
  }),
  defineShared({
    id: "node.clearCover",
    exportName: "nodeClearCover",
    target: "node",
    effect: "update",
    inputSchema: closedObject({}),
    requiredCapabilities: NODE_WRITE,
    idempotent: true,
  }),
  defineShared({
    id: "node.pin",
    exportName: "nodePin",
    target: "node",
    effect: "update",
    inputSchema: closedObject({}),
    requiredCapabilities: NODE_WRITE,
    idempotent: true,
  }),
  defineShared({
    id: "node.unpin",
    exportName: "nodeUnpin",
    target: "node",
    effect: "update",
    inputSchema: closedObject({}),
    requiredCapabilities: NODE_WRITE,
    idempotent: true,
  }),
  defineShared({
    id: "node.setPermission",
    exportName: "nodeSetPermission",
    target: "node",
    effect: "update",
    inputSchema: closedObject({ permission: NODE_PERMISSION }),
    requiredCapabilities: NODE_WRITE,
    idempotent: true,
  }),
  defineShared({
    id: "node.addTag",
    exportName: "nodeAddTag",
    target: "node",
    effect: "update",
    inputSchema: closedObject({ tag: { type: "string", minLength: 1 } }),
    requiredCapabilities: NODE_WRITE,
    idempotent: true,
  }),
  defineShared({
    id: "node.removeTag",
    exportName: "nodeRemoveTag",
    target: "node",
    effect: "update",
    inputSchema: closedObject({ tag: { type: "string", minLength: 1 } }),
    requiredCapabilities: NODE_WRITE,
    idempotent: true,
  }),
  defineShared({
    id: "node.setStateData",
    exportName: "nodeSetStateData",
    target: "node",
    effect: "update",
    inputSchema: closedObject({ stateData: NODE_STATE_DATA }),
    requiredCapabilities: NODE_WRITE,
    idempotent: true,
  }),

  // Media attachment: one id per media type, used by the file drop zone.
  //
  // A file reaches a node through exactly one operation family: a stored file's
  // id, never a client-measured address. A file the server already stores (a
  // library resource the user references, a site import, a webpage document)
  // sends the same `uploadId`, and the handler reads the facts off the record.
  // `source` / `sourceUrl` only record where the file came from.
  defineShared({
    id: "image.attachFile",
    exportName: "imageAttachFile",
    target: "node",
    appliesTo: { nodeTypes: ["image"] },
    effect: "update",
    inputSchema: ATTACH_FILE_INPUT,
    // The host reads the stored upload result to backfill size and dimensions.
    requiredCapabilities: ["node.write", "storage.read"],
    idempotent: false,
  }),
  defineShared({
    id: "pdf.attachFile",
    exportName: "pdfAttachFile",
    target: "node",
    appliesTo: { nodeTypes: ["pdf"] },
    effect: "update",
    inputSchema: ATTACH_FILE_INPUT,
    requiredCapabilities: ["node.write", "storage.read"],
    idempotent: false,
  }),
  defineShared({
    id: "video.attachFile",
    exportName: "videoAttachFile",
    target: "node",
    appliesTo: { nodeTypes: ["video"] },
    effect: "update",
    inputSchema: ATTACH_FILE_INPUT,
    // Duration and dimensions come from probing the stored file.
    requiredCapabilities: ["node.write", "storage.read"],
    idempotent: false,
  }),
  defineShared({
    id: "audio.attachFile",
    exportName: "audioAttachFile",
    target: "node",
    appliesTo: { nodeTypes: ["audio"] },
    effect: "update",
    inputSchema: ATTACH_FILE_INPUT,
    requiredCapabilities: ["node.write", "storage.read"],
    idempotent: false,
  }),
  defineShared({
    id: "webpage.attachFile",
    exportName: "webpageAttachFile",
    target: "node",
    appliesTo: { nodeTypes: ["webpage"] },
    effect: "update",
    inputSchema: ATTACH_FILE_INPUT,
    // The document's address and byte length are read off the stored record;
    // the client no longer assembles either (`webpage.replaceDocument` stays for
    // a pasted address that has no upload behind it).
    requiredCapabilities: ["node.write", "storage.read"],
    idempotent: false,
  }),

  // Emptying a payload the type owns. The rule table lives in `@workspace/utils`
  // and the handler applies it to the server snapshot, so "what clearing means"
  // is stated once instead of the client sending the emptied content back.
  defineShared({
    id: "node.clearContent",
    exportName: "nodeClearContent",
    target: "node",
    appliesTo: {
      nodeTypes: [
        "text",
        "rich-text",
        "webpage",
        "website",
        "image",
        "pdf",
        "video",
        "audio",
      ],
    },
    effect: "update",
    inputSchema: closedObject({}),
    requiredCapabilities: NODE_WRITE,
    idempotent: true,
  }),

  // Lifecycle. Soft delete only; physical removal is an admin cleanup job.
  defineShared({
    id: "node.delete",
    exportName: "nodeDelete",
    target: "node",
    effect: "delete",
    inputSchema: closedObject({}),
    requiredCapabilities: ["node.delete"],
    idempotent: true,
  }),
];
