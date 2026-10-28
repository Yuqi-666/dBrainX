// SPDX-License-Identifier: AGPL-3.0-only

"use client";

import { useCallback, useContext, useEffect, useMemo, useRef } from "react";
import { useI18n } from "@workspace/ui/lib/i18n";
import { translate } from "@workspace/ui/lib/i18n/runtime";
import { EditorContent, EditorContext, useEditor } from "@tiptap/react";
import { Doc as YDoc } from "yjs";
import { createPortal } from "react-dom";

// --- Tiptap Core Extensions ---
import type { JSONContent } from "@tiptap/core";
import { StarterKit } from "@tiptap/starter-kit";
import { Markdown } from "@tiptap/markdown";
import { Mention } from "@tiptap/extension-mention";
import { TaskList, TaskItem } from "@tiptap/extension-list";
import { Color, TextStyle } from "@tiptap/extension-text-style";
import { Placeholder, Selection } from "@tiptap/extensions";
import { Collaboration, isChangeOrigin } from "@tiptap/extension-collaboration";
import { Typography } from "@tiptap/extension-typography";
import { Highlight } from "@tiptap/extension-highlight";
import { Superscript } from "@tiptap/extension-superscript";
import { Subscript } from "@tiptap/extension-subscript";
import { TextAlign } from "@tiptap/extension-text-align";
import { Ai } from "@workspace/editor/lib/ai";
import { UniqueID } from "@tiptap/extension-unique-id";
import { Emoji, gitHubEmojis } from "@tiptap/extension-emoji";
import {
  getHierarchicalIndexes,
  TableOfContents,
} from "@tiptap/extension-table-of-contents";

// --- Hooks ---
import { useUiEditorState } from "@workspace/editor/hooks/use-ui-editor-state";
import { useScrollToHash } from "@workspace/editor/components/tiptap-ui/copy-anchor-link-button/use-scroll-to-hash";

// --- Custom Extensions ---
import { PasteMarkdown } from "@workspace/editor/components/tiptap-extension/paste-markdown-extension";
import { CopyMarkdown } from "@workspace/editor/components/tiptap-extension/copy-markdown-extension";
import { SelectBlockOrAll } from "@workspace/editor/components/tiptap-extension/select-block-or-all-extension";
import { HorizontalRule } from "@workspace/editor/components/tiptap-node/horizontal-rule-node/horizontal-rule-node-extension";
import { UiState } from "@workspace/editor/components/tiptap-extension/ui-state-extension";
import { Image } from "@workspace/editor/components/tiptap-node/image-node/image-node-extension";
import { NodeBackground } from "@workspace/editor/components/tiptap-extension/node-background-extension";
import { NodeAlignment } from "@workspace/editor/components/tiptap-extension/node-alignment-extension";
import { TocNode } from "@workspace/editor/components/tiptap-node/toc-node/extensions/toc-node-extension";
import { Excalidraw } from "../../tiptap-node/excalidraw/excalidraw-extension";
import { LatexInline, LatexBlock } from "../../tiptap-node/latex-node";

// --- Tiptap Node ---
import { ImageUploadNode } from "@workspace/editor/components/tiptap-node/image-upload-node/image-upload-node-extension";

// --- Table Node ---
import { TableKit } from "@workspace/editor/components/tiptap-node/table-node/extensions/table-node-extension";
import { TableHandleExtension } from "@workspace/editor/components/tiptap-node/table-node/extensions/table-handle";
import { TableHandle } from "@workspace/editor/components/tiptap-node/table-node/ui/table-handle/table-handle";
import { TableSelectionOverlay } from "@workspace/editor/components/tiptap-node/table-node/ui/table-selection-overlay";
import { TableCellHandleMenu } from "@workspace/editor/components/tiptap-node/table-node/ui/table-cell-handle-menu";
import { TableExtendRowColumnButtons } from "@workspace/editor/components/tiptap-node/table-node/ui/table-extend-row-column-button";
import "@workspace/editor/components/tiptap-node/table-node/styles/prosemirror-table.scss";
import "@workspace/editor/components/tiptap-node/table-node/styles/table-node.scss";

import "@workspace/editor/components/tiptap-node/blockquote-node/blockquote-node.scss";
import "@workspace/editor/components/tiptap-node/code-block-node/code-block-node.scss";
import "@workspace/editor/components/tiptap-node/horizontal-rule-node/horizontal-rule-node.scss";
import "@workspace/editor/components/tiptap-node/list-node/list-node.scss";
import "@workspace/editor/components/tiptap-node/image-node/image-node.scss";
import "@workspace/editor/components/tiptap-node/heading-node/heading-node.scss";
import "@workspace/editor/components/tiptap-node/paragraph-node/paragraph-node.scss";

// --- Tiptap UI ---
import { EmojiDropdownMenu } from "@workspace/editor/components/tiptap-ui/emoji-dropdown-menu";
import { MentionDropdownMenu } from "@workspace/editor/components/tiptap-ui/mention-dropdown-menu";
import { SlashDropdownMenu } from "@workspace/editor/components/tiptap-ui/slash-dropdown-menu";
import { DragContextMenu } from "@workspace/editor/components/tiptap-ui/drag-context-menu";
import { AiMenu } from "@workspace/editor/components/tiptap-ui/ai-menu";

// --- Lib ---
import {
  handleImageUpload,
  MAX_FILE_SIZE,
} from "@workspace/editor/lib/tiptap-utils";

// --- Styles ---
import "@workspace/editor/components/tiptap-templates/notion-like/notion-like-editor.scss";

// --- Content ---
import { MobileToolbar } from "@workspace/editor/components/tiptap-templates/notion-like/notion-like-editor-mobile-toolbar";
import { NotionToolbarFloating } from "@workspace/editor/components/tiptap-templates/notion-like/notion-like-editor-toolbar-floating";
import { TocSidebar } from "@workspace/editor/components/tiptap-node/toc-node";
import {
  TocProvider,
  useToc,
} from "@workspace/editor/components/tiptap-node/toc-node/context/toc-context";
import { ListNormalizationExtension } from "@workspace/editor/components/tiptap-extension/list-normalization-extension";
import { Indent } from "@workspace/editor/components/tiptap-extension/indent-extension";

/**
 * Initial document a consumer hands to a freshly created editor. Consumers pass
 * whole node contents, so the value is not guaranteed to carry a rich-text body:
 * only `docs` is ever read, and everything else is ignored.
 */
type InitialEditorContent = { docs?: JSONContent };

function extractInitialDocs(value: unknown): JSONContent | undefined {
  if (value && typeof value === "object" && "docs" in value) {
    return (value as InitialEditorContent).docs;
  }
  return undefined;
}

export interface NotionEditorProps {
  placeholder?: string;
  onContentChange?: (content: JSONContent) => void;
  getInitialContent?: () => unknown;
}

export interface EditorProviderProps {
  placeholder?: string;
  onContentChange?: (content: JSONContent) => void;
  getInitialContent?: () => unknown;
}

/**
 * Loading spinner component shown while the editor instance is being created
 */
export function LoadingSpinner({
  text = translate("Loading editor…"),
}: {
  text?: string;
}) {
  useI18n();
  return (
    <div className="spinner-container">
      <div className="spinner-content">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="10"></circle>
          <path d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg>
        <div className="spinner-loading-text">{text}</div>
      </div>
    </div>
  );
}

/**
 * EditorContent component that renders the actual editor
 */
export function EditorContentArea() {
  const { editor } = useContext(EditorContext)!;
  const { isDragging } = useUiEditorState(editor);

  useScrollToHash();

  if (!editor) {
    return null;
  }

  return (
    <EditorContent
      editor={editor}
      role="presentation"
      className="notion-like-editor-content"
      style={{
        cursor: isDragging ? "grabbing" : "auto",
      }}
    >
      <DragContextMenu />
      <AiMenu />
      <EmojiDropdownMenu />
      <MentionDropdownMenu />
      <SlashDropdownMenu />
      <NotionToolbarFloating />
      {createPortal(<MobileToolbar />, document.body)}
    </EditorContent>
  );
}

/**
 * Component that creates and provides the editor instance
 */
export function EditorProvider(props: EditorProviderProps) {
  const { locale } = useI18n();
  const {
    placeholder = translate("Start writing..."),
    onContentChange,
    getInitialContent,
  } = props;
  const placeholderRef = useRef(placeholder);

  const { setTocContent } = useToc();

  /**
   * The document lives in a local Y.Doc. There is no collaboration transport in
   * this release, so the doc never leaves the tab — it is here for the CRDT
   * history the editor's undo/redo rides on (`StarterKit` disables its own).
   */
  const ydoc = useMemo(() => new YDoc(), []);

  const handleContentChange = useCallback(
    (content: JSONContent) => {
      onContentChange?.(content);
    },
    [onContentChange],
  );

  const editor = useEditor({
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: "notion-like-editor",
      },
    },
    onUpdate({ editor }) {
      // The content has changed - extract JSON content
      const json = editor.getJSON();
      handleContentChange(json);
    },
    onCreate({ editor }) {
      // Tiptap emits `create` from a timeout (`Editor.mount`), so a first
      // keystroke can land before this runs. Only an empty document may be
      // seeded: writing over a non-empty one would erase that keystroke and
      // persist the blank document the user is about to close.
      if (!editor.isEmpty) return;
      const initialContent = getInitialContent?.();
      if (initialContent) {
        // tiptap turns a missing document into an empty one; its parameter type
        // just does not spell out `undefined`.
        const initialDocs = extractInitialDocs(initialContent);
        editor.commands.setContent(initialDocs as JSONContent);
      }
    },
    extensions: [
      StarterKit.configure({
        undoRedo: false,
        horizontalRule: false,
        dropcursor: {
          width: 2,
        },
        link: { openOnClick: false },
      }),
      Markdown,
      PasteMarkdown,
      CopyMarkdown,
      SelectBlockOrAll,
      HorizontalRule,
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      Collaboration.configure({ document: ydoc }),
      Placeholder.configure({
        placeholder: () => placeholderRef.current,
        emptyNodeClass: "is-empty with-slash",
      }),
      Mention,
      Emoji.configure({
        emojis: gitHubEmojis.filter(
          (emoji) => !emoji.name.includes("regional"),
        ),
        forceFallbackImages: true,
      }),
      TableKit.configure({
        table: {
          resizable: true,
          cellMinWidth: 120,
        },
      }),
      NodeBackground.configure({
        types: [
          "paragraph",
          "heading",
          "blockquote",
          "taskList",
          "bulletList",
          "orderedList",
          "tableCell",
          "tableHeader",
          "tocNode",
        ],
      }),
      NodeAlignment,
      TextStyle,
      Superscript,
      Subscript,
      Indent,
      Color,
      TaskList,
      TaskItem.configure({ nested: true }),
      Highlight.configure({ multicolor: true }),
      Selection,
      Image,
      TableOfContents.configure({
        getIndex: getHierarchicalIndexes,
        onUpdate(content) {
          setTocContent(content);
        },
      }),
      TableHandleExtension,
      ListNormalizationExtension,
      ImageUploadNode.configure({
        accept: "image/*",
        maxSize: MAX_FILE_SIZE,
        limit: 3,
        upload: handleImageUpload,
        onError: (error) => console.error("Upload failed:", error),
      }),
      UniqueID.configure({
        types: [
          "table",
          "paragraph",
          "bulletList",
          "orderedList",
          "taskList",
          "heading",
          "blockquote",
          "codeBlock",
          "tocNode",
          "inlineMath",
          "blockMath",
        ],
        filterTransaction: (transaction) => !isChangeOrigin(transaction),
      }),
      Typography,
      UiState,
      TocNode.configure({
        topOffset: 48,
      }),
      Ai,
      Excalidraw,
      LatexInline,
      LatexBlock,
    ],
  });

  useEffect(() => {
    placeholderRef.current = placeholder;
    if (editor)
      editor.view.dispatch(editor.state.tr.setMeta("i18n.locale", locale));
  }, [editor, placeholder, locale]);

  if (!editor) {
    return <LoadingSpinner />;
  }

  return (
    <div className="notion-like-editor-wrapper">
      <EditorContext.Provider value={{ editor }}>
        <div className="notion-like-editor-layout">
          <EditorContentArea />
          <TocSidebar topOffset={48} />
        </div>

        <TableExtendRowColumnButtons />
        <TableHandle />
        <TableSelectionOverlay
          showResizeHandles={true}
          cellMenu={(props) => (
            <TableCellHandleMenu
              editor={props.editor}
              onMouseDown={(e) => props.onResizeStart?.("br")(e)}
            />
          )}
        />
      </EditorContext.Provider>
    </div>
  );
}

/**
 * Full editor with all necessary providers, ready to use with just a placeholder
 */
export function NotionEditor({
  placeholder,
  onContentChange,
  getInitialContent,
}: NotionEditorProps) {
  return (
    <TocProvider>
      <EditorProvider
        placeholder={placeholder}
        onContentChange={onContentChange}
        getInitialContent={getInitialContent}
      />
    </TocProvider>
  );
}
