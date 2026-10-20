// SPDX-License-Identifier: AGPL-3.0-only

import { useI18n } from "@workspace/ui/lib/i18n";
import type { Editor } from "@tiptap/react";

// --- Hooks ---
import { useTiptapEditor } from "@workspace/editor/hooks/use-tiptap-editor";

// --- Lib ---
import { isNodeTypeSelected } from "@workspace/editor/lib/tiptap-utils";

// --- Tiptap UI ---
import { DeleteNodeButton } from "@workspace/editor/components/tiptap-ui/delete-node-button";
import { ImageDownloadButton } from "@workspace/editor/components/tiptap-ui/image-download-button";
import { ImageAlignButton } from "@workspace/editor/components/tiptap-ui/image-align-button";

// --- UI Primitive ---
import { Separator } from "@workspace/editor/components/tiptap-ui-primitive/separator";
import { ImageCaptionButton } from "@workspace/editor/components/tiptap-ui/image-caption-button";
import { ImageUploadButton } from "@workspace/editor/components/tiptap-ui/image-upload-button";
import { RefreshCcwIcon } from "@workspace/editor/components/tiptap-icons/refresh-ccw-icon";

export function ImageNodeFloating({
  editor: providedEditor,
}: {
  editor?: Editor | null;
}) {
  const { t } = useI18n();

  const { editor } = useTiptapEditor(providedEditor);
  const visible = isNodeTypeSelected(editor, ["image"]);

  if (!editor || !visible) {
    return null;
  }

  return (
    <>
      <ImageAlignButton align="left" />
      <ImageAlignButton align="center" />
      <ImageAlignButton align="right" />
      <Separator />
      <ImageCaptionButton />
      <Separator />
      <ImageDownloadButton />
      <ImageUploadButton icon={RefreshCcwIcon} tooltip={t("Replace")} />
      <Separator />
      <DeleteNodeButton />
    </>
  );
}
