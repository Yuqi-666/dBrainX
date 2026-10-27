// SPDX-License-Identifier: AGPL-3.0-only

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

/**
 * Rich-text editing gestures that the Tiptap template does not provide:
 *
 * - `Ctrl/Cmd+A` selects the current block first and the whole document on the
 *   second press. ProseMirror's default binds `Mod-a` straight to `selectAll`,
 *   so a new extension has to take the shortcut first.
 * - Copying puts Markdown on the clipboard (`text/plain`) instead of flattened
 *   text, and leaves nodes that have no text representation — images above all
 *   — out of the result.
 *
 * The end-to-end cases run a real headless editor and the real Markdown
 * manager, so they exercise the same parser/renderer pair the app uses.
 */

const EDITOR_DIR = new URL("../../packages/editor/", import.meta.url);
const requireFromEditor = createRequire(new URL("package.json", EDITOR_DIR));

const SELECT_EXTENSION = fileURLToPath(
  new URL(
    "../../packages/editor/components/tiptap-extension/select-block-or-all-extension.ts",
    import.meta.url,
  ),
);
const COPY_EXTENSION = fileURLToPath(
  new URL(
    "../../packages/editor/components/tiptap-extension/copy-markdown-extension.ts",
    import.meta.url,
  ),
);
const NOTION_EDITOR = fileURLToPath(
  new URL(
    "../../packages/editor/components/tiptap-templates/notion-like/notion-like-editor.tsx",
    import.meta.url,
  ),
);

const { selectBlockOrAll } = await import(pathToFileURL(SELECT_EXTENSION).href);
const { CopyMarkdown, filterBlankCopyNodes, serializeSelectionAsMarkdown } =
  await import(pathToFileURL(COPY_EXTENSION).href);

/**
 * Imports the ESM build of a package `packages/editor`, the same build the
 * extension files import. `require.resolve` would pick the CJS build, whose
 * class identities differ (a `TextSelection` from the CJS build is not the ESM
 * `TextSelection` the extension tests with `instanceof`).
 */
async function importFromEditor(name) {
  const cjs = requireFromEditor.resolve(name);
  const esm = cjs.endsWith(".cjs") ? `${cjs.slice(0, -4)}.js` : cjs;
  return import(pathToFileURL(esm).href);
}

const { Editor, Node } = await importFromEditor("@tiptap/core");
const { StarterKit } = await importFromEditor("@tiptap/starter-kit");
const { Markdown } = await importFromEditor("@tiptap/markdown");
const { AllSelection } = await importFromEditor("@tiptap/pm/state");

/** A Markdown-only image stand-in: the template's image adds a React view. */
const TestImage = Node.create({
  name: "image",
  group: "inline",
  inline: true,
  atom: true,
  addAttributes() {
    return { src: { default: null }, alt: { default: null } };
  },
  renderHTML({ HTMLAttributes }) {
    return ["img", HTMLAttributes];
  },
  renderMarkdown(node) {
    return `![${node.attrs?.alt ?? ""}](${node.attrs?.src ?? ""})`;
  },
});

const paragraph = (text) => ({
  type: "paragraph",
  content: [{ type: "text", text }],
});

function createEditor(content, extensions = [StarterKit, Markdown]) {
  return new Editor({ content, extensions });
}

/** The document position of the first occurrence of `needle`. */
function textPosition(editor, needle) {
  let position;
  editor.state.doc.descendants((node, pos) => {
    if (position != null || !node.isText || !node.text) return;
    const offset = node.text.indexOf(needle);
    if (offset >= 0) position = pos + offset;
  });
  assert.notEqual(position, undefined, `"${needle}" is not in the document`);
  return position;
}

function selectedText(editor) {
  return editor.state.doc.textBetween(
    editor.state.selection.from,
    editor.state.selection.to,
    "\n\n",
  );
}

test("Mod-a selects the current block, then the whole document", () => {
  const editor = createEditor({
    type: "doc",
    content: [
      {
        type: "heading",
        attrs: { level: 1 },
        content: [{ type: "text", text: "Title" }],
      },
      paragraph("hello world"),
      paragraph("second"),
    ],
  });
  try {
    editor.commands.setTextSelection(textPosition(editor, "world") + 2);

    assert.equal(selectBlockOrAll(editor), true);
    assert.equal(selectedText(editor), "hello world");
    assert.ok(!(editor.state.selection instanceof AllSelection));

    // The block is selected now: the same gesture grows to the document.
    assert.equal(selectBlockOrAll(editor), true);
    assert.ok(editor.state.selection instanceof AllSelection);
  } finally {
    editor.destroy();
  }
});

test("a partial selection inside one block grows to that whole block", () => {
  const editor = createEditor({
    type: "doc",
    content: [paragraph("alpha beta gamma")],
  });
  try {
    const start = textPosition(editor, "beta");
    editor.commands.setTextSelection({ from: start, to: start + 4 });

    selectBlockOrAll(editor);
    assert.equal(selectedText(editor), "alpha beta gamma");
    assert.ok(!(editor.state.selection instanceof AllSelection));
  } finally {
    editor.destroy();
  }
});

test("a selection already spanning blocks goes straight to the document", () => {
  const editor = createEditor({
    type: "doc",
    content: [paragraph("first"), paragraph("second")],
  });
  try {
    editor.commands.setTextSelection({
      from: textPosition(editor, "first") + 1,
      to: textPosition(editor, "second") + 2,
    });

    selectBlockOrAll(editor);
    assert.ok(editor.state.selection instanceof AllSelection);
  } finally {
    editor.destroy();
  }
});

/**
 * Minimal table nodes for the cell case. `cellAround` only needs the
 * `tableRole` markers; pulling in the repository's full table extension would
 * drag the React node view and the `@workspace/editor` alias into plain Node.
 */
const TestTable = Node.create({
  name: "table",
  group: "block",
  content: "tableRow+",
  tableRole: "table",
  isolating: true,
  renderHTML: () => ["table", 0],
  extendNodeSchema(extension) {
    return { tableRole: extension.config.tableRole };
  },
});

const TestTableRow = Node.create({
  name: "tableRow",
  content: "(tableCell | tableHeader)+",
  tableRole: "row",
  renderHTML: () => ["tr", 0],
  extendNodeSchema(extension) {
    return { tableRole: extension.config.tableRole };
  },
});

const TestTableCell = Node.create({
  name: "tableCell",
  content: "block+",
  tableRole: "cell",
  isolating: true,
  attrs: {
    colspan: { default: 1 },
    rowspan: { default: 1 },
    colwidth: { default: null },
  },
  renderHTML: () => ["td", 0],
  extendNodeSchema(extension) {
    return { tableRole: extension.config.tableRole };
  },
});

const TestTableHeader = TestTableCell.extend({
  name: "tableHeader",
  renderHTML: () => ["th", 0],
});

test("a table cell selects its content first, then the document", () => {
  const editor = createEditor(
    {
      type: "doc",
      content: [
        {
          type: "table",
          content: [
            {
              type: "tableRow",
              content: [
                {
                  type: "tableHeader",
                  content: [
                    {
                      type: "paragraph",
                      content: [{ type: "text", text: "A" }],
                    },
                    {
                      type: "paragraph",
                      content: [{ type: "text", text: "B" }],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
    [
      StarterKit,
      Markdown,
      TestTable,
      TestTableRow,
      TestTableCell,
      TestTableHeader,
    ],
  );
  try {
    editor.commands.setTextSelection(textPosition(editor, "A"));
    selectBlockOrAll(editor);
    assert.equal(selectedText(editor), "A\n\nB");
    assert.ok(!(editor.state.selection instanceof AllSelection));

    selectBlockOrAll(editor);
    assert.ok(editor.state.selection instanceof AllSelection);
  } finally {
    editor.destroy();
  }
});

test("copying Markdown keeps the formatting syntax", () => {
  const editor = createEditor(
    {
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 2 },
          content: [{ type: "text", text: "Title" }],
        },
        {
          type: "paragraph",
          content: [
            { type: "text", text: "plain " },
            { type: "text", text: "bold", marks: [{ type: "bold" }] },
            { type: "text", text: " and " },
            { type: "text", text: "code", marks: [{ type: "code" }] },
          ],
        },
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [paragraph("item")],
            },
          ],
        },
      ],
    },
    [StarterKit, Markdown],
  );
  try {
    editor.commands.selectAll();
    const markdown = serializeSelectionAsMarkdown(editor);
    assert.match(markdown, /^## Title/m);
    assert.match(markdown, /\*\*bold\*\*/);
    assert.match(markdown, /`code`/);
    assert.match(markdown, /^- item$/m);
  } finally {
    editor.destroy();
  }
});

test("copying part of one block keeps inline Markdown only", () => {
  const editor = createEditor(
    {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "alpha " },
            { type: "text", text: "bold", marks: [{ type: "bold" }] },
            { type: "text", text: " omega" },
          ],
        },
      ],
    },
    [StarterKit, Markdown],
  );
  try {
    const from = textPosition(editor, "bold");
    editor.commands.setTextSelection({ from, to: from + "bold".length });
    assert.equal(serializeSelectionAsMarkdown(editor), "**bold**");
  } finally {
    editor.destroy();
  }
});

test("a partial list-item copy does not gain the list marker", () => {
  const editor = createEditor(
    {
      type: "doc",
      content: [
        {
          type: "bulletList",
          content: [{ type: "listItem", content: [paragraph("item text")] }],
        },
      ],
    },
    [StarterKit, Markdown],
  );
  try {
    const from = textPosition(editor, "text");
    editor.commands.setTextSelection({ from, to: from + "text".length });
    assert.equal(serializeSelectionAsMarkdown(editor), "text");
  } finally {
    editor.destroy();
  }
});

test("the clipboard text serializer is the CopyMarkdown plugin", () => {
  const editor = createEditor(
    {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "hi", marks: [{ type: "bold" }] }],
        },
      ],
    },
    [StarterKit, Markdown, CopyMarkdown],
  );
  try {
    editor.commands.selectAll();
    const plugins = editor.extensionManager.plugins;
    const copyIndex = plugins.findIndex(
      (plugin) => String(plugin.key) === "copyMarkdown$",
    );
    const coreIndex = plugins.findIndex(
      (plugin) => String(plugin.key) === "clipboardTextSerializer$",
    );
    assert.notEqual(copyIndex, -1, "the CopyMarkdown plugin is registered");
    assert.notEqual(coreIndex, -1, "the core serializer is registered");
    // ProseMirror asks the plugins in order and stops at the first answer.
    assert.ok(
      copyIndex < coreIndex,
      "the Markdown serializer must be asked before the plain-text one",
    );
    assert.equal(plugins[copyIndex].props.clipboardTextSerializer(), "**hi**");
  } finally {
    editor.destroy();
  }
});

test("an image is left out of the copied Markdown", () => {
  const editor = createEditor(
    {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "before " },
            { type: "image", attrs: { src: "photo.png", alt: "a photo" } },
            { type: "text", text: " after" },
          ],
        },
      ],
    },
    [StarterKit, Markdown, TestImage],
  );
  try {
    editor.commands.selectAll();
    const markdown = serializeSelectionAsMarkdown(editor);
    assert.doesNotMatch(markdown, /!\[|photo\.png/);
    assert.match(markdown, /before/);
    assert.match(markdown, /after/);
  } finally {
    editor.destroy();
  }
});

test("a block that held only an image copies as nothing", () => {
  const content = [
    {
      type: "paragraph",
      content: [{ type: "image", attrs: { src: "photo.png", alt: "a photo" } }],
    },
  ];
  assert.deepEqual(filterBlankCopyNodes(content), []);

  const editor = createEditor({ type: "doc", content }, [
    StarterKit,
    Markdown,
    TestImage,
  ]);
  try {
    editor.commands.selectAll();
    assert.equal(serializeSelectionAsMarkdown(editor), "");
  } finally {
    editor.destroy();
  }
});

test("the Notion template registers both extensions", () => {
  const source = readFileSync(NOTION_EDITOR, "utf8");
  assert.match(source, /import \{ CopyMarkdown \}/);
  assert.match(source, /import \{ SelectBlockOrAll \}/);
  assert.match(source, /^\s*CopyMarkdown,$/m);
  assert.match(source, /^\s*SelectBlockOrAll,$/m);
});
