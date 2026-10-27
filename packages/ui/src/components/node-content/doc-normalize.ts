// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Shape compatibility helpers for node `content`.
 *
 * Pure functions: no React, no store, no writes. They only translate what a
 * record already holds into the shape the editors consume, so callers stay
 * tolerant of older records.
 *
 * This file used to carry `normalizeNotes` too. The media readers moved to
 * `packages/ui/src/components/media-player/types.ts` with the rest of the
 * timestamp vocabulary: they normalise a media node's `content`, not a rich-text
 * document, and they are pure functions worth testing, which is why they live
 * next to their tests and their consumers (`node --test` cannot follow a
 * runtime import across a directory the way `tsc` can).
 */

/** A Tiptap JSON document — the shape `text` and `rich-text` docs both want. */
export interface NormalizedDoc {
  type: "doc";
  content: unknown[];
}

/** Wrap plain text into the one-paragraph Tiptap document. */
function paragraphDoc(text: string): NormalizedDoc {
  return {
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text }] }],
  };
}

/**
 * Normalize a `docs` value into a Tiptap document.
 *
 * This is **lazy upgrade**: reading never writes to the database. A record that
 * still holds the old `text` shape (`{ content: "字符串" }`) or a bare string is
 * translated here, and the first edit through the node's writer persists the new
 * `{ type: "doc", content: [...] }` shape. No one-off migration script exists.
 *
 * M3 consumes this and may extend the target shape **in this file** as the
 * single-block editor needs more (`node-content-ui.md` §M3.2-1).
 *
 * Rules, in priority order:
 * 1. a non-empty string → one paragraph (an empty string → an empty document);
 * 2. an object with `type === "doc"` → itself (`content` defaults to `[]`);
 * 3. an object whose `content` is a non-empty string → one paragraph (the old
 *    shape); an empty one → an empty document;
 * 4. an object whose `content` is an array → `{ type: "doc", content }`;
 * 5. anything else (`undefined` / `null` / empty string / unrecognized) → an
 *    empty document.
 */
export function normalizeDoc(value: unknown): NormalizedDoc {
  if (typeof value === "string") {
    return value.length > 0
      ? paragraphDoc(value)
      : { type: "doc", content: [] };
  }

  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;

    if (record.type === "doc") {
      return {
        type: "doc",
        content: Array.isArray(record.content) ? record.content : [],
      };
    }

    if (typeof record.content === "string") {
      // An empty string is a real legacy shape (`text-node-content.tsx` wrote
      // `{ content: textareaValue }`), and it must NOT become a paragraph with
      // an empty text node: ProseMirror's `schema.text("")` throws
      // "Empty text nodes are not allowed", so the document has to stay empty.
      return record.content.length > 0
        ? paragraphDoc(record.content)
        : { type: "doc", content: [] };
    }

    if (Array.isArray(record.content)) {
      return { type: "doc", content: record.content };
    }
  }

  return { type: "doc", content: [] };
}
