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

export const LATEX_INLINE_SHORTCUT_KEY = "mod+shift+e";

export interface UseLatexInlineConfig {
  editor?: Editor | null;
  hideWhenUnavailable?: boolean;
  onToggled?: () => void;
}

export function canToggleLatexInline(
  editor: Editor | null,
  turnInto: boolean = true,
): boolean {
  if (!editor || !editor.isEditable) return false;
  if (!isNodeInSchema("latexInline", editor)) return false;

  if (!turnInto) {
    return editor.can().setLatexInline();
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
      "latexInline",
    ])
  )
    return false;

  return editor.can().setLatexInline();
}

/**
 * Toggles latex inline in the editor (精确替换选中部分)
 */
export function toggleLatexInline(editor: Editor | null): boolean {
  if (!editor || !editor.isEditable) return false;
  if (!canToggleLatexInline(editor)) return false;

  try {
    const { state } = editor;
    const { selection } = state;

    // 1. 如果当前已经是公式节点，再次触发意味着 "取消公式" -> 还原为普通文本
    if (editor.isActive("latexInline")) {
      if (
        selection instanceof NodeSelection &&
        selection.node.type.name === "latexInline"
      ) {
        // 由于是 atom 节点，文本存在 attrs 里，需要提取出来转为纯文本
        const text = selection.node.attrs.text || "";
        editor.chain().focus().insertContent(text).run();
        return true;
      }
    }

    // 2. 将普通文本转为行内公式
    let latexText = "";
    if (!selection.empty && selection instanceof TextSelection) {
      // 提取精确选中的文本
      latexText = state.doc.textBetween(selection.from, selection.to, " ");
    }

    // 删除选中的文本，并在原位置插入行内公式节点
    editor
      .chain()
      .focus()
      .deleteSelection() // 只删除高亮部分
      .setLatexInline({ text: latexText })
      .run();

    return true;
  } catch {
    return false;
  }
}

export function shouldShowLatexInlineButton(props: {
  editor: Editor | null;
  hideWhenUnavailable: boolean;
}): boolean {
  const { editor, hideWhenUnavailable } = props;

  if (!editor) return false;

  if (!hideWhenUnavailable) {
    return true;
  }

  if (!editor.isEditable) return false;
  if (!isNodeInSchema("latexInline", editor)) return false;

  return canToggleLatexInline(editor);
}

export function useLatexInline(config?: UseLatexInlineConfig) {
  const { t } = useI18n();

  const {
    editor: providedEditor,
    hideWhenUnavailable = false,
    onToggled,
  } = config || {};

  const { editor } = useTiptapEditor(providedEditor);
  const [isVisible, setIsVisible] = useState<boolean>(true);
  const canToggleState = canToggleLatexInline(editor);
  const isActive = editor?.isActive("latexInline") || false;

  useEffect(() => {
    if (!editor) return;

    const handleSelectionUpdate = () => {
      setIsVisible(
        shouldShowLatexInlineButton({ editor, hideWhenUnavailable }),
      );
    };

    handleSelectionUpdate();

    editor.on("selectionUpdate", handleSelectionUpdate);

    return () => {
      editor.off("selectionUpdate", handleSelectionUpdate);
    };
  }, [editor, hideWhenUnavailable]);

  const handleToggle = useCallback(() => {
    if (!editor) return false;

    const success = toggleLatexInline(editor);
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
    label: t("Inline math"),
    shortcutKeys: LATEX_INLINE_SHORTCUT_KEY,
    Icon: TypeIcon,
  };
}
