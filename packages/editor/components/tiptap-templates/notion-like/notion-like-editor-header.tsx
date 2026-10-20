// SPDX-License-Identifier: AGPL-3.0-only

"use client";
import { useI18n } from "@workspace/ui/lib/i18n";

import { ThemeToggle } from "@workspace/editor/components/tiptap-templates/notion-like/notion-like-editor-theme-toggle";

// --- Tiptap UI ---
import { UndoRedoButton } from "@workspace/editor/components/tiptap-ui/undo-redo-button";

// --- UI Primitives ---
import { Spacer } from "@workspace/editor/components/tiptap-ui-primitive/spacer";
import { Separator } from "@workspace/editor/components/tiptap-ui-primitive/separator";
import { ButtonGroup } from "@workspace/editor/components/tiptap-ui-primitive/button-group";

// --- Styles ---
import "@workspace/editor/components/tiptap-templates/notion-like/notion-like-editor-header.scss";

import { Button } from "@workspace/ui/components/ui/button";
import { EditorContext } from "@tiptap/react";
import { useContext } from "react";

export function NotionEditorHeader() {
  const { t } = useI18n();

  const { editor } = useContext(EditorContext)!;
  return (
    <header className="notion-like-editor-header">
      <Spacer />
      <div className="notion-like-editor-header-actions">
        <ButtonGroup>
          <ButtonGroup>
            <UndoRedoButton action="undo" />
          </ButtonGroup>
          <ButtonGroup>
            <UndoRedoButton action="redo" />
          </ButtonGroup>
        </ButtonGroup>

        <Separator />

        <ThemeToggle />

        <Button
          variant="default"
          onClick={() => console.log(editor?.getJSON())}
        >
          {t("输出编辑器内容")}{" "}
        </Button>
      </div>
    </header>
  );
}
