// SPDX-License-Identifier: AGPL-3.0-only

"use client";
import { useI18n } from "@workspace/ui/lib/i18n";

import { useCallback, useEffect, useState } from "react";
import { type Editor } from "@tiptap/react";
import { NodeSelection, TextSelection } from "@tiptap/pm/state";

// --- Hooks ---
import { useTiptapEditor } from "@workspace/editor/hooks/use-tiptap-editor";

// --- Lib ---
import {
  isNodeInSchema,
  selectionWithinConvertibleTypes,
} from "@workspace/editor/lib/tiptap-utils";

// --- Icons ---
import { TypeIcon } from "@workspace/editor/components/tiptap-icons/type-icon";

export const LATEX_BLOCK_SHORTCUT_KEY = "mod+shift+m";

export interface UseLatexBlockConfig {
  editor?: Editor | null;
  hideWhenUnavailable?: boolean;
  onToggled?: () => void;
}

export function canToggleLatexBlock(
  editor: Editor | null,
  turnInto: boolean = true,
): boolean {
  if (!editor || !editor.isEditable) return false;
  if (!isNodeInSchema("latexBlock", editor)) return false;

  if (!turnInto) {
    return editor.can().setLatexBlock();
  }

  if (
    !selectionWithinConvertibleTypes(editor, [
      "paragraph",
      "heading",
      "bulletList",
      "orderedList",
      "taskList",
      "blockquote",
      "codeBlock",
      "latexBlock",
    ])
  )
    return false;

  return editor.can().setLatexBlock();
}

/**
 * Toggles latex block in the editor (精确替换选中部分)
 */
export function toggleLatexBlock(editor: Editor | null): boolean {
  if (!editor || !editor.isEditable) return false;
  if (!canToggleLatexBlock(editor)) return false;

  try {
    const { state } = editor;
    const { selection } = state;

    // 1. 如果已经是块级公式，再次触发则取消它（变为普通段落）
    if (editor.isActive("latexBlock")) {
      if (
        selection instanceof NodeSelection &&
        selection.node.type.name === "latexBlock"
      ) {
        const text = selection.node.attrs.text || "";
        editor
          .chain()
          .focus()
          .insertContent({
            type: "paragraph",
            content: text ? [{ type: "text", text }] : [],
          })
          .run();
        return true;
      }
    }

    // 2. 将选中的文本转为块级公式
    let latexText = "";
    if (!selection.empty && selection instanceof TextSelection) {
      latexText = state.doc.textBetween(selection.from, selection.to, "\n");
    }

    // 删除选中片段并替换为公式块 (Tiptap 会自动在这个位置打断段落并插入 Block)
    editor
      .chain()
      .focus()
      .deleteSelection()
      .setLatexBlock({ text: latexText })
      .run();

    return true;
  } catch {
    return false;
  }
}

export function shouldShowLatexButton(props: {
  editor: Editor | null;
  hideWhenUnavailable: boolean;
}): boolean {
  const { editor, hideWhenUnavailable } = props;

  if (!editor) return false;

  if (!hideWhenUnavailable) {
    return true;
  }

  if (!editor.isEditable) return false;
  if (!isNodeInSchema("latexBlock", editor)) return false;

  return canToggleLatexBlock(editor);
}

export function useLatexBlock(config?: UseLatexBlockConfig) {
  const { t } = useI18n();

  const {
    editor: providedEditor,
    hideWhenUnavailable = false,
    onToggled,
  } = config || {};

  const { editor } = useTiptapEditor(providedEditor);
  const [isVisible, setIsVisible] = useState<boolean>(true);
  const canToggleState = canToggleLatexBlock(editor);
  const isActive = editor?.isActive("latexBlock") || false;

  useEffect(() => {
    if (!editor) return;

    const handleSelectionUpdate = () => {
      setIsVisible(shouldShowLatexButton({ editor, hideWhenUnavailable }));
    };

    handleSelectionUpdate();

    editor.on("selectionUpdate", handleSelectionUpdate);

    return () => {
      editor.off("selectionUpdate", handleSelectionUpdate);
    };
  }, [editor, hideWhenUnavailable]);

  const handleToggle = useCallback(() => {
    if (!editor) return false;

    const success = toggleLatexBlock(editor);
    if (success) {
      onToggled?.();
    }
    return success;
  }, [editor, onToggled]);

  return {
    isVisible,
    isActive,
    handleToggle,
    canToggle: canToggleState,
    label: t("Math block"),
    shortcutKeys: LATEX_BLOCK_SHORTCUT_KEY,
    Icon: TypeIcon,
  };
}
