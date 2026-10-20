// SPDX-License-Identifier: AGPL-3.0-only

import type { RecordModel } from "pocketbase";

import type {
  NodeStateData,
  NodeIcon,
  NodeCover,
} from "@workspace/interfaces/models/node/base";
import type { DataView } from "@workspace/interfaces/models/data-view";
import type { AnnotationLayerData } from "@workspace/interfaces/models/node/nodes/annotation";
import type { TimestampData } from "@workspace/interfaces/models/node/nodes/single/timestamp-data";
import type { WebpageContent as WebpageContentData } from "@workspace/interfaces/models/node/nodes/single/webpage";
import type {
  DatabaseField as DatabaseFieldData,
  DatabaseRow as DatabaseRowData,
} from "@workspace/interfaces/models/node/nodes/complex/database";

import {
  NodeId,
  Permission,
  TextContent,
  ImageContent,
  PdfContent,
  VideoContent,
  AudioContent,
  WebpageContent,
  WebsiteContent,
  CollectionContent,
  RichTextContent,
  DatabaseContent,
} from "@workspace/domain/models/node/value-objects";
import {
  Node,
  TextNode,
  ImageNode,
  PdfNode,
  VideoNode,
  AudioNode,
  WebpageNode,
  WebsiteNode,
  CollectionNode,
  RichTextNode,
  DatabaseNode,
  type NodeBaseProps,
} from "@workspace/domain/models/node/entities";
import {
  filterConfigFromRecord,
  filterConfigToRecord,
} from "./filter-config.mapper";

export interface BaseNodeRecord extends RecordModel {
  title: string;
  abstract?: string;
  permission: "private" | "public" | "restricted";
  semanticId: string;
  tags: string[];
  isPinned: boolean;
  stateData?: NodeStateData;
  /**
   * Display icon (`NodeIcon` JSON). Top-level, not part of `content`, so every
   * one of the 10 node types carries it.
   *
   * JSON column, optional, created by `1700000000_initial_schema.js`. A record
   * written before the column (or explicitly cleared) reads back as `null` or
   * is simply absent — `toDomain` maps both to `undefined` (see `baseProps`),
   * the same way `record.views` is handled.
   */
  icon?: NodeIcon | null;
  /** Display cover (`NodeCover` JSON); see {@link BaseNodeRecord.icon}. */
  cover?: NodeCover | null;
  created: string;
  updated: string;
  nodeType: string;
  workspaceId?: string;
}

interface TextNodeRecord extends BaseNodeRecord {
  nodeType: "text";
  content: Record<string, unknown>;
}

interface ImageNodeRecord extends BaseNodeRecord {
  nodeType: "image";
  content: string;
  width: number;
  height: number;
  fileSize: number;
  location?: string;
  shootingTime?: string;
  /**
   * Pen / highlight layer (`AnnotationLayerData` JSON) drawn on the image.
   *
   * Optional; a missing column or an explicit `null` both read as `undefined`
   * (see `BaseNodeRecord.icon`). The shape is copied through as-is — normalising
   * a malformed value is the frontend's `doc-normalize.ts`, not the mapper's.
   */
  annotations?: AnnotationLayerData | null;
}

interface PdfNodeRecord extends BaseNodeRecord {
  nodeType: "pdf";
  content: string;
  coverUrl: string;
  pageCount: number;
  fileSize: number;
  /** Pen / highlight layer (`AnnotationLayerData` JSON); see `ImageNodeRecord.annotations`. */
  annotations?: AnnotationLayerData | null;
}

interface VideoNodeRecord extends BaseNodeRecord {
  nodeType: "video";
  content: string;
  coverUrl: string;
  /** HLS playlist address; `""` on a record written before transcode existed. */
  hlsUrl?: string;
  duration: number;
  source: "local" | "online";
  sourceUrl?: string;
  fileSize?: number;
  location?: string;
  shootingTime?: string;
  /**
   * The played timeline (`TimestampData[]` JSON): notes and subtitle cues in one
   * list, discriminated by each item's own `type`.
   *
   * Optional; a missing column or an explicit `null` both read as `undefined`
   * (see `BaseNodeRecord.icon`), and a value of an unexpected shape is passed
   * through untouched.
   */
  timestamps?: TimestampData[] | null;
}

interface AudioNodeRecord extends BaseNodeRecord {
  nodeType: "audio";
  content: string;
  /** Derived cover artwork; `""` on a local upload and on old records. */
  coverUrl?: string;
  duration: number;
  /** `"local"` on a record written before the music-site import existed. */
  source?: "local" | "online";
  sourceUrl?: string;
  fileSize: number;
  /** The played timeline (`TimestampData[]` JSON); see `VideoNodeRecord.timestamps`. */
  timestamps?: TimestampData[] | null;
}

interface WebpageNodeRecord extends BaseNodeRecord {
  nodeType: "webpage";
  /**
   * Stored address of the document (`/api/files/files/<record>/<name>`), or
   * `""` before the first import.
   *
   * Records written by the retired inline shape hold the source text itself;
   * `0000000007_webpage_object_storage.js` converts them, so this mapper reads
   * the column as an address only. A legacy inline record that has not been
   * converted yet is therefore read as empty — the migration is what upgrades
   * it, not the mapper.
   */
  content: string;
  /** Byte length of the stored document; the media-node column, reused. */
  fileSize?: number;
  /** Retired inline-source language; kept out of the model (see above). */
  codeLanguage?: string;
}

interface WebsiteNodeRecord extends BaseNodeRecord {
  nodeType: "website";
  content: string;
  faviconUrl?: string;
}

interface CollectionNodeRecord extends BaseNodeRecord {
  nodeType: "collection";
  /** PocketBase 的原始 JSON，可能来自旧版写入（含 `{ _value }` 包装）。 */
  filterConfig?: unknown;
  /** Data views (`DataView[]`); absent on records written before the column. */
  views?: DataView[];
}

interface RichTextNodeRecord extends BaseNodeRecord {
  nodeType: "rich-text";
  referencedNodes: string[];
  docs: Record<string, unknown>;
}

/**
 * A database node keeps its table in two dedicated JSON columns, `fields` and
 * `rows` — not in the shared `content` column, which `text` / `image` / …
 * own. This is the same split `rich-text` uses for `referencedNodes` + `docs`:
 * the wire shape groups them under `content`, the record does not.
 *
 * `views` (how the node browses its own table) is the third such column and is
 * shared with `collection`; it is optional here because a `database` record
 * written before the column existed simply has no views.
 *
 * Both columns are created by `1700000000_initial_schema.js`, so a `database`
 * record always carries them; no legacy shape exists to accommodate.
 */
interface DatabaseNodeRecord extends BaseNodeRecord {
  nodeType: "database";
  /** Ordered schema column. */
  fields: DatabaseFieldData[];
  /** Ordered records column; each row's cells are keyed by field id. */
  rows: DatabaseRowData[];
  /** Data views (`DataView[]`); absent on records written before the column. */
  views?: DataView[];
}

const VALID_NODE_TYPES = [
  "text",
  "image",
  "pdf",
  "video",
  "audio",
  "webpage",
  "website",
  "collection",
  "rich-text",
  "database",
] as const;

type ValidNodeType = (typeof VALID_NODE_TYPES)[number];

function isValidNodeType(type: string): type is ValidNodeType {
  return VALID_NODE_TYPES.includes(type as ValidNodeType);
}

/**
 * The document address a webpage node references.
 *
 * `content` holds the stored address written by the import flow, or `""`. The
 * retired `webpageMode` / `url` / `screenshotUrl` columns and the inline source
 * shape are not read any more: `0000000007_webpage_object_storage.js` moves the
 * old source into the object store, and a record that only held a URL of the
 * old screenshot form is not a representation of this node type.
 */
function resolveWebpageContent(record: WebpageNodeRecord): WebpageContentData {
  return { url: record.content || "" };
}

export class NodeMapper {
  toDomain(record: RecordModel): Node {
    const nodeType = record.nodeType as string;

    if (!isValidNodeType(nodeType)) {
      throw new Error(`Invalid node type: ${nodeType}`);
    }

    const baseProps = {
      id: new NodeId(record.id),
      title: record.title,
      abstract: record.abstract || undefined,
      permission: new Permission(
        record.permission as "private" | "public" | "restricted",
      ),
      semanticId: record.semanticId as string,
      tags: (record.tags as string[]) || [],
      isPinned: record.isPinned as boolean,
      stateData: record.stateData as NodeStateData | undefined,
      // `icon` / `cover` are JSON columns added after the fact: a missing column
      // (old record) and an explicit `null` (cleared field) both mean "no
      // value", and `undefined` is the only shape the domain understands. Same
      // read-compat contract as `record.views` below.
      icon: record.icon ?? undefined,
      cover: record.cover ?? undefined,
      createdAt: record.created as string,
      updatedAt: record.updated as string,
      workspaceId: record.workspaceId as string | undefined,
    } satisfies NodeBaseProps;

    switch (nodeType) {
      case "text":
        return this.mapTextNode(record as unknown as TextNodeRecord, baseProps);
      case "image":
        return this.mapImageNode(
          record as unknown as ImageNodeRecord,
          baseProps,
        );
      case "pdf":
        return this.mapPdfNode(record as unknown as PdfNodeRecord, baseProps);
      case "video":
        return this.mapVideoNode(
          record as unknown as VideoNodeRecord,
          baseProps,
        );
      case "audio":
        return this.mapAudioNode(
          record as unknown as AudioNodeRecord,
          baseProps,
        );
      case "webpage":
        return this.mapWebpageNode(
          record as unknown as WebpageNodeRecord,
          baseProps,
        );
      case "website":
        return this.mapWebsiteNode(
          record as unknown as WebsiteNodeRecord,
          baseProps,
        );
      case "collection":
        return this.mapCollectionNode(
          record as unknown as CollectionNodeRecord,
          baseProps,
        );
      case "rich-text":
        return this.mapRichTextNode(
          record as unknown as RichTextNodeRecord,
          baseProps,
        );
      case "database":
        return this.mapDatabaseNode(
          record as unknown as DatabaseNodeRecord,
          baseProps,
        );
      default:
        throw new Error(`Unhandled node type: ${nodeType}`);
    }
  }

  private mapTextNode(
    record: TextNodeRecord,
    baseProps: NodeBaseProps,
  ): TextNode {
    return TextNode.create({
      ...baseProps,
      content: new TextContent(record.content || {}),
    });
  }

  private mapImageNode(
    record: ImageNodeRecord,
    baseProps: NodeBaseProps,
  ): ImageNode {
    return ImageNode.create({
      ...baseProps,
      width: record.width || 0,
      height: record.height || 0,
      fileSize: record.fileSize || 0,
      location: record.location,
      shootingTime: record.shootingTime,
      // Absent column / `null` → `undefined`: no annotation layer is an absent
      // half, and an unexpected shape is handed through untouched.
      content: new ImageContent(
        record.content || "",
        record.annotations ?? undefined,
      ),
    });
  }

  private mapPdfNode(record: PdfNodeRecord, baseProps: NodeBaseProps): PdfNode {
    return PdfNode.create({
      ...baseProps,
      pageCount: record.pageCount || 0,
      fileSize: record.fileSize || 0,
      content: new PdfContent(
        record.content || "",
        record.coverUrl || "",
        record.annotations ?? undefined,
      ),
    });
  }

  private mapVideoNode(
    record: VideoNodeRecord,
    baseProps: NodeBaseProps,
  ): VideoNode {
    return VideoNode.create({
      ...baseProps,
      duration: record.duration || 0,
      source: record.source || "online",
      sourceUrl: record.sourceUrl,
      fileSize: record.fileSize,
      location: record.location,
      shootingTime: record.shootingTime,
      // `timestamps` is a JSON column: absent / `null` → `undefined` (no
      // timestamps), never an empty array patched in here.
      content: new VideoContent(
        record.content || "",
        record.coverUrl || "",
        record.hlsUrl || "",
        record.timestamps ?? undefined,
      ),
    });
  }

  private mapAudioNode(
    record: AudioNodeRecord,
    baseProps: NodeBaseProps,
  ): AudioNode {
    return AudioNode.create({
      ...baseProps,
      duration: record.duration || 0,
      // `source` is a select column whose `""` is the pre-import shape: a
      // record without it was uploaded locally, so it reads back as "local".
      source: record.source || "local",
      sourceUrl: record.sourceUrl,
      fileSize: record.fileSize || 0,
      // See `mapVideoNode`: absent / `null` → `undefined`, no empty array.
      // `coverUrl` is optional on an audio node (a local upload has none), so
      // the record's `""` sentinel maps to "no cover" here.
      content: new AudioContent(
        record.content || "",
        record.coverUrl || undefined,
        record.timestamps ?? undefined,
      ),
    });
  }

  private mapWebpageNode(
    record: WebpageNodeRecord,
    baseProps: NodeBaseProps,
  ): WebpageNode {
    return WebpageNode.create({
      ...baseProps,
      fileSize: record.fileSize || 0,
      content: new WebpageContent(resolveWebpageContent(record)),
    });
  }

  private mapWebsiteNode(
    record: WebsiteNodeRecord,
    baseProps: NodeBaseProps,
  ): WebsiteNode {
    return WebsiteNode.create({
      ...baseProps,
      content: new WebsiteContent(record.content || "", record.faviconUrl),
    });
  }

  private mapCollectionNode(
    record: CollectionNodeRecord,
    baseProps: NodeBaseProps,
  ): CollectionNode {
    return CollectionNode.create({
      ...baseProps,
      content: new CollectionContent(
        record.filterConfig
          ? filterConfigFromRecord(record.filterConfig)
          : undefined,
        // A missing column reads as "no views": `normalizeViews` turns
        // `undefined` into `[]`, and the frontend seeds a default view.
        record.views,
      ),
    });
  }

  private mapRichTextNode(
    record: RichTextNodeRecord,
    baseProps: NodeBaseProps,
  ): RichTextNode {
    const referencedNodes = (record.referencedNodes || []).map(
      (id) => new NodeId(id),
    );
    return RichTextNode.create({
      ...baseProps,
      content: new RichTextContent(referencedNodes, record.docs || {}),
    });
  }

  private mapDatabaseNode(
    record: DatabaseNodeRecord,
    baseProps: NodeBaseProps,
  ): DatabaseNode {
    // Both columns are created by the 0 script and `toRecord` always writes
    // them, so a `database` record that reaches here without them was not
    // written by this application (hand-edited DB / raw REST insert). Fail loud:
    // `fromData` would otherwise turn a missing column into a silently empty
    // table (design doc §10).
    if (record.fields == null || record.rows == null) {
      throw new Error(
        `Database node "${baseProps.id.value}" is missing its fields/rows columns`,
      );
    }
    return DatabaseNode.create({
      ...baseProps,
      // The two columns come straight back off the record; the value objects
      // validate them and throw if a hand-edited row no longer forms a table.
      content: DatabaseContent.fromData({
        fields: record.fields,
        rows: record.rows,
        views: record.views,
      }),
    });
  }

  toRecord(node: Node): Partial<RecordModel> {
    const baseRecord: Partial<RecordModel> = {
      id: node.id.value,
      title: node.title,
      abstract: node.abstract,
      permission: node.permission.value,
      semanticId: node.semanticId,
      tags: node.tags,
      isPinned: node.isPinned,
      stateData: node.stateData,
      // `icon` / `cover` are top-level JSON columns that every node type shares
      // and that the user can CLEAR. "No value" therefore has to be written as
      // an explicit `null`: the JS SDK drops `undefined` keys, and PocketBase's
      // `update` is a partial update (a missing key keeps the old value), so
      // `clearIcon()` / `clearCover()` would never reach the database. This is
      // deliberately NOT the `stateData` treatment above.
      icon: node.icon ?? null,
      cover: node.cover ?? null,
      // Do NOT "fix" `annotations` / `timestamps` the same way in the
      // content branches below: those are half-side patches of `content`, so an
      // `undefined` key (i.e. "keep the old value" on a partial update) is
      // exactly the merge semantics `updateNodeContent`'s `?? node.content.*`
      // relies on. Only a whole-field clear needs the `null` sentinel.
      created: node.createdAt,
      updated: node.updatedAt,
      nodeType: node.nodeType.value,
      workspaceId: node.workspaceId,
    };

    if (node instanceof TextNode) {
      return {
        ...baseRecord,
        content: node.content.docs,
      };
    }

    if (node instanceof ImageNode) {
      return {
        ...baseRecord,
        content: node.content.url,
        width: node.width,
        height: node.height,
        fileSize: node.fileSize,
        location: node.location,
        shootingTime: node.shootingTime,
        annotations: node.content.annotations,
      };
    }

    if (node instanceof PdfNode) {
      return {
        ...baseRecord,
        content: node.content.url,
        coverUrl: node.content.coverUrl,
        pageCount: node.pageCount,
        fileSize: node.fileSize,
        annotations: node.content.annotations,
      };
    }

    if (node instanceof VideoNode) {
      return {
        ...baseRecord,
        content: node.content.url,
        // `coverUrl` / `hlsUrl` are string columns with `""` as their "none"
        // value. Like `source`, `sourceUrl` and every other content-adjacent
        // field, they are written as-is: a missing `coverUrl` on an old video
        // node is `""` in the domain, so it round-trips without a `?? ""`.
        coverUrl: node.content.coverUrl,
        hlsUrl: node.content.hlsUrl,
        duration: node.duration,
        source: node.source,
        sourceUrl: node.sourceUrl,
        fileSize: node.fileSize,
        location: node.location,
        shootingTime: node.shootingTime,
        // No `?? null` — see the rule above: `timestamps` is a half-side patch
        // of `content`, and an `undefined` key is what tells the application
        // layer's `?? node.content.*` merge to keep the old value.
        timestamps: node.content.timestamps,
      };
    }

    if (node instanceof AudioNode) {
      return {
        ...baseRecord,
        content: node.content.url,
        // Audio follows the VideoNode conventions above: `coverUrl` is a
        // string column where `""` means "no cover" (the domain field is
        // optional, so `undefined` is written as `""` to clear it), while
        // `timestamps` is deliberately left `undefined` for "keep the old
        // value" on a partial content update.
        coverUrl: node.content.coverUrl ?? "",
        duration: node.duration,
        source: node.source,
        sourceUrl: node.sourceUrl,
        fileSize: node.fileSize,
        timestamps: node.content.timestamps,
      };
    }

    if (node instanceof WebpageNode) {
      // The node keeps no source: the document is an object in the `files`
      // collection, so only its address and recorded byte length are stored.
      // The retired `codeLanguage` column is not cleared, because a record it
      // wrote is read back through the migration that moved the bytes.
      return {
        ...baseRecord,
        content: node.content.url,
        fileSize: node.fileSize,
      };
    }

    if (node instanceof WebsiteNode) {
      return {
        ...baseRecord,
        content: node.content.url,
        faviconUrl: node.content.faviconUrl,
      };
    }

    if (node instanceof CollectionNode) {
      return {
        ...baseRecord,
        filterConfig: node.content.filterConfig
          ? filterConfigToRecord(node.content.filterConfig)
          : undefined,
        // Views are plain JSON already (no value objects to unwrap), so they go
        // into their own column as-is.
        views: node.content.views,
      };
    }

    if (node instanceof RichTextNode) {
      return {
        ...baseRecord,
        referencedNodes: node.content.referencedNodes.map((n) => n.value),
        docs: node.content.docs,
      };
    }

    if (node instanceof DatabaseNode) {
      // The table goes in its own two JSON columns — `fields` and `rows` — the
      // way `rich-text` uses `referencedNodes` + `docs`. `content` is
      // deliberately not written, so the shared column is left to the node
      // types that actually own a single payload. Fields and cells are also
      // unwrapped to plain JSON: writing the value objects directly would
      // persist `{ "_value": ... }` wrappers.
      return {
        ...baseRecord,
        fields: node.content.fields.map((field) => ({
          id: field.id,
          name: field.name,
          type: field.type,
          includeTime: field.includeTime,
          options: field.options?.map((option) => ({
            id: option.id,
            name: option.name,
            color: option.color,
          })),
        })),
        rows: node.content.rows.map((row) => ({
          id: row.id,
          cells: Object.fromEntries(
            Object.entries(row.cells).map(([fieldId, cell]) => [
              fieldId,
              cell.value,
            ]),
          ),
        })),
        views: node.content.views,
      };
    }

    throw new Error(`Unknown node type: ${node.constructor.name}`);
  }
}
