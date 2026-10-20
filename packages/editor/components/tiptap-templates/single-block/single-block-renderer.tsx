// SPDX-License-Identifier: AGPL-3.0-only

"use client";

/**
 * Read-only rendering of a `text` node's single block — the same schema as
 * {@link SingleBlockEditor}, without an editor instance.
 *
 * `generateHTML(doc, extensions)` is `@tiptap/core`'s own static renderer
 * (`dist/index.d.ts:1986`); the plan deliberately does **not** add
 * `@tiptap/static-renderer`, which is not installed anywhere in this repository
 * (plan §M3.2-4). Sharing {@link createSingleBlockExtensions} is what keeps the
 * read-only output and the editable output from drifting apart.
 *
 * The consumer owns the box (centering, type scale), exactly like the editor: the
 * caller passes those as Tailwind classes (plan §M3.2-3).
 */
import { generateHTML } from "@tiptap/core";
import type { JSONContent } from "@tiptap/core";
import { useMemo } from "react";
import { cn } from "../../../lib/tiptap-utils";
import {
  createSingleBlockExtensions,
  toSingleBlockContent,
} from "./single-block-editor";
import "./single-block-editor.scss";

export interface SingleBlockRendererProps {
  /** The stored document (`normalizeDoc(node.content.docs)`); unknown shapes render empty. */
  doc?: unknown;
  /** Applied to the block; the caller sets the type scale and the whitespace. */
  className?: string;
}

/**
 * Renders the document to static HTML. No editor, no store, no writes — so it is
 * safe in the hover preview and in any other read-only surface.
 */
export function SingleBlockRenderer({ doc, className }: SingleBlockRendererProps) {
  const html = useMemo(() => {
    const content: JSONContent = toSingleBlockContent(doc) ?? {
      type: "doc",
      content: [{ type: "paragraph" }],
    };
    // `static: true` swaps the formula node view for KaTeX HTML — `generateHTML`
    // cannot mount node views, and the editable `latexInline` renders an empty
    // span that only its node view fills.
    return generateHTML(content, createSingleBlockExtensions({ static: true }));
  }, [doc]);

  return (
    <div
      className={cn("single-block-renderer", className)}
      // `generateHTML` output comes from this repository's own schema: no raw HTML
      // nodes are registered, so every tag it can emit is one this file declares.
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
