// SPDX-License-Identifier: AGPL-3.0-only

import { Extension } from "@tiptap/core";
import type { Editor } from "@tiptap/core";
import { AllSelection, TextSelection } from "@tiptap/pm/state";
import { cellAround } from "@tiptap/pm/tables";

/**
 * Ctrl/Cmd+A walks out of the selection one level at a time instead of jumping
 * straight to the whole document:
 *
 * 1. the first press selects the current **block** — the paragraph, heading,
 *    code block or image caption that holds the caret, or the whole table cell
 *    when the caret sits in one;
 * 2. a second press selects the whole document.
 *
 * ProseMirror's default `Mod-a` (Tiptap's core keymap) is `selectAll`, so this
 * extension is registered with a high priority: it has to take the shortcut
 * before the core keymap, and before the image and table extensions' own
 * `Mod-a` handlers, which only know their own part of the same gesture.
 *
 * A multi-block selection cannot grow to "its block" — the next sensible step
 * is the document, so it goes straight to the second press.
 */
export function selectBlockOrAll(editor: Editor): boolean {
  const { state } = editor;
  const { selection } = state;

  // Everything is selected already: let the default (also `selectAll`) run.
  if (selection instanceof AllSelection) return false;

  // A node- or cell-selection is already a block-sized selection, and a gap
  // cursor is not in a block at all: the next step is the document.
  if (!(selection instanceof TextSelection)) return editor.commands.selectAll();

  // A table cell is one block, even when it holds several paragraphs. Only a
  // selection that stays inside one cell grows to the cell; one that leaves it
  // has already grown past the block level.
  const cell = cellAround(selection.$from);
  if (cell && cellAround(selection.$to)?.pos === cell.pos) {
    const cellNode = state.doc.nodeAt(cell.pos);
    if (!cellNode) return editor.commands.selectAll();
    return growSelection(
      editor,
      cell.pos + 1,
      cell.pos + cellNode.nodeSize - 1,
    );
  }

  if (selection.$from.parent !== selection.$to.parent) {
    return editor.commands.selectAll();
  }

  const { $from } = selection;
  if (!$from.parent.isTextblock) return editor.commands.selectAll();

  return growSelection(editor, $from.start(), $from.end());
}

/**
 * Selects `from…to` when it still lies inside one block; a second identical
 * press means the block is already selected, so the document follows.
 */
function growSelection(editor: Editor, from: number, to: number): boolean {
  const { state } = editor;
  if (from >= to) return editor.commands.selectAll();

  // `between` resolves the block's boundary positions to the nearest inline
  // position (a table cell's start is before its first paragraph), where
  // `TextSelection.create` would warn about a non-inline endpoint.
  const next = TextSelection.between(
    state.doc.resolve(from),
    state.doc.resolve(to),
    1,
  );
  if (!next) return editor.commands.selectAll();

  if (state.selection.eq(next)) return editor.commands.selectAll();

  return editor.commands.setTextSelection({ from: next.from, to: next.to });
}

export const SelectBlockOrAll = Extension.create({
  name: "selectBlockOrAll",

  priority: 1000,

  addKeyboardShortcuts() {
    return {
      "Mod-a": () => selectBlockOrAll(this.editor),
    };
  },
});
