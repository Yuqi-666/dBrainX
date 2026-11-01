// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The builtin plugin's browser UI entry (§4.10.2).
 *
 * It exports one `NodeContentDescriptor` per builtin node type and nothing else:
 * the types' editors and previews live in `./node-content/` and `./previews/`,
 * and this module is the only place that pairs a type id with a component. The
 * client bootstrap imports it lazily (`apps/web/lib/plugin-ui.generated.ts`) and
 * calls `registerNodeContent` before the first paint; `packages/ui` then resolves
 * every type — builtin or third-party — through that table and never imports a
 * plugin package.
 *
 * `cover` is not part of `NodeContentDescriptor` yet. The card cover needs to
 * know which field holds a type's picture (`url`, `coverUrl`, `faviconUrl`) and
 * which document is its text, and that knowledge belongs to the type's plugin,
 * so the field travels here and is typed by `NodeCoverContribution` from
 * `packages/ui` until the SDK contract grows it.
 */
import { createElement, lazy } from "react";
import type { ComponentType, LazyExoticComponent } from "react";
import {
  FileEdit,
  FileText,
  FileType,
  Folder,
  Globe,
  Image as ImageIcon,
  Table,
  Video,
  Volume,
} from "lucide-react";
import type {
  NodeContentDescriptor,
  NodeContentViewProps,
} from "@workspace/plugin-sdk/ui";
import type {
  AudioNodeData,
  CollectionNodeData,
  DatabaseNodeData,
  ImageNodeData,
  PdfNodeData,
  RichTextNodeData,
  TextNodeData,
  VideoNodeData,
  WebpageNodeData,
  WebsiteNodeData,
} from "@workspace/interfaces";
import type { NodeCoverContribution } from "@workspace/ui/components/preview-block/node-preview-cover";
import { translate } from "@workspace/ui/lib/i18n/runtime";

import { docText } from "./node-content/doc-normalize";
import { builtinAttributeFields } from "./attribute-fields";

/** The manifest id this entry registers under (`plugins/builtin/plugin.json`). */
export const builtinPluginId = "dbrainx.builtin";

/** A builtin descriptor: the SDK shape plus its cover contribution. */
export interface BuiltinNodeContentDescriptor extends NodeContentDescriptor {
  cover?: NodeCoverContribution;
}

/**
 * Adapts a type-specific editor or preview to the descriptor's generic props.
 *
 * Each component declares its own node type (`TextNodeData`), while the registry
 * mounts it through `NodeContentViewProps`. A descriptor is only ever handed a
 * node of the type it registered, so the adapter narrows the prop back instead of
 * making every editor accept the whole `NodeData` union.
 */
function lazyOf<P extends NodeContentViewProps>(
  load: () => Promise<{ default: ComponentType<P> }>,
): LazyExoticComponent<ComponentType<NodeContentViewProps>> {
  return lazy(async () => {
    const { default: Content } = await load();
    function TypedContent(props: NodeContentViewProps) {
      return createElement(Content, props as P);
    }
    return { default: TypedContent };
  });
}

export const builtinNodeContentDescriptors: readonly BuiltinNodeContentDescriptor[] =
  [
    {
      type: "text",
      pluginId: builtinPluginId,
      label: translate("Text"),
      icon: FileText,
      editor: lazyOf<NodeContentViewProps<TextNodeData>>(() =>
        import("./node-content/text-node-content").then((module) => ({
          default: module.TextNodeContent,
        })),
      ),
      preview: lazyOf<NodeContentViewProps<TextNodeData>>(() =>
        import("./previews/text-preview").then((module) => ({
          default: module.TextPreview,
        })),
      ),
      cover: {
        text: (node) =>
          docText((node as { content?: { docs?: unknown } }).content?.docs),
      },
      uncontrolledEditors: true,
      clearable: true,
    },
    {
      type: "rich-text",
      pluginId: builtinPluginId,
      label: translate("Rich Text"),
      icon: FileEdit,
      editor: lazyOf<NodeContentViewProps<RichTextNodeData>>(() =>
        import("./node-content/rich-text-node-content").then((module) => ({
          default: module.RichTextNodeContent,
        })),
      ),
      preview: lazyOf<NodeContentViewProps<RichTextNodeData>>(() =>
        import("./previews/rich-text-preview").then((module) => ({
          default: module.RichTextPreview,
        })),
      ),
      cover: {
        text: (node) =>
          docText((node as { content?: { docs?: unknown } }).content?.docs),
      },
      uncontrolledEditors: true,
      clearable: true,
    },
    {
      type: "image",
      pluginId: builtinPluginId,
      label: translate("Image"),
      attributes: { fields: builtinAttributeFields.image },
      icon: ImageIcon,
      previewContentWidth: 400,
      editor: lazyOf<NodeContentViewProps<ImageNodeData>>(() =>
        import("./node-content/image-node-content").then((module) => ({
          default: module.ImageNodeContent,
        })),
      ),
      preview: lazyOf<NodeContentViewProps<ImageNodeData>>(() =>
        import("./previews/image-preview").then((module) => ({
          default: module.ImagePreview,
        })),
      ),
      cover: {
        url: (node) =>
          (node as { content?: { url?: string } }).content?.url || null,
      },
      clearable: true,
    },
    {
      type: "pdf",
      pluginId: builtinPluginId,
      label: "PDF",
      attributes: { fields: builtinAttributeFields.pdf },
      icon: FileType,
      previewContentWidth: 400,
      editor: lazyOf<NodeContentViewProps<PdfNodeData>>(() =>
        import("./node-content/pdf-node-content").then((module) => ({
          default: module.PdfNodeContent,
        })),
      ),
      preview: lazyOf<NodeContentViewProps<PdfNodeData>>(() =>
        import("./previews/pdf-preview").then((module) => ({
          default: module.PdfPreview,
        })),
      ),
      cover: {
        url: (node) =>
          (node as { content?: { coverUrl?: string } }).content?.coverUrl ||
          null,
      },
      clearable: true,
    },
    {
      type: "video",
      pluginId: builtinPluginId,
      label: translate("Video"),
      attributes: { fields: builtinAttributeFields.video },
      icon: Video,
      previewContentWidth: 400,
      editor: lazyOf<NodeContentViewProps<VideoNodeData>>(() =>
        import("./node-content/video-node-content").then((module) => ({
          default: module.VideoNodeContent,
        })),
      ),
      preview: lazyOf<NodeContentViewProps<VideoNodeData>>(() =>
        import("./previews/video-preview").then((module) => ({
          default: module.VideoPreview,
        })),
      ),
      cover: {
        url: (node) =>
          (node as { content?: { coverUrl?: string } }).content?.coverUrl ||
          null,
      },
      clearable: true,
    },
    {
      type: "audio",
      pluginId: builtinPluginId,
      label: translate("Audio"),
      attributes: { fields: builtinAttributeFields.audio },
      icon: Volume,
      editor: lazyOf<NodeContentViewProps<AudioNodeData>>(() =>
        import("./node-content/audio-node-content").then((module) => ({
          default: module.AudioNodeContent,
        })),
      ),
      preview: lazyOf<NodeContentViewProps<AudioNodeData>>(() =>
        import("./previews/audio-preview").then((module) => ({
          default: module.AudioPreview,
        })),
      ),
      cover: {
        // Only an imported audio node has a cover; a local upload falls through
        // to the type glyph, exactly as it did before the import existed.
        url: (node) =>
          (node as { content?: { coverUrl?: string } }).content?.coverUrl ||
          null,
      },
      clearable: true,
    },
    {
      type: "webpage",
      pluginId: builtinPluginId,
      label: translate("Webpage"),
      attributes: { fields: builtinAttributeFields.webpage },
      icon: Globe,
      previewContentWidth: 400,
      editor: lazyOf<NodeContentViewProps<WebpageNodeData>>(() =>
        import("./node-content/webpage-node-content").then((module) => ({
          default: module.WebpageNodeContent,
        })),
      ),
      preview: lazyOf<NodeContentViewProps<WebpageNodeData>>(() =>
        import("./previews/webpage-preview").then((module) => ({
          default: module.WebpagePreview,
        })),
      ),
      clearable: true,
    },
    {
      type: "website",
      pluginId: builtinPluginId,
      label: translate("Website"),
      attributes: { fields: builtinAttributeFields.website },
      icon: Globe,
      editor: lazyOf<NodeContentViewProps<WebsiteNodeData>>(() =>
        import("./node-content/website-node-content").then((module) => ({
          default: module.WebsiteNodeContent,
        })),
      ),
      preview: lazyOf<NodeContentViewProps<WebsiteNodeData>>(() =>
        import("./previews/website-preview").then((module) => ({
          default: module.WebsitePreview,
        })),
      ),
      cover: {
        url: (node) =>
          (node as { content?: { faviconUrl?: string } }).content?.faviconUrl ||
          null,
      },
      clearable: true,
    },
    {
      type: "collection",
      pluginId: builtinPluginId,
      label: translate("Collection"),
      attributes: { fields: builtinAttributeFields.collection },
      icon: Folder,
      editor: lazyOf<NodeContentViewProps<CollectionNodeData>>(() =>
        import("./node-content/collection-node-content").then((module) => ({
          default: module.CollectionNodeContent,
        })),
      ),
      preview: lazyOf<NodeContentViewProps<CollectionNodeData>>(() =>
        import("./previews/collection-preview").then((module) => ({
          default: module.CollectionPreview,
        })),
      ),
    },
    {
      type: "database",
      pluginId: builtinPluginId,
      label: translate("Database"),
      icon: Table,
      editor: lazyOf<NodeContentViewProps<DatabaseNodeData>>(() =>
        import("./node-content/database-node-content").then((module) => ({
          default: module.DatabaseNodeContent,
        })),
      ),
      preview: lazyOf<NodeContentViewProps<DatabaseNodeData>>(() =>
        import("./previews/database-preview").then((module) => ({
          default: module.DatabasePreview,
        })),
      ),
    },
  ];
