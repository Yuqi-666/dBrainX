// SPDX-License-Identifier: AGPL-3.0-only

import { InputRule, Node } from "@tiptap/core";
import type { NodeViewProps } from "@tiptap/react";
import { ReactNodeViewRenderer } from "@tiptap/react";
import LatexInlineView from "./latex-inline";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    mathInline: {
      setLatexInline: (attributes?: { text: string }) => ReturnType;
    };
  }
}

export interface LatexInlineOption {
  HTMLAttributes: Record<string, unknown>;
  view: React.ComponentType<NodeViewProps> | null;
}

// 匹配 "$ " 或者 "\( "
const inputRegex = /(\$|\\\()\s$/;

export const LatexInline = Node.create<LatexInlineOption>({
  name: "latexInline",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,

  addOptions() {
    return {
      HTMLAttributes: {},
      view: null,
    };
  },

  addAttributes() {
    return {
      text: {
        default: "",
        parseHTML: (element) => element.getAttribute("data-latex") || "",
        renderHTML: (attributes) => ({
          "data-latex": attributes.text,
        }),
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: `span[data-type="${this.name}"]`,
      },
    ];
  },

  renderHTML({ HTMLAttributes, node }) {
    return [
      "span",
      {
        "data-type": this.name,
        "data-latex": node.attrs.text,
        ...HTMLAttributes,
      },
      "",
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(LatexInlineView);
  },

  addCommands() {
    return {
      setLatexInline:
        (attributes) =>
        ({ commands }) => {
          return commands.insertContent({
            type: this.name,
            attrs: attributes || { text: "" },
          });
        },
    };
  },

  addInputRules() {
    return [
      new InputRule({
        find: inputRegex,
        handler: ({ range, chain }) => {
          chain()
            .focus()
            .deleteRange(range)
            .setLatexInline()
            .setNodeSelection(range.from)
            .run();
        },
      }),
    ];
  },

  markdownTokenizer: {
    name: "latexInline",
    level: "inline",
    start: (src) => {
      // 1. 查找有效单 $ (过滤掉 $$)
      let validDollarIndex = -1;
      let idx = src.indexOf("$");
      while (idx !== -1) {
        if (src[idx + 1] !== "$") {
          validDollarIndex = idx;
          break;
        }
        idx = src.indexOf("$", idx + 2);
      }

      // 2. 查找 \(
      const parenIndex = src.indexOf("\\(");

      if (validDollarIndex === -1 && parenIndex === -1) return -1;
      if (validDollarIndex === -1) return parenIndex;
      if (parenIndex === -1) return validDollarIndex;

      // 返回两者中较靠前的位置
      return Math.min(validDollarIndex, parenIndex);
    },
    tokenize: (src) => {
      if (src.startsWith("$$")) {
        return undefined; // 遇到 $$ 退出，让 block 去处理
      }
      // 捕获 $...$ 或 \(...\) 内部的文本
      const match = /^(?:\$([^$]+)\$|\\\(([\s\S]+?)\\\))/.exec(src);
      if (!match) {
        return undefined;
      }
      return {
        type: "latexInline",
        raw: match[0],
        text: match[1] || match[2] || "",
      };
    },
  },

  parseMarkdown: (token) => {
    return {
      type: "latexInline",
      attrs: {
        text: token.text || "",
      },
    };
  },

  renderMarkdown: (node) => {
    const text = node.attrs?.text || "";
    return `$${text}$`; // 序列化时统一还原为单 $ 格式
  },
});
