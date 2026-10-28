// SPDX-License-Identifier: AGPL-3.0-only

"use client";
import { useI18n } from "@workspace/ui/lib/i18n";

import { useCallback, useEffect, useState } from "react";
import type { Editor } from "@tiptap/react";
import { NodeSelection } from "@tiptap/pm/state";

// --- Hooks ---
import { useTiptapEditor } from "@workspace/editor/hooks/use-tiptap-editor";

// --- Icons ---
import { AiSparklesIcon } from "@workspace/editor/components/tiptap-icons/ai-sparkles-icon";

// --- Lib ---
import { isNodeTypeSelected } from "@workspace/editor/lib/tiptap-utils";

/**
 * Configuration for the improve dropdown functionality
 */
export interface UseImproveDropdownConfig {
  /**
   * The Tiptap editor instance.
   */
  editor?: Editor | null;
  /**
   * Whether to hide the dropdown when AI features are not available
   * @default false
   */
  hideWhenUnavailable?: boolean;
}

const AI_EXCLUDED_BLOCKS = [
  "image",
  "imageUpload",
  "video",
  "audio",
  "table",
  "codeBlock",
  "horizontalRule",
  "hardBreak",
];

/**
 * Checks if the current selection is one the AI entries apply to.
 */
export function canUseAi(editor: Editor | null): boolean {
  if (!editor || !editor.isEditable) return false;

  const { selection } = editor.state;

  if (selection.empty) {
    return false;
  }

  if (selection instanceof NodeSelection) {
    if (!selection.node.content.size) {
      return false;
    }

    const node = selection.node;
    if (AI_EXCLUDED_BLOCKS.includes(node.type.name)) {
      return false;
    }
  }

  return true;
}

/**
 * Determines if the improve dropdown should be visible
 */
export function shouldShowImproveDropdown(params: {
  editor: Editor | null;
  hideWhenUnavailable: boolean;
}): boolean {
  const { editor, hideWhenUnavailable } = params;

  if (!editor) return false;

  if (!hideWhenUnavailable) {
    return true;
  }

  if (!editor.isEditable) return false;

  // The third argument 'true' checks whether the current selection is inside an image caption, and prevents showing AI features (improve dropdown) there
  // If the selection is inside an image caption, we can't show the improve dropdown (AI features)
  if (isNodeTypeSelected(editor, ["image"], true)) return false;

  if (!editor.isActive("code")) {
    return canUseAi(editor);
  }

  return true;
}

/**
 * Custom hook that provides improve dropdown functionality for Tiptap editor.
 *
 * It owns visibility only. The dropdown exists so the AI entry stays where users
 * look for it, and it states the feature is unavailable — there is no AI backend
 * in this release, so nothing here executes a command any more.
 */
export function useImproveDropdown(config?: UseImproveDropdownConfig) {
  const { t } = useI18n();

  const { editor: providedEditor, hideWhenUnavailable = false } = config || {};

  const { editor } = useTiptapEditor(providedEditor);
  const [isOpen, setIsOpen] = useState(false);
  const [isVisible, setIsVisible] = useState(true);
  const isDisabled = !canUseAi(editor);

  const handleOpenChange = useCallback(
    (open: boolean, callback?: (isOpen: boolean) => void) => {
      if (!editor || isDisabled) return;
      setIsOpen(open);
      callback?.(open);
    },
    [editor, isDisabled],
  );

  useEffect(() => {
    if (!editor) return;

    const handleSelectionUpdate = () => {
      setIsVisible(
        shouldShowImproveDropdown({
          editor,
          hideWhenUnavailable,
        }),
      );
    };

    handleSelectionUpdate();
    editor.on("selectionUpdate", handleSelectionUpdate);

    return () => {
      editor.off("selectionUpdate", handleSelectionUpdate);
    };
  }, [editor, hideWhenUnavailable]);

  return {
    isVisible,
    isDisabled,
    isOpen,
    setIsOpen,
    handleOpenChange,
    label: t("Improve"),
    Icon: AiSparklesIcon,
  };
}
