// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The ten builtin node types' own operations (§4.3.5).
 *
 * Only `self` operations are declared: one node, its own content, `reach:
 * "self"`. The design document's per-type table also sketches `external` and
 * `system` examples (quote/summary node creation, `image.analyze`,
 * `video.transcode`, …); none of them are declared here, because a declared
 * operation without a handler is refused at enablement and silently degrading
 * an unimplemented one is worse (§4.3.9).
 *
 * Public metadata operations and `node.add` are not repeated: they live once in
 * `operations.ts` and apply to every type.
 *
 * ## Handlers
 *
 * Every definition below is built with `defineOperationDefinition`, so its
 * `handler` is already `plugin:dbrainx.builtin#<exportName>`; the module exports
 * no `run` for them, because a self operation writes the target node's content
 * through the host. The host binds the ones this build implements by id
 * (`apps/server/src/operation-registry.ts`).
 *
 * Bound today: the payload operations the editors write through
 * (`text.setDocument`, `rich-text.setDocument`, `image|pdf.setAnnotations`,
 * `video|audio.setTimeline`, `collection.setFilter|setViews`,
 * `database.setRows|setFields|setViews`, `website.setUrl|setFavicon`,
 * `webpage.replaceDocument`, `video.setCover`), plus the five `*.attachFile`
 * operations from `operations.ts`, which resolve the stored upload result
 * before they write.
 *
 * The rest stay unbound: the document, timeline, annotation, view and database
 * operations in the table below. The plugin host refuses to enable a plugin
 * whose declared export is missing, exactly as §4.3.9 requires, so
 * `operation.list` never offers one that would fail.
 *
 * What each handler does, or will do once it is bound:
 *
 * | operation | export | effect on the node content |
 * | --- | --- | --- |
 * | `text.setDocument` | `textSetDocument` | replace `docs` |
 * | `text.append` | `textAppend` | add a block under the given id |
 * | `text.replaceRange` | `textReplaceRange` | replace characters `from..to` of one block |
 * | `rich-text.setDocument` | `richTextSetDocument` | replace `docs` (and `referencedNodes` when sent) |
 * | `rich-text.insertBlock` | `richTextInsertBlock` | add a block |
 * | `rich-text.updateBlock` | `richTextUpdateBlock` | replace one block |
 * | `rich-text.removeBlock` | `richTextRemoveBlock` | drop one block |
 * | `image.addAnnotation` | `imageAddAnnotation` | append to `annotations.items` |
 * | `image.removeAnnotation` | `imageRemoveAnnotation` | drop the item by id |
 * | `image.setMetadata` | `imageSetMetadata` | patch `width`/`height`/`location`/`shootingTime` |
 * | `pdf.addAnnotation` | `pdfAddAnnotation` | append to `annotations.items` |
 * | `pdf.removeAnnotation` | `pdfRemoveAnnotation` | drop the item by id |
 * | `pdf.moveAnnotation` | `pdfMoveAnnotation` | change the item's `page` |
 * | `video.timeline.add` | `videoTimelineAdd` | append a `timestamps` entry |
 * | `video.timeline.update` | `videoTimelineUpdate` | replace the entry with that id |
 * | `video.timeline.remove` | `videoTimelineRemove` | drop the entry by id |
 * | `video.setCover` | `videoSetCover` | set `coverUrl` |
 * | `audio.timeline.add` | `audioTimelineAdd` | append a `timestamps` entry |
 * | `audio.timeline.update` | `audioTimelineUpdate` | replace the entry with that id |
 * | `audio.timeline.remove` | `audioTimelineRemove` | drop the entry by id |
 * | `webpage.replaceDocument` | `webpageReplaceDocument` | replace `url` |
 * | `website.setFavicon` | `websiteSetFavicon` | set `faviconUrl` |
 * | `collection.setFilter` | `collectionSetFilter` | merge into `filterConfig` |
 * | `collection.setView` | `collectionSetView` | upsert one view by id |
 * | `collection.removeView` | `collectionRemoveView` | drop the view by id |
 * | `database.addField` | `databaseAddField` | append a field |
 * | `database.removeField` | `databaseRemoveField` | drop the field and its cells |
 * | `database.addRow` | `databaseAddRow` | append a row |
 * | `database.updateCell` | `databaseUpdateCell` | set one cell |
 * | `database.deleteRow` | `databaseDeleteRow` | drop the row |
 * | `database.setView` | `databaseSetView` | upsert one view by id |
 */

import type {
  JsonSchema,
  OperationDefinition,
  OperationEffect,
} from "@workspace/plugin-sdk";
import { defineOperationDefinition } from "@workspace/plugin-sdk";

import { DATABASE_FIELD_TYPES } from "../types/complex/database.ts";
import { timestampDataSchema } from "../types/shared/timestamp-data.ts";
import { builtinPluginId } from "./plugin-id.ts";
import { closedObject } from "./operations.ts";

/** The type ids this catalogue covers, in product order. */
export type BuiltinTypeId =
  | "text"
  | "rich-text"
  | "image"
  | "pdf"
  | "video"
  | "audio"
  | "webpage"
  | "website"
  | "collection"
  | "database";

type Capabilities = OperationDefinition["requiredCapabilities"];

const NODE_WRITE: Capabilities = ["node.write"];

interface TypeOperationSpec {
  readonly id: string;
  /** Module export the host binds as the handler (see the gap table above). */
  readonly exportName: string;
  readonly inputSchema: JsonSchema;
  readonly idempotent: boolean;
  readonly effect?: OperationEffect;
  readonly requiredCapabilities?: Capabilities;
}

/**
 * One type operation: node target, that type only, `self` reach.
 *
 * `appliesTo` is declared (rather than omitted) because a self operation is
 * meaningless on any other type: `appliesTo` is what makes the router refuse
 * `video.timeline.add` on a `text` node with `OPERATION_NOT_FOUND`.
 */
function defineTypeOperation(
  type: BuiltinTypeId,
  spec: TypeOperationSpec,
): OperationDefinition {
  return defineOperationDefinition({
    id: spec.id,
    pluginId: builtinPluginId,
    exportName: spec.exportName,
    target: "node",
    appliesTo: { nodeTypes: [type] },
    effect: spec.effect ?? "update",
    reach: "self",
    inputSchema: spec.inputSchema,
    requiredCapabilities: spec.requiredCapabilities ?? NODE_WRITE,
    idempotent: spec.idempotent,
  });
}

/** A block id that the client minted; empty is refused, not defaulted. */
const BLOCK_ID = { type: "string", minLength: 1 } as const;
/** One Tiptap document; opaque to the server, which stores it as sent. */
const DOCUMENT = { type: "object" } as const;
/** One annotation item; the annotation editor owns its variant shape. */
const ANNOTATION = { type: "object" } as const;
/** A timeline entry; the shared schema pins note vs subtitle. */
const TIMELINE_ITEM = timestampDataSchema;
/** A stored DataView; the data view package owns its fields. */
const VIEW = { type: "object" } as const;

const DATABASE_FIELD: JsonSchema = {
  type: "object",
  required: ["id", "name", "type"],
  properties: {
    id: { type: "string", minLength: 1 },
    name: { type: "string" },
    type: { enum: [...DATABASE_FIELD_TYPES] },
    options: {
      type: "array",
      items: closedObject({
        id: { type: "string", minLength: 1 },
        name: { type: "string" },
        color: { type: "string" },
      }),
    },
    includeTime: { type: "boolean" },
  },
  additionalProperties: false,
};

const DATABASE_CELL: JsonSchema = {
  type: "object",
  required: ["type"],
  properties: {
    type: { enum: [...DATABASE_FIELD_TYPES] },
  },
};

/**
 * The payload operations: one operation for the array a type's editor owns.
 *
 * The data view and the annotation layer hand their host the whole next list
 * (a table's rows, a view list, an annotation set, a timeline), not one item at
 * a time, so the operation granularity is the payload. Each one is still a
 * single named, schema-checked, versioned write of `content` and nothing else;
 * what it replaces is the old whole-node merge, which could also change the
 * title, the tags and every other field in the same call.
 */
const ANNOTATIONS: JsonSchema = { type: "object" };
const ROWS: JsonSchema = { type: "array", items: { type: "object" } };
const FIELDS: JsonSchema = { type: "array", items: DATABASE_FIELD };
const VIEWS: JsonSchema = { type: "array", items: VIEW };
const TIMELINE: JsonSchema = { type: "array", items: TIMELINE_ITEM };

export const typeOperations: readonly OperationDefinition[] = [
  // text: the body is a block map, so editing is per block, never a blob.
  defineTypeOperation("text", {
    id: "text.setDocument",
    exportName: "textSetDocument",
    inputSchema: closedObject({ docs: DOCUMENT }),
    idempotent: true,
  }),
  defineTypeOperation("text", {
    id: "text.append",
    exportName: "textAppend",
    inputSchema: closedObject({ blockId: BLOCK_ID, document: DOCUMENT }),
    idempotent: false,
  }),
  defineTypeOperation("text", {
    id: "text.replaceRange",
    exportName: "textReplaceRange",
    inputSchema: closedObject({
      blockId: BLOCK_ID,
      from: { type: "integer", minimum: 0 },
      to: { type: "integer", minimum: 0 },
      text: { type: "string" },
    }),
    idempotent: false,
  }),

  defineTypeOperation("rich-text", {
    id: "rich-text.setDocument",
    exportName: "richTextSetDocument",
    inputSchema: closedObject(
      {
        docs: DOCUMENT,
        referencedNodes: { type: "array", items: { type: "string" } },
      },
      ["docs"],
    ),
    idempotent: true,
  }),
  defineTypeOperation("rich-text", {
    id: "rich-text.insertBlock",
    exportName: "richTextInsertBlock",
    inputSchema: closedObject({ blockId: BLOCK_ID, document: DOCUMENT }),
    idempotent: false,
  }),
  defineTypeOperation("rich-text", {
    id: "rich-text.updateBlock",
    exportName: "richTextUpdateBlock",
    inputSchema: closedObject({ blockId: BLOCK_ID, document: DOCUMENT }),
    idempotent: true,
  }),
  defineTypeOperation("rich-text", {
    id: "rich-text.removeBlock",
    exportName: "richTextRemoveBlock",
    inputSchema: closedObject({ blockId: BLOCK_ID }),
    idempotent: true,
  }),

  defineTypeOperation("image", {
    id: "image.addAnnotation",
    exportName: "imageAddAnnotation",
    inputSchema: closedObject({ annotation: ANNOTATION }),
    idempotent: false,
  }),
  defineTypeOperation("image", {
    id: "image.removeAnnotation",
    exportName: "imageRemoveAnnotation",
    inputSchema: closedObject({ annotationId: { type: "string", minLength: 1 } }),
    idempotent: true,
  }),
  defineTypeOperation("image", {
    id: "image.setMetadata",
    exportName: "imageSetMetadata",
    inputSchema: {
      ...closedObject(
        {
          width: { type: "number", minimum: 0 },
          height: { type: "number", minimum: 0 },
          location: { type: "string" },
          shootingTime: { type: "string" },
        },
        [],
      ),
      minProperties: 1,
    },
    idempotent: true,
  }),

  defineTypeOperation("image", {
    id: "image.setAnnotations",
    exportName: "imageSetAnnotations",
    inputSchema: closedObject({ annotations: ANNOTATIONS }),
    idempotent: true,
  }),

  defineTypeOperation("pdf", {
    id: "pdf.addAnnotation",
    exportName: "pdfAddAnnotation",
    inputSchema: closedObject({ annotation: ANNOTATION }),
    idempotent: false,
  }),
  defineTypeOperation("pdf", {
    id: "pdf.removeAnnotation",
    exportName: "pdfRemoveAnnotation",
    inputSchema: closedObject({ annotationId: { type: "string", minLength: 1 } }),
    idempotent: true,
  }),
  defineTypeOperation("pdf", {
    id: "pdf.moveAnnotation",
    exportName: "pdfMoveAnnotation",
    inputSchema: closedObject({
      annotationId: { type: "string", minLength: 1 },
      page: { type: "integer", minimum: 0 },
    }),
    idempotent: true,
  }),

  defineTypeOperation("pdf", {
    id: "pdf.setAnnotations",
    exportName: "pdfSetAnnotations",
    inputSchema: closedObject({ annotations: ANNOTATIONS }),
    idempotent: true,
  }),

  defineTypeOperation("video", {
    id: "video.timeline.add",
    exportName: "videoTimelineAdd",
    inputSchema: closedObject({ item: TIMELINE_ITEM }),
    idempotent: false,
  }),
  defineTypeOperation("video", {
    id: "video.timeline.update",
    exportName: "videoTimelineUpdate",
    inputSchema: closedObject({
      itemId: { type: "string", minLength: 1 },
      item: TIMELINE_ITEM,
    }),
    idempotent: true,
  }),
  defineTypeOperation("video", {
    id: "video.timeline.remove",
    exportName: "videoTimelineRemove",
    inputSchema: closedObject({ itemId: { type: "string", minLength: 1 } }),
    idempotent: true,
  }),
  defineTypeOperation("video", {
    id: "video.setTimeline",
    exportName: "videoSetTimeline",
    inputSchema: closedObject({ timestamps: TIMELINE }),
    idempotent: true,
  }),
  defineTypeOperation("video", {
    id: "video.setCover",
    exportName: "videoSetCover",
    inputSchema: closedObject({ coverUrl: { type: "string" } }),
    idempotent: true,
  }),

  defineTypeOperation("audio", {
    id: "audio.timeline.add",
    exportName: "audioTimelineAdd",
    inputSchema: closedObject({ item: TIMELINE_ITEM }),
    idempotent: false,
  }),
  defineTypeOperation("audio", {
    id: "audio.timeline.update",
    exportName: "audioTimelineUpdate",
    inputSchema: closedObject({
      itemId: { type: "string", minLength: 1 },
      item: TIMELINE_ITEM,
    }),
    idempotent: true,
  }),
  defineTypeOperation("audio", {
    id: "audio.timeline.remove",
    exportName: "audioTimelineRemove",
    inputSchema: closedObject({ itemId: { type: "string", minLength: 1 } }),
    idempotent: true,
  }),

  defineTypeOperation("audio", {
    id: "audio.setTimeline",
    exportName: "audioSetTimeline",
    inputSchema: closedObject({ timestamps: TIMELINE }),
    idempotent: true,
  }),

  defineTypeOperation("webpage", {
    id: "webpage.replaceDocument",
    exportName: "webpageReplaceDocument",
    // The attribute panel edits the stored address itself: a user can paste a
    // URL, and nothing here has an upload to resolve. The byte length is not
    // part of the write, so a schema that names `fileSize` would be refused for
    // the one input the panel sends.
    inputSchema: closedObject({ url: { type: "string", minLength: 1 } }),
    idempotent: false,
  }),

  defineTypeOperation("website", {
    id: "website.setUrl",
    exportName: "websiteSetUrl",
    inputSchema: closedObject({ url: { type: "string" } }),
    idempotent: true,
  }),
  defineTypeOperation("website", {
    id: "website.setFavicon",
    exportName: "websiteSetFavicon",
    inputSchema: closedObject({ faviconUrl: { type: "string" } }),
    idempotent: true,
  }),

  defineTypeOperation("collection", {
    id: "collection.setFilter",
    exportName: "collectionSetFilter",
    inputSchema: closedObject({ filterConfig: { type: "object" } }),
    idempotent: true,
  }),
  defineTypeOperation("collection", {
    id: "collection.setView",
    exportName: "collectionSetView",
    inputSchema: closedObject({ view: VIEW }),
    idempotent: true,
  }),
  defineTypeOperation("collection", {
    id: "collection.removeView",
    exportName: "collectionRemoveView",
    inputSchema: closedObject({ viewId: { type: "string", minLength: 1 } }),
    idempotent: true,
  }),

  defineTypeOperation("collection", {
    id: "collection.setViews",
    exportName: "collectionSetViews",
    inputSchema: closedObject({ views: VIEWS }),
    idempotent: true,
  }),

  defineTypeOperation("database", {
    id: "database.addField",
    exportName: "databaseAddField",
    inputSchema: closedObject({ field: DATABASE_FIELD }),
    idempotent: false,
  }),
  defineTypeOperation("database", {
    id: "database.removeField",
    exportName: "databaseRemoveField",
    inputSchema: closedObject({ fieldId: { type: "string", minLength: 1 } }),
    idempotent: true,
  }),
  defineTypeOperation("database", {
    id: "database.addRow",
    exportName: "databaseAddRow",
    inputSchema: closedObject({ cells: { type: "object" } }),
    idempotent: false,
  }),
  defineTypeOperation("database", {
    id: "database.updateCell",
    exportName: "databaseUpdateCell",
    inputSchema: closedObject({
      rowId: { type: "string", minLength: 1 },
      fieldId: { type: "string", minLength: 1 },
      cell: DATABASE_CELL,
    }),
    idempotent: true,
  }),
  defineTypeOperation("database", {
    id: "database.deleteRow",
    exportName: "databaseDeleteRow",
    inputSchema: closedObject({ rowId: { type: "string", minLength: 1 } }),
    idempotent: true,
  }),
  defineTypeOperation("database", {
    id: "database.setView",
    exportName: "databaseSetView",
    inputSchema: closedObject({ view: VIEW }),
    idempotent: true,
  }),
  defineTypeOperation("database", {
    id: "database.setRows",
    exportName: "databaseSetRows",
    inputSchema: closedObject({ rows: ROWS }),
    idempotent: true,
  }),
  defineTypeOperation("database", {
    id: "database.setFields",
    exportName: "databaseSetFields",
    // A schema edit rewrites the cells of the fields it changed in the same
    // gesture, so both halves travel in one input and land as one write.
    inputSchema: closedObject({ fields: FIELDS, rows: ROWS }),
    idempotent: true,
  }),
  defineTypeOperation("database", {
    id: "database.setViews",
    exportName: "databaseSetViews",
    inputSchema: closedObject({ views: VIEWS }),
    idempotent: true,
  }),
];

function idsFor(type: BuiltinTypeId): readonly string[] {
  return typeOperations
    .filter((definition) => definition.appliesTo?.nodeTypes.includes(type))
    .map((definition) => definition.id);
}

/**
 * The operation ids each type lists in `node-types.ts`, derived from the
 * catalogue so a type can never advertise an operation that does not exist.
 */
export const selfOperationIds: Readonly<Record<BuiltinTypeId, readonly string[]>> =
  Object.freeze({
    text: idsFor("text"),
    "rich-text": idsFor("rich-text"),
    image: idsFor("image"),
    pdf: idsFor("pdf"),
    video: idsFor("video"),
    audio: idsFor("audio"),
    webpage: idsFor("webpage"),
    website: idsFor("website"),
    collection: idsFor("collection"),
    database: idsFor("database"),
  });
