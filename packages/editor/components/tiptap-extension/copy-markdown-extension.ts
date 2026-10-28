// SPDX-License-Identifier: AGPL-3.0-only

import { Extension } from "@tiptap/core";
import type { Editor, JSONContent } from "@tiptap/core";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import type { EditorState } from "@tiptap/pm/state";

/**
 * Copying from the rich-text body puts **Markdown** on the clipboard
 * (`text/plain`) instead of ProseMirror's flattened plain text:
 *
 * - bold, italic, strike, code, links and headings keep their Markdown syntax;
 * - lists, quotes, code blocks, tables and inline formulas are serialised by
 *   the same `@tiptap/markdown` manager that parses a Markdown paste, so a copy
 *   and a paste round-trip through one implementation;
 * - nodes that have no useful text representation are left blank. Images are
 *   the visible case: copying must not emit `![alt](src)`.
 *
 * Only the plain-text flavour changes. The HTML flavour is still ProseMirror's
 * own rich serialisation, so pasting into a word processor keeps the styling.
 */
export const BLANK_COPY_NODE_TYPES = new Set([
  "image",
  "imageUpload",
  "excalidraw",
  "tocNode",
]);

/**
 * Drops the nodes that must not appear in copied Markdown. A block left with
 * no content because everything inside it was dropped (for example a paragraph
 * holding only an image) is dropped too, so it does not leave an empty line.
 */
export function filterBlankCopyNodes(nodes: JSONContent[]): JSONContent[] {
  return nodes
    .map(stripBlankNode)
    .filter((node): node is JSONContent => node !== null);
}

function stripBlankNode(node: JSONContent): JSONContent | null {
  if (node.type && BLANK_COPY_NODE_TYPES.has(node.type)) return null;
  if (!Array.isArray(node.content)) return node;

  const content = filterBlankCopyNodes(node.content);
  if (content.length === 0 && node.content.length > 0) return null;

  return content.length === node.content.length ? node : { ...node, content };
}

/**
 * Serialises the current selection as Markdown. Returns `""` when there is
 * nothing to serialise (or when the editor has no Markdown manager); the
 * clipboard then falls back to ProseMirror's plain text.
 */
export function serializeSelectionAsMarkdown(editor: Editor): string {
  const markdown = editor.markdown;
  if (!markdown) return "";

  const { selection } = editor.state;
  const ranges = selection.ranges;
  const from = Math.min(...ranges.map((range) => range.$from.pos));
  const to = Math.max(...ranges.map((range) => range.$to.pos));
  if (from === to) return "";

  const content = selectionContent(editor.state, from, to);
  if (!content) return "";

  try {
    const filtered = filterBlankCopyNodes(content as JSONContent[]);
    if (filtered.length === 0) return "";
    // The manager serialises whole blocks; block boundaries already carry the
    // separators, so a trailing one would just add a blank line to the paste.
    return markdown
      .serialize({ type: "doc", content: filtered })
      .replace(/\n+$/, "");
  } catch (error) {
    // Copy must never fail: an unrenderable document falls back to plain text.
    console.warn("[CopyMarkdown] falling back to plain text", error);
    return "";
  }
}

/**
 * The selected JSON, ready for the Markdown manager.
 *
 * A selection that stays inside one text block is serialised as its **inline**
 * content only: copying a phrase out of a list item must not gain a `- ` prefix
 * (and copying a fragment of a heading must not gain `#`). A selection that
 * covers whole blocks keeps the block structure, so copying a list or a set of
 * headings still produces that Markdown.
 */
function selectionContent(
  state: EditorState,
  from: number,
  to: number,
): JSONContent[] | null {
  const { selection } = state;

  if (
    selection instanceof TextSelection &&
    selection.$from.parent === selection.$to.parent &&
    selection.$from.parent.isTextblock &&
    (selection.from !== selection.$from.start() ||
      selection.to !== selection.$from.end())
  ) {
    const inline = selection.$from.parent.content
      .cut(selection.$from.parentOffset, selection.$to.parentOffset)
      .toJSON();
    return (inline as JSONContent[] | null) ?? null;
  }

  return state.doc.cut(from, to).content.toJSON() as JSONContent[] | null;
}

export const CopyMarkdown = Extension.create({
  name: "copyMarkdown",

  addProseMirrorPlugins() {
    const { editor } = this;

    return [
      new Plugin({
        key: new PluginKey("copyMarkdown"),
        props: {
          clipboardTextSerializer: () => serializeSelectionAsMarkdown(editor),
        },
      }),
    ];
  },
});
