// SPDX-License-Identifier: AGPL-3.0-only

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

/**
 * Markdown paste into the Notion-like editor.
 *
 * Two upstream behaviours used to break an ordinary paste, and both are
 * normalised by `markdown-paste-normalizer.ts` before the JSON reaches the
 * editor:
 *
 * 1. `marked`'s GFM `del` tokenizer accepts a *single* tilde pair, so a range
 *    such as `0~9 … 10~15` became a strike mark running between the two tildes.
 *    GFM defines strikethrough as `~~text~~`, so a lone `~` must stay literal.
 * 2. Full-width punctuation defeats CommonMark's closing-delimiter rule, so
 *    `**（Decimal）**和**（Hexadecimal）**` came out as one `<strong>` wrapping
 *    `和` (with a nested second `<strong>`), which Tiptap maps to two `bold`
 *    marks on one text node. ProseMirror allows one mark per type, so
 *    `insertContent` threw
 *    `RangeError: Invalid collection of marks for node text: bold,bold`.
 *    `repairEmphasisBoundaries` pairs the runs and pads only the delimiters the
 *    flanking rules reject, so the paste keeps `和` plain.
 *
 * The end-to-end cases below run the real parser and the real editor; the
 * structural cases pin the normaliser itself, which is what has to keep holding
 * when either dependency is upgraded.
 */

const EDITOR_DIR = new URL("../../packages/editor/", import.meta.url);
const requireFromEditor = createRequire(new URL("package.json", EDITOR_DIR));

const NORMALIZER = fileURLToPath(
  new URL(
    "../../packages/editor/components/tiptap-extension/markdown-paste-normalizer.ts",
    import.meta.url,
  ),
);
const EXTENSION = fileURLToPath(
  new URL(
    "../../packages/editor/components/tiptap-extension/paste-markdown-extension.ts",
    import.meta.url,
  ),
);

const {
  protectLoneTildes,
  normalizePastedMarkdown,
  repairEmphasisBoundaries,
} = await import(pathToFileURL(NORMALIZER).href);

/** Imports a workspace package by the name `packages/editor` resolves. */
async function importFromEditor(name) {
  const entry = requireFromEditor.resolve(name);
  return import(pathToFileURL(entry).href);
}

const { Editor } = await importFromEditor("@tiptap/core");
const { StarterKit } = await importFromEditor("@tiptap/starter-kit");
const { Markdown } = await importFromEditor("@tiptap/markdown");

/** Runs the paste pipeline the extension runs, against a fresh editor. */
function pasteMarkdown(text) {
  const editor = new Editor({
    // Tiptap needs an object document here: without a DOM a string initial
    // content reaches `window` and throws.
    content: { type: "doc", content: [{ type: "paragraph" }] },
    extensions: [StarterKit, Markdown],
  });
  try {
    const doc = normalizePastedMarkdown(
      editor.markdown.parse(protectLoneTildes(repairEmphasisBoundaries(text))),
    );
    editor.commands.insertContent(doc);
    return editor.getJSON();
  } finally {
    editor.destroy();
  }
}

/** Every text node's marks, flattened. */
function textNodes(json) {
  const nodes = [];
  const visit = (node) => {
    if (node.type === "text") nodes.push(node);
    node.content?.forEach(visit);
  };
  visit(json);
  return nodes;
}

test("a lone tilde survives a Markdown paste as literal text", () => {
  assert.equal(
    protectLoneTildes("0~9, A, B, C, D, E, F (对应 10~15)"),
    "0\u0000dsh-lone-tilde\u00009, A, B, C, D, E, F (对应 10\u0000dsh-lone-tilde\u000015)",
  );
  // `~~text~~` is the one shape that must keep reaching the parser.
  assert.equal(protectLoneTildes("~~strike~~"), "~~strike~~");
  // A fence run is Markdown structure, not content.
  assert.equal(protectLoneTildes("~~~\ncode\n~~~"), "~~~\ncode\n~~~");

  const json = pasteMarkdown("0~9, A, B, C, D, E, F (对应 10~15)");
  const text = textNodes(json)
    .map((node) => node.text)
    .join("");
  assert.equal(text, "0~9, A, B, C, D, E, F (对应 10~15)");
  assert.ok(
    textNodes(json).every((node) => !node.marks?.some((m) => m.type === "strike")),
    "a lone tilde must not become a strike mark",
  );
});

test("a double tilde still becomes a strike mark", () => {
  const json = pasteMarkdown("~~strike~~ and ~literal~");
  const struck = textNodes(json).filter((node) =>
    node.marks?.some((mark) => mark.type === "strike"),
  );
  assert.equal(
    struck.map((node) => node.text).join(""),
    "strike",
    "only the ~~…~~ run is a strike",
  );
  assert.match(
    textNodes(json)
      .map((node) => node.text)
      .join(""),
    /~literal~/,
  );
});

test("full-width punctuation keeps a bold run separate from the next one", () => {
  const json = pasteMarkdown("**（Decimal）**和**（Hexadecimal）**");

  for (const node of textNodes(json)) {
    const types = (node.marks ?? []).map((mark) => mark.type);
    assert.equal(
      new Set(types).size,
      types.length,
      `text node ${JSON.stringify(node.text)} carries a duplicate mark: ${types.join(",")}`,
    );
  }
  const bold = textNodes(json)
    .filter((node) => node.marks?.some((mark) => mark.type === "bold"))
    .map((node) => node.text);
  // The reported failure was one outer strong across all three runs: `和` must
  // stay plain and each parenthesised label must be its own bold run.
  assert.deepEqual(bold, ["（Decimal）", "（Hexadecimal）"]);
  assert.equal(
    textNodes(json).find((node) => node.text === "和")?.marks,
    undefined,
  );
});

test("a Chinese sentence keeps every bold term separate", () => {
  const json = pasteMarkdown(
    "数制是按进位方式计数的系统。在数字逻辑中，最常用的数制有**二进制（Binary）**、**八进制（Octal）**、**十进制（Decimal）**和**十六进制（Hexadecimal）**。",
  );
  const bold = textNodes(json)
    .filter((node) => node.marks?.some((mark) => mark.type === "bold"))
    .map((node) => node.text);
  assert.deepEqual(bold, [
    "二进制（Binary）",
    "八进制（Octal）",
    "十进制（Decimal）",
    "十六进制（Hexadecimal）",
  ]);
  // No sentinel may survive into the document the editor receives.
  const text = textNodes(json)
    .map((node) => node.text)
    .join("");
  assert.doesNotMatch(text, /\u0000/);
});

test("the repair leaves ordinary Markdown and literal runs untouched", () => {
  assert.equal(
    repairEmphasisBoundaries("**Decimal** and **Hexadecimal**"),
    "**Decimal** and **Hexadecimal**",
  );
  // Padded runs are arithmetic or prose, not emphasis, and `marked` keeps them
  // literal today; the repair must not change that.
  assert.equal(repairEmphasisBoundaries("2 ** 3 ** 4"), "2 ** 3 ** 4");
  assert.equal(
    repairEmphasisBoundaries("`a**（b）**c` and **（x）**"),
    "`a**（b）**c` and **（x）**",
  );
});

test("the normaliser restores the sentinel in attributes too", () => {
  const doc = {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "a\u0000dsh-lone-tilde\u0000b",
            marks: [
              {
                type: "link",
                attrs: { href: "http://example.com/~user/file.html" },
              },
            ],
          },
        ],
      },
    ],
  };
  const normalized = normalizePastedMarkdown(doc);
  const node = normalized.content[0].content[0];
  assert.equal(node.text, "a~b");
  assert.equal(node.marks[0].attrs.href, "http://example.com/~user/file.html");
});

test("the paste extension routes Markdown through the normaliser", () => {
  const source = readFileSync(EXTENSION, "utf8");
  assert.match(source, /protectLoneTildes\(repairEmphasisBoundaries\(text\)\)/);
  assert.match(source, /normalizePastedMarkdown\(/);
  assert.match(source, /try \{/);
  // A rejected document must fall back to the browser's plain-text paste.
  assert.match(source, /catch \(error\)[\s\S]*return false;/);
});
