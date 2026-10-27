// SPDX-License-Identifier: AGPL-3.0-only

"use client";
import { translate } from "@workspace/ui/lib/i18n/runtime";

import { useI18n } from "@workspace/ui/lib/i18n";

/**
 * The restricted **one-block** Tiptap editor behind a `text` node
 * (`docs/node-content/README.md` §1.1, plan `docs/plan/node-content-ui.md` M3).
 *
 * A `text` node is a single centered paragraph of rich text — a 禅意 block for a
 * quote, theorem or formula. Three layers keep it at one block, in descending
 * order of authority:
 *
 * 1. **The schema.** {@link SingleBlockDocument} declares `content: "paragraph"`,
 *    which is stricter than ProseMirror's default `block+`. Schema rejection is
 *    the only layer that also covers IME composition and drop/paste.
 * 2. **`transformPasted`** flattens a multi-block paste into one paragraph, so
 *    the schema never has to reject a whole paste (it would keep only the first
 *    block and silently drop the rest).
 * 3. **`handleKeyDown`** swallows `Enter` so no second paragraph is ever asked
 *    for — a look-and-feel guard, not a data-integrity one.
 *
 * `Esc` is deliberately **not** handled: it belongs to the surrounding Dialog.
 * There is no Yjs collaboration here, so `undoRedo` (disabled in the Notion
 * template because the collaboration extension owns history) stays on.
 *
 * **The block is one paragraph, not one capability.** Rich text inside that
 * paragraph is the same as inside a `rich-text` paragraph — the same inline marks,
 * the same link / colour controls, the same inline formula — which is why
 * {@link createSingleBlockExtensions} registers the inline half of the Notion
 * template's extension set and `single-block-toolbar.tsx` assembles the same
 * `tiptap-ui` controls into a selection bubble (design §1.1 「整块内容是一个居中的、
 * 字号明显大于正文的富文本块」). What stays out is what a single paragraph cannot
 * hold: headings / lists / quotes / tables / images / emoji / mentions / block
 * formulas, the slash menu, the drag handle, AI and comments.
 *
 * The container styles (centering, type scale, whitespace) belong to the
 * **consumer** (`packages/ui`), per plan §M3.2-3: `packages/editor` is not in the
 * Tailwind `@source` list, so only structure and SCSS live here.
 */
import { Node as TiptapNode } from "@tiptap/core";
import type { Extensions, JSONContent } from "@tiptap/core";
import { EditorContent, useEditor } from "@tiptap/react";
import { StarterKit } from "@tiptap/starter-kit";
import { Placeholder } from "@tiptap/extensions";
import { Highlight } from "@tiptap/extension-highlight";
import { Subscript } from "@tiptap/extension-subscript";
import { Superscript } from "@tiptap/extension-superscript";
import { TextAlign } from "@tiptap/extension-text-align";
import { Color, TextStyle } from "@tiptap/extension-text-style";
import { Typography } from "@tiptap/extension-typography";
import { Fragment, Slice } from "@tiptap/pm/model";
import type { EditorView } from "@tiptap/pm/view";
import katex from "katex";
import { useEffect, useMemo, useRef, useState } from "react";
import { LatexInline } from "@workspace/editor/components/tiptap-node/latex-node";
import { cn } from "@workspace/editor/lib/tiptap-utils";
import { SingleBlockToolbar } from "./single-block-toolbar";
import "./single-block-editor.scss";

/**
 * The document node: exactly one paragraph, no `block+` escape hatch.
 *
 * Hand-written rather than `Document.extend(...)` because `@tiptap/extension-document`
 * is only a transitive dependency of `@tiptap/starter-kit` and is therefore not
 * resolvable from this package; this is the same `Node.create` body that package
 * uses (`name: "doc"`, `topNode: true`) with a tighter `content`.
 */
const SingleBlockDocument = TiptapNode.create({
  name: "doc",
  topNode: true,
  content: "paragraph",
});

/**
 * `LatexInline` with the formula **baked into the HTML**.
 *
 * `generateHTML` never mounts React node views, so the editable extension's own
 * `renderHTML` — an empty `span[data-type="latexInline"]` that only the node view
 * fills — would render an invisible formula in a read-only surface. KaTeX renders
 * it at generation time instead. This adds no environment requirement:
 * `generateHTML` is already DOM-bound (`@tiptap/core`'s `getHTMLFromFragment` uses
 * `document.implementation`).
 */
const StaticLatexInline = LatexInline.extend({
  renderHTML({ node }) {
    const latex = String(node.attrs.text ?? "");
    const span = document.createElement("span");
    span.className = "single-block-latex";
    span.setAttribute("data-latex", latex);
    // KaTeX escapes what it emits; `throwOnError: false` draws invalid TeX in red
    // instead of throwing in the middle of a render.
    span.innerHTML = katex.renderToString(latex, { throwOnError: false });
    return span;
  },
});

export interface SingleBlockExtensionOptions {
  /** Placeholder text; omit it and no `Placeholder` decoration is registered. */
  placeholder?: string | (() => string);
  /**
   * Static rendering (`SingleBlockRenderer`): node views cannot run, so the
   * formula is baked to HTML ({@link StaticLatexInline}) instead of mounted.
   */
  static?: boolean;
}

/**
 * The one extension set both the editor and the read-only renderer use.
 *
 * Taste is fixed here on purpose: only inline marks and inline nodes survive
 * (bold / italic / underline / strike / code / link from `StarterKit`, plus text
 * colour, highlight, superscript, subscript, typography and the inline formula),
 * every block-level node is off, `hardBreak` is off (soft wrapping is the
 * consumer's `white-space`), and `document` is replaced by
 * {@link SingleBlockDocument}.
 *
 * The inline half mirrors the Notion template's set (`notion-like-editor.tsx`
 * `:279-320`) one-for-one where the schema allows it — so a `text` block's `docs`
 * stays a legal **subset** of a `rich-text` document (design §0.2-1) and the two
 * editors offer the same affordances for the text they both hold. `latexBlock` is
 * the one exclusion: it is a `group: "block"` node, and this document is one
 * paragraph.
 */
export function createSingleBlockExtensions(
  options: SingleBlockExtensionOptions = {},
): Extensions {
  const { placeholder, static: isStatic = false } = options;

  const extensions: Extensions = [
    StarterKit.configure({
      document: false,
      blockquote: false,
      bulletList: false,
      codeBlock: false,
      dropcursor: false,
      gapcursor: false,
      hardBreak: false,
      heading: false,
      horizontalRule: false,
      listItem: false,
      listKeymap: false,
      orderedList: false,
      trailingNode: false,
      link: { openOnClick: false },
    }),
    SingleBlockDocument,
    TextAlign.configure({ types: ["paragraph"] }),
    // --- inline capability, shared with rich-text ---
    TextStyle,
    Color,
    Highlight.configure({ multicolor: true }),
    Superscript,
    Subscript,
    Typography,
    isStatic ? StaticLatexInline : LatexInline,
  ];

  if (placeholder !== undefined) {
    extensions.push(
      Placeholder.configure({ placeholder, emptyNodeClass: "is-empty" }),
    );
  }

  return extensions;
}

/**
 * A stored `docs` value → the `content` option `useEditor` accepts.
 *
 * {@link SingleBlockDocument} rejects `{ type: "doc", content: [] }`, so an empty
 * (or unrecognized) stored value must become `undefined` — that is what makes
 * Tiptap build its own default empty document.
 */
export function toSingleBlockContent(value: unknown): JSONContent | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as { type?: unknown; content?: unknown };
  if (record.type !== "doc") return undefined;
  if (!Array.isArray(record.content) || record.content.length === 0) {
    return undefined;
  }
  return value as JSONContent;
}

/** True for the IME "confirm" `Enter`, which must reach the composition. */
function isComposingEnter(event: KeyboardEvent): boolean {
  return event.isComposing || event.keyCode === 229;
}

/**
 * Collapse a multi-block paste into one paragraph.
 *
 * Marks are dropped **only** on this path: a paste that fits the schema (a single
 * paragraph, or an inline fragment) passes through untouched, so bold/italic
 * survive a normal paste. Blocks are joined with `\n` inside one text node, which
 * the SCSS renders through `white-space: pre-wrap` — the design's "压平成一段（不落
 * `hardBreak`）".
 */
function flattenPastedSlice(slice: Slice, view: EditorView): Slice {
  const blocks = slice.content.content;
  if (blocks.length <= 1) return slice;

  const paragraphType = view.state.schema.nodes.paragraph;
  if (!paragraphType) return slice;

  const text = blocks
    .map((block) => block.textContent)
    .filter((part) => part.length > 0)
    .join("\n");

  return new Slice(
    Fragment.from(
      paragraphType.create(
        null,
        text.length > 0 ? view.state.schema.text(text) : null,
      ),
    ),
    0,
    0,
  );
}

export interface SingleBlockEditorProps {
  /**
   * The stored document, normally `normalizeDoc(node.content.docs)`. It seeds the
   * editor once — the editor is uncontrolled afterwards, and the caller persists
   * through {@link SingleBlockEditorProps.onContentChange}.
   */
  initialContent?: unknown;
  /** Called with the whole document after every change. */
  onContentChange?: (doc: JSONContent) => void;
  placeholder?: string;
  /** Applied to the element that wraps `EditorContent`; the caller sizes it. */
  className?: string;
}

/**
 * The single-block editor. Uncontrolled by design: it takes the stored document
 * once (the caller remounts it with `key` when the node changes) and reports every
 * new document through `onContentChange`.
 *
 * The selection bubble ({@link SingleBlockToolbar}) is a child of `EditorContent`,
 * exactly like the Notion template's floating toolbar: it has to live inside the
 * editor wrapper for `isElementWithinEditor` to treat clicks on it as "inside the
 * editor" (they must not dismiss it).
 */
export function SingleBlockEditor({
  initialContent,
  onContentChange,
  placeholder = translate("写下这句话…"),
  className,
}: SingleBlockEditorProps) {
  const { locale } = useI18n();
  const placeholderRef = useRef(placeholder);

  // Lazy `useState`, not `useRef`: the seed has to be read once, and reading a ref
  // during render is what `react-hooks/refs` forbids.
  const [initialDoc] = useState(() => toSingleBlockContent(initialContent));
  const changeHandler = useRef(onContentChange);
  useEffect(() => {
    changeHandler.current = onContentChange;
  }, [onContentChange]);

  const extensions = useMemo(
    () =>
      createSingleBlockExtensions({
        placeholder: () => placeholderRef.current,
      }),
    [],
  );

  const editor = useEditor(
    {
      immediatelyRender: false,
      // `null` (not `undefined`) is Tiptap's "no content" value; it builds the
      // default empty document.
      content: initialDoc ?? null,
      editorProps: {
        attributes: { class: "single-block-editor" },
        handleKeyDown: (_view, event) => {
          if (event.key !== "Enter") return false;
          if (isComposingEnter(event)) return false;
          // Enter / Shift-Enter / Mod-Enter all stay inside the one block.
          return true;
        },
        transformPasted: (slice, view) => flattenPastedSlice(slice, view),
      },
      onUpdate: ({ editor: instance }) => {
        changeHandler.current?.(instance.getJSON());
      },
      extensions,
    },
    [],
  );

  useEffect(() => {
    placeholderRef.current = placeholder;
    if (editor)
      editor.view.dispatch(editor.state.tr.setMeta("i18n.locale", locale));
  }, [editor, placeholder, locale]);

  if (!editor) {
    return (
      <div className={cn("flex flex-col", className)} aria-hidden="true" />
    );
  }

  return (
    <div className={cn("flex flex-col", className)}>
      <EditorContent editor={editor} className="single-block-editor-content">
        <SingleBlockToolbar editor={editor} />
      </EditorContent>
    </div>
  );
}
