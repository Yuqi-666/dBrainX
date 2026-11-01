// SPDX-License-Identifier: AGPL-3.0-only

"use client";

/** Image-node persistence; ImageViewer owns navigation and the shared ink surface. */
import { useCallback } from "react";
import type {
  Annotation,
  ImageContent,
  ImageNodeData,
} from "@workspace/interfaces";
import { useUIStore } from "@workspace/store";
import { resolveFileUrl } from "@workspace/api-client";
import { ImageViewer } from "@workspace/ui/components/image-viewer/image-viewer";
import { cn } from "@workspace/ui/lib/utils";
import { FileDropZone } from "@workspace/ui/components/node-content/file-drop-zone";
import { useNodeContentWriter } from "@workspace/ui/components/node-content/use-node-content-writer";

interface ImageNodeContentProps {
  node: ImageNodeData;
  className?: string;
}

export function ImageNodeContent({ node, className }: ImageNodeContentProps) {
  const url = resolveFileUrl(node.content?.url);
  const hasUrl = !!url;

  const { apply } = useNodeContentWriter<ImageContent>(
    node.id,
    "image",
    node.content,
  );

  /**
   * Dialog mode has 80vh to work with, so the toolbar starts folded (design §2.4).
   * Read here rather than inside the layer: the layer is host-agnostic by
   * construction and must not learn what a `mainViewType` is.
   */
  const compact = useUIStore((state) => state.mainViewType !== "editor");

  /**
   * One gesture → one write. `image.setAnnotations` replaces the annotation
   * payload and nothing else, so the `url` an upload wrote is never touched by
   * an annotation edit (and vice versa).
   */
  const handleItemsChange = useCallback(
    (items: Annotation[]) => {
      void apply("image.setAnnotations", { annotations: { version: 1, items } });
    },
    [apply],
  );

  if (!hasUrl) {
    return (
      <FileDropZone
        nodeId={node.id}
        accept="image/*"
        variant="image"
        className={cn("w-full h-full", className)}
      />
    );
  }

  return (
    <div className={cn("h-full w-full overflow-hidden", className)}>
      <ImageViewer
        key={url}
        url={url}
        title={node.title}
        annotations={node.content?.annotations?.items}
        onAnnotationsChange={handleItemsChange}
        compact={compact}
      />
    </div>
  );
}
