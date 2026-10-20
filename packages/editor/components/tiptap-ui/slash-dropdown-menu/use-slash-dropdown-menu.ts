// SPDX-License-Identifier: AGPL-3.0-only

"use client";
import { translate } from "@workspace/ui/lib/i18n/runtime";
import { useI18n } from "@workspace/ui/lib/i18n";

import { useCallback } from "react";
import type { Editor } from "@tiptap/react";
import type { Range } from "@tiptap/core";

// --- Icons ---
import { CodeBlockIcon } from "@workspace/editor/components/tiptap-icons/code-block-icon";
import { HeadingOneIcon } from "@workspace/editor/components/tiptap-icons/heading-one-icon";
import { HeadingTwoIcon } from "@workspace/editor/components/tiptap-icons/heading-two-icon";
import { HeadingThreeIcon } from "@workspace/editor/components/tiptap-icons/heading-three-icon";
import { ImageIcon } from "@workspace/editor/components/tiptap-icons/image-icon";
import { ListIcon } from "@workspace/editor/components/tiptap-icons/list-icon";
import { ListOrderedIcon } from "@workspace/editor/components/tiptap-icons/list-ordered-icon";
import { BlockquoteIcon } from "@workspace/editor/components/tiptap-icons/blockquote-icon";
import { ListTodoIcon } from "@workspace/editor/components/tiptap-icons/list-todo-icon";
import { AiSparklesIcon } from "@workspace/editor/components/tiptap-icons/ai-sparkles-icon";
import { MinusIcon } from "@workspace/editor/components/tiptap-icons/minus-icon";
import { TypeIcon } from "@workspace/editor/components/tiptap-icons/type-icon";
import { AtSignIcon } from "@workspace/editor/components/tiptap-icons/at-sign-icon";
import { SmilePlusIcon } from "@workspace/editor/components/tiptap-icons/smile-plus-icon";
import { TableIcon } from "@workspace/editor/components/tiptap-icons/table-icon";
import { ListIndentedIcon } from "@workspace/editor/components/tiptap-icons/list-indented-icon";
import IconExcalidraw from "../../tiptap-icons/excalidraw";
import { Sigma } from "lucide-react";

// --- Lib ---
import {
  isExtensionAvailable,
  isNodeInSchema,
} from "@workspace/editor/lib/tiptap-utils";
import {
  findSelectionPosition,
  hasContentAbove,
} from "@workspace/editor/lib/tiptap-advanced-utils";

// --- Tiptap UI ---
import type { SuggestionItem } from "@workspace/editor/components/tiptap-ui-utils/suggestion-menu";
import { addEmojiTrigger } from "@workspace/editor/components/tiptap-ui/emoji-trigger-button";
import { addMentionTrigger } from "@workspace/editor/components/tiptap-ui/mention-trigger-button";

export interface SlashMenuConfig {
  enabledItems?: SlashMenuItemType[];
  customItems?: SuggestionItem[];
  itemGroups?: {
    [key in SlashMenuItemType]?: string;
  };
  showGroups?: boolean;
}

const texts = {
  // AI
  continue_writing: {
    get title() {
      return translate("Continue Writing");
    },
    subtext: "Continue writing from the current position",
    keywords: ["continue", "write", "continue writing", "ai"],
    badge: AiSparklesIcon,
    group: "AI",
  },
  ai_ask_button: {
    get title() {
      return translate("Ask AI");
    },
    subtext: "Ask AI to generate content",
    keywords: ["ai", "ask", "generate"],
    badge: AiSparklesIcon,
    group: "AI",
  },

  // Style
  text: {
    get title() {
      return translate("Text");
    },
    subtext: "Regular text paragraph",
    keywords: ["p", "paragraph", "text"],
    badge: TypeIcon,
    group: "Style",
  },
  heading_1: {
    get title() {
      return translate("Heading 1");
    },
    subtext: "Top-level heading",
    keywords: ["h", "heading1", "h1"],
    badge: HeadingOneIcon,
    group: "Style",
  },
  heading_2: {
    get title() {
      return translate("Heading 2");
    },
    subtext: "Key section heading",
    keywords: ["h2", "heading2", "subheading"],
    badge: HeadingTwoIcon,
    group: "Style",
  },
  heading_3: {
    get title() {
      return translate("Heading 3");
    },
    subtext: "Subsection and group heading",
    keywords: ["h3", "heading3", "subheading"],
    badge: HeadingThreeIcon,
    group: "Style",
  },
  bullet_list: {
    get title() {
      return translate("Bullet List");
    },
    subtext: "List with unordered items",
    keywords: ["ul", "li", "list", "bulletlist", "bullet list"],
    badge: ListIcon,
    group: "Style",
  },
  ordered_list: {
    get title() {
      return translate("Numbered List");
    },
    subtext: "List with ordered items",
    keywords: ["ol", "li", "list", "numberedlist", "numbered list"],
    badge: ListOrderedIcon,
    group: "Style",
  },
  task_list: {
    get title() {
      return translate("To-do list");
    },
    subtext: "List with tasks",
    keywords: ["tasklist", "task list", "todo", "checklist"],
    badge: ListTodoIcon,
    group: "Style",
  },
  quote: {
    get title() {
      return translate("Blockquote");
    },
    subtext: "Blockquote block",
    keywords: ["quote", "blockquote"],
    badge: BlockquoteIcon,
    group: "Style",
  },
  code_block: {
    get title() {
      return translate("Code Block");
    },
    subtext: "Code block with syntax highlighting",
    keywords: ["code", "pre"],
    badge: CodeBlockIcon,
    group: "Style",
  },

  // Insert
  mention: {
    get title() {
      return translate("Mention");
    },
    subtext: "Mention a user or item",
    keywords: ["mention", "user", "item", "tag"],
    badge: AtSignIcon,
    group: "Insert",
  },
  emoji: {
    get title() {
      return translate("Emoji");
    },
    subtext: "Insert an emoji",
    keywords: ["emoji", "emoticon", "smiley"],
    badge: SmilePlusIcon,
    group: "Insert",
  },
  table: {
    get title() {
      return translate("Table");
    },
    subtext: "Insert a table",
    aliases: ["table", "insertTable"],
    badge: TableIcon,
    group: "Insert",
  },
  divider: {
    get title() {
      return translate("Separator");
    },
    subtext: "Horizontal line to separate content",
    keywords: ["hr", "horizontalRule", "line", "separator"],
    badge: MinusIcon,
    group: "Insert",
  },
  toc: {
    get title() {
      return translate("Table of contents");
    },
    subtext: "Insert a table of contents",
    keywords: ["toc", "tableofcontents", "table of contents"],
    badge: ListIndentedIcon,
    group: "Insert",
  },
  excalidraw: {
    get title() {
      return translate("Excalidraw diagram");
    },
    subtext: "Draw and sketch excalidraw diagrams",
    keywords: ["excalidraw", "diagrams", "draw", "sketch", "whiteboard"],
    badge: IconExcalidraw,
    group: "Insert",
  },
  inline_latex: {
    get title() {
      return translate("Inline LaTeX");
    },
    subtext: "Insert inline mathematical formula",
    keywords: ["latex", "math", "inline", "formula", "equation", "$"],
    badge: Sigma,
    group: "Insert",
  },
  block_latex: {
    get title() {
      return translate("Block LaTeX");
    },
    subtext: "Insert block-level mathematical formula",
    keywords: ["latex", "math", "block", "formula", "equation", "$$"],
    badge: Sigma,
    group: "Insert",
  },

  // Upload
  image: {
    get title() {
      return translate("Image");
    },
    subtext: "Resizable image with caption",
    keywords: [
      "image",
      "imageUpload",
      "upload",
      "img",
      "picture",
      "media",
      "url",
    ],
    badge: ImageIcon,
    group: "Upload",
  },
};

export type SlashMenuItemType = keyof typeof texts;

/**
 * Every slash item exposes the same shape. Implementations that do not need the
 * suggestion `range` simply accept the subset of props they use.
 */
type SlashItemImplementation = {
  check: (editor: Editor) => boolean;
  action: (props: { editor: Editor; range: Range }) => void;
};

const getItemImplementations = () => {
  return {
    // AI
    continue_writing: {
      check: (editor: Editor) => {
        const { hasContent } = hasContentAbove(editor);
        const extensionsReady = isExtensionAvailable(editor, [
          "ai",
          "aiAdvanced",
        ]);
        return extensionsReady && hasContent;
      },
      action: ({ editor }: { editor: Editor }) => {
        const editorChain = editor.chain().focus();

        const nodeSelectionPosition = findSelectionPosition({ editor });

        if (nodeSelectionPosition !== null) {
          editorChain.setNodeSelection(nodeSelectionPosition);
        }

        editorChain.run();

        editor.chain().focus().aiGenerationShow().run();

        requestAnimationFrame(() => {
          const { hasContent, content } = hasContentAbove(editor);

          const snippet =
            content.length > 500 ? `...${content.slice(-500)}` : content;

          const prompt = hasContent
            ? `Context: ${snippet}\n\nContinue writing from where the text above ends. Write ONLY ONE SENTENCE. DONT REPEAT THE TEXT.`
            : "Start writing a new paragraph. Write ONLY ONE SENTENCE.";

          editor
            .chain()
            .focus()
            .aiTextPrompt({
              stream: true,
              format: "rich-text",
              text: prompt,
            })
            .run();
        });
      },
    },
    ai_ask_button: {
      check: (editor: Editor) =>
        isExtensionAvailable(editor, ["ai", "aiAdvanced"]),
      action: ({ editor }: { editor: Editor }) => {
        const editorChain = editor.chain().focus();

        const nodeSelectionPosition = findSelectionPosition({ editor });

        if (nodeSelectionPosition !== null) {
          editorChain.setNodeSelection(nodeSelectionPosition);
        }

        editorChain.run();

        editor.chain().focus().aiGenerationShow().run();
      },
    },

    // Style
    text: {
      check: (editor: Editor) => isNodeInSchema("paragraph", editor),
      action: ({ editor }: { editor: Editor }) => {
        editor.chain().focus().setParagraph().run();
      },
    },
    heading_1: {
      check: (editor: Editor) => isNodeInSchema("heading", editor),
      action: ({ editor }: { editor: Editor }) => {
        editor.chain().focus().toggleHeading({ level: 1 }).run();
      },
    },
    heading_2: {
      check: (editor: Editor) => isNodeInSchema("heading", editor),
      action: ({ editor }: { editor: Editor }) => {
        editor.chain().focus().toggleHeading({ level: 2 }).run();
      },
    },
    heading_3: {
      check: (editor: Editor) => isNodeInSchema("heading", editor),
      action: ({ editor }: { editor: Editor }) => {
        editor.chain().focus().toggleHeading({ level: 3 }).run();
      },
    },
    bullet_list: {
      check: (editor: Editor) => isNodeInSchema("bulletList", editor),
      action: ({ editor }: { editor: Editor }) => {
        editor.chain().focus().toggleBulletList().run();
      },
    },
    ordered_list: {
      check: (editor: Editor) => isNodeInSchema("orderedList", editor),
      action: ({ editor }: { editor: Editor }) => {
        editor.chain().focus().toggleOrderedList().run();
      },
    },
    task_list: {
      check: (editor: Editor) => isNodeInSchema("taskList", editor),
      action: ({ editor }: { editor: Editor }) => {
        editor.chain().focus().toggleTaskList().run();
      },
    },
    quote: {
      check: (editor: Editor) => isNodeInSchema("blockquote", editor),
      action: ({ editor }: { editor: Editor }) => {
        editor.chain().focus().toggleBlockquote().run();
      },
    },
    code_block: {
      check: (editor: Editor) => isNodeInSchema("codeBlock", editor),
      action: ({ editor }: { editor: Editor }) => {
        editor.chain().focus().toggleNode("codeBlock", "paragraph").run();
      },
    },

    // Insert
    mention: {
      check: (editor: Editor) =>
        isExtensionAvailable(editor, ["mention", "mentionAdvanced"]),
      action: ({ editor }: { editor: Editor }) => addMentionTrigger(editor),
    },
    emoji: {
      check: (editor: Editor) =>
        isExtensionAvailable(editor, ["emoji", "emojiPicker"]),
      action: ({ editor }: { editor: Editor }) => addEmojiTrigger(editor),
    },
    divider: {
      check: (editor: Editor) => isNodeInSchema("horizontalRule", editor),
      action: ({ editor }: { editor: Editor }) => {
        editor.chain().focus().setHorizontalRule().run();
      },
    },
    toc: {
      check: (editor: Editor) => isNodeInSchema("tocNode", editor),
      action: ({ editor }: { editor: Editor }) => {
        editor.chain().focus().insertTocNode().run();
      },
    },
    table: {
      check: (editor: Editor) => isNodeInSchema("table", editor),
      action: ({ editor }: { editor: Editor }) => {
        editor
          .chain()
          .focus()
          .insertTable({
            rows: 3,
            cols: 3,
            withHeaderRow: false,
          })
          .run();
      },
    },

    excalidraw: {
      check: (editor: Editor) => isNodeInSchema("excalidraw", editor),
      action: ({ editor }: { editor: Editor }) => {
        editor.chain().focus().setExcalidraw().run();
      },
    },

    inline_latex: {
      check: (editor: Editor) => isNodeInSchema("latexInline", editor),
      action: ({ editor, range }: { editor: Editor; range: Range }) => {
        editor
          .chain()
          .focus()
          .deleteRange(range)
          .setLatexInline()
          .setNodeSelection(range.from)
          .run();
      },
    },
    block_latex: {
      check: (editor: Editor) => isNodeInSchema("latexBlock", editor),
      action: ({ editor, range }: { editor: Editor; range: Range }) => {
        editor.chain().focus().deleteRange(range).setLatexBlock().run();
      },
    },

    // Upload
    image: {
      check: (editor: Editor) => isNodeInSchema("image", editor),
      action: ({ editor }: { editor: Editor }) => {
        editor
          .chain()
          .focus()
          .insertContent({
            type: "imageUpload",
          })
          .run();
      },
    },
  };
};

function organizeItemsByGroups(
  items: SuggestionItem[],
  showGroups: boolean,
): SuggestionItem[] {
  if (!showGroups) {
    return items.map((item) => ({ ...item, group: "" }));
  }

  const groups: { [groupLabel: string]: SuggestionItem[] } = {};

  // Group items
  items.forEach((item) => {
    const groupLabel = item.group || "";
    if (!groups[groupLabel]) {
      groups[groupLabel] = [];
    }
    groups[groupLabel].push(item);
  });

  // Flatten groups in order (this maintains the visual order for keyboard navigation)
  const organizedItems: SuggestionItem[] = [];
  Object.entries(groups).forEach(([, groupItems]) => {
    organizedItems.push(...groupItems);
  });

  return organizedItems;
}

/**
 * Custom hook for slash dropdown menu functionality
 */
export function useSlashDropdownMenu(config?: SlashMenuConfig) {
  useI18n();

  const getSlashMenuItems = useCallback(
    (editor: Editor) => {
      const items: SuggestionItem[] = [];

      const enabledItems =
        config?.enabledItems || (Object.keys(texts) as SlashMenuItemType[]);
      const showGroups = config?.showGroups !== false;

      const itemImplementations = getItemImplementations();

      enabledItems.forEach((itemType) => {
        const itemImpl: SlashItemImplementation | undefined =
          itemImplementations[itemType];
        const itemText = texts[itemType];

        if (itemImpl && itemText && itemImpl.check(editor)) {
          const item: SuggestionItem = {
            onSelect: ({ editor, range }: { editor: Editor; range: Range }) =>
              itemImpl.action({ editor, range }),
            ...itemText,
          };

          if (config?.itemGroups?.[itemType]) {
            item.group = config.itemGroups[itemType];
          } else if (!showGroups) {
            item.group = "";
          }

          items.push(item);
        }
      });

      if (config?.customItems) {
        items.push(...config.customItems);
      }

      // Reorganize items by groups to ensure keyboard navigation works correctly
      return organizeItemsByGroups(items, showGroups);
    },
    [config],
  );

  return {
    getSlashMenuItems,
    config,
  };
}
