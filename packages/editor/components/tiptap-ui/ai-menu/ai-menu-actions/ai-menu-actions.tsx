// SPDX-License-Identifier: AGPL-3.0-only

"use client";
import { useI18n } from "@workspace/ui/lib/i18n";

import { useCallback } from "react";
import type { Editor } from "@tiptap/react";
import { Button } from "@workspace/editor/components/tiptap-ui-primitive/button";
import { RefreshAiIcon } from "@workspace/editor/components/tiptap-icons/refresh-ai-icon";
import { XIcon } from "@workspace/editor/components/tiptap-icons/x-icon";
import { CheckIcon } from "@workspace/editor/components/tiptap-icons/check-icon";
import type { TextOptions } from "@workspace/editor/lib/ai";
import { useUiEditorState } from "@workspace/editor/hooks/use-ui-editor-state";
import { ButtonGroup } from "@workspace/editor/components/tiptap-ui-primitive/button-group";

import "@workspace/editor/components/tiptap-ui/ai-menu/ai-menu-actions/ai-menu-actions.scss";

export interface AiMenuActionsProps {
  editor: Editor | null;
  options: TextOptions;
  onRegenerate?: () => void;
  onAccept?: () => void;
  onReject?: () => void;
}

export function AiMenuActions({
  editor,
  options,
  onRegenerate,
  onAccept,
  onReject,
}: AiMenuActionsProps) {
  const { t } = useI18n();

  const { aiGenerationIsLoading } = useUiEditorState(editor);

  const handleRegenerate = useCallback(() => {
    if (!editor) return;
    editor.chain().focus().aiRegenerate(options).run();
    onRegenerate?.();
  }, [editor, onRegenerate, options]);

  const handleDiscard = useCallback(() => {
    if (!editor) return;
    editor.chain().focus().aiReject().run();
    onReject?.();
  }, [editor, onReject]);

  const handleApply = useCallback(() => {
    if (!editor) return;
    editor.chain().focus().aiAccept().run();
    onAccept?.();
  }, [editor, onAccept]);

  return (
    <div className="tiptap-ai-menu-actions">
      <div className="tiptap-ai-menu-results">
        <Button
          variant="ghost"
          className="tiptap-button"
          onClick={handleRegenerate}
          disabled={aiGenerationIsLoading}
        >
          <RefreshAiIcon className="tiptap-button-icon" />
          {t("Try again")}{" "}
        </Button>
      </div>

      <div className="tiptap-ai-menu-commit">
        <ButtonGroup>
          <ButtonGroup>
            <Button
              variant="ghost"
              className="tiptap-button"
              onClick={handleDiscard}
            >
              <XIcon className="tiptap-button-icon" />
              {t("Discard")}{" "}
            </Button>
          </ButtonGroup>

          <ButtonGroup>
            <Button
              data-style="primary"
              className="tiptap-button"
              onClick={handleApply}
            >
              <CheckIcon className="tiptap-button-icon" />
              {t("Apply")}{" "}
            </Button>
          </ButtonGroup>
        </ButtonGroup>
      </div>
    </div>
  );
}
