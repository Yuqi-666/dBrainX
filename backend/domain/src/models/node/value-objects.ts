// SPDX-License-Identifier: AGPL-3.0-only

import type { NodeId as NodeIdType } from "@workspace/interfaces/models/node/base";
import type { NodeDataType } from "@workspace/interfaces/models/node/types";
import type { WebpageContent as WebpageContentData } from "@workspace/interfaces/models/node/nodes/single/webpage";
// NOTE: the bare `@workspace/interfaces` entry point is deliberate. Only `.`,
// `./api`, `./common`, `./models` and `./nodes` are published in that package's
// `exports` map, so a VALUE import from a deep subpath (e.g.
// `@workspace/interfaces/models/node/nodes/complex/database`) resolves for `tsc`
// — whose tsconfig `paths` widen it — but throws `ERR_PACKAGE_PATH_NOT_EXPORTED`
// at runtime under tsx/node. Type-only deep imports are fine (they are erased).
import {
  DATA_VIEW_TYPES,
  DATABASE_FIELD_TYPES,
  normalizeDataViewType,
  type AnnotationLayerData,
  type DataView,
  type DataViewType,
  type DatabaseCell as DatabaseCellData,
  type DatabaseContent as DatabaseContentData,
  type DatabaseFieldType,
  type TimestampData,
} from "@workspace/interfaces";
import { FilterConfig } from "../filter/value-objects";

/**
 * Value Object representing a Node ID.
 * Immutable wrapper for node identifier with validation.
 */
export class NodeId {
  private readonly _value: NodeIdType;

  constructor(value: NodeIdType) {
    if (!value || value.trim().length === 0) {
      throw new Error("NodeId cannot be empty");
    }
    this._value = value;
  }

  get value(): NodeIdType {
    return this._value;
  }

  equals(other: NodeId): boolean {
    return this._value === other._value;
  }

  toString(): string {
    return this._value;
  }
}

/**
 * Value Object representing node permission level.
 * Encapsulates permission logic and validation.
 */
export class Permission {
  private readonly _value: "private" | "public" | "restricted";

  constructor(value: "private" | "public" | "restricted") {
    if (value !== "private" && value !== "public" && value !== "restricted") {
      throw new Error(`Invalid permission: ${value}`);
    }
    this._value = value;
  }

  static private(): Permission {
    return new Permission("private");
  }

  static public(): Permission {
    return new Permission("public");
  }

  static restricted(): Permission {
    return new Permission("restricted");
  }

  get value(): "private" | "public" | "restricted" {
    return this._value;
  }

  isPrivate(): boolean {
    return this._value === "private";
  }

  isPublic(): boolean {
    return this._value === "public";
  }

  isRestricted(): boolean {
    return this._value === "restricted";
  }

  equals(other: Permission): boolean {
    return this._value === other._value;
  }

  toString(): string {
    return this._value;
  }
}

/**
 * Value Object representing the type discriminator for nodes.
 * Provides type-safe node type discrimination.
 */
export class NodeType<T extends NodeDataType = NodeDataType> {
  private readonly _value: T;

  constructor(value: T) {
    const validTypes = [
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
    const isValid = validTypes.some((t) => t === value);
    if (!isValid) {
      throw new Error(`Invalid node type: ${value}`);
    }
    this._value = value;
  }

  get value(): T {
    return this._value;
  }

  equals(other: NodeType<T>): boolean {
    return this._value === other._value;
  }

  toString(): string {
    return this._value;
  }
}

/**
 * Content Value Objects for all node types.
 * All content value objects are immutable.
 */

/**
 * Text node content.
 */
export class TextContent {
  private readonly _docs: Record<string, any>;

  constructor(docs: Record<string, any>) {
    this._docs = Object.freeze({ ...docs });
  }

  get docs(): Record<string, any> {
    return { ...this._docs };
  }

  equals(other: TextContent): boolean {
    return JSON.stringify(this._docs) === JSON.stringify(other._docs);
  }
}

/**
 * Image node content.
 */
export class ImageContent {
  private readonly _url: string;
  private readonly _annotations: AnnotationLayerData | undefined;

  constructor(url: string, annotations?: AnnotationLayerData) {
    this._url = url;
    this._annotations = annotations;
  }

  get url(): string {
    return this._url;
  }

  /**
   * The pen/highlight layer drawn on the image, or `undefined` when there is
   * none.
   *
   * Absent — never an empty layer — is the "no annotations" shape: a record
   * predating the column simply has no key. The whole layer is replaced in one
   * write (`annotation.md` §3.1 / README §4.1), so `withAnnotations` is this
   * content's half-side entry point.
   */
  get annotations(): AnnotationLayerData | undefined {
    return this._annotations;
  }

  /** Same image with a different annotation layer; `url` is carried over. */
  withAnnotations(annotations: AnnotationLayerData | undefined): ImageContent {
    return new ImageContent(this._url, annotations);
  }

  equals(other: ImageContent): boolean {
    return (
      this._url === other._url &&
      JSON.stringify(this._annotations) === JSON.stringify(other._annotations)
    );
  }
}

/**
 * PDF node content.
 */
export class PdfContent {
  private readonly _url: string;
  private readonly _coverUrl: string;
  private readonly _annotations: AnnotationLayerData | undefined;

  constructor(
    url: string,
    coverUrl: string,
    annotations?: AnnotationLayerData,
  ) {
    this._url = url;
    this._coverUrl = coverUrl;
    this._annotations = annotations;
  }

  get url(): string {
    return this._url;
  }

  get coverUrl(): string {
    return this._coverUrl;
  }

  /** See `ImageContent.annotations`. */
  get annotations(): AnnotationLayerData | undefined {
    return this._annotations;
  }

  /** Same pdf with a different annotation layer; `url`/`coverUrl` are carried over. */
  withAnnotations(annotations: AnnotationLayerData | undefined): PdfContent {
    return new PdfContent(this._url, this._coverUrl, annotations);
  }

  equals(other: PdfContent): boolean {
    return (
      this._url === other._url &&
      this._coverUrl === other._coverUrl &&
      JSON.stringify(this._annotations) === JSON.stringify(other._annotations)
    );
  }
}

/**
 * Video node content.
 *
 * `hlsUrl` is the HLS playlist the backend packaged the upload into. It is
 * optional because a video that has not been transcoded yet (or whose
 * transcode was refused) is still a valid node: the player then falls back to
 * `url`, which is all an existing record has.
 */
export class VideoContent {
  private readonly _url: string;
  private readonly _coverUrl: string;
  private readonly _hlsUrl: string;
  private readonly _timestamps: TimestampData[] | undefined;

  constructor(
    url: string,
    coverUrl: string,
    hlsUrl = "",
    timestamps?: TimestampData[],
  ) {
    this._url = url;
    this._coverUrl = coverUrl;
    this._hlsUrl = hlsUrl;
    this._timestamps = timestamps;
  }

  get url(): string {
    return this._url;
  }

  get coverUrl(): string {
    return this._coverUrl;
  }

  get hlsUrl(): string {
    return this._hlsUrl;
  }

  /**
   * The played timeline's items — notes and subtitle cues in **one** list, or
   * `undefined` when the node has none.
   *
   * Absent — not an empty array — is the "no timestamps" shape of an old
   * record. The list is one half of the content (`README.md` §4.1), so
   * `withTimestamps` replaces it whole while `url` / `coverUrl` / `hlsUrl` stay
   * put. It was two halves (`timestampNotes` + `subtitles`) until the two were
   * unified into one `timestamps` item shape; the discriminator is each item's
   * own `type`, so this layer stores bytes and passes them through
   * (normalising a malformed value is the frontend's `normalizeTimestamps`).
   */
  get timestamps(): TimestampData[] | undefined {
    return this._timestamps;
  }

  /** Same video with a different timestamp list; the media fields are carried over. */
  withTimestamps(timestamps: TimestampData[] | undefined): VideoContent {
    return new VideoContent(
      this._url,
      this._coverUrl,
      this._hlsUrl,
      timestamps,
    );
  }

  equals(other: VideoContent): boolean {
    return (
      this._url === other._url &&
      this._coverUrl === other._coverUrl &&
      this._hlsUrl === other._hlsUrl &&
      JSON.stringify(this._timestamps) === JSON.stringify(other._timestamps)
    );
  }
}

/**
 * Audio node content.
 *
 * `coverUrl` is the cover the music-site import saved as a derived file
 * resource. It is optional — unlike `VideoContent.coverUrl`, which every video
 * upload produces — because a local audio upload has no such artwork and every
 * record written before the import existed has none. `undefined` therefore
 * means "no cover", the same meaning the interface gives the optional field.
 */
export class AudioContent {
  private readonly _url: string;
  private readonly _coverUrl: string | undefined;
  private readonly _timestamps: TimestampData[] | undefined;

  constructor(url: string, coverUrl?: string, timestamps?: TimestampData[]) {
    this._url = url;
    this._coverUrl = coverUrl;
    this._timestamps = timestamps;
  }

  get url(): string {
    return this._url;
  }

  get coverUrl(): string | undefined {
    return this._coverUrl;
  }

  /** See `VideoContent.timestamps`. */
  get timestamps(): TimestampData[] | undefined {
    return this._timestamps;
  }

  /** Same audio with a different timestamp list; the media fields are carried over. */
  withTimestamps(timestamps: TimestampData[] | undefined): AudioContent {
    return new AudioContent(this._url, this._coverUrl, timestamps);
  }

  equals(other: AudioContent): boolean {
    return (
      this._url === other._url &&
      this._coverUrl === other._coverUrl &&
      JSON.stringify(this._timestamps) === JSON.stringify(other._timestamps)
    );
  }
}

/**
 * Webpage node content: the address of the stored web page.
 *
 * The document's bytes live in the object store (the `files` collection), not
 * in a JSON column — a `pdf` node works the same way. The address is the only
 * representation the node keeps, so there is no source text here to outgrow a
 * column limit or to disagree with the stored file. A live address belongs to a
 * `website` node, and a screenshot is just an uploaded `image`.
 */
export class WebpageContent {
  private readonly _url: string;

  constructor(data: WebpageContentData) {
    this._url = data.url;
  }

  get url(): string {
    return this._url;
  }

  equals(other: WebpageContent): boolean {
    return this._url === other._url;
  }
}

/**
 * Website node content.
 */
export class WebsiteContent {
  private readonly _url: string;
  private readonly _faviconUrl?: string;

  constructor(url: string, faviconUrl?: string) {
    this._url = url;
    this._faviconUrl = faviconUrl;
  }

  get url(): string {
    return this._url;
  }

  get faviconUrl(): string | undefined {
    return this._faviconUrl;
  }

  equals(other: WebsiteContent): boolean {
    return this._url === other._url && this._faviconUrl === other._faviconUrl;
  }
}

/**
 * The shapes a data view may declare.
 *
 * Both the runtime list and the type come from `@workspace/interfaces` — this
 * module only re-exports them, exactly like `DATABASE_FIELD_TYPES` below. Do not
 * re-declare the list here: a second copy is what used to drift.
 */
export { DATA_VIEW_TYPES, normalizeDataViewType };
export type { DataViewType };

/**
 * Validates and copies the `views` payload a complex node carries.
 *
 * A data view is *how this node browses its own rows*. The per-view `config` is
 * owned by the frontend registry, so the domain checks only what it must to
 * guarantee a usable aggregate — an array of objects carrying a unique,
 * non-empty `id`, a `name`, a known `type` and an object `config`. The config's
 * internals are deliberately opaque here (`TableColumnConfig`, `ChartMeasure`,
 * … are a registry concern, not an aggregate invariant).
 *
 * The type is resolved through `normalizeDataViewType`, not compared against the
 * list directly: an alias (`nodeGraph` → `graph`) is accepted **and rewritten**,
 * so this boundary is what upgrades an old payload instead of rejecting it.
 */
function normalizeViews(value: readonly DataView[] | undefined): DataView[] {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error("Node views must be an array");
  }

  const seen = new Set<string>();
  return value.map((entry) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      throw new Error("Every node view must be an object");
    }
    const view = entry as Partial<DataView>;
    if (typeof view.id !== "string" || view.id.length === 0) {
      throw new Error("Every node view must have a non-empty id");
    }
    if (seen.has(view.id)) {
      throw new Error(`Duplicate data view id: ${view.id}`);
    }
    seen.add(view.id);
    if (typeof view.name !== "string" || view.name.length === 0) {
      throw new Error(`Data view "${view.id}" must have a non-empty name`);
    }
    const type = normalizeDataViewType(String(view.type));
    if (!type) {
      throw new Error(`Unknown data view type: ${String(view.type)}`);
    }
    if (typeof view.config !== "object" || view.config === null) {
      throw new Error(`Data view "${view.id}" must have a config object`);
    }
    // The pairing between `type` and the *shape* of `config` is a registry
    // concern (the config is opaque here), so rewriting the type asserts the
    // union instead of proving it — the same reason the old code cast at all.
    return { ...(view as DataView), type } as DataView;
  });
}

/**
 * Structural equality of two view lists.
 *
 * Views are compared by their JSON payload (`id` / `name` / `type` / `config`):
 * they are plain persisted configuration, not value objects with their own
 * `equals`, so a deep compare is the only honest test. List order is part of
 * the content — the toolbar renders in it.
 */
function sameViews(a: readonly DataView[], b: readonly DataView[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  return a.every(
    (view, index) => JSON.stringify(view) === JSON.stringify(b[index]),
  );
}

/**
 * Collection node content.
 */
export class CollectionContent {
  private readonly _filterConfig: FilterConfig | undefined;
  private readonly _views: readonly DataView[];

  constructor(
    filterConfig: FilterConfig | undefined,
    views: readonly DataView[] = [],
  ) {
    this._filterConfig = filterConfig;
    this._views = Object.freeze(normalizeViews(views));
  }

  get filterConfig(): FilterConfig | undefined {
    return this._filterConfig;
  }

  /**
   * The data views configured on this node, in display order.
   *
   * Views are node-level state that rides along with the filter: replacing the
   * filter must not drop them, so every rebuild goes through `withFilter` /
   * `withViews` rather than constructing a fresh content.
   */
  get views(): DataView[] {
    return [...this._views];
  }

  /** Same content with a different filter; the views are carried over. */
  withFilter(filterConfig: FilterConfig | undefined): CollectionContent {
    return new CollectionContent(filterConfig, this._views);
  }

  /** Same content with a different view list; the filter is carried over. */
  withViews(views: readonly DataView[]): CollectionContent {
    return new CollectionContent(this._filterConfig, views);
  }

  equals(other: CollectionContent): boolean {
    if (!sameViews(this._views, other._views)) {
      return false;
    }
    if (!this._filterConfig && !other._filterConfig) {
      return true;
    }
    if (!this._filterConfig || !other._filterConfig) {
      return false;
    }
    return this._filterConfig.equals(other._filterConfig);
  }
}

/**
 * Rich text node content.
 */
export class RichTextContent {
  private readonly _referencedNodes: NodeId[];
  private readonly _docs: Record<string, any>;

  constructor(referencedNodes: NodeId[], docs: Record<string, any>) {
    this._referencedNodes = [...referencedNodes];
    this._docs = Object.freeze({ ...docs });
  }

  get referencedNodes(): NodeId[] {
    return [...this._referencedNodes];
  }

  get docs(): Record<string, any> {
    return { ...this._docs };
  }

  equals(other: RichTextContent): boolean {
    if (this._referencedNodes.length !== other._referencedNodes.length) {
      return false;
    }
    for (let i = 0; i < this._referencedNodes.length; i++) {
      const thisNode = this._referencedNodes[i];
      const otherNode = other._referencedNodes[i];
      if (!thisNode || !otherNode || !thisNode.equals(otherNode)) {
        return false;
      }
    }
    return JSON.stringify(this._docs) === JSON.stringify(other._docs);
  }
}

/**
 * Database (Notion-style structured table) content value objects.
 *
 * A database node owns an ordered field list (its schema) and an ordered row
 * list (its records). Cells are keyed by `DatabaseField.id` and their payload
 * is a discriminated union whose `type` must match the owning field's type.
 *
 * `DatabaseContent` is the single validation boundary for stored table data: it
 * cannot be constructed from data that violates any structural rule (duplicate
 * field / row / option ids, a cell for a removed field, a cell whose type
 * disagrees with its field, an out-of-range select option, a malformed date or
 * url, a non-finite number).
 *
 * Every payload kept here is plain JSON — never a domain value object — so the
 * table can be written straight into the `nodes.content` column without
 * `JSON.stringify` turning a wrapper into `{ "_value": ... }` (the failure mode
 * `filter-config.mapper.ts` documents for `selectedNodes`).
 */

/**
 * Field types a database column may declare.
 *
 * Both the runtime list and the type come from `@workspace/interfaces` — this
 * module only re-exports them so the domain keeps a single import surface. Do
 * not re-declare the list here: a second copy is exactly what used to drift.
 */
export { DATABASE_FIELD_TYPES };
export type { DatabaseFieldType };

/** A cell payload, discriminated by the field type it belongs to. */
export type DatabaseCellValue = DatabaseCellData;

function isDatabaseFieldType(value: unknown): value is DatabaseFieldType {
  return DATABASE_FIELD_TYPES.includes(value as DatabaseFieldType);
}

function isSelectFieldType(type: DatabaseFieldType): boolean {
  return type === "select" || type === "multiSelect";
}

/**
 * ISO 8601 calendar date, optionally carrying a time component.
 *
 * A date cell is date-only in the editor (`2024-03-12`), so the full
 * `toISOString()` form (`2024-03-12T00:00:00.000Z`) must not be the only
 * accepted shape — but neither may a locale string such as `03/12/2024`.
 */
const ISO_8601_DATE =
  /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;

function assertIsoDate(value: string): void {
  if (!ISO_8601_DATE.test(value) || Number.isNaN(Date.parse(value))) {
    throw new Error(`Database date cell must be an ISO 8601 string: ${value}`);
  }
}

function assertUrl(value: string): void {
  try {
    new URL(value);
  } catch {
    throw new Error(`Database url cell must be a valid URL: ${value}`);
  }
}

function assertStringArray(value: unknown, label: string): void {
  if (
    !Array.isArray(value) ||
    value.some((entry) => typeof entry !== "string")
  ) {
    throw new Error(`Database ${label} must be an array of strings`);
  }
}

/** Payload-shape checks that a cell can make on its own, without its field. */
function assertCellPayload(value: DatabaseCellValue): void {
  switch (value.type) {
    case "text":
      if (typeof value.text !== "string") {
        throw new Error("Database text cell must carry a string");
      }
      return;
    case "number":
      // `Number.isFinite` (not `typeof`) is deliberate: `Infinity` and `-Infinity`
      // pass a typeof check but `JSON.stringify` turns them into `null`, so the
      // value would silently change on the way to the database.
      if (value.number !== null && !Number.isFinite(value.number)) {
        throw new Error("Database number cell must be a finite number or null");
      }
      return;
    case "select":
      if (value.optionId !== null && typeof value.optionId !== "string") {
        throw new Error("Database select cell must carry an option id or null");
      }
      return;
    case "multiSelect":
      assertStringArray(value.optionIds, "multiSelect cell optionIds");
      return;
    case "date":
      if (value.date !== null) {
        if (typeof value.date !== "string") {
          throw new Error("Database date cell must carry a string or null");
        }
        assertIsoDate(value.date);
      }
      return;
    case "checkbox":
      if (typeof value.checked !== "boolean") {
        throw new Error("Database checkbox cell must carry a boolean");
      }
      return;
    case "url":
      if (value.url !== null) {
        if (typeof value.url !== "string") {
          throw new Error("Database url cell must carry a string or null");
        }
        assertUrl(value.url);
      }
      return;
    case "relation":
      assertStringArray(value.nodeIds, "relation cell nodeIds");
      return;
  }
}

/** Defensive copy so a caller's array can never alias the stored payload. */
function cloneCellValue(value: DatabaseCellValue): DatabaseCellValue {
  switch (value.type) {
    case "multiSelect":
      return { ...value, optionIds: [...value.optionIds] };
    case "relation":
      return { ...value, nodeIds: [...value.nodeIds] };
    default:
      return { ...value };
  }
}

/**
 * One option of a `select` / `multiSelect` field.
 */
export class DatabaseFieldOption {
  private readonly _id: string;
  private readonly _name: string;
  private readonly _color: string | undefined;

  constructor(id: string, name: string, color?: string) {
    if (!id || id.trim().length === 0) {
      throw new Error("DatabaseFieldOption id cannot be empty");
    }
    if (!name || name.trim().length === 0) {
      throw new Error("DatabaseFieldOption name cannot be empty");
    }
    this._id = id;
    this._name = name;
    this._color = color;
  }

  get id(): string {
    return this._id;
  }

  get name(): string {
    return this._name;
  }

  get color(): string | undefined {
    return this._color;
  }

  equals(other: DatabaseFieldOption): boolean {
    return (
      this._id === other._id &&
      this._name === other._name &&
      this._color === other._color
    );
  }
}

/**
 * A column of the table: stable id, display name, type and (for the select
 * types) its option list.
 *
 * `options` is only meaningful — and only required — for `select` /
 * `multiSelect`. It is carried through untouched for every other type so a
 * round-trip through the `content` column never drops data.
 */
export class DatabaseField {
  private readonly _id: string;
  private readonly _name: string;
  private readonly _type: DatabaseFieldType;
  private readonly _options: readonly DatabaseFieldOption[] | undefined;

  constructor(
    id: string,
    name: string,
    type: DatabaseFieldType,
    options?: DatabaseFieldOption[],
    readonly includeTime: boolean = false,
  ) {
    if (!id || id.trim().length === 0) {
      throw new Error("DatabaseField id cannot be empty");
    }
    if (!name || name.trim().length === 0) {
      throw new Error("DatabaseField name cannot be empty");
    }
    if (!isDatabaseFieldType(type)) {
      throw new Error(`Invalid database field type: ${type}`);
    }
    if (isSelectFieldType(type) && (!options || options.length === 0)) {
      throw new Error(
        `DatabaseField "${id}" of type ${type} must declare at least one option`,
      );
    }
    if (options) {
      // Duplicate option ids would make `hasOption` ambiguous and, once the
      // editor exists, collide as React keys. The rule applies to every type
      // that carries options, not just the select ones.
      const optionIds = new Set<string>();
      for (const option of options) {
        if (optionIds.has(option.id)) {
          throw new Error(
            `DatabaseField "${id}" declares duplicate option id "${option.id}"`,
          );
        }
        optionIds.add(option.id);
      }
    }
    this._id = id;
    this._name = name;
    this._type = type;
    this._options = options ? Object.freeze([...options]) : undefined;
  }

  get id(): string {
    return this._id;
  }

  get name(): string {
    return this._name;
  }

  get type(): DatabaseFieldType {
    return this._type;
  }

  get options(): DatabaseFieldOption[] | undefined {
    return this._options ? [...this._options] : undefined;
  }

  /** Whether `optionId` is one of this field's declared options. */
  hasOption(optionId: string): boolean {
    return (this._options ?? []).some((option) => option.id === optionId);
  }

  withName(name: string): DatabaseField {
    return new DatabaseField(
      this._id,
      name,
      this._type,
      this._options ? [...this._options] : undefined,
      this.includeTime,
    );
  }

  withOptions(options: DatabaseFieldOption[]): DatabaseField {
    return new DatabaseField(
      this._id,
      this._name,
      this._type,
      options,
      this.includeTime,
    );
  }

  /**
   * Same column with a different type. `options` is passed through as given: a
   * select type needs a fresh non-empty list (the old one may not fit the new
   * type), and `undefined` drops whatever the column used to carry.
   */
  withType(
    type: DatabaseFieldType,
    options?: DatabaseFieldOption[],
  ): DatabaseField {
    return new DatabaseField(this._id, this._name, type, options);
  }

  equals(other: DatabaseField): boolean {
    if (
      this._id !== other._id ||
      this._name !== other._name ||
      this._type !== other._type ||
      this.includeTime !== other.includeTime
    ) {
      return false;
    }
    const mine = this._options ?? [];
    const theirs = other._options ?? [];
    if (mine.length !== theirs.length) {
      return false;
    }
    return mine.every((option, index) => {
      const otherOption = theirs[index];
      return otherOption !== undefined && option.equals(otherOption);
    });
  }
}

/**
 * One cell value. The payload stays a discriminated union so callers keep
 * exhaustive narrowing; the wrapper only freezes it and guards the shape.
 *
 * `relation` cells hold raw `NodeId` strings — a soft reference to other graph
 * nodes. Target existence is deliberately not checked here (v1 never creates
 * an `Edge` from a row).
 */
export class DatabaseCell {
  private readonly _value: DatabaseCellValue;

  constructor(value: DatabaseCellValue) {
    const type = (value as { type?: unknown } | null | undefined)?.type;
    if (typeof type !== "string" || !isDatabaseFieldType(type)) {
      throw new Error(`Invalid database cell type: ${String(type)}`);
    }
    assertCellPayload(value);
    this._value = Object.freeze(cloneCellValue(value));
  }

  get type(): DatabaseFieldType {
    return this._value.type;
  }

  /** Plain, JSON-serializable payload — safe to write into `nodes.content`. */
  get value(): DatabaseCellValue {
    return cloneCellValue(this._value);
  }

  equals(other: DatabaseCell): boolean {
    return JSON.stringify(this._value) === JSON.stringify(other._value);
  }
}

/**
 * One record of the table. `cells` is keyed by `DatabaseField.id`; a key with no
 * matching field is rejected by `DatabaseContent`.
 */
export class DatabaseRow {
  private readonly _id: string;
  private readonly _cells: Readonly<Record<string, DatabaseCell>>;

  constructor(id: string, cells: Record<string, DatabaseCell>) {
    if (!id || id.trim().length === 0) {
      throw new Error("DatabaseRow id cannot be empty");
    }
    this._id = id;
    this._cells = Object.freeze({ ...cells });
  }

  get id(): string {
    return this._id;
  }

  get cells(): Record<string, DatabaseCell> {
    return { ...this._cells };
  }

  /** The cell stored under `fieldId`, if this row has one. */
  cell(fieldId: string): DatabaseCell | undefined {
    return this._cells[fieldId];
  }

  withCells(cells: Record<string, DatabaseCell>): DatabaseRow {
    return new DatabaseRow(this._id, cells);
  }

  equals(other: DatabaseRow): boolean {
    const fieldIds = Object.keys(this._cells);
    if (fieldIds.length !== Object.keys(other._cells).length) {
      return false;
    }
    return fieldIds.every((fieldId) => {
      const mine = this._cells[fieldId];
      const theirs = other._cells[fieldId];
      return mine !== undefined && theirs !== undefined && mine.equals(theirs);
    });
  }
}

/**
 * A relation cell escapes the field-level option check: it stores graph node
 * ids, and whether those nodes still exist is a rendering concern.
 */
function assertCellMatchesField(
  row: DatabaseRow,
  cell: DatabaseCell,
  field: DatabaseField,
): void {
  if (cell.type !== field.type) {
    throw new Error(
      `Database cell "${field.id}" of row "${row.id}" is a ${cell.type} but the field is a ${field.type}`,
    );
  }

  const value = cell.value;
  if (value.type === "select") {
    if (value.optionId !== null && !field.hasOption(value.optionId)) {
      throw new Error(
        `Database select cell "${field.id}" of row "${row.id}" references unknown option "${value.optionId}"`,
      );
    }
    return;
  }
  if (value.type === "multiSelect") {
    for (const optionId of value.optionIds) {
      if (!field.hasOption(optionId)) {
        throw new Error(
          `Database multiSelect cell "${field.id}" of row "${row.id}" references unknown option "${optionId}"`,
        );
      }
    }
  }
}

/**
 * The whole table: ordered fields plus ordered rows, validated on construction.
 */
export class DatabaseContent {
  private readonly _fields: readonly DatabaseField[];
  private readonly _rows: readonly DatabaseRow[];
  private readonly _views: readonly DataView[];

  constructor(
    fields: DatabaseField[],
    rows: DatabaseRow[],
    views: readonly DataView[] = [],
  ) {
    this._fields = Object.freeze([...fields]);
    this._rows = Object.freeze([...rows]);
    this._views = Object.freeze(normalizeViews(views));
    this.validate();
  }

  /**
   * Builds content from the plain JSON shape (the `DatabaseContent` interface
   * in `@workspace/interfaces`), which is how it arrives from tRPC and from the
   * `nodes.fields` / `nodes.rows` columns. Throws when the data cannot form a
   * valid table.
   */
  static fromData(
    data: Partial<DatabaseContentData> | null | undefined,
  ): DatabaseContent {
    const raw = data ?? {};
    const fields = (raw.fields ?? []).map(
      (field) =>
        new DatabaseField(
          field.id,
          field.name,
          field.type,
          field.options?.map(
            (option) =>
              new DatabaseFieldOption(option.id, option.name, option.color),
          ),
          field.includeTime,
        ),
    );
    const rows = (raw.rows ?? []).map(
      (row) =>
        new DatabaseRow(
          row.id,
          Object.fromEntries(
            Object.entries(row.cells ?? {}).map(([fieldId, cell]) => [
              fieldId,
              new DatabaseCell(cell),
            ]),
          ),
        ),
    );
    return new DatabaseContent(fields, rows, raw.views ?? []);
  }

  get fields(): DatabaseField[] {
    return [...this._fields];
  }

  get rows(): DatabaseRow[] {
    return [...this._rows];
  }

  /**
   * The data views configured on this node, in display order.
   *
   * Views describe how the table above is browsed, so they live on the same
   * content — but a column/row edit must not drop them. Every rebuild inside
   * `DatabaseNode` therefore goes through a helper that carries them over.
   */
  get views(): DataView[] {
    return [...this._views];
  }

  /** Same table with a different view list. */
  withViews(views: readonly DataView[]): DatabaseContent {
    return new DatabaseContent([...this._fields], [...this._rows], views);
  }

  /** The field stored under `fieldId`, if the schema has one. */
  field(fieldId: string): DatabaseField | undefined {
    return this._fields.find((field) => field.id === fieldId);
  }

  /** The row stored under `rowId`, if the table has one. */
  row(rowId: string): DatabaseRow | undefined {
    return this._rows.find((row) => row.id === rowId);
  }

  equals(other: DatabaseContent): boolean {
    if (!sameViews(this._views, other._views)) {
      return false;
    }
    if (
      this._fields.length !== other._fields.length ||
      this._rows.length !== other._rows.length
    ) {
      return false;
    }
    const fieldsMatch = this._fields.every((field, index) => {
      const otherField = other._fields[index];
      return otherField !== undefined && field.equals(otherField);
    });
    if (!fieldsMatch) {
      return false;
    }
    return this._rows.every((row, index) => {
      const otherRow = other._rows[index];
      return otherRow !== undefined && row.equals(otherRow);
    });
  }

  /**
   * Structural validation (design doc §9):
   * unique field ids, unique row ids, every cell key pointing at a live field,
   * every cell type agreeing with its field, every select option id resolving
   * against that field's options. Field names, option lists, cell payload
   * shapes, dates and urls are checked by the value objects themselves.
   */
  private validate(): void {
    const fieldsById = new Map<string, DatabaseField>();
    for (const field of this._fields) {
      if (fieldsById.has(field.id)) {
        throw new Error(`Duplicate database field id: ${field.id}`);
      }
      fieldsById.set(field.id, field);
    }

    const rowIds = new Set<string>();
    for (const row of this._rows) {
      if (rowIds.has(row.id)) {
        throw new Error(`Duplicate database row id: ${row.id}`);
      }
      rowIds.add(row.id);

      for (const [fieldId, cell] of Object.entries(row.cells)) {
        const field = fieldsById.get(fieldId);
        if (!field) {
          throw new Error(
            `Database row "${row.id}" has a cell for unknown field "${fieldId}"`,
          );
        }
        assertCellMatchesField(row, cell, field);
      }
    }
  }
}
