// SPDX-License-Identifier: AGPL-3.0-only

import { useI18n } from "@workspace/ui/lib/i18n";
import type { NodeViewProps } from "@tiptap/react";
import { NodeViewWrapper } from "@tiptap/react";
import { useState, useEffect } from "react";
import { replaceAttachment, uploadAttachment } from "@workspace/api-client";
import type { IAttachment } from "@workspace/interfaces";
import type {
  ExcalidrawImperativeAPI,
  ExcalidrawInitialDataState,
} from "@excalidraw/excalidraw/types";
import clsx from "clsx";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@workspace/ui/components/ui/dialog";
import { Button } from "@workspace/ui/components/ui/button";
import { getFileUrl, loadExcalidrawData } from "./excalidraw-utils";
import { ExcalidrawWrapper } from "./excalidraw-wrapper";

/**
 * Nodes saved before the preview existed point `src` at the scene JSON
 * (`diagram.excalidraw.json`). An `<img>` can never render that, so such a node
 * is treated as "no preview": the placeholder shows and the scene is recovered
 * from the JSON on open instead of a broken image.
 */
function isLegacyJsonSource(src: string | null | undefined): boolean {
  return typeof src === "string" && src.toLowerCase().endsWith(".json");
}

/**
 * Stores the preview PNG as the block's one storage unit.
 *
 * The preview carries the scene in its PNG metadata, so the image and the raw
 * scene share one `files` record. A block saved by this version keeps that
 * record's id in `attachmentId`, and a save replaces the record in place: the
 * id, the resource-library card and the quota charge all stay the same instead
 * of accumulating one blob per save.
 *
 * The fallback covers a record deleted from the resource library, a quota or
 * file-ceiling refusal, and an older server that does not accept a file
 * replacement — the block still saves by creating a fresh record. A legacy
 * `.excalidraw.json` block also has an `attachmentId` (the JSON blob's record),
 * so its save replaces that record with the PNG and the old JSON unit is gone
 * without an explicit delete.
 */
async function savePreviewAttachment(
  attachmentId: string | undefined,
  file: File,
): Promise<IAttachment> {
  if (attachmentId) {
    try {
      return await replaceAttachment(attachmentId, file);
    } catch (error) {
      // Not fatal on its own: the fallback below keeps the block saveable. The
      // error explains why the record was replaced by a new one.
      console.error("Failed to replace Excalidraw preview:", error);
    }
  }
  return uploadAttachment(file);
}

export default function ExcalidrawView(props: NodeViewProps) {
  const { t } = useI18n();

  const { node, updateAttributes, editor, selected } = props;
  const { src, title, width, data, attachmentId } = node.attrs;

  const [excalidrawAPI, setExcalidrawAPI] =
    useState<ExcalidrawImperativeAPI | null>(null);
  const [excalidrawData, setExcalidrawData] =
    useState<ExcalidrawInitialDataState | null>(null);
  const [opened, setOpened] = useState(false);
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  const handleOpen = async () => {
    if (!editor.isEditable) {
      return;
    }

    try {
      if (data) {
        const jsonData = JSON.parse(data);
        const elements = jsonData.elements || [];
        const files = jsonData.files || {};

        setExcalidrawData({ elements, files });
      } else if (src) {
        // No inline scene: recover it from the stored attachment. A node
        // written before the raster preview kept its scene JSON in a
        // `.excalidraw.json` file; a preview PNG saved by this version embeds
        // the same scene in its PNG metadata. `loadExcalidrawData` reads both,
        // and an image without embedded scene data simply opens an empty
        // canvas, so the block stays usable.
        setExcalidrawData(await loadExcalidrawData(src));
      }
    } catch (err) {
      console.error(err);
    } finally {
      setOpened(true);
    }
  };

  const handleClose = () => {
    setOpened(false);
  };

  const handleSave = async () => {
    if (!excalidrawAPI) {
      return;
    }

    // The scene JSON also stays inline in `data`: it is the editable source of
    // truth, so the block survives even when storing the preview below fails.
    // It is deliberately not the storage path anymore — the preview PNG embeds
    // the same scene, and the two must stay one `files` record.
    const jsonString = JSON.stringify({
      elements: excalidrawAPI.getSceneElements(),
      files: excalidrawAPI.getFiles(),
    });

    try {
      // The node view renders an <img>, so `src` must point at a raster image.
      // Export one with the scene embedded in the PNG metadata, so this single
      // blob is both the preview and the raw scene; saving then replaces that
      // one record instead of uploading a second one.
      const { exportToBlob } = await import("@excalidraw/excalidraw");
      const blob = await exportToBlob({
        elements: excalidrawAPI.getSceneElements(),
        appState: {
          ...excalidrawAPI.getAppState(),
          exportEmbedScene: true,
        },
        files: excalidrawAPI.getFiles(),
        mimeType: "image/png",
      });
      const previewFile = new File([blob], "diagram.png", {
        type: "image/png",
      });
      const attachment = await savePreviewAttachment(attachmentId, previewFile);

      updateAttributes({
        data: jsonString,
        src: attachment.url,
        title: attachment.fileName,
        size: attachment.fileSize,
        attachmentId: attachment.id,
      });
    } catch (error) {
      console.error("Failed to save Excalidraw diagram:", error);
      // Keep the scene editable and leave any existing preview untouched.
      updateAttributes({ data: jsonString });
    }

    setOpened(false);
  };

  // A legacy JSON `src` is not an image: fall back to the placeholder, while
  // `handleOpen` still recovers the scene from it.
  const previewSrc = src && !isLegacyJsonSource(src) ? getFileUrl(src) : "";
  // The stored `width` is the layout string "100%"; only a real pixel number
  // belongs in the img width attribute (a bad value draws a thin strip).
  const numericWidth = Number(width);
  const imgWidth =
    Number.isFinite(numericWidth) && numericWidth > 0
      ? numericWidth
      : undefined;

  return (
    <NodeViewWrapper>
      <Dialog open={opened} onOpenChange={setOpened}>
        <DialogContent
          showCloseButton={false}
          className={clsx(
            // The same shell as the node editor dialog: one window size for
            // every "open a node" surface, so a diagram does not open a second,
            // differently proportioned dialog.
            "p-0 gap-0 sm:max-w-[80%] w-[1200px] h-[80vh] flex flex-col",
            "rounded-2xl bg-popover",
            "ring-1 ring-foreground/5 shadow-2xl shadow-foreground/5",
          )}
        >
          {/* Radix requires a title on every dialog; the window shows the
              canvas itself, so it stays visually hidden. */}
          <DialogTitle className="sr-only">
            {t("Excalidraw diagram")}
          </DialogTitle>
          <DialogDescription className="sr-only">
            {t("Double-click to edit Excalidraw diagram")}
          </DialogDescription>
          <div className="flex items-center justify-end gap-2 p-2 shrink-0">
            <Button onClick={handleSave} size="sm">
              {t("Save & Exit")}{" "}
            </Button>
            <Button onClick={handleClose} variant="destructive" size="sm">
              {t("Exit")}{" "}
            </Button>
          </div>
          <div className="flex-1 min-h-0 p-1 pt-0">
            {isMounted && (
              <ExcalidrawWrapper
                excalidrawAPI={(api) => setExcalidrawAPI(api)}
                initialData={{
                  elements: excalidrawData?.elements || [],
                  files: excalidrawData?.files || {},
                  scrollToContent: true,
                }}
              />
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/*
        One gesture and one frame for both states: double-click opens the editor
        on the image and on the placeholder alike (the pencil button is gone),
        and both draw the same frame — a hairline that grows into a primary ring
        on hover, and a primary ring while the block is selected. The frame is
        applied here instead of through ProseMirror's
        `ProseMirror-selectednode` because `paragraph-node.scss` paints that
        class with a selection background, which read as a second, ugly border
        stacked on the ring.
      */}
      {previewSrc ? (
        <div
          onDoubleClick={handleOpen}
          className={clsx(
            "relative w-fit max-w-full cursor-pointer rounded-lg ring-1 ring-transparent",
            "transition-[box-shadow] duration-150 hover:ring-2 hover:ring-primary/40",
            selected && "ring-2 ring-primary/60",
          )}
        >
          <img
            src={previewSrc}
            alt={title}
            width={imgWidth}
            className="alignCenter block max-w-full h-auto rounded-md"
          />
        </div>
      ) : (
        <div
          onDoubleClick={handleOpen}
          className={clsx(
            "flex cursor-pointer items-center justify-center rounded-lg bg-muted/25 px-4 py-6",
            "ring-1 ring-border/70 transition-[box-shadow,background-color] duration-150",
            "hover:bg-muted/45 hover:ring-2 hover:ring-primary/40",
            selected && "ring-2 ring-primary/60",
          )}
        >
          <span className="text-muted-foreground">
            {t("Double-click to edit Excalidraw diagram")}{" "}
          </span>
        </div>
      )}
    </NodeViewWrapper>
  );
}
