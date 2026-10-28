// SPDX-License-Identifier: AGPL-3.0-only

import type { Node } from "@workspace/domain";
import {
  AudioNode,
  CollectionNode,
  DatabaseNode,
  ImageNode,
  PdfNode,
  RichTextNode,
  TextNode,
  VideoNode,
  WebpageNode,
  WebsiteNode,
} from "@workspace/domain";

import type { NodeDTO } from "./node.dto";

/**
 * Domain node → DTO mapping, shared by the command and query services.
 *
 * Both services hand nodes to the client, and the two used to carry their own
 * copy of this switch. That copy is how `hlsUrl` first shipped half-wired: the
 * write path mapped it and the read path silently dropped it, so a node was
 * stored with a playlist the client never saw. One mapper means one place to
 * teach about a new field.
 */
export function toNodeDTO(node: Node): NodeDTO {
  const base = {
    id: node.id.value,
    workspaceId: node.workspaceId,
    title: node.title,
    abstract: node.abstract,
    permission: node.permission.value as "private" | "public" | "restricted",
    semanticId: node.semanticId,
    tags: node.tags,
    isPinned: node.isPinned,
    // The getters normalise the write-only `null` clear sentinel to
    // `undefined`, so the read path never hands `null` to a client (R29-定).
    icon: node.icon,
    cover: node.cover,
    stateData: node.stateData,
    createdAt: node.createdAt,
    updatedAt: node.updatedAt,
  };

  switch (node.nodeType.value) {
    case "text":
      return {
        ...base,
        nodeType: "text" as const,
        content: { docs: (node as TextNode).content.docs },
      };
    case "image": {
      const image = node as ImageNode;
      return {
        ...base,
        nodeType: "image" as const,
        width: image.width,
        height: image.height,
        fileSize: image.fileSize,
        location: image.location,
        shootingTime: image.shootingTime,
        content: {
          url: image.content.url,
          annotations: image.content.annotations,
        },
      };
    }
    case "pdf": {
      const pdf = node as PdfNode;
      return {
        ...base,
        nodeType: "pdf" as const,
        pageCount: pdf.pageCount,
        fileSize: pdf.fileSize,
        content: {
          url: pdf.content.url,
          coverUrl: pdf.content.coverUrl,
          annotations: pdf.content.annotations,
        },
      };
    }
    case "video": {
      const video = node as VideoNode;
      return {
        ...base,
        nodeType: "video" as const,
        duration: video.duration,
        source: video.source,
        sourceUrl: video.sourceUrl,
        fileSize: video.fileSize,
        location: video.location,
        shootingTime: video.shootingTime,
        content: {
          url: video.content.url,
          coverUrl: video.content.coverUrl,
          hlsUrl: video.content.hlsUrl,
          // Named here or dropped here — see the `hlsUrl` note above.
          timestamps: video.content.timestamps,
        },
      };
    }
    case "audio": {
      const audio = node as AudioNode;
      return {
        ...base,
        nodeType: "audio" as const,
        duration: audio.duration,
        source: audio.source,
        sourceUrl: audio.sourceUrl,
        fileSize: audio.fileSize,
        content: {
          url: audio.content.url,
          coverUrl: audio.content.coverUrl,
          timestamps: audio.content.timestamps,
        },
      };
    }
    case "webpage": {
      const webpage = node as WebpageNode;
      return {
        ...base,
        nodeType: "webpage" as const,
        fileSize: webpage.fileSize,
        content: {
          url: webpage.content.url,
        },
      };
    }
    case "website": {
      const website = node as WebsiteNode;
      return {
        ...base,
        nodeType: "website" as const,
        content: {
          url: website.content.url,
          faviconUrl: website.content.faviconUrl,
        },
      };
    }
    case "collection": {
      const collection = node as CollectionNode;
      return {
        ...base,
        nodeType: "collection" as const,
        content: {
          filterConfig: collection.content.filterConfig && {
            selectedNodes: collection.content.filterConfig.selectedNodes?.map(
              (nodeId) => nodeId.value,
            ),
            ruleGroup: collection.content.filterConfig.ruleGroup,
            collectionType: collection.content.filterConfig.collectionType,
          },
          // Views are already plain JSON, so they go out untouched — but they
          // must be listed explicitly: this mapper builds the content by hand
          // and anything not named here never reaches the client.
          views: collection.content.views,
        },
      };
    }
    case "rich-text": {
      const richText = node as RichTextNode;
      return {
        ...base,
        nodeType: "rich-text" as const,
        content: {
          referencedNodes: richText.content.referencedNodes.map((n) => n.value),
          docs: richText.content.docs,
        },
      };
    }
    case "database": {
      const database = node as DatabaseNode;
      // Cells are unwrapped to their plain JSON payload: a `DatabaseCell` value
      // object written as-is would serialize to `{ "_value": ... }`.
      return {
        ...base,
        nodeType: "database" as const,
        content: {
          fields: database.content.fields.map((field) => ({
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
          rows: database.content.rows.map((row) => ({
            id: row.id,
            cells: Object.fromEntries(
              Object.entries(row.cells).map(([fieldId, cell]) => [
                fieldId,
                cell.value,
              ]),
            ),
          })),
          // Same reason as the collection case: named here or dropped here.
          views: database.content.views,
        },
      };
    }
    default:
      throw new Error(`Unknown node type`);
  }
}
