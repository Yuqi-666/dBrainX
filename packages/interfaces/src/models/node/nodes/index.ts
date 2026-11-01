// SPDX-License-Identifier: AGPL-3.0-only

export type { TextNodeData } from "./single/text";
export type { ImageNodeData, ImageContent } from "./single/image";
export type { PdfNodeData, PdfContent } from "./single/pdf";
export type { VideoNodeData, VideoContent, VideoSource } from "./single/video";
export type { AudioNodeData, AudioContent } from "./single/audio";
export type {
  TimestampData,
  TimestampKind,
  TimestampNoteData,
  TimestampSubtitleData,
} from "./single/timestamp-data";
export type { WebpageNodeData, WebpageContent } from "./single/webpage";
export type { WebsiteNodeData } from "./single/website";

export type {
  AnnotationLayerData,
  Annotation,
  AnnotationPoint,
  Stroke,
  Highlight,
  TextAnno,
  ArrowAnno,
  ShapeAnno,
} from "./annotation";

export type {
  CollectionNodeData,
  CollectionContent,
} from "./complex/collection";

export type { RichTextNodeData, RichTextContent } from "./complex/rich-text";

export type {
  DatabaseNodeData,
  DatabaseContent,
  DatabaseField,
  DatabaseFieldType,
  DatabaseFieldOption,
  DatabaseCell,
  DatabaseRow,
} from "./complex/database";

// Runtime value: canonical database field-type list (see `complex/database.ts`).
export { DATABASE_FIELD_TYPES } from "./complex/database";
