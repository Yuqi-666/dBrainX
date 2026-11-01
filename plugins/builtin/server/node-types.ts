// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The builtin node types, in the order the product lists them.
 *
 * Every id here is an existing one; the migration only moves the declaration
 * out of `packages/interfaces`. The `operations` arrays follow the example
 * catalog in the architecture document (§4.3.5); that catalog is an example,
 * not a literal checklist, and the shared `node.add` / metadata operations are
 * registered once by the plugin host, so they are not repeated per type.
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

export const builtinPluginId = "dbrainx.builtin";

export const nodeTypes = [
  defineNodeType<TextContent>({
    type: "text",
    version: 1,
    pluginId: builtinPluginId,
    schema: textSchema,
    defaultContent: createTextContent,
    display: { label: "Text", icon: "FileText" },
    operations: [
      "text.setDocument",
      "text.append",
      "text.replaceRange",
      "text.quoteInto",
    ],
  }),
  defineNodeType<RichTextContent>({
    type: "rich-text",
    version: 1,
    pluginId: builtinPluginId,
    schema: richTextSchema,
    defaultContent: createRichTextContent,
    display: { label: "Rich Text", icon: "FileEdit" },
    operations: [
      "rich-text.setDocument",
      "rich-text.insertBlock",
      "rich-text.updateBlock",
      "rich-text.removeBlock",
      "rich-text.extractBlockToNode",
    ],
  }),
  defineNodeType<ImageContent>({
    type: "image",
    version: 1,
    pluginId: builtinPluginId,
    schema: imageSchema,
    defaultContent: createImageContent,
    display: { label: "Image", icon: "Image" },
    operations: [
      "image.addAnnotation",
      "image.removeAnnotation",
      "image.setMetadata",
      "image.linkAnnotationToNode",
      "image.analyze",
      "image.renderCover",
    ],
  }),
  defineNodeType<PdfContent>({
    type: "pdf",
    version: 1,
    pluginId: builtinPluginId,
    schema: pdfSchema,
    defaultContent: createPdfContent,
    display: { label: "PDF", icon: "FileType" },
    operations: [
      "pdf.addAnnotation",
      "pdf.removeAnnotation",
      "pdf.moveAnnotation",
      "pdf.createQuoteNode",
      "pdf.analyze",
    ],
  }),
  defineNodeType<VideoContent>({
    type: "video",
    version: 1,
    pluginId: builtinPluginId,
    schema: videoSchema,
    defaultContent: createVideoContent,
    display: { label: "Video", icon: "Video" },
    operations: [
      "video.timeline.add",
      "video.timeline.update",
      "video.timeline.remove",
      "video.setCover",
      "video.createNoteNode",
      "video.transcode",
    ],
  }),
  defineNodeType<AudioContent>({
    type: "audio",
    version: 1,
    pluginId: builtinPluginId,
    schema: audioSchema,
    defaultContent: createAudioContent,
    display: { label: "Audio", icon: "Volume" },
    operations: [
      "audio.timeline.add",
      "audio.timeline.update",
      "audio.timeline.remove",
      "audio.createTranscriptNode",
      "audio.transcode",
    ],
  }),
  defineNodeType<WebpageContent>({
    type: "webpage",
    version: 1,
    pluginId: builtinPluginId,
    schema: webpageSchema,
    defaultContent: createWebpageContent,
    display: { label: "Webpage", icon: "Globe" },
    operations: [
      "webpage.replaceDocument",
      "webpage.createSummaryNode",
      "webpage.fetchSnapshot",
    ],
  }),
  defineNodeType<WebsiteContent>({
    type: "website",
    version: 1,
    pluginId: builtinPluginId,
    schema: websiteSchema,
    defaultContent: createWebsiteContent,
    display: { label: "Website", icon: "Globe" },
    operations: [
      "website.setFavicon",
      "website.createBookmarkNode",
      "website.fetchMetadata",
    ],
  }),
  defineNodeType<CollectionContent>({
    type: "collection",
    version: 1,
    pluginId: builtinPluginId,
    schema: collectionSchema,
    defaultContent: createCollectionContent,
    display: { label: "Collection", icon: "Folder" },
    operations: [
      "collection.setFilter",
      "collection.setView",
      "collection.removeView",
      "collection.exportToDatabase",
    ],
  }),
  defineNodeType<DatabaseContent>({
    type: "database",
    version: 1,
    pluginId: builtinPluginId,
    schema: databaseSchema,
    defaultContent: createDatabaseContent,
    display: { label: "Database", icon: "Table" },
    operations: [
      "database.addField",
      "database.removeField",
      "database.addRow",
      "database.updateCell",
      "database.deleteRow",
      "database.setView",
      "database.createNodeFromRow",
      "database.syncRowsFromNodes",
    ],
  }),
];
