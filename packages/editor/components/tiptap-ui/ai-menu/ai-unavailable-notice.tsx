// SPDX-License-Identifier: AGPL-3.0-only

"use client";

import { useCallback, useEffect } from "react";
import { type Editor } from "@tiptap/react";

// -- Hooks --
import { useTiptapEditor } from "@workspace/editor/hooks/use-tiptap-editor";
import { useUiEditorState } from "@workspace/editor/hooks/use-ui-editor-state";

// -- Utils --
import { getSelectedDOMElement } from "@workspace/editor/lib/tiptap-advanced-utils";

// -- Lib --
import { AI_UNAVAILABLE_NOTICE } from "@workspace/editor/lib/ai";

// -- Tiptap UI --
import {
  Menu,
  MenuContent,
  useFloatingMenuStore,
} from "@workspace/editor/components/tiptap-ui-primitive/menu";
import { Card } from "@workspace/editor/components/tiptap-ui-primitive/card/card";
import {
  createEditorWidthAnchorRect,
  createVirtualAnchor,
  getSelectionRangeRect,
} from "@workspace/editor/components/tiptap-ui/ai-menu/ai-menu-utils";
import {
  useAiMenuState,
  useAiMenuStateProvider,
  useTextSelectionTracker,
} from "@workspace/editor/components/tiptap-ui/ai-menu/ai-menu-hooks";

// -- Icons --
import { AiSparklesIcon } from "@workspace/editor/components/tiptap-icons/ai-sparkles-icon";

import "@workspace/editor/components/tiptap-ui/ai-menu/ai-notice.scss";

/**
 * The AI panel the editor actually mounts. Every AI entry point (toolbar
 * `Improve`, `Ask AI`, the slash menu's AI group) opens it by running
 * `aiGenerationShow`, and it is the single place that states the feature is
 * unavailable — so the entries stay where users expect them and none of them
 * silently does nothing.
 *
 * It deliberately renders no generation UI: there is no backend behind it. The
 * full generation panel (`ai-menu.tsx` with `ai-menu-input` / `ai-menu-actions`
 * / `ai-menu-items`) is retained in this directory but not exported and not
 * referenced — a future real backend mounts that one instead. See `lib/ai.ts`.
 */
export function AiUnavailableNotice({
  editor: providedEditor,
  anchorToSelection = false,
}: {
  editor?: Editor | null;
  anchorToSelection?: boolean;
}) {
  const { editor } = useTiptapEditor(providedEditor);
  const { state, updateState, reset } = useAiMenuState();
  const { show, store } = useFloatingMenuStore();
  const { aiGenerationActive } = useUiEditorState(editor);

  const closeAiMenu = useCallback(() => {
    if (!editor) return;
    reset();
    store?.hideAll();
    editor.commands.resetUiState();
  }, [editor, reset, store]);

  /**
   * Anchors the panel to the current selection (or the block holding it) and
   * opens it.
   *
   * Opening is driven here rather than from the selection tracker below, because
   * `aiGenerationShow` mutates extension storage without dispatching a
   * transaction: the tracker rides on transactions, so it can only reposition an
   * already-open panel, never open one.
   */
  const openAtSelection = useCallback(() => {
    if (!editor) return;

    const editorDom = editor.view.dom;
    const selectionRect = getSelectionRangeRect(editor);

    if (anchorToSelection && selectionRect) {
      const anchorRect = createEditorWidthAnchorRect(editorDom, selectionRect);
      const anchor = createVirtualAnchor(anchorRect, editorDom);
      updateState({ isOpen: true });
      show(anchor);
      return;
    }

    const selectedElement = getSelectedDOMElement(editor);
    if (selectedElement) {
      updateState({ isOpen: true });
      show(selectedElement);
    }
  }, [editor, anchorToSelection, updateState, show]);

  useEffect(() => {
    if (!editor || !aiGenerationActive || state.isOpen) return;
    openAtSelection();
  }, [editor, aiGenerationActive, state.isOpen, openAtSelection]);

  useTextSelectionTracker({
    editor,
    aiGenerationActive,
    showMenuAtElement: show,
    setMenuVisible: (visible) => updateState({ isOpen: visible }),
    anchorToSelection,
  });

  useEffect(() => {
    if (!aiGenerationActive && state.isOpen) {
      closeAiMenu();
    }
  }, [aiGenerationActive, state.isOpen, closeAiMenu]);

  if (!editor || !state.isOpen || !aiGenerationActive) {
    return null;
  }

  return (
    <Menu open={state.isOpen} placement="bottom-start" store={store}>
      <MenuContent
        onClickOutside={closeAiMenu}
        className="tiptap-ai-menu"
        flip={false}
      >
        <Card>
          <div className="tiptap-ai-unavailable" role="status">
            <AiSparklesIcon className="tiptap-button-icon" />
            <span className="tiptap-button-text">{AI_UNAVAILABLE_NOTICE}</span>
          </div>
        </Card>
      </MenuContent>
    </Menu>
  );
}

export function AiMenu({
  editor,
  anchorToSelection,
}: {
  editor?: Editor | null;
  anchorToSelection?: boolean;
}) {
  const { value, AiMenuStateContext } = useAiMenuStateProvider();

  return (
    <AiMenuStateContext.Provider value={value}>
      <AiUnavailableNotice
        editor={editor}
        anchorToSelection={anchorToSelection}
      />
    </AiMenuStateContext.Provider>
  );
}
