// SPDX-License-Identifier: AGPL-3.0-only

"use client";
import { useI18n } from "@workspace/ui/lib/i18n";

/**
 * The **selection bubble** of the single-block editor (`single-block-editor.tsx`,
 * design `docs/node-content/README.md` §1.1: 「整块内容是一个居中的、字号明显大于
 * 正文的富文本块」).
 *
 * Why a second floating toolbar exists at all, instead of reusing
 * `notion-like/notion-like-editor-toolbar-floating.tsx`: the two blocks differ in
 * **what is meaningful**, not in taste. Every control here is the *same component*
 * the rich-text toolbar uses (`MarkButton`, `LinkPopover`, `ColorTextPopover`,
 * `TextAlignButton`, `LatexInlineButton`, the `Toolbar` primitives,
 * `FloatingElement`) — only the assembly differs:
 *
 * | rich-text paragraph | here | why |
 * | --- | --- | --- |
 * | Improve (AI), 转换成 (headings/lists/quote), image, indent | — | the document is one `paragraph`; those nodes are not in the schema (`SingleBlockDocument`) |
 * | bold / italic / underline / strike / code | same | inline marks are the whole capability set of the block |
 * | link, text colour + highlight | same | same |
 * | superscript / subscript / align | same, in 更多 | same |
 * | inline formula (LaTeX) | same | design §1.1 「公式走 …」; `LatexInline` is in the shared extension set |
 *
 * Importing the rich-text assembly instead would have been wrong twice: it drags
 * in the AI / collab / mention / table graph (and with it `@workspace/api-client`,
 * which is the source of most of the editor's baseline noise), and every one of
 * its block-level entries would have to be hidden again.
 *
 * Two deliberate differences from the Notion template's bubble:
 *
 * 1. **No `useIsBreakpoint` guard.** The Notion template hides its bubble on narrow
 *    screens because it has a `MobileToolbar` underneath; a one-paragraph block has
 *    no such fallback, so hiding it would remove the only formatting affordance on a
 *    tablet. The block is a single line, so the bubble is usable with a coarse
 *    pointer.
 * 2. **No `lockDragHandle` / `aiGenerationActive` / `commentInputVisible` inputs** —
 *    those come from `UiState`, which the single-block schema deliberately does not
 *    register (no drag handle, no AI, no comments).
 *
 * The bubble positions itself from the current text selection
 * (`getSelectionBoundingRect`) and is a child of the editor wrapper, so
 * `isElementWithinEditor` (which tests `editor.view.dom.parentElement`) already
 * treats a click on it as "inside the editor" and it does not dismiss itself.
 * `Esc` is **not** swallowed: `FloatingElement` closes the bubble and lets the event
 * bubble to the surrounding Dialog (`node-editor.tsx`), matching §M3.4-10.
 */
import { useEffect, useState } from "react";
import type { Editor } from "@tiptap/react";
import { EditorContext } from "@tiptap/react";

// --- Hooks ---
import { useFloatingToolbarVisibility } from "@workspace/editor/hooks/use-floating-toolbar-visibility";
import { useTiptapEditor } from "@workspace/editor/hooks/use-tiptap-editor";

// --- Lib ---
import { isSelectionValid } from "@workspace/editor/lib/tiptap-collab-utils";

// --- Icons ---
import { MoreVerticalIcon } from "@workspace/editor/components/tiptap-icons/more-vertical-icon";

// --- Tiptap UI ---
import { ColorTextPopover } from "@workspace/editor/components/tiptap-ui/color-text-popover";
import { LatexInlineButton } from "@workspace/editor/components/tiptap-ui/latex-inline-button";
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

// --- UI Primitives ---
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

export interface SingleBlockToolbarProps {
  /** The editor this bubble belongs to; `null` renders nothing. */
  editor: Editor | null;
}

/**
 * The floating toolbar. Visibility is `useFloatingToolbarVisibility`'s own rule
 * (`isSelectionValid`): a non-empty text selection inside the paragraph — which is
 * also why selecting a formula node shows the formula's own editor instead
 * (`latexInline` is in `isSelectionValid`'s `excludedNodeTypes`).
 */
export function SingleBlockToolbar({ editor }: SingleBlockToolbarProps) {
  const { t } = useI18n();

  const { shouldShow } = useFloatingToolbarVisibility({
    editor,
    isSelectionValid,
  });

  if (!editor) return null;

  return (
    // Same shape as the Notion template: every control below reads the editor from
    // the context, so one provider is enough (and keeps the controls reusable).
    <EditorContext.Provider value={{ editor }}>
      <FloatingElement shouldShow={shouldShow}>
        <Toolbar variant="floating" aria-label={t("文本格式")}>
          <ToolbarGroup>
            <MarkButton type="bold" hideWhenUnavailable={true} />
            <MarkButton type="italic" hideWhenUnavailable={true} />
            <MarkButton type="underline" hideWhenUnavailable={true} />
            <MarkButton type="strike" hideWhenUnavailable={true} />
            <MarkButton type="code" hideWhenUnavailable={true} />
          </ToolbarGroup>

          <ToolbarSeparator />

          <ToolbarGroup>
            <LinkPopover
              autoOpenOnLinkActive={false}
              hideWhenUnavailable={true}
            />
            <ColorTextPopover hideWhenUnavailable={true} />
          </ToolbarGroup>

          <ToolbarSeparator />

          <ToolbarGroup>
            <LatexInlineButton hideWhenUnavailable={true} />
          </ToolbarGroup>

          <SingleBlockMoreOptions />
        </Toolbar>
      </FloatingElement>
    </EditorContext.Provider>
  );
}

/** Whether 更多 has anything to show for the current selection. */
function canMoreOptions(editor: Editor | null): boolean {
  if (!editor) return false;

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

  if (!editor) return false;

  // A code mark excludes script marks and alignment (they cannot be applied inside
  // it) — same rule as the Notion template.
  if (hideWhenUnavailable && !editor.isActive("code")) {
    return canMoreOptions(editor);
  }

  return Boolean(editor.isEditable);
}

export interface SingleBlockMoreOptionsProps extends Omit<ButtonProps, "type"> {
  editor?: Editor | null;
  /**
   * Whether to hide the dropdown when no option is available.
   * @default false
   */
  hideWhenUnavailable?: boolean;
}

/**
 * 更多 — superscript / subscript and the four text alignments. Kept behind one
 * button so the bubble stays narrow (the single block is a short line of text, and
 * a wide bubble over a centered paragraph is mostly empty chrome).
 */
export function SingleBlockMoreOptions({
  editor: providedEditor,
  hideWhenUnavailable = true,
  ...props
}: SingleBlockMoreOptionsProps) {
  const { t } = useI18n();

  // `useTiptapEditor` falls back to `EditorContext` — the provider above — so the
  // whole bubble can stay context-driven like the Notion template's controls.
  const { editor } = useTiptapEditor(providedEditor);
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!editor) return;

    const handleSelectionUpdate = () => {
      setShow(shouldShowMoreOptions({ editor, hideWhenUnavailable }));
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
              tooltip={t("更多")}
              aria-label={t("更多")}
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
                <MarkButton type="superscript" editor={editor} />
                <MarkButton type="subscript" editor={editor} />
              </ToolbarGroup>

              <ToolbarSeparator />

              <ToolbarGroup>
                <TextAlignButton align="left" editor={editor} />
                <TextAlignButton align="center" editor={editor} />
                <TextAlignButton align="right" editor={editor} />
                <TextAlignButton align="justify" editor={editor} />
              </ToolbarGroup>
            </Toolbar>
          </PopoverContent>
        </Popover>
      </ToolbarGroup>
    </>
  );
}
