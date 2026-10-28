// SPDX-License-Identifier: AGPL-3.0-only

"use client";

/**
 * The node preview's **body** — the type-specific half of `PreviewBlock`.
 *
 * Frozen shape (`docs/plan/node-content-ui.md` §0-2; **W1-C owns the body** —
 * R1 moves the existing `PreviewHeader` + `previews/*` ten-way dispatch here so
 * the stale-check for M8 has one stable landmark to grep for:
 * `grep -rn "NodePreviewBody" packages/ui/src`).
 *
 * It deliberately carries **no positioning, no hover chrome and no
 * `data-preview-block` shell** — those stay in `preview-block.tsx`.
 */
import type { ReactNode } from "react";
import type { NodeData } from "@workspace/interfaces";
import { cn } from "@workspace/ui/lib/utils";
import { PreviewHeader } from "./preview-header";
import { TextPreview } from "./previews/text-preview";
import { ImagePreview } from "./previews/image-preview";
import { VideoPreview } from "./previews/video-preview";
import { PdfPreview } from "./previews/pdf-preview";
import { AudioPreview } from "./previews/audio-preview";
import { WebpagePreview } from "./previews/webpage-preview";
import { WebsitePreview } from "./previews/website-preview";
import { CollectionPreview } from "./previews/collection-preview";
import { RichTextPreview } from "./previews/rich-text-preview";
import { DatabasePreview } from "./previews/database-preview";

export interface PreviewBodyProps {
  node: NodeData;
  className?: string;
}

/** The ten-way type dispatch; unmoved from `preview-block.tsx` (R1 is a move). */
function renderNodePreview(node: NodeData): ReactNode {
  switch (node.nodeType) {
    case "text":
      return <TextPreview node={node} />;
    case "image":
      return <ImagePreview node={node} />;
    case "video":
      return <VideoPreview node={node} />;
    case "pdf":
      return <PdfPreview node={node} />;
    case "audio":
      return <AudioPreview node={node} />;
    case "webpage":
      return <WebpagePreview node={node} />;
    case "website":
      return <WebsitePreview node={node} />;
    case "collection":
      return <CollectionPreview node={node} />;
    case "rich-text":
      return <RichTextPreview node={node} />;
    case "database":
      return <DatabasePreview node={node} />;
    default:
      return <TextPreview node={node} />;
  }
}

export function NodePreviewBody({
  node,
  className,
}: PreviewBodyProps): ReactNode {
  return (
    <>
      <PreviewHeader node={node} />
      <div className={cn("px-4 pb-4 pt-2", className)}>
        {renderNodePreview(node)}
      </div>
    </>
  );
}
