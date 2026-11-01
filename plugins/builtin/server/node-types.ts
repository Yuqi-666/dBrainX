// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The builtin node types, in the order the product lists them.
 *
 * Every id here is an existing one; the migration only moves the declaration
 * out of `packages/interfaces`. The `operations` arrays are derived from
 * `type-operations.ts`, so a type lists exactly the `self` operations that are
 * registered: the design document's example catalog (§4.3.5) also sketches
 * `external` and `system` operations, and listing one that has no handler would
 * make the plugin refuse its own enablement (§4.3.9). The shared `node.add` /
 * metadata operations are registered once by the plugin host, so they are not
 * repeated per type.
 */

import { defineNodeType } from "@workspace/plugin-sdk";

import type { CollectionContent } from "../types/complex/collection.ts";
import {
  collectionSchema,
  createCollectionContent,
} from "../types/complex/collection.ts";
import type { DatabaseContent } from "../types/complex/database.ts";
import {
  createDatabaseContent,
  databaseSchema,
} from "../types/complex/database.ts";
import type { RichTextContent } from "../types/complex/rich-text.ts";
import {
  createRichTextContent,
  richTextSchema,
} from "../types/complex/rich-text.ts";
import type { AudioContent } from "../types/single/audio.ts";
import { audioSchema, createAudioContent } from "../types/single/audio.ts";
import type { ImageContent } from "../types/single/image.ts";
import { createImageContent, imageSchema } from "../types/single/image.ts";
import type { PdfContent } from "../types/single/pdf.ts";
import { createPdfContent, pdfSchema } from "../types/single/pdf.ts";
import type { TextContent } from "../types/single/text.ts";
import { createTextContent, textSchema } from "../types/single/text.ts";
import type { VideoContent } from "../types/single/video.ts";
import { createVideoContent, videoSchema } from "../types/single/video.ts";
import type { WebpageContent } from "../types/single/webpage.ts";
import {
  createWebpageContent,
  webpageSchema,
} from "../types/single/webpage.ts";
import type { WebsiteContent } from "../types/single/website.ts";
import {
  createWebsiteContent,
  websiteSchema,
} from "../types/single/website.ts";

import { builtinPluginId } from "./plugin-id.ts";
import { selfOperationIds } from "./type-operations.ts";

export { builtinPluginId };

export const nodeTypes = [
  defineNodeType<TextContent>({
    type: "text",
    version: 1,
    pluginId: builtinPluginId,
    schema: textSchema,
    defaultContent: createTextContent,
    display: { label: "Text", icon: "FileText" },
    operations: [...selfOperationIds.text],
  }),
  defineNodeType<RichTextContent>({
    type: "rich-text",
    version: 1,
    pluginId: builtinPluginId,
    schema: richTextSchema,
    defaultContent: createRichTextContent,
    display: { label: "Rich Text", icon: "FileEdit" },
    operations: [...selfOperationIds["rich-text"]],
  }),
  defineNodeType<ImageContent>({
    type: "image",
    version: 1,
    pluginId: builtinPluginId,
    schema: imageSchema,
    defaultContent: createImageContent,
    display: { label: "Image", icon: "Image" },
    operations: [...selfOperationIds.image],
  }),
  defineNodeType<PdfContent>({
    type: "pdf",
    version: 1,
    pluginId: builtinPluginId,
    schema: pdfSchema,
    defaultContent: createPdfContent,
    display: { label: "PDF", icon: "FileType" },
    operations: [...selfOperationIds.pdf],
  }),
  defineNodeType<VideoContent>({
    type: "video",
    version: 1,
    pluginId: builtinPluginId,
    schema: videoSchema,
    defaultContent: createVideoContent,
    display: { label: "Video", icon: "Video" },
    operations: [...selfOperationIds.video],
  }),
  defineNodeType<AudioContent>({
    type: "audio",
    version: 1,
    pluginId: builtinPluginId,
    schema: audioSchema,
    defaultContent: createAudioContent,
    display: { label: "Audio", icon: "Volume" },
    operations: [...selfOperationIds.audio],
  }),
  defineNodeType<WebpageContent>({
    type: "webpage",
    version: 1,
    pluginId: builtinPluginId,
    schema: webpageSchema,
    defaultContent: createWebpageContent,
    display: { label: "Webpage", icon: "Globe" },
    operations: [...selfOperationIds.webpage],
  }),
  defineNodeType<WebsiteContent>({
    type: "website",
    version: 1,
    pluginId: builtinPluginId,
    schema: websiteSchema,
    defaultContent: createWebsiteContent,
    display: { label: "Website", icon: "Globe" },
    operations: [...selfOperationIds.website],
  }),
  defineNodeType<CollectionContent>({
    type: "collection",
    version: 1,
    pluginId: builtinPluginId,
    schema: collectionSchema,
    defaultContent: createCollectionContent,
    display: { label: "Collection", icon: "Folder" },
    operations: [...selfOperationIds.collection],
  }),
  defineNodeType<DatabaseContent>({
    type: "database",
    version: 1,
    pluginId: builtinPluginId,
    schema: databaseSchema,
    defaultContent: createDatabaseContent,
    display: { label: "Database", icon: "Table" },
    operations: [...selfOperationIds.database],
  }),
];
