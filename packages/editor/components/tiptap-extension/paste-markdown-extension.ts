// SPDX-License-Identifier: AGPL-3.0-only

import { Extension } from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";

import {
  normalizePastedMarkdown,
  protectLoneTildes,
  repairEmphasisBoundaries,
} from "@workspace/editor/components/tiptap-extension/markdown-paste-normalizer";

export const PasteMarkdown = Extension.create({
  name: "pasteMarkdown",

  addProseMirrorPlugins() {
    const { editor } = this;
    return [
      new Plugin({
        props: {
          handlePaste(view, event) {
            const text = event.clipboardData?.getData("text/plain");

            if (!text) {
              return false;
            }

            if (editor.markdown) {
              try {
                // Parse the Markdown text to Tiptap JSON using the Markdown
                // manager. Full-width punctuation is repaired first so a bold
                // run followed by `和` keeps `和` plain, the tilde protection
                // keeps a lone `~` literal (GFM only strikes through
                // `~~text~~`), and the normaliser restores both sentinels and
                // collapses duplicate marks — the combination that otherwise
                // makes `insertContent` throw and drops the paste.
                const doc = normalizePastedMarkdown(
                  editor.markdown.parse(
                    protectLoneTildes(repairEmphasisBoundaries(text)),
                  ),
                );

                // Insert the parsed JSON content at cursor position
                editor.commands.insertContent(doc);
                return true;
              } catch (error) {
                // A document ProseMirror still rejects must not swallow the
                // paste: returning false hands it back to the browser, which
                // inserts the plain text.
                console.warn("[PasteMarkdown] falling back to plain text", error);
                return false;
              }
            }

            return false;
          },
        },
      }),
    ];
  },
});
