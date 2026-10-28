// SPDX-License-Identifier: AGPL-3.0-only

"use client";
import { useI18n } from "@workspace/ui/lib/i18n";

/**
 * A `pdf` node: the self-drawn viewer, with the browser's own PDF plugin left in
 * place as the degradation path.
 *
 * The `<iframe>` is not dead code — it is what the node showed before this
 * viewer existed, and it is the only thing that still works when pdfjs cannot
 * run at all: an encrypted file, a corrupt one, a worker that failed to start,
 * or a cross-origin fetch the API refused. In all of those cases the iframe can
 * still *show* the document (it cannot annotate or search, which is exactly the
 * trade this viewer exists to buy), so the failure is reported here and the
 * viewer is replaced rather than left on a blank page.
 *
 * ## Ink
 *
 * This file is also the **host** of the pdf's annotation layer, and the split of
 * duties is the image host's (`image-node-content.tsx`): the viewer paints and
 * reports one finished gesture, the layer owns the tool and the history, and the
 * **persistence** happens here through the M1 shared writer — one gesture is one
 * serialized write of the whole `annotations` object, merged onto the live node.
 *
 * The one thing that is pdf-specific is *where* the ink goes: each item carries a
 * 0-based `page`, and the viewer portals one canvas per page box, so a mark stays
 * on the page it was drawn on while the strip scrolls and zooms underneath it.
 * That is the viewer's business; this file only ever moves the array.
 */
import { useCallback, useEffect, useState } from "react";
import { cn } from "@workspace/ui/lib/utils";
import { FileDropZone } from "./file-drop-zone";
import type {
  Annotation,
  PdfContent,
  PdfNodeData,
} from "@workspace/interfaces";
import { NodeService } from "@workspace/services";
import { useAuthStore, useUIStore } from "@workspace/store";
import { resolveFileUrl } from "@workspace/api-client";
import { PdfViewer } from "@workspace/ui/components/pdf-viewer/pdf-viewer";
import type { PdfLoadFailure } from "@workspace/ui/components/pdf-viewer/types";
import { useNodeContentWriter } from "./use-node-content-writer";

interface PdfNodeContentProps {
  node: PdfNodeData;
  className?: string;
}

export function PdfNodeContent({ node, className }: PdfNodeContentProps) {
  const { t } = useI18n();

  const url = resolveFileUrl(node.content?.url);
  const hasUrl = !!url;
  /**
   * The backend renders page 1 at upload. It is not the reading surface, but it
   * is the viewer's first screen while pdf.js opens the file: resolving page 1
   * can take hundreds of range reads on a scan with a flat page tree, and this
   * image is already small and cacheable. Empty when analysis was skipped or the
   * cover failed, which the viewer treats as "no cover".
   */
  const coverUrl = resolveFileUrl(node.content?.coverUrl);
  const [failure, setFailure] = useState<PdfLoadFailure | null>(null);

  const { patchContent } = useNodeContentWriter<PdfContent>(
    node.id,
    "pdf",
    node.content,
  );

  /**
   * Dialog mode has 80vh to work with, so the ink toolbar starts folded (design
   * §2.4). Read here rather than inside the viewer: the viewer is
   * host-agnostic by construction and must not learn what a `mainViewType` is.
   */
  const compact = useUIStore((state) => state.mainViewType !== "editor");

  /**
   * The reading position is per reader as well as per node: one account on a
   * shared browser must not resume on the page another account left off. The
   * viewer owns the page and only needs the key; this host knows the user and
   * the node.
   */
  const userId = useAuthStore((state) => state.user?.id ?? null);
  const progressKey = `${userId ?? "anonymous"}:${node.id}`;

  /** A new file is a new attempt — the previous fallback must not stick to it. */
  useEffect(() => {
    setFailure(null);
  }, [url]);

  const handleError = useCallback((next: PdfLoadFailure) => {
    setFailure(next);
  }, []);

  const handleAnnotationsChange = useCallback(
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
        accept=".pdf,application/pdf"
        variant="pdf"
        className={cn("w-full h-full min-h-[400px]", className)}
      />
    );
  }

  return (
    <div className={cn("flex p-4 w-full h-full", className)}>
      <div className="flex-1 min-w-0 rounded-lg overflow-hidden bg-muted/30">
        {failure ? (
          <iframe
            key={url}
            src={url}
            className="w-full h-full"
            title={node.title || t("PDF文档")}
          />
        ) : (
          <PdfViewer
            key={url}
            url={url}
            title={node.title}
            coverUrl={coverUrl || undefined}
            progressKey={progressKey}
            annotations={node.content?.annotations?.items}
            onAnnotationsChange={handleAnnotationsChange}
            compact={compact}
            onError={handleError}
            className="h-full"
          />
        )}
      </div>
    </div>
  );
}
