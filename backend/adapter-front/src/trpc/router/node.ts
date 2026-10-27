// SPDX-License-Identifier: AGPL-3.0-only

import { router, protectedProcedure } from "../server";
import { container } from "../../di/container";
import { normalizeDataViewType, DATABASE_FIELD_TYPES } from "@workspace/domain";
import type { DataView } from "@workspace/interfaces/models/data-view";
import type { NodeCover, NodeIcon, TimestampData } from "@workspace/interfaces";
import { z } from "zod";

/**
 * A node's display icon (`NodeIcon`).
 *
 * Deliberately a `z.custom` and not a `z.object`: zod strips every key it does
 * not declare, which would silently drop `color` (and any key added later) on
 * the way in — the same lesson `dataViewSchema` records. The payload is passed
 * through byte-for-byte; `null` is the R29 "clear this field" sentinel and is
 * admitted by the `.nullable()` on the field declarations.
 */
const nodeIconSchema = z.custom<NodeIcon>((value) => {
  if (typeof value !== "object" || value === null) return false;
  const icon = value as Partial<NodeIcon>;
  return (
    (icon.kind === "emoji" || icon.kind === "icon" || icon.kind === "image") &&
    typeof icon.value === "string" &&
    (icon.color === undefined || typeof icon.color === "string")
  );
}, "Must be a node icon: { kind: 'emoji' | 'icon' | 'image', value, color? }");

/**
 * A node's display cover (`NodeCover`) — a discriminated union, so the check
 * branches on `kind` instead of declaring an object schema. Same `z.custom`
 * reason and same `null` sentinel as {@link nodeIconSchema}.
 */
const nodeCoverSchema = z.custom<NodeCover>((value) => {
  if (typeof value !== "object" || value === null) return false;
  const cover = value as { kind?: unknown; url?: unknown; nodeId?: unknown };
  if (cover.kind === "image") return typeof cover.url === "string";
  if (cover.kind === "node") return typeof cover.nodeId === "string";
  return false;
}, "Must be a node cover: { kind: 'image', url } | { kind: 'node', nodeId }");

const baseNodeFields = {
  id: z.string(),
  title: z.string().optional(),
  abstract: z.string().optional(),
  permission: z.enum(["private", "public", "restricted"]).optional(),
  semanticId: z.string(),
  tags: z.array(z.string()).optional(),
  isPinned: z.boolean().optional(),
  stateData: z.any().optional(),
  workspaceId: z.string().optional(),
  // `undefined` means "leave the field alone"; `null` is the write-side
  // "clear" sentinel (R29-定), so both have to survive this whitelist.
  icon: nodeIconSchema.nullable().optional(),
  cover: nodeCoverSchema.nullable().optional(),
};

const textContentSchema = z.object({
  docs: z.record(z.any()),
});

/**
 * The pen layer, declared only so that a create payload carrying one is not
 * silently stripped (zod drops unknown keys — see `fileMetaSchema` below). The
 * shape is validated by the domain's own `AnnotationLayerData` type, and the
 * *update* path already passes `content` through untouched, so this is the same
 * leniency on the other door rather than a second validator.
 */
const annotationsSchema = z.any().optional();

const imageContentSchema = z.object({
  url: z.string(),
  annotations: annotationsSchema,
});

const pdfContentSchema = z.object({
  url: z.string(),
  coverUrl: z.string(),
  annotations: annotationsSchema,
});

/**
 * One item on a media node's timeline (`TimestampData`).
 *
 * A note and a subtitle cue are one shape now, discriminated by `type`, so this
 * is one schema rather than one per kind — a create payload carries whatever
 * the timeline holds and the reader (`normalizeTimestamps`) is what decides
 * which of them are *usable*.
 *
 * `z.custom` for exactly the reason {@link nodeIconSchema} gives: a `z.object`
 * would strip any key an item gains later (and the two variants have different
 * keys — a `z.object` would have to be a union of literals, and `.passthrough()`
 * types the parsed value in a way the interfaces are not assignable from). The
 * check is deliberately shallow: numeric `timeMs`, and a `content` whose type
 * matches the discriminator.
 *
 * Both kinds are accepted **on the add schemas**: the old `timestampNotes` gap
 * (`docs/plan/gates.md` 遗留 1) existed because a note's body was a second,
 * richer shape than a cue's; with one shape there is nothing left to exclude,
 * and `createNode` passes the list straight into the content value object.
 */
const timestampDataSchema = z.custom<TimestampData>((value) => {
  if (typeof value !== "object" || value === null) return false;
  const item = value as Partial<TimestampData>;
  if (typeof item.timeMs !== "number") return false;
  if (item.type === "note") {
    return typeof item.content === "object" && item.content !== null;
  }
  if (item.type === "subtitle") {
    return typeof item.content === "string";
  }
  return false;
}, "Must be a timeline item: { type: 'note', timeMs, content } | { type: 'subtitle', timeMs, content, endMs? }");

const videoContentSchema = z.object({
  url: z.string(),
  coverUrl: z.string(),
  // Written by the upload flow once the backend has packaged the video as HLS;
  // absent until then, and on every record created by an older build.
  hlsUrl: z.string().optional(),
  timestamps: z.array(timestampDataSchema).optional(),
});

const audioContentSchema = z.object({
  url: z.string(),
  // The music-site import saves the artwork as a derived file; a local upload
  // has none, so this is optional. Declared here because zod strips keys it
  // does not know — an undeclared `coverUrl` would never reach the service.
  coverUrl: z.string().optional(),
  timestamps: z.array(timestampDataSchema).optional(),
});

/**
 * Webpage content — the address of the stored document.
 *
 * The bytes live in the `files` collection; the node carries the address and
 * the recorded byte length (a top-level field, like every other file-backed
 * node type). A payload from the retired inline shape has no `url`, so it maps
 * to an empty address instead of failing the request: the data migration
 * `0000000007_webpage_object_storage.js` is what converts those records, and an
 * empty address reads as "no page yet".
 */
const webpageContentSchema = z
  .object({
    url: z.string().optional(),
  })
  .transform((content) => ({ url: content.url ?? "" }));

const websiteContentSchema = z.object({
  url: z.string(),
  faviconUrl: z.string().optional(),
});

/**
 * A data view (`DataView` in `@workspace/interfaces`) as it crosses the API.
 *
 * Only the identity is checked here: `type` is resolved through the one
 * canonical normalizer (re-exported by the domain, never hand-copied), which also
 * accepts a legacy alias (`nodeGraph` → `graph`) so an old payload reaches the
 * domain's rewriter instead of a 400. The domain value objects re-check `id` /
 * `name` / `type` / `config` on the way in. The shape *inside* `config` is owned
 * by the frontend view registry, so it is opaque at this boundary.
 *
 * Deliberately not a `z.object`: zod strips unknown keys, which would silently
 * drop anything a view carries beyond the keys listed here (`config` included,
 * the moment the registry gains a key), and `.passthrough()` cannot be used
 * either — its index signature makes the parsed type unassignable from the
 * `DataView` interface union that `NodeData` is built from. `z.custom` keeps the
 * payload byte-for-byte and pins the type to the interface.
 */
const dataViewSchema = z.custom<DataView>((value) => {
  if (typeof value !== "object" || value === null) return false;
  const view = value as Partial<DataView>;
  return (
    typeof view.id === "string" &&
    view.id.length > 0 &&
    typeof view.name === "string" &&
    view.name.length > 0 &&
    normalizeDataViewType(String(view.type)) !== undefined &&
    typeof view.config === "object" &&
    view.config !== null
  );
}, "Must be a data view: { id, name, type, config }");

const collectionContentSchema = z.object({
  filterConfig: z.any().optional(),
  // Data views live under `content` (see docs/dataview/README.md §5.2). Zod
  // strips keys it does not know, so an undeclared `views` would never persist.
  views: z.array(dataViewSchema).optional(),
});

const richTextContentSchema = z.object({
  referencedNodes: z.array(z.string()),
  docs: z.record(z.any()),
});

const databaseFieldOptionSchema = z.object({
  id: z.string(),
  name: z.string(),
  color: z.string().optional(),
});

const databaseFieldSchema = z.object({
  id: z.string(),
  name: z.string(),
  // Derived from the one canonical list in `@workspace/interfaces` (re-exported
  // by the domain), never re-typed here — a hand-copied enum is how the schema
  // and the value objects drift apart.
  type: z.enum(DATABASE_FIELD_TYPES),
  // Required on select / multiSelect (the domain value object enforces that),
  // carried through untouched by every other type.
  options: z.array(databaseFieldOptionSchema).optional(),
  includeTime: z.boolean().optional(),
});

/**
 * A date cell is date-only in the editor, so `2024-03-12` must be as valid as a
 * full `2024-03-12T00:00:00.000Z`. Mirrors `DatabaseCell`'s check in the domain
 * layer exactly — this schema must never be the stricter of the two.
 */
const databaseDateSchema = z
  .string()
  .refine(
    (value) =>
      /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/.test(
        value,
      ) && !Number.isNaN(Date.parse(value)),
    { message: "Must be an ISO 8601 date or datetime" },
  );

const databaseCellSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), text: z.string() }),
  // `.finite()` is required on top of `z.number()`: zod already rejects NaN but
  // accepts ±Infinity, and `JSON.stringify` would persist that as `null`. The
  // domain value object uses `Number.isFinite` for the same reason.
  z.object({
    type: z.literal("number"),
    number: z.number().finite().nullable(),
  }),
  z.object({ type: z.literal("select"), optionId: z.string().nullable() }),
  z.object({ type: z.literal("multiSelect"), optionIds: z.array(z.string()) }),
  z.object({ type: z.literal("date"), date: databaseDateSchema.nullable() }),
  z.object({ type: z.literal("checkbox"), checked: z.boolean() }),
  z.object({ type: z.literal("url"), url: z.string().url().nullable() }),
  z.object({ type: z.literal("relation"), nodeIds: z.array(z.string()) }),
]);

const databaseRowSchema = z.object({
  id: z.string(),
  cells: z.record(databaseCellSchema),
});

const databaseContentSchema = z.object({
  fields: z.array(databaseFieldSchema),
  rows: z.array(databaseRowSchema),
  // Same `views` column as `collection` — see `collectionContentSchema`.
  views: z.array(dataViewSchema).optional(),
});

const addSchema = z.discriminatedUnion("nodeType", [
  z.object({
    ...baseNodeFields,
    nodeType: z.literal("text"),
    content: textContentSchema,
  }),
  z.object({
    ...baseNodeFields,
    nodeType: z.literal("image"),
    width: z.number(),
    height: z.number(),
    fileSize: z.number(),
    location: z.string().optional(),
    shootingTime: z.string().optional(),
    content: imageContentSchema,
  }),
  z.object({
    ...baseNodeFields,
    nodeType: z.literal("pdf"),
    pageCount: z.number(),
    fileSize: z.number(),
    content: pdfContentSchema,
  }),
  z.object({
    ...baseNodeFields,
    nodeType: z.literal("video"),
    duration: z.number(),
    source: z.enum(["local", "online"]),
    sourceUrl: z.string().optional(),
    fileSize: z.number().optional(),
    location: z.string().optional(),
    shootingTime: z.string().optional(),
    content: videoContentSchema,
  }),
  z.object({
    ...baseNodeFields,
    nodeType: z.literal("audio"),
    duration: z.number(),
    // Optional so an old client (and the local upload path) keeps creating
    // local nodes; the domain defaults a missing source to "local".
    // Declared here because zod strips unknown keys — an undeclared
    // `source` / `sourceUrl` would be dropped before the service sees it.
    source: z.enum(["local", "online"]).optional(),
    sourceUrl: z.string().optional(),
    fileSize: z.number(),
    content: audioContentSchema,
  }),
  z.object({
    ...baseNodeFields,
    nodeType: z.literal("webpage"),
    fileSize: z.number().optional(),
    content: webpageContentSchema,
  }),
  z.object({
    ...baseNodeFields,
    nodeType: z.literal("website"),
    content: websiteContentSchema,
  }),
  z.object({
    ...baseNodeFields,
    nodeType: z.literal("collection"),
    content: collectionContentSchema,
  }),
  z.object({
    ...baseNodeFields,
    nodeType: z.literal("rich-text"),
    content: richTextContentSchema,
  }),
  z.object({
    ...baseNodeFields,
    nodeType: z.literal("database"),
    content: databaseContentSchema,
  }),
]);

/**
 * File metadata patched onto an already-created node by the upload flow. Zod
 * strips keys it does not know, so every field the client actually writes has
 * to be declared here or it is silently dropped before reaching the service.
 */
const fileMetaSchema = {
  fileSize: z.number().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
  duration: z.number().optional(),
  pageCount: z.number().optional(),
  source: z.enum(["local", "online"]).optional(),
  sourceUrl: z.string().optional(),
  location: z.string().optional(),
  shootingTime: z.string().optional(),
};

const updateSchema = z.object({
  id: z.string(),
  updates: z.object({
    title: z.string().optional(),
    abstract: z.string().optional(),
    tags: z.array(z.string()).optional(),
    permission: z.enum(["private", "public", "restricted"]).optional(),
    semanticId: z.string().optional(),
    isPinned: z.boolean().optional(),
    content: z.any().optional(),
    stateData: z.any().optional(),
    workspaceId: z.string().optional(),
    icon: nodeIconSchema.nullable().optional(),
    cover: nodeCoverSchema.nullable().optional(),
    ...fileMetaSchema,
  }),
});

const deleteSchema = z.object({
  id: z.string(),
});

export const nodeRouter = router({
  add: protectedProcedure.input(addSchema).mutation(async ({ ctx, input }) => {
    const result = await container().nodeCommandService.createNode({
      ...input,
      userId: ctx.userId,
      sourceId: ctx.sourceId,
    } as any);
    return result;
  }),

  update: protectedProcedure
    .input(updateSchema)
    .mutation(async ({ ctx, input }) => {
      const result = await container().nodeCommandService.updateNode({
        id: input.id,
        title: input.updates.title,
        abstract: input.updates.abstract,
        tags: input.updates.tags,
        permission: input.updates.permission,
        semanticId: input.updates.semanticId,
        isPinned: input.updates.isPinned,
        icon: input.updates.icon,
        cover: input.updates.cover,
        content: input.updates.content,
        stateData: input.updates.stateData,
        workspaceId: input.updates.workspaceId,
        fileSize: input.updates.fileSize,
        width: input.updates.width,
        height: input.updates.height,
        duration: input.updates.duration,
        pageCount: input.updates.pageCount,
        source: input.updates.source,
        sourceUrl: input.updates.sourceUrl,
        location: input.updates.location,
        shootingTime: input.updates.shootingTime,
        userId: ctx.userId,
        sourceId: ctx.sourceId,
      });
      return result;
    }),

  delete: protectedProcedure
    .input(deleteSchema)
    .mutation(async ({ ctx, input }) => {
      await container().nodeCommandService.deleteNode({
        id: input.id,
        userId: ctx.userId,
        sourceId: ctx.sourceId,
      });
      return { success: true, id: input.id };
    }),

  list: protectedProcedure
    .input(
      z.object({
        nodeType: z.string().optional(),
        semanticId: z.string().optional(),
      }),
    )
    .query(async ({ input }) => {
      return container().nodeQueryService.list({
        nodeType: input.nodeType,
        semanticId: input.semanticId,
      });
    }),

  listByWorkspace: protectedProcedure
    .input(z.object({ workspaceId: z.string() }))
    .query(async ({ input }) => {
      return container().nodeQueryService.listByWorkspace(input.workspaceId);
    }),

  getById: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ input }) => {
      return container().nodeQueryService.getById({ id: input.id });
    }),

  getPinned: protectedProcedure.query(async () => {
    return container().nodeQueryService.getPinned();
  }),

  getRecentlyUpdated: protectedProcedure
    .input(z.object({ limit: z.number().default(10) }))
    .query(async ({ input }) => {
      return container().nodeQueryService.getRecentlyUpdated({
        limit: input.limit,
      });
    }),
});
