// SPDX-License-Identifier: AGPL-3.0-only

import type { NodeCover, NodeIcon } from "@workspace/interfaces";
import type { DataView } from "@workspace/interfaces/models/data-view";
import type {
  NodeTagId,
  NodeSemanticId,
  NodeStateData,
} from "@workspace/interfaces/models/node/base";
import type { NodeDataType } from "@workspace/interfaces/models/node/types";

import {
  NodeId,
  Permission,
  NodeType,
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
  DatabaseField,
  DatabaseFieldOption,
  DatabaseCell,
  DatabaseRow,
  type DatabaseFieldType,
} from "./value-objects";
import { FilterConfig } from "../filter/value-objects";

export interface NodeBaseProps {
  id: NodeId;
  title: string;
  abstract?: string;
  permission: Permission;
  semanticId: NodeSemanticId;
  tags: NodeTagId[];
  isPinned: boolean;
  stateData?: NodeStateData;
  createdAt: string;
  updatedAt: string;
  workspaceId?: string;
  /**
   * Display icon (`NodeBase.icon`).
   *
   * **`null` is the write path's "clear this field" sentinel** — `docs/plan/README.md`
   * §9 R29-定, with the shape fixed by selectors §0.2-④. The `Node`
   * constructor normalises it to `undefined`, so `Node.icon` never returns
   * `null`: a clear and an absent icon read back identically, while `undefined`
   * on a write means "leave this field alone" (the two cannot be told apart
   * once merged).
   */
  icon?: NodeIcon | null;
  /** Display cover. See {@link NodeBaseProps.icon} for the `null` sentinel. */
  cover?: NodeCover | null;
}

export abstract class Node {
  protected readonly _id: NodeId;
  protected readonly _title: string;
  protected readonly _abstract: string | undefined;
  protected readonly _permission: Permission;
  protected readonly _semanticId: NodeSemanticId;
  protected readonly _tags: NodeTagId[];
  protected readonly _isPinned: boolean;
  protected readonly _stateData: NodeStateData | undefined;
  protected readonly _createdAt: string;
  protected readonly _updatedAt: string;
  protected readonly _nodeType: NodeType;
  protected readonly _workspaceId: string | undefined;
  protected readonly _icon: NodeIcon | undefined;
  protected readonly _cover: NodeCover | undefined;

  protected constructor(
    props: NodeBaseProps & { nodeType: NodeType<NodeDataType> },
  ) {
    this._id = props.id;
    this._title = props.title;
    this._abstract = props.abstract;
    this._permission = props.permission;
    this._semanticId = props.semanticId;
    this._tags = [...props.tags];
    this._isPinned = props.isPinned;
    this._stateData = props.stateData ? { ...props.stateData } : undefined;
    this._createdAt = props.createdAt;
    this._updatedAt = props.updatedAt;
    this._nodeType = props.nodeType;
    this._workspaceId = props.workspaceId;
    // The one place the `null` clear sentinel is normalised away: every
    // subclass rebuilds through this constructor, so the getters below can
    // promise `undefined` and never `null` (`docs/plan/README.md` §9 R29-定).
    this._icon = props.icon ?? undefined;
    this._cover = props.cover ?? undefined;
  }

  get id(): NodeId {
    return this._id;
  }

  get title(): string {
    return this._title;
  }

  get abstract(): string | undefined {
    return this._abstract;
  }

  get permission(): Permission {
    return this._permission;
  }

  get semanticId(): NodeSemanticId {
    return this._semanticId;
  }

  get tags(): NodeTagId[] {
    return [...this._tags];
  }

  get isPinned(): boolean {
    return this._isPinned;
  }

  get stateData(): NodeStateData | undefined {
    return this._stateData ? { ...this._stateData } : undefined;
  }

  get createdAt(): string {
    return this._createdAt;
  }

  get updatedAt(): string {
    return this._updatedAt;
  }

  get nodeType(): NodeType {
    return this._nodeType;
  }

  get workspaceId(): string | undefined {
    return this._workspaceId;
  }

  /** Display icon, or `undefined` when the node has none (never `null`). */
  get icon(): NodeIcon | undefined {
    return this._icon;
  }

  /** Display cover, or `undefined` when the node has none (never `null`). */
  get cover(): NodeCover | undefined {
    return this._cover;
  }

  sameIdentityAs(other: Node): boolean {
    return this._id.equals(other._id);
  }

  updateTitle(title: string): Node {
    return this.cloneWith({
      title,
      updatedAt: new Date().toISOString(),
    });
  }

  updateAbstract(abstract: string): Node {
    return this.cloneWith({
      abstract,
      updatedAt: new Date().toISOString(),
    });
  }

  updateTags(tags: NodeTagId[]): Node {
    return this.cloneWith({
      tags,
      updatedAt: new Date().toISOString(),
    });
  }

  updatePermission(permission: Permission): Node {
    return this.cloneWith({
      permission,
      updatedAt: new Date().toISOString(),
    });
  }

  updateSemanticId(semanticId: string): Node {
    return this.cloneWith({
      semanticId,
      updatedAt: new Date().toISOString(),
    });
  }
  pin(): Node {
    if (this._isPinned) return this;
    return this.cloneWith({
      isPinned: true,
      updatedAt: new Date().toISOString(),
    });
  }

  unpin(): Node {
    if (!this._isPinned) return this;
    return this.cloneWith({
      isPinned: false,
      updatedAt: new Date().toISOString(),
    });
  }

  updateNodeStateData(stateData: NodeStateData): Node {
    return this.cloneWith({
      stateData,
      updatedAt: new Date().toISOString(),
    });
  }

  updateIcon(icon: NodeIcon): Node {
    return this.cloneWith({
      icon,
      updatedAt: new Date().toISOString(),
    });
  }

  /**
   * Remove the display icon.
   *
   * `icon: null` — not `undefined` — is the write-path sentinel: the client
   * sends a merged node and the server decides value-by-value, so an
   * `undefined` here would be read as "leave the old icon in place"
   * (`docs/plan/README.md` §9 R29-定).
   */
  clearIcon(): Node {
    return this.cloneWith({
      icon: null,
      updatedAt: new Date().toISOString(),
    });
  }

  updateCover(cover: NodeCover): Node {
    return this.cloneWith({
      cover,
      updatedAt: new Date().toISOString(),
    });
  }

  /** Remove the display cover. See {@link Node.clearIcon} for the `null` sentinel. */
  clearCover(): Node {
    return this.cloneWith({
      cover: null,
      updatedAt: new Date().toISOString(),
    });
  }

  /**
   * Every base field, shaped exactly like the subclasses' constructor /
   * `create()` input.
   *
   * This is the base fields' single home: each subclass rebuilds itself with
   * `{ ...this.baseProps(), ...its own fields }` instead of re-listing the
   * eleven base properties in `create` / `updateContent` / `updateFileMeta` /
   * `cloneWith`. Adding a base field therefore touches this method and
   * `NodeBaseProps` once, not ten subclasses (selectors §0.2-④ / §8).
   */
  protected baseProps(): NodeBaseProps {
    return {
      id: this._id,
      title: this._title,
      abstract: this._abstract,
      permission: this._permission,
      semanticId: this._semanticId,
      tags: this._tags,
      isPinned: this._isPinned,
      stateData: this._stateData,
      createdAt: this._createdAt,
      updatedAt: this._updatedAt,
      workspaceId: this._workspaceId,
      icon: this._icon,
      cover: this._cover,
    };
  }

  protected abstract cloneWith(props: Partial<NodeBaseProps>): Node;
}

export class TextNode extends Node {
  protected readonly _content: TextContent;

  private constructor(props: NodeBaseProps & { content: TextContent }) {
    super({ ...props, nodeType: new NodeType<"text">("text") });
    this._content = props.content;
  }

  get content(): TextContent {
    return this._content;
  }

  static create(props: {
    id: NodeId;
    title: string;
    abstract?: string;
    permission: Permission;
    semanticId: NodeSemanticId;
    tags?: NodeTagId[];
    isPinned?: boolean;
    stateData?: NodeStateData;
    icon?: NodeIcon | null;
    cover?: NodeCover | null;
    content: TextContent;
    createdAt?: string;
    updatedAt?: string;
    workspaceId?: string;
  }): TextNode {
    const now = new Date().toISOString();
    return new TextNode({
      id: props.id,
      title: props.title,
      abstract: props.abstract,
      permission: props.permission,
      semanticId: props.semanticId,
      tags: props.tags ?? [],
      isPinned: props.isPinned ?? false,
      stateData: props.stateData,
      icon: props.icon,
      cover: props.cover,
      content: props.content,
      createdAt: props.createdAt ?? now,
      updatedAt: props.updatedAt ?? now,
      workspaceId: props.workspaceId,
    });
  }

  updateContent(content: TextContent): TextNode {
    return new TextNode({
      ...this.baseProps(),
      content,
      updatedAt: new Date().toISOString(),
    });
  }

  protected cloneWith(props: Partial<NodeBaseProps>): TextNode {
    return new TextNode({
      ...this.baseProps(),
      ...props,
      content: this._content,
    });
  }
}

export class ImageNode extends Node {
  protected readonly _width: number;
  protected readonly _height: number;
  protected readonly _fileSize: number;
  protected readonly _location: string | undefined;
  protected readonly _shootingTime: string | undefined;
  protected readonly _content: ImageContent;

  private constructor(
    props: NodeBaseProps & {
      width: number;
      height: number;
      fileSize: number;
      location?: string;
      shootingTime?: string;
      content: ImageContent;
    },
  ) {
    super({ ...props, nodeType: new NodeType<"image">("image") });

    if (props.width < 0) throw new Error("Image width must bever positive");
    if (props.height < 0) throw new Error("Image height must be positive");
    if (props.fileSize < 0) throw new Error("Image file size must be positive");

    this._width = props.width;
    this._height = props.height;
    this._fileSize = props.fileSize;
    this._location = props.location;
    this._shootingTime = props.shootingTime;
    this._content = props.content;
  }

  get width(): number {
    return this._width;
  }

  get height(): number {
    return this._height;
  }

  get fileSize(): number {
    return this._fileSize;
  }

  get location(): string | undefined {
    return this._location;
  }

  get shootingTime(): string | undefined {
    return this._shootingTime;
  }

  get content(): ImageContent {
    return this._content;
  }

  static create(props: {
    id: NodeId;
    title: string;
    abstract?: string;
    permission: Permission;
    semanticId: NodeSemanticId;
    tags?: NodeTagId[];
    isPinned?: boolean;
    stateData?: NodeStateData;
    icon?: NodeIcon | null;
    cover?: NodeCover | null;
    width: number;
    height: number;
    fileSize: number;
    location?: string;
    shootingTime?: string;
    content: ImageContent;
    createdAt?: string;
    updatedAt?: string;
    workspaceId?: string;
  }): ImageNode {
    const now = new Date().toISOString();
    return new ImageNode({
      id: props.id,
      title: props.title,
      abstract: props.abstract,
      permission: props.permission,
      semanticId: props.semanticId,
      tags: props.tags ?? [],
      isPinned: props.isPinned ?? false,
      stateData: props.stateData,
      icon: props.icon,
      cover: props.cover,
      width: props.width,
      height: props.height,
      fileSize: props.fileSize,
      location: props.location,
      shootingTime: props.shootingTime,
      content: props.content,
      createdAt: props.createdAt ?? now,
      updatedAt: props.updatedAt ?? now,
      workspaceId: props.workspaceId,
    });
  }

  updateContent(content: ImageContent): ImageNode {
    return new ImageNode({
      ...this.baseProps(),
      width: this._width,
      height: this._height,
      fileSize: this._fileSize,
      location: this._location,
      shootingTime: this._shootingTime,
      content,
      updatedAt: new Date().toISOString(),
    });
  }

  /**
   * Replaces the metadata measured on the uploaded file. The upload flow patches
   * an already-created node, so these values arrive after `create()`. Returns
   * `this` when the patch carries nothing this node understands.
   */
  updateFileMeta(meta: {
    width?: number;
    height?: number;
    fileSize?: number;
    location?: string;
    shootingTime?: string;
  }): ImageNode {
    if (
      meta.width === undefined &&
      meta.height === undefined &&
      meta.fileSize === undefined &&
      meta.location === undefined &&
      meta.shootingTime === undefined
    ) {
      return this;
    }

    return new ImageNode({
      ...this.baseProps(),
      width: meta.width ?? this._width,
      height: meta.height ?? this._height,
      fileSize: meta.fileSize ?? this._fileSize,
      location: meta.location ?? this._location,
      shootingTime: meta.shootingTime ?? this._shootingTime,
      content: this._content,
      updatedAt: new Date().toISOString(),
    });
  }

  protected cloneWith(props: Partial<NodeBaseProps>): ImageNode {
    return new ImageNode({
      ...this.baseProps(),
      ...props,
      width: this._width,
      height: this._height,
      fileSize: this._fileSize,
      location: this._location,
      shootingTime: this._shootingTime,
      content: this._content,
    });
  }
}

export class PdfNode extends Node {
  protected readonly _pageCount: number;
  protected readonly _fileSize: number;
  protected readonly _content: PdfContent;

  private constructor(
    props: NodeBaseProps & {
      pageCount: number;
      fileSize: number;
      content: PdfContent;
    },
  ) {
    super({ ...props, nodeType: new NodeType<"pdf">("pdf") });

    if (props.pageCount < 0) throw new Error("PDF page count must be positive");
    if (props.fileSize < 0) throw new Error("PDF file size must be positive");

    this._pageCount = props.pageCount;
    this._fileSize = props.fileSize;
    this._content = props.content;
  }

  get pageCount(): number {
    return this._pageCount;
  }

  get fileSize(): number {
    return this._fileSize;
  }

  get content(): PdfContent {
    return this._content;
  }

  static create(props: {
    id: NodeId;
    title: string;
    abstract?: string;
    permission: Permission;
    semanticId: NodeSemanticId;
    tags?: NodeTagId[];
    isPinned?: boolean;
    stateData?: NodeStateData;
    icon?: NodeIcon | null;
    cover?: NodeCover | null;
    pageCount: number;
    fileSize: number;
    content: PdfContent;
    createdAt?: string;
    updatedAt?: string;
    workspaceId?: string;
  }): PdfNode {
    const now = new Date().toISOString();
    return new PdfNode({
      id: props.id,
      title: props.title,
      abstract: props.abstract,
      permission: props.permission,
      semanticId: props.semanticId,
      tags: props.tags ?? [],
      isPinned: props.isPinned ?? false,
      stateData: props.stateData,
      icon: props.icon,
      cover: props.cover,
      pageCount: props.pageCount,
      fileSize: props.fileSize,
      content: props.content,
      createdAt: props.createdAt ?? now,
      updatedAt: props.updatedAt ?? now,
      workspaceId: props.workspaceId,
    });
  }

  updateContent(content: PdfContent): PdfNode {
    return new PdfNode({
      ...this.baseProps(),
      pageCount: this._pageCount,
      fileSize: this._fileSize,
      content,
      updatedAt: new Date().toISOString(),
    });
  }

  /** See `ImageNode.updateFileMeta`. */
  updateFileMeta(meta: { pageCount?: number; fileSize?: number }): PdfNode {
    if (meta.pageCount === undefined && meta.fileSize === undefined) {
      return this;
    }

    return new PdfNode({
      ...this.baseProps(),
      pageCount: meta.pageCount ?? this._pageCount,
      fileSize: meta.fileSize ?? this._fileSize,
      content: this._content,
      updatedAt: new Date().toISOString(),
    });
  }

  protected cloneWith(props: Partial<NodeBaseProps>): PdfNode {
    return new PdfNode({
      ...this.baseProps(),
      ...props,
      pageCount: this._pageCount,
      fileSize: this._fileSize,
      content: this._content,
    });
  }
}

export class VideoNode extends Node {
  protected readonly _duration: number;
  protected readonly _source: "local" | "online";
  protected readonly _sourceUrl: string | undefined;
  protected readonly _fileSize: number | undefined;
  protected readonly _location: string | undefined;
  protected readonly _shootingTime: string | undefined;
  protected readonly _content: VideoContent;

  private constructor(
    props: NodeBaseProps & {
      duration: number;
      source: "local" | "online";
      sourceUrl?: string;
      fileSize?: number;
      location?: string;
      shootingTime?: string;
      content: VideoContent;
    },
  ) {
    super({ ...props, nodeType: new NodeType<"video">("video") });

    if (props.duration < 0) throw new Error("Video duration must be positive");
    if (props.source !== "local" && props.source !== "online") {
      throw new Error("Video source must be 'local' or 'online'");
    }

    this._duration = props.duration;
    this._source = props.source;
    this._sourceUrl = props.sourceUrl;
    this._fileSize = props.fileSize;
    this._location = props.location;
    this._shootingTime = props.shootingTime;
    this._content = props.content;
  }

  get duration(): number {
    return this._duration;
  }

  get source(): "local" | "online" {
    return this._source;
  }

  get sourceUrl(): string | undefined {
    return this._sourceUrl;
  }

  get fileSize(): number | undefined {
    return this._fileSize;
  }

  get location(): string | undefined {
    return this._location;
  }

  get shootingTime(): string | undefined {
    return this._shootingTime;
  }

  get content(): VideoContent {
    return this._content;
  }

  static create(props: {
    id: NodeId;
    title: string;
    abstract?: string;
    permission: Permission;
    semanticId: NodeSemanticId;
    tags?: NodeTagId[];
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
    content: VideoContent;
    createdAt?: string;
    updatedAt?: string;
    workspaceId?: string;
  }): VideoNode {
    const now = new Date().toISOString();
    return new VideoNode({
      id: props.id,
      title: props.title,
      abstract: props.abstract,
      permission: props.permission,
      semanticId: props.semanticId,
      tags: props.tags ?? [],
      isPinned: props.isPinned ?? false,
      stateData: props.stateData,
      icon: props.icon,
      cover: props.cover,
      duration: props.duration,
      source: props.source,
      sourceUrl: props.sourceUrl,
      fileSize: props.fileSize,
      location: props.location,
      shootingTime: props.shootingTime,
      content: props.content,
      createdAt: props.createdAt ?? now,
      updatedAt: props.updatedAt ?? now,
      workspaceId: props.workspaceId,
    });
  }

  updateContent(content: VideoContent): VideoNode {
    return new VideoNode({
      ...this.baseProps(),
      duration: this._duration,
      source: this._source,
      sourceUrl: this._sourceUrl,
      fileSize: this._fileSize,
      location: this._location,
      shootingTime: this._shootingTime,
      content,
      updatedAt: new Date().toISOString(),
    });
  }

  /** See `ImageNode.updateFileMeta`. */
  updateFileMeta(meta: {
    duration?: number;
    source?: "local" | "online";
    sourceUrl?: string;
    fileSize?: number;
    location?: string;
    shootingTime?: string;
  }): VideoNode {
    if (
      meta.duration === undefined &&
      meta.source === undefined &&
      meta.sourceUrl === undefined &&
      meta.fileSize === undefined &&
      meta.location === undefined &&
      meta.shootingTime === undefined
    ) {
      return this;
    }

    return new VideoNode({
      ...this.baseProps(),
      duration: meta.duration ?? this._duration,
      source: meta.source ?? this._source,
      sourceUrl: meta.sourceUrl ?? this._sourceUrl,
      fileSize: meta.fileSize ?? this._fileSize,
      location: meta.location ?? this._location,
      shootingTime: meta.shootingTime ?? this._shootingTime,
      content: this._content,
      updatedAt: new Date().toISOString(),
    });
  }

  protected cloneWith(props: Partial<NodeBaseProps>): VideoNode {
    return new VideoNode({
      ...this.baseProps(),
      ...props,
      duration: this._duration,
      source: this._source,
      sourceUrl: this._sourceUrl,
      fileSize: this._fileSize,
      location: this._location,
      shootingTime: this._shootingTime,
      content: this._content,
    });
  }
}

export class AudioNode extends Node {
  protected readonly _duration: number;
  protected readonly _source: "local" | "online";
  protected readonly _sourceUrl: string | undefined;
  protected readonly _fileSize: number;
  protected readonly _content: AudioContent;

  private constructor(
    props: NodeBaseProps & {
      duration: number;
      source: "local" | "online";
      sourceUrl?: string;
      fileSize: number;
      content: AudioContent;
    },
  ) {
    super({ ...props, nodeType: new NodeType<"audio">("audio") });

    if (props.duration < 0) throw new Error("Audio duration must be positive");
    if (props.fileSize < 0) throw new Error("Audio file size must be positive");
    // The union is compile-time only; a payload that crossed the router (or a
    // hand-edited record) can still carry any string, and "local" is the
    // read-compat default, so an unknown value is a bug worth failing on.
    if (props.source !== "local" && props.source !== "online") {
      throw new Error("Audio source must be 'local' or 'online'");
    }

    this._duration = props.duration;
    this._source = props.source;
    this._sourceUrl = props.sourceUrl;
    this._fileSize = props.fileSize;
    this._content = props.content;
  }

  get duration(): number {
    return this._duration;
  }

  /**
   * Where the bytes came from.
   *
   * Always one of the two values: `create` defaults it to `"local"` so a record
   * written before the music-site import (and a local upload) reads back as
   * `"local"` instead of `undefined`.
   */
  get source(): "local" | "online" {
    return this._source;
  }

  /** The page an online import came from; `undefined` on a local upload. */
  get sourceUrl(): string | undefined {
    return this._sourceUrl;
  }

  get fileSize(): number {
    return this._fileSize;
  }

  get content(): AudioContent {
    return this._content;
  }

  static create(props: {
    id: NodeId;
    title: string;
    abstract?: string;
    permission: Permission;
    semanticId: NodeSemanticId;
    tags?: NodeTagId[];
    isPinned?: boolean;
    stateData?: NodeStateData;
    icon?: NodeIcon | null;
    cover?: NodeCover | null;
    duration: number;
    source?: "local" | "online";
    sourceUrl?: string;
    fileSize: number;
    content: AudioContent;
    createdAt?: string;
    updatedAt?: string;
    workspaceId?: string;
  }): AudioNode {
    const now = new Date().toISOString();
    return new AudioNode({
      id: props.id,
      title: props.title,
      abstract: props.abstract,
      permission: props.permission,
      semanticId: props.semanticId,
      tags: props.tags ?? [],
      isPinned: props.isPinned ?? false,
      stateData: props.stateData,
      icon: props.icon,
      cover: props.cover,
      duration: props.duration,
      source: props.source ?? "local",
      sourceUrl: props.sourceUrl,
      fileSize: props.fileSize,
      content: props.content,
      createdAt: props.createdAt ?? now,
      updatedAt: props.updatedAt ?? now,
      workspaceId: props.workspaceId,
    });
  }

  updateContent(content: AudioContent): AudioNode {
    return new AudioNode({
      ...this.baseProps(),
      duration: this._duration,
      source: this._source,
      sourceUrl: this._sourceUrl,
      fileSize: this._fileSize,
      content,
      updatedAt: new Date().toISOString(),
    });
  }

  /** See `ImageNode.updateFileMeta`. */
  updateFileMeta(meta: {
    duration?: number;
    source?: "local" | "online";
    sourceUrl?: string;
    fileSize?: number;
  }): AudioNode {
    if (
      meta.duration === undefined &&
      meta.source === undefined &&
      meta.sourceUrl === undefined &&
      meta.fileSize === undefined
    ) {
      return this;
    }

    return new AudioNode({
      ...this.baseProps(),
      duration: meta.duration ?? this._duration,
      source: meta.source ?? this._source,
      sourceUrl: meta.sourceUrl ?? this._sourceUrl,
      fileSize: meta.fileSize ?? this._fileSize,
      content: this._content,
      updatedAt: new Date().toISOString(),
    });
  }

  protected cloneWith(props: Partial<NodeBaseProps>): AudioNode {
    return new AudioNode({
      ...this.baseProps(),
      ...props,
      duration: this._duration,
      source: this._source,
      sourceUrl: this._sourceUrl,
      fileSize: this._fileSize,
      content: this._content,
    });
  }
}

export class WebpageNode extends Node {
  protected readonly _fileSize: number;
  protected readonly _content: WebpageContent;

  private constructor(
    props: NodeBaseProps & { fileSize: number; content: WebpageContent },
  ) {
    super({ ...props, nodeType: new NodeType<"webpage">("webpage") });
    if (props.fileSize < 0)
      throw new Error("Webpage file size must be positive");
    this._fileSize = props.fileSize;
    this._content = props.content;
  }

  /** Byte length of the stored document; 0 while the node has no file. */
  get fileSize(): number {
    return this._fileSize;
  }

  get content(): WebpageContent {
    return this._content;
  }

  static create(props: {
    id: NodeId;
    title: string;
    abstract?: string;
    permission: Permission;
    semanticId: NodeSemanticId;
    tags?: NodeTagId[];
    isPinned?: boolean;
    stateData?: NodeStateData;
    icon?: NodeIcon | null;
    cover?: NodeCover | null;
    fileSize?: number;
    content: WebpageContent;
    createdAt?: string;
    updatedAt?: string;
    workspaceId?: string;
  }): WebpageNode {
    const now = new Date().toISOString();
    return new WebpageNode({
      id: props.id,
      title: props.title,
      abstract: props.abstract,
      permission: props.permission,
      semanticId: props.semanticId,
      tags: props.tags ?? [],
      isPinned: props.isPinned ?? false,
      stateData: props.stateData,
      icon: props.icon,
      cover: props.cover,
      fileSize: props.fileSize ?? 0,
      content: props.content,
      createdAt: props.createdAt ?? now,
      updatedAt: props.updatedAt ?? now,
      workspaceId: props.workspaceId,
    });
  }

  updateContent(content: WebpageContent): WebpageNode {
    return new WebpageNode({
      ...this.baseProps(),
      fileSize: this._fileSize,
      content,
      updatedAt: new Date().toISOString(),
    });
  }

  /** See `ImageNode.updateFileMeta`. */
  updateFileMeta(meta: { fileSize?: number }): WebpageNode {
    if (meta.fileSize === undefined) return this;
    return new WebpageNode({
      ...this.baseProps(),
      fileSize: meta.fileSize,
      content: this._content,
      updatedAt: new Date().toISOString(),
    });
  }

  protected cloneWith(props: Partial<NodeBaseProps>): WebpageNode {
    return new WebpageNode({
      ...this.baseProps(),
      ...props,
      fileSize: this._fileSize,
      content: this._content,
    });
  }
}

export class WebsiteNode extends Node {
  protected readonly _content: WebsiteContent;

  private constructor(props: NodeBaseProps & { content: WebsiteContent }) {
    super({ ...props, nodeType: new NodeType<"website">("website") });
    this._content = props.content;
  }

  get content(): WebsiteContent {
    return this._content;
  }

  static create(props: {
    id: NodeId;
    title: string;
    abstract?: string;
    permission: Permission;
    semanticId: NodeSemanticId;
    tags?: NodeTagId[];
    isPinned?: boolean;
    stateData?: NodeStateData;
    icon?: NodeIcon | null;
    cover?: NodeCover | null;
    content: WebsiteContent;
    createdAt?: string;
    updatedAt?: string;
    workspaceId?: string;
  }): WebsiteNode {
    const now = new Date().toISOString();
    return new WebsiteNode({
      id: props.id,
      title: props.title,
      abstract: props.abstract,
      permission: props.permission,
      semanticId: props.semanticId,
      tags: props.tags ?? [],
      isPinned: props.isPinned ?? false,
      stateData: props.stateData,
      icon: props.icon,
      cover: props.cover,
      content: props.content,
      createdAt: props.createdAt ?? now,
      updatedAt: props.updatedAt ?? now,
      workspaceId: props.workspaceId,
    });
  }

  updateContent(content: WebsiteContent): WebsiteNode {
    return new WebsiteNode({
      ...this.baseProps(),
      content,
      updatedAt: new Date().toISOString(),
    });
  }

  protected cloneWith(props: Partial<NodeBaseProps>): WebsiteNode {
    return new WebsiteNode({
      ...this.baseProps(),
      ...props,
      content: this._content,
    });
  }
}

export class CollectionNode extends Node {
  protected readonly _content: CollectionContent;

  private constructor(props: NodeBaseProps & { content: CollectionContent }) {
    super({ ...props, nodeType: new NodeType<"collection">("collection") });
    this._content = props.content;
  }

  get content(): CollectionContent {
    return this._content;
  }

  static create(props: {
    id: NodeId;
    title: string;
    abstract?: string;
    permission: Permission;
    semanticId: NodeSemanticId;
    tags?: NodeTagId[];
    isPinned?: boolean;
    stateData?: NodeStateData;
    icon?: NodeIcon | null;
    cover?: NodeCover | null;
    content: CollectionContent;
    createdAt?: string;
    updatedAt?: string;
    workspaceId?: string;
  }): CollectionNode {
    const now = new Date().toISOString();
    return new CollectionNode({
      id: props.id,
      title: props.title,
      abstract: props.abstract,
      permission: props.permission,
      semanticId: props.semanticId,
      tags: props.tags ?? [],
      isPinned: props.isPinned ?? false,
      stateData: props.stateData,
      icon: props.icon,
      cover: props.cover,
      content: props.content,
      createdAt: props.createdAt ?? now,
      updatedAt: props.updatedAt ?? now,
      workspaceId: props.workspaceId,
    });
  }

  applyFilter(filterConfig: FilterConfig): CollectionNode {
    return new CollectionNode({
      ...this.baseProps(),
      // `withFilter`, not a bare `new CollectionContent(...)`: the data views
      // hanging off this node are not part of the filter and must survive it.
      content: this._content.withFilter(FilterConfig.create(filterConfig)),
      updatedAt: new Date().toISOString(),
    });
  }

  /** Replace the node's data views, keeping the filter untouched. */
  applyViews(views: readonly DataView[]): CollectionNode {
    return new CollectionNode({
      ...this.baseProps(),
      content: this._content.withViews(views),
      updatedAt: new Date().toISOString(),
    });
  }

  clearFilter(): CollectionNode {
    return new CollectionNode({
      ...this.baseProps(),
      content: this._content.withFilter(FilterConfig.empty()),
      updatedAt: new Date().toISOString(),
    });
  }

  protected cloneWith(props: Partial<NodeBaseProps>): CollectionNode {
    return new CollectionNode({
      ...this.baseProps(),
      ...props,
      content: this._content,
    });
  }
}

export class RichTextNode extends Node {
  protected readonly _content: RichTextContent;

  private constructor(props: NodeBaseProps & { content: RichTextContent }) {
    super({ ...props, nodeType: new NodeType<"rich-text">("rich-text") });
    this._content = props.content;
  }

  get content(): RichTextContent {
    return this._content;
  }

  static create(props: {
    id: NodeId;
    title: string;
    abstract?: string;
    permission: Permission;
    semanticId: NodeSemanticId;
    tags?: NodeTagId[];
    isPinned?: boolean;
    stateData?: NodeStateData;
    icon?: NodeIcon | null;
    cover?: NodeCover | null;
    content: RichTextContent;
    createdAt?: string;
    updatedAt?: string;
    workspaceId?: string;
  }): RichTextNode {
    const now = new Date().toISOString();
    return new RichTextNode({
      id: props.id,
      title: props.title,
      abstract: props.abstract,
      permission: props.permission,
      semanticId: props.semanticId,
      tags: props.tags ?? [],
      isPinned: props.isPinned ?? false,
      stateData: props.stateData,
      icon: props.icon,
      cover: props.cover,
      content: props.content,
      createdAt: props.createdAt ?? now,
      updatedAt: props.updatedAt ?? now,
      workspaceId: props.workspaceId,
    });
  }

  addReference(nodeId: NodeId): RichTextNode {
    const currentRefs = this._content.referencedNodes;
    if (currentRefs.some((ref) => ref.equals(nodeId))) {
      return this;
    }
    const newRefs = [...currentRefs, nodeId];
    return new RichTextNode({
      ...this.baseProps(),
      content: new RichTextContent(newRefs, this._content.docs),
      updatedAt: new Date().toISOString(),
    });
  }

  removeReference(nodeId: NodeId): RichTextNode {
    const newRefs = this._content.referencedNodes.filter(
      (ref) => !ref.equals(nodeId),
    );
    if (newRefs.length === this._content.referencedNodes.length) {
      return this;
    }
    return new RichTextNode({
      ...this.baseProps(),
      content: new RichTextContent(newRefs, this._content.docs),
      updatedAt: new Date().toISOString(),
    });
  }

  updateContent(content: RichTextContent): RichTextNode {
    return new RichTextNode({
      ...this.baseProps(),
      content,
      updatedAt: new Date().toISOString(),
    });
  }

  protected cloneWith(props: Partial<NodeBaseProps>): RichTextNode {
    return new RichTextNode({
      ...this.baseProps(),
      ...props,
      content: this._content,
    });
  }
}

/**
 * Reorders `items` to the order given by `ids`, which must be a permutation of
 * the existing ids. A mismatch throws rather than silently dropping the
 * entries a caller forgot to list.
 */
function reorderById<T extends { id: string }>(
  items: T[],
  ids: string[],
  label: string,
): T[] {
  if (ids.length !== items.length) {
    throw new Error(
      `Invalid database ${label} order: expected ${items.length} ids, received ${ids.length}`,
    );
  }

  const byId = new Map(items.map((item) => [item.id, item]));
  const seen = new Set<string>();
  const reordered: T[] = [];

  for (const id of ids) {
    const item = byId.get(id);
    if (!item || seen.has(id)) {
      throw new Error(
        `Invalid database ${label} order: unknown or duplicate id "${id}"`,
      );
    }
    seen.add(id);
    reordered.push(item);
  }

  return reordered;
}

/**
 * Drops the cell a row holds for `fieldId`. A row without one is returned
 * unchanged, so callers can map it over every row cheaply.
 */
function withoutCell(row: DatabaseRow, fieldId: string): DatabaseRow {
  const cells = row.cells;
  if (cells[fieldId] === undefined) {
    return row;
  }
  delete cells[fieldId];
  return row.withCells(cells);
}

/**
 * Database node: a self-contained Notion-style table.
 *
 * Rows are not nodes — they never enter the graph and own no `NodeBase`. A
 * `relation` cell stores graph node ids as a soft reference; this aggregate
 * never creates an `Edge` for one (design doc §10).
 */
export class DatabaseNode extends Node {
  protected readonly _content: DatabaseContent;

  private constructor(props: NodeBaseProps & { content: DatabaseContent }) {
    super({ ...props, nodeType: new NodeType<"database">("database") });
    this._content = props.content;
  }

  get content(): DatabaseContent {
    return this._content;
  }

  static create(props: {
    id: NodeId;
    title: string;
    abstract?: string;
    permission: Permission;
    semanticId: NodeSemanticId;
    tags?: NodeTagId[];
    isPinned?: boolean;
    stateData?: NodeStateData;
    icon?: NodeIcon | null;
    cover?: NodeCover | null;
    content: DatabaseContent;
    createdAt?: string;
    updatedAt?: string;
    workspaceId?: string;
  }): DatabaseNode {
    const now = new Date().toISOString();
    return new DatabaseNode({
      id: props.id,
      title: props.title,
      abstract: props.abstract,
      permission: props.permission,
      semanticId: props.semanticId,
      tags: props.tags ?? [],
      isPinned: props.isPinned ?? false,
      stateData: props.stateData,
      icon: props.icon,
      cover: props.cover,
      content: props.content,
      createdAt: props.createdAt ?? now,
      updatedAt: props.updatedAt ?? now,
      workspaceId: props.workspaceId,
    });
  }

  updateContent(content: DatabaseContent): DatabaseNode {
    return new DatabaseNode({
      ...this.baseProps(),
      content,
      updatedAt: new Date().toISOString(),
    });
  }

  /**
   * Rebuild the table from new `fields` / `rows`.
   *
   * Every column/row mutation below goes through here rather than constructing
   * a `DatabaseContent` directly: the views (how the node browses its own
   * table) are node state that a schema edit must not drop, and a bare
   * constructor call defaults them to `[]`.
   */
  private rebuildContent(
    fields: DatabaseField[],
    rows: DatabaseRow[],
  ): DatabaseContent {
    return new DatabaseContent(fields, rows, this._content.views);
  }

  /** Append a field to the schema. A duplicate id is rejected by content. */
  addField(field: DatabaseField): DatabaseNode {
    return this.updateContent(
      this.rebuildContent([...this._content.fields, field], this._content.rows),
    );
  }

  renameField(fieldId: string, name: string): DatabaseNode {
    this.requireField(fieldId);
    const fields = this._content.fields.map((field) =>
      field.id === fieldId ? field.withName(name) : field,
    );
    return this.updateContent(this.rebuildContent(fields, this._content.rows));
  }

  /**
   * Replace a column's option list.
   *
   * Removing an option would leave cells pointing at an option the field no
   * longer declares, which `DatabaseContent` rejects — so exactly those values
   * are cleared (a `select` cell becomes `null`, a `multiSelect` cell keeps the
   * options that survived) instead of failing the whole update. This mirrors
   * `removeField`'s cascade.
   */
  setFieldOptions(
    fieldId: string,
    options: DatabaseFieldOption[],
  ): DatabaseNode {
    const field = this.requireField(fieldId);
    const fields = this._content.fields.map((candidate) =>
      candidate.id === fieldId ? candidate.withOptions(options) : candidate,
    );

    const allowed = new Set(options.map((option) => option.id));
    const rows =
      field.type === "select" || field.type === "multiSelect"
        ? this._content.rows.map((row) => {
            const cell = row.cell(fieldId);
            if (!cell) {
              return row;
            }
            const value = cell.value;
            if (value.type === "select") {
              if (value.optionId === null || allowed.has(value.optionId)) {
                return row;
              }
              return row.withCells({
                ...row.cells,
                [fieldId]: new DatabaseCell({
                  type: "select",
                  optionId: null,
                }),
              });
            }
            if (value.type === "multiSelect") {
              const kept = value.optionIds.filter((optionId: string) =>
                allowed.has(optionId),
              );
              if (kept.length === value.optionIds.length) {
                return row;
              }
              return row.withCells({
                ...row.cells,
                [fieldId]: new DatabaseCell({
                  type: "multiSelect",
                  optionIds: kept,
                }),
              });
            }
            return row;
          })
        : this._content.rows;

    return this.updateContent(this.rebuildContent(fields, rows));
  }

  /**
   * Change a column's type.
   *
   * Cells cannot survive a type change — their payload discriminator would no
   * longer match the field — so every value in that column is dropped. That is
   * the same cascade `removeField` performs, minus the field itself; it is
   * spelled out here because silently coercing values across types is not
   * something the aggregate can do safely. `options` must be supplied when
   * `type` is `select` / `multiSelect` and is ignored by the other types.
   */
  setFieldType(
    fieldId: string,
    type: DatabaseFieldType,
    options?: DatabaseFieldOption[],
  ): DatabaseNode {
    this.requireField(fieldId);

    const fields = this._content.fields.map((field) =>
      field.id === fieldId ? field.withType(type, options) : field,
    );
    const rows = this._content.rows.map((row) => withoutCell(row, fieldId));

    return this.updateContent(this.rebuildContent(fields, rows));
  }

  /**
   * Remove a field and cascade-delete its cells from every row, so no row is
   * left holding a cell for a field that no longer exists.
   */
  removeField(fieldId: string): DatabaseNode {
    this.requireField(fieldId);

    const fields = this._content.fields.filter((field) => field.id !== fieldId);
    const rows = this._content.rows.map((row) => withoutCell(row, fieldId));

    return this.updateContent(this.rebuildContent(fields, rows));
  }

  /** Append a row. A duplicate id is rejected by content. */
  addRow(row: DatabaseRow): DatabaseNode {
    return this.updateContent(
      this.rebuildContent(this._content.fields, [...this._content.rows, row]),
    );
  }

  /**
   * Set one cell. The field must exist and the cell's type must match it; a
   * select cell whose option id is not declared on the field is rejected by
   * `DatabaseContent`.
   */
  updateCell(rowId: string, fieldId: string, cell: DatabaseCell): DatabaseNode {
    const row = this.requireRow(rowId);
    const field = this.requireField(fieldId);

    if (cell.type !== field.type) {
      throw new Error(
        `Database cell "${fieldId}" is a ${cell.type} but the field is a ${field.type}`,
      );
    }

    const updatedRow = row.withCells({ ...row.cells, [fieldId]: cell });
    const rows = this._content.rows.map((candidate) =>
      candidate.id === rowId ? updatedRow : candidate,
    );
    return this.updateContent(this.rebuildContent(this._content.fields, rows));
  }

  removeRow(rowId: string): DatabaseNode {
    this.requireRow(rowId);
    const rows = this._content.rows.filter((row) => row.id !== rowId);
    return this.updateContent(this.rebuildContent(this._content.fields, rows));
  }

  /** Reorder the columns; `ids` must be a permutation of the field ids. */
  reorderFields(ids: string[]): DatabaseNode {
    const fields = reorderById(this._content.fields, ids, "field");
    return this.updateContent(this.rebuildContent(fields, this._content.rows));
  }

  /** Reorder the rows; `ids` must be a permutation of the row ids. */
  reorderRows(ids: string[]): DatabaseNode {
    const rows = reorderById(this._content.rows, ids, "row");
    return this.updateContent(this.rebuildContent(this._content.fields, rows));
  }

  private requireField(fieldId: string): DatabaseField {
    const field = this._content.field(fieldId);
    if (!field) {
      throw new Error(`Database field not found: ${fieldId}`);
    }
    return field;
  }

  private requireRow(rowId: string): DatabaseRow {
    const row = this._content.row(rowId);
    if (!row) {
      throw new Error(`Database row not found: ${rowId}`);
    }
    return row;
  }

  protected cloneWith(props: Partial<NodeBaseProps>): DatabaseNode {
    return new DatabaseNode({
      ...this.baseProps(),
      ...props,
      content: this._content,
    });
  }
}
