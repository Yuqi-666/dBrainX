// SPDX-License-Identifier: AGPL-3.0-only

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

/**
 * A `webpage` node stores the page as an object, not as record content.
 *
 * The node used to keep the whole HTML source in the `nodes.content` JSON
 * column, which forced the column's ceiling above the default 16 MiB web page
 * file limit (`0000000006_node_content_size.js`). The model is now the PDF
 * node's: the bytes live in the `files` collection and the node keeps the
 * address plus the byte length (`0000000007_webpage_object_storage.js` converts
 * the old records).
 *
 * These tests pin the properties a future change could silently undo:
 *
 * 1. The wire shape and the domain mapper carry `url`, not source text.
 * 2. The import surface uploads or references a stored object; it never reads
 *    the file text into the node.
 * 3. The view reads the object back only for rendering/editing and renders it
 *    with `srcDoc` (the PocketBase file route answers `Content-Disposition:
 *    attachment`, so an iframe `src` would download instead of render).
 * 4. The delete hook and the client-side cleanup clear the address, so deleting
 *    the resource does not leave a dead page node.
 */

const root = new URL("../../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");

const webpage = read(
  "packages/ui/src/components/node-content/webpage-node-content.tsx",
);
const dropZone = read(
  "packages/ui/src/components/node-content/file-drop-zone.tsx",
);
const model = read("packages/interfaces/src/models/node/nodes/single/webpage.ts");
const router = read("backend/adapter-front/src/trpc/router/node.ts");
const mapper = read(
  "backend/infrastructure/src/database/mappers/node.mapper.ts",
);
const hook = read("pb/pb_hooks/lib/node-references.js");

test("the webpage model is a stored address and a byte length", () => {
  assert.match(model, /url: string;/, "content carries the stored address");
  assert.match(model, /fileSize: number;/, "the node records the byte length");
  assert.doesNotMatch(
    model,
    /code: string|language: string/,
    "the node no longer stores source text or a highlight language",
  );
});

test("the API and the mapper carry the stored address", () => {
  assert.match(
    router,
    /const webpageContentSchema = z[\s\S]*?url: z\.string\(\)\.optional\(\)[\s\S]*?url: content\.url \?\? ""/,
    "the router accepts an address and defaults a legacy payload to empty",
  );
  assert.match(
    router,
    /nodeType: z\.literal\("webpage"\),\s*\n\s*fileSize: z\.number\(\)\.optional\(\)/,
    "a create may carry the byte length",
  );
  assert.match(
    mapper,
    /content: new WebpageContent\(resolveWebpageContent\(record\)\)/,
    "the mapper builds the content from the record",
  );
  assert.match(
    mapper,
    /return \{ url: record\.content \|\| "" \}/,
    "the record's content column is read as an address",
  );
  assert.match(
    mapper,
    /content: node\.content\.url,\s*\n\s*fileSize: node\.fileSize,/,
    "the node writes the address and the byte length back",
  );
});

test("the empty state uploads or references a stored object", () => {
  assert.match(
    dropZone,
    /uploadFiles\(\[file\]\)/,
    "a picked file is uploaded, not read into the node",
  );
  assert.match(
    dropZone,
    /await writeDocument\(url, file\.size\)/,
    "the upload writes the stored address and the size",
  );
  assert.match(
    dropZone,
    /await writeDocument\(resource\.storedUrl, resource\.fileSize\)/,
    "a library resource is referenced by its stored address",
  );
  // The reference path must not download the resource to copy its text.
  assert.doesNotMatch(dropZone, /response\.text\(\)|file\.text\(\)/);
  // The size check is the deployment's web page policy, not a hard-coded cap.
  assert.match(dropZone, /maxFileBytesFor\(limits, file\.name, file\.type\)/);
  assert.match(
    webpage,
    /const DOCUMENT_ACCEPT = "\.html,\.htm,\.xhtml,text\/html"/,
  );
});

test("the import surface keeps the native picker working", () => {
  const input = dropZone.match(/<Input\b[\s\S]*?type="file"[\s\S]*?\/>/);
  assert.ok(input, 'the drop zone renders an <Input type="file">');
  assert.doesNotMatch(
    input[0],
    /className="hidden"/,
    "display:none makes WebKit ignore the file picker",
  );
  assert.match(
    dropZone,
    /htmlFor=\{fileInputId\}/,
    "a method card is bound to the file input",
  );
  assert.match(
    dropZone,
    /const reportImportError = \(message: string\) => \{[\s\S]*?onUploadError\?\./,
    "a rejection reaches the host as well as the inline line",
  );
});

test("the node view renders the object and edits it back into storage", () => {
  assert.match(
    webpage,
    /<iframe[\s\S]*?srcDoc=\{storedText\}/,
    "the preview feeds the object text to a sandboxed iframe",
  );
  assert.doesNotMatch(webpage, /<iframe[\s\S]*?src=\{/, "no direct file URL");
  assert.match(
    webpage,
    /await replaceAttachment\(recordId, file\)/,
    "saving replaces the node's own stored object in place",
  );
  assert.match(
    webpage,
    /if \(!attachment\) attachment = await uploadAttachment\(file\)/,
    "a resource the user cannot replace is stored as a new object",
  );
  assert.match(
    webpage,
    /content: \{ url: attachment\.url \},\s*\n\s*fileSize: attachment\.fileSize,/,
    "the save points the node at the stored object",
  );
  assert.match(webpage, /正在加载网页/, "a read has its own loading state");
  assert.match(webpage, /加载网页失败/, "a failed read is reported");
});

test("deleting the resource clears the stored address", () => {
  assert.match(
    hook,
    /nodeType === "webpage"[\s\S]*?record\.set\("content", ""\);\s*\n\s*record\.set\("fileSize", 0\);/,
    "the server hook clears the page address and the byte length",
  );
});
