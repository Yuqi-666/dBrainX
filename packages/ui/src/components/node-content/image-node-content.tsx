// SPDX-License-Identifier: AGPL-3.0-only

"use client";

/** Image-node persistence; ImageViewer owns navigation and the shared ink surface. */
import { useCallback, useEffect } from "react";
import type {
  Annotation,
  ImageContent,
  ImageNodeData,
} from "@workspace/interfaces";
import { NodeService } from "@workspace/services";
import { useUIStore } from "@workspace/store";
import { resolveFileUrl } from "@workspace/api-client";
import { ImageViewer } from "@workspace/ui/components/image-viewer/image-viewer";
import { cn } from "@workspace/ui/lib/utils";
import { FileDropZone } from "./file-drop-zone";
import { useNodeContentWriter } from "./use-node-content-writer";

interface ImageNodeContentProps {
  node: ImageNodeData;
  className?: string;
}

export function ImageNodeContent({ node, className }: ImageNodeContentProps) {
  const url = resolveFileUrl(node.content?.url);
  const hasUrl = !!url;

  const { patchContent } = useNodeContentWriter<ImageContent>(
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
   * One gesture → one write. `patchContent` merges this half onto the **live**
   * node, so the `url` written by an upload can never be rolled back by an
   * annotation (and vice versa, which is what M2's half-merge bought us).
   */
  const handleItemsChange = useCallback(
    (items: Annotation[]) => {
      patchContent({ annotations: { version: 1, items } });
    },
    [patchContent],
  );

  /**
   * The two "leave now" moments (plan §M5.1 item 8). With the shared writer a
   * finished gesture is already a queued write, so this is about the *last*
   * microtask: a flush here cannot lose a stroke that the user drew a millisecond
   * before closing the dialog.
   */
  useEffect(() => {
    const flush = () => {
      void NodeService.flushPendingUpdate(node.id);
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flush();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      flush();
    };
  }, [node.id]);

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
