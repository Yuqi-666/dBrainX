// SPDX-License-Identifier: AGPL-3.0-only

import { useI18n } from "@workspace/ui/lib/i18n";
import { useEffect, useState } from "react";
import { type Editor } from "@tiptap/react";

// --- Hooks ---
import { useTiptapEditor } from "@workspace/editor/hooks/use-tiptap-editor";
import { useUiEditorState } from "@workspace/editor/hooks/use-ui-editor-state";
import { useIsBreakpoint } from "@workspace/editor/hooks/use-is-breakpoint";
import { useFloatingToolbarVisibility } from "@workspace/editor/hooks/use-floating-toolbar-visibility";

// --- Node ---
import { ImageNodeFloating } from "@workspace/editor/components/tiptap-node/image-node/image-node-floating";

// --- Icons ---
import { MoreVerticalIcon } from "@workspace/editor/components/tiptap-icons/more-vertical-icon";

// --- UI ---
import { ColorTextPopover } from "@workspace/editor/components/tiptap-ui/color-text-popover";
import { ImproveDropdown } from "@workspace/editor/components/tiptap-ui/improve-dropdown";
import { LinkPopover } from "@workspace/editor/components/tiptap-ui/link-popover";
import type { Mark } from "@workspace/editor/components/tiptap-ui/mark-button";
import {
  canToggleMark,
  MarkButton,
} from "@workspace/editor/components/tiptap-ui/mark-button";
import type { TextAlign } from "@workspace/editor/components/tiptap-ui/text-align-button";
import {
  canSetTextAlign,
  TextAlignButton,
} from "@workspace/editor/components/tiptap-ui/text-align-button";
import { TurnIntoDropdown } from "@workspace/editor/components/tiptap-ui/turn-into-dropdown";
import { IndentButton } from "@workspace/editor/components/tiptap-ui/indent-button";

// --- Utils ---
import { isSelectionValid } from "@workspace/editor/lib/tiptap-collab-utils";

// --- Primitive UI Components ---
import type { ButtonProps } from "@workspace/editor/components/tiptap-ui-primitive/button";
import { Button } from "@workspace/editor/components/tiptap-ui-primitive/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@workspace/editor/components/tiptap-ui-primitive/popover";
import {
  Toolbar,
  ToolbarGroup,
  ToolbarSeparator,
} from "@workspace/editor/components/tiptap-ui-primitive/toolbar";

// --- UI Utils ---
import { FloatingElement } from "@workspace/editor/components/tiptap-ui-utils/floating-element";

export function NotionToolbarFloating() {
  useI18n();

  const { editor } = useTiptapEditor();
  const isMobile = useIsBreakpoint("max", 480);
  const { lockDragHandle, aiGenerationActive, commentInputVisible } =
    useUiEditorState(editor);

  const { shouldShow } = useFloatingToolbarVisibility({
    editor,
    isSelectionValid,
    extraHideWhen: Boolean(aiGenerationActive || commentInputVisible),
  });

  if (lockDragHandle || isMobile) return null;

  return (
    <FloatingElement shouldShow={shouldShow}>
      <Toolbar variant="floating">
        <ToolbarGroup>
          <ImproveDropdown hideWhenUnavailable={true} />
        </ToolbarGroup>

        <ToolbarSeparator />

        <ToolbarGroup>
          <TurnIntoDropdown hideWhenUnavailable={true} />
        </ToolbarGroup>

        <ToolbarSeparator />

        <ToolbarGroup>
          <MarkButton type="bold" hideWhenUnavailable={true} />
          <MarkButton type="italic" hideWhenUnavailable={true} />
          <MarkButton type="underline" hideWhenUnavailable={true} />
          <MarkButton type="strike" hideWhenUnavailable={true} />
          <MarkButton type="code" hideWhenUnavailable={true} />
        </ToolbarGroup>

        <ToolbarSeparator />

        <ToolbarGroup>
          <ImageNodeFloating />
        </ToolbarGroup>

        <ToolbarGroup>
          <LinkPopover
            autoOpenOnLinkActive={false}
            hideWhenUnavailable={true}
          />
          <ColorTextPopover hideWhenUnavailable={true} />
        </ToolbarGroup>

        <MoreOptions hideWhenUnavailable={true} />
      </Toolbar>
    </FloatingElement>
  );
}

function canMoreOptions(editor: Editor | null): boolean {
  if (!editor) {
    return false;
  }

  const canTextAlignAny = ["left", "center", "right", "justify"].some((align) =>
    canSetTextAlign(editor, align as TextAlign),
  );

  const canMarkAny = ["superscript", "subscript"].some((type) =>
    canToggleMark(editor, type as Mark),
  );

  return canMarkAny || canTextAlignAny;
}

function shouldShowMoreOptions(params: {
  editor: Editor | null;
  hideWhenUnavailable: boolean;
}): boolean {
  const { editor, hideWhenUnavailable } = params;

  if (!editor) {
    return false;
  }

  if (hideWhenUnavailable && !editor.isActive("code")) {
    return canMoreOptions(editor);
  }

  return Boolean(editor?.isEditable);
}

export interface MoreOptionsProps extends Omit<ButtonProps, "type"> {
  /**
   * The Tiptap editor instance.
   */
  editor?: Editor | null;
  /**
   * Whether to hide the dropdown when no options are available.
   * @default false
   */
  hideWhenUnavailable?: boolean;
}

export function MoreOptions({
  editor: providedEditor,
  hideWhenUnavailable = false,
  ...props
}: MoreOptionsProps) {
  const { t } = useI18n();

  const { editor } = useTiptapEditor(providedEditor);
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!editor) return;

    const handleSelectionUpdate = () => {
      setShow(
        shouldShowMoreOptions({
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

  if (!show || !editor || !editor.isEditable) {
    return null;
  }

  return (
    <>
      <ToolbarSeparator />
      <ToolbarGroup>
        <Popover>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              role="button"
              tabIndex={-1}
              tooltip={t("More options")}
              {...props}
            >
              <MoreVerticalIcon className="tiptap-button-icon" />
            </Button>
          </PopoverTrigger>

          <PopoverContent
            side="top"
            align="end"
            alignOffset={4}
            sideOffset={4}
            asChild
          >
            <Toolbar variant="floating" tabIndex={0}>
              <ToolbarGroup>
                <MarkButton type="superscript" />
                <MarkButton type="subscript" />
              </ToolbarGroup>

              <ToolbarSeparator />

              <ToolbarGroup>
                <TextAlignButton align="left" />
                <TextAlignButton align="center" />
                <TextAlignButton align="right" />
                <TextAlignButton align="justify" />
              </ToolbarGroup>

              <ToolbarSeparator />

              <ToolbarGroup>
                <IndentButton action="outdent" />
                <IndentButton action="indent" />
              </ToolbarGroup>
            </Toolbar>
          </PopoverContent>
        </Popover>
      </ToolbarGroup>
    </>
  );
}
