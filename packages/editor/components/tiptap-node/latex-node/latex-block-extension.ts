// SPDX-License-Identifier: AGPL-3.0-only

import { InputRule, Node } from "@tiptap/core";
import type { NodeViewProps } from "@tiptap/react";
import { ReactNodeViewRenderer } from "@tiptap/react";
import LatexBlockView from "./latex-block";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    mathBlock: {
      setLatexBlock: (attributes?: { text: string }) => ReturnType;
    };
  }
}

export interface LatexBlockOptions {
  HTMLAttributes: Record<string, unknown>;
  view: React.ComponentType<NodeViewProps> | null;
}

// 匹配 "$$ " 或者 "\[ "
const inputRegex = /(\$\$|\\\[)\s$/;

export const LatexBlock = Node.create<LatexBlockOptions>({
  name: "latexBlock",
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,

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
        tag: `div[data-type="${this.name}"]`,
      },
    ];
  },

  renderHTML({ HTMLAttributes, node }) {
    return [
      "div",
      {
        "data-type": this.name,
        "data-latex": node.attrs.text,
        ...HTMLAttributes,
      },
      "",
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(LatexBlockView);
  },

  addCommands() {
    return {
      setLatexBlock:
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
          chain().focus().deleteRange(range).setLatexBlock().run();
        },
      }),
    ];
  },

  markdownTokenizer: {
    name: "latexBlock",
    level: "block",
    start: (src) => {
      // 找到 $$ 或者 \[ 的起始位置
      const match = src.match(/\$\$|\\\[/);
      return match?.index ?? -1;
    },
    tokenize: (src) => {
      // 捕获 $$...$$ 或 \[...\] 内部的文本
      const match = /^(?:\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\])/.exec(src);
      if (!match) {
        return undefined;
      }
      return {
        type: "latexBlock",
        raw: match[0],
        text: (match[1] || match[2] || "").trim(),
      };
    },
  },

  parseMarkdown: (token) => {
    return {
      type: "latexBlock",
      attrs: {
        text: token.text || "",
      },
    };
  },

  renderMarkdown: (node) => {
    const text = node.attrs?.text || "";
    return `$$${text}$$\n\n`; // 序列化时统一还原为 $$ 格式
  },
});
