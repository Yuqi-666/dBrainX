// SPDX-License-Identifier: AGPL-3.0-only

import type {
  DataView,
  DatabaseContent,
  FilterConfig,
  NodeCover,
  NodeIcon,
  NodeStateData,
  TimestampData,
  WebpageContent,
} from "@workspace/interfaces";

export interface CreateTextNodeCommand {
  nodeType: "text";
  id: string;
  title: string;
  abstract?: string;
  permission?: "private" | "public" | "restricted";
  semanticId: string;
  tags?: string[];
  isPinned?: boolean;
  stateData?: NodeStateData;
  icon?: NodeIcon | null;
  cover?: NodeCover | null;
  content: { docs: Record<string, any> };
  userId: string;
  sourceId?: string;
  workspaceId?: string;
}

export interface CreateImageNodeCommand {
  nodeType: "image";
  id: string;
  title: string;
  abstract?: string;
  permission?: "private" | "public" | "restricted";
  semanticId: string;
  tags?: string[];
  isPinned?: boolean;
  stateData?: NodeStateData;
  icon?: NodeIcon | null;
  cover?: NodeCover | null;
  width: number;
  height: number;
  fileSize: number;
  location?: string;
  shootingTime?: string;
  content: { url: string };
  userId: string;
  sourceId?: string;
  workspaceId?: string;
}

export interface CreatePdfNodeCommand {
  nodeType: "pdf";
  id: string;
  title: string;
  abstract?: string;
  permission?: "private" | "public" | "restricted";
  semanticId: string;
  tags?: string[];
  isPinned?: boolean;
  stateData?: NodeStateData;
  icon?: NodeIcon | null;
  cover?: NodeCover | null;
  pageCount: number;
  fileSize: number;
  content: { url: string; coverUrl: string };
  userId: string;
  sourceId?: string;
  workspaceId?: string;
}

export interface CreateVideoNodeCommand {
  nodeType: "video";
  id: string;
  title: string;
  abstract?: string;
  permission?: "private" | "public" | "restricted";
  semanticId: string;
  tags?: string[];
  isPinned?: boolean;
  stateData?: NodeStateData;
  icon?: NodeIcon | null;
  cover?: NodeCover | null;
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
  userId: string;
  sourceId?: string;
  workspaceId?: string;
}

export interface CreateAudioNodeCommand {
  nodeType: "audio";
  id: string;
  title: string;
  abstract?: string;
  permission?: "private" | "public" | "restricted";
  semanticId: string;
  tags?: string[];
  isPinned?: boolean;
  stateData?: NodeStateData;
  icon?: NodeIcon | null;
  cover?: NodeCover | null;
  duration: number;
  /** Absent means "local": a create payload from an old client has no source. */
  source?: "local" | "online";
  sourceUrl?: string;
  fileSize: number;
  content: { url: string; coverUrl?: string; timestamps?: TimestampData[] };
  userId: string;
  sourceId?: string;
  workspaceId?: string;
}

export interface CreateWebpageNodeCommand {
  nodeType: "webpage";
  id: string;
  title: string;
  abstract?: string;
  permission?: "private" | "public" | "restricted";
  semanticId: string;
  tags?: string[];
  isPinned?: boolean;
  stateData?: NodeStateData;
  icon?: NodeIcon | null;
  cover?: NodeCover | null;
  /** Byte length of the stored document; 0 for a node created empty. */
  fileSize?: number;
  content: WebpageContent;
  userId: string;
  sourceId?: string;
  workspaceId?: string;
}

export interface CreateWebsiteNodeCommand {
  nodeType: "website";
  id: string;
  title: string;
  abstract?: string;
  permission?: "private" | "public" | "restricted";
  semanticId: string;
  tags?: string[];
  isPinned?: boolean;
  stateData?: NodeStateData;
  icon?: NodeIcon | null;
  cover?: NodeCover | null;
  content: { url: string; faviconUrl?: string };
  userId: string;
  sourceId?: string;
  workspaceId?: string;
}

export interface CreateCollectionNodeCommand {
  nodeType: "collection";
  id: string;
  title: string;
  abstract?: string;
  permission?: "private" | "public" | "restricted";
  semanticId: string;
  tags?: string[];
  isPinned?: boolean;
  stateData?: NodeStateData;
  icon?: NodeIcon | null;
  cover?: NodeCover | null;
  content: {
    filterConfig?: FilterConfig;
    /** Data views of this collection; absent means "start with none". */
    views?: DataView[];
  };
  userId: string;
  sourceId?: string;
  workspaceId?: string;
}

export interface CreateRichTextNodeCommand {
  nodeType: "rich-text";
  id: string;
  title: string;
  abstract?: string;
  permission?: "private" | "public" | "restricted";
  semanticId: string;
  tags?: string[];
  isPinned?: boolean;
  stateData?: NodeStateData;
  icon?: NodeIcon | null;
  cover?: NodeCover | null;
  content: { referencedNodes: string[]; docs: Record<string, any> };
  userId: string;
  sourceId?: string;
  workspaceId?: string;
}

/**
 * `content` is the whole table — fields and rows are replaced wholesale, so
 * column/row edits do not need a command of their own (design doc §10).
 */
export interface CreateDatabaseNodeCommand {
  nodeType: "database";
  id: string;
  title: string;
  abstract?: string;
  permission?: "private" | "public" | "restricted";
  semanticId: string;
  tags?: string[];
  isPinned?: boolean;
  stateData?: NodeStateData;
  icon?: NodeIcon | null;
  cover?: NodeCover | null;
  content: DatabaseContent;
  userId: string;
  sourceId?: string;
  workspaceId?: string;
}

export type CreateNodeCommand =
  | CreateTextNodeCommand
  | CreateImageNodeCommand
  | CreatePdfNodeCommand
  | CreateVideoNodeCommand
  | CreateAudioNodeCommand
  | CreateWebpageNodeCommand
  | CreateWebsiteNodeCommand
  | CreateCollectionNodeCommand
  | CreateRichTextNodeCommand
  | CreateDatabaseNodeCommand;

export interface UpdateNodeCommand {
  id: string;
  title?: string;
  abstract?: string;
  tags?: string[];
  permission?: "private" | "public" | "restricted";
  semanticId?: string;
  isPinned?: boolean;
  /**
   * Partial content patch. Every key is an independent half: only the keys
   * present in the patch are written, and an omitted key keeps the value
   * already stored. The rich-text `referencedNodes` / `docs` pair is two such
   * independent halves — either may be patched alone — not one.
   */
  content?: any;
  stateData?: NodeStateData;
  /**
   * Display icon / cover, same value judgement as `isPinned`: `null` asks this
   * write to clear the field (the R29 sentinel — once the client's merged node
   * arrives, `undefined` cannot be told apart from "do not touch this field"),
   * while `undefined` leaves the stored value untouched.
   */
  icon?: NodeIcon | null;
  cover?: NodeCover | null;
  /**
   * File metadata measured by the upload flow (dimensions, duration, page
   * count, …). These are immutable everywhere else in the domain, so they ride
   * along with the update that carries the uploaded url — see
   * `ImageNode.updateFileMeta`. Each media node picks the subset it owns.
   */
  fileSize?: number;
  width?: number;
  height?: number;
  duration?: number;
  pageCount?: number;
  source?: "local" | "online";
  sourceUrl?: string;
  location?: string;
  shootingTime?: string;
  userId: string;
  sourceId?: string;
  workspaceId?: string;
}

export interface DeleteNodeCommand {
  id: string;
  userId: string;
  sourceId?: string;
}
