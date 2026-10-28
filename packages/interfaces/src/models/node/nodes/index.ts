// SPDX-License-Identifier: AGPL-3.0-only

import type { TextNodeData } from "./single/text";
import type { ImageNodeData } from "./single/image";
import type { PdfNodeData } from "./single/pdf";
import type { VideoNodeData } from "./single/video";
import type { AudioNodeData } from "./single/audio";
import type { WebpageNodeData } from "./single/webpage";
import type { WebsiteNodeData } from "./single/website";
import type { CollectionNodeData } from "./complex/collection";
import type { RichTextNodeData } from "./complex/rich-text";
import type { DatabaseNodeData } from "./complex/database";

export type NodeData = SingleNodeData | ComplexNodeData;

export type SingleNodeData =
  | TextNodeData
  | ImageNodeData
  | PdfNodeData
  | VideoNodeData
  | AudioNodeData
  | WebpageNodeData
  | WebsiteNodeData;

export type ComplexNodeData =
  | CollectionNodeData
  | RichTextNodeData
  | DatabaseNodeData;

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
