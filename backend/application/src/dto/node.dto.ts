// SPDX-License-Identifier: AGPL-3.0-only

import type { DataView } from "@workspace/interfaces/models/data-view";
import type { FilterConfig } from "@workspace/interfaces/models/filter";
import type {
  NodeStateData,
  NodeIcon,
  NodeCover,
} from "@workspace/interfaces/models/node/base";
import type {
  AnnotationLayerData,
  TimestampData,
} from "@workspace/interfaces/models/node/nodes";
import type { WebpageContent } from "@workspace/interfaces/models/node/nodes/single/webpage";
import type { DatabaseContent } from "@workspace/interfaces/models/node/nodes/complex/database";

export interface BaseNodeDTO {
  id: string;
  workspaceId?: string;
  title: string;
  abstract?: string;
  permission: "private" | "public" | "restricted";
  semanticId: string;
  tags: string[];
  isPinned: boolean;
  /**
   * Display icon / cover. Both are `undefined` when the node has none: the
   * read path never carries the write-only `null` "clear" sentinel.
   */
  icon?: NodeIcon;
  cover?: NodeCover;
  stateData?: NodeStateData;
  createdAt: string;
  updatedAt: string;
}

export interface TextNodeDTO extends BaseNodeDTO {
  nodeType: "text";
  content: { docs: Record<string, any> };
}

export interface ImageNodeDTO extends BaseNodeDTO {
  nodeType: "image";
  width: number;
  height: number;
  fileSize: number;
  location?: string;
  shootingTime?: string;
  content: { url: string; annotations?: AnnotationLayerData };
}

export interface PdfNodeDTO extends BaseNodeDTO {
  nodeType: "pdf";
  pageCount: number;
  fileSize: number;
  content: { url: string; coverUrl: string; annotations?: AnnotationLayerData };
}

export interface VideoNodeDTO extends BaseNodeDTO {
  nodeType: "video";
  duration: number;
  source: "local" | "online";
  sourceUrl?: string;
  fileSize?: number;
  location?: string;
  shootingTime?: string;
  content: {
    url: string;
    coverUrl: string;
    hlsUrl?: string;
    timestamps?: TimestampData[];
  };
}

export interface AudioNodeDTO extends BaseNodeDTO {
  nodeType: "audio";
  duration: number;
  /** Reads as `"local"` on every record written before the import existed. */
  source: "local" | "online";
  sourceUrl?: string;
  fileSize: number;
  content: {
    url: string;
    /** Only an imported node has artwork; a local upload has none. */
    coverUrl?: string;
    timestamps?: TimestampData[];
  };
}

export interface WebpageNodeDTO extends BaseNodeDTO {
  nodeType: "webpage";
  /** Byte length of the stored document; 0 while the node has no file. */
  fileSize: number;
  content: WebpageContent;
}

export interface WebsiteNodeDTO extends BaseNodeDTO {
  nodeType: "website";
  content: { url: string; faviconUrl?: string };
}

export interface CollectionNodeDTO extends BaseNodeDTO {
  nodeType: "collection";
  content: {
    filterConfig?: FilterConfig;
    /** Data views of this collection; mirrors `CollectionContent.views`. */
    views?: DataView[];
  };
}

export interface RichTextNodeDTO extends BaseNodeDTO {
  nodeType: "rich-text";
  content: {
    referencedNodes: string[];
    docs: Record<string, any>;
  };
}

export interface DatabaseNodeDTO extends BaseNodeDTO {
  nodeType: "database";
  content: DatabaseContent;
}

export type NodeDTO =
  | TextNodeDTO
  | ImageNodeDTO
  | PdfNodeDTO
  | VideoNodeDTO
  | AudioNodeDTO
  | WebpageNodeDTO
  | WebsiteNodeDTO
  | CollectionNodeDTO
  | RichTextNodeDTO
  | DatabaseNodeDTO;
