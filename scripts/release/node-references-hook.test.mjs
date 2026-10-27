// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The after-delete hook that clears a deleted file from the nodes.
 *
 * `pb/pb_hooks/lib/node-references.js` runs inside PocketBase's Go-hosted
 * runtime; `node:vm` gives it a plain global scope, which is enough because it
 * only touches the `e.app` it is handed. The tests pin one node type at a time,
 * because the stored shape differs per type: a media node keeps its address in
 * a JSON string, a rich-text node in its own `docs` column, a text node in
 * `content`, and every node can carry the address in `cover` or `icon`.
 *
 * The hook must be best effort: the file is already gone, so a node that fails
 * to save must not stop the remaining nodes (or the derived-artifact cleanup
 * that runs after it).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";

const HOOK_SOURCE = readFileSync(
  new URL("../../pb/pb_hooks/lib/node-references.js", import.meta.url),
  "utf8",
);

/** Cross-realm objects fail `deepEqual` on their prototype; compare plain data. */
const plain = (value) => JSON.parse(JSON.stringify(value));

function loadHook() {
  const warnings = [];
  const scope = {
    module: { exports: {} },
    console: { warn: (...args) => warnings.push(args.join("")) },
  };
  runInNewContext(HOOK_SOURCE, scope);
  return { ...scope.module.exports, warnings };
}

/** A node record with just the behavior the hook uses. */
function nodeRecord(id, fields = {}) {
  const values = new Map(Object.entries(fields));
  return {
    id,
    values,
    get: (key) => values.get(key),
    getString: (key) => {
      const value = values.get(key);
      return typeof value === "string" ? value : "";
    },
    set: (key, value) => values.set(key, value),
  };
}

/** An after-delete event whose filter returns `nodes` (already matched). */
function event(nodes, options = {}) {
  const e = {
    record: { id: options.recordId ?? "file-1" },
    queries: [],
    saved: [],
    app: {
      findRecordsByFilter(collection, filter, sort, limit, offset, params) {
        e.queries.push({ collection, filter, sort, limit, offset, params });
        if (options.findFails) throw new Error("filter failed");
        return nodes;
      },
      save(record) {
        if (record.id === options.failFor) throw new Error("validation failed");
        e.saved.push(record.id);
      },
    },
  };
  return e;
}

test("searches every column a node can store a file address in", () => {
  const hook = loadHook();
  const e = event([]);

  hook.detachNodeReferences(e);

  assert.equal(e.queries.length, 1);
  assert.equal(e.queries[0].collection, "nodes");
  assert.equal(e.queries[0].sort, "");
  assert.equal(e.queries[0].limit, 0);
  assert.equal(e.queries[0].offset, 0);
  // The needle is the record id as a path segment: the stable part of every
  // stored address form (absolute, gateway prefix, desktop same-origin).
  assert.deepEqual(plain(e.queries[0].params), { needle: "/file-1/" });
  for (const column of [
    "content",
    "docs",
    "coverUrl",
    "hlsUrl",
    "faviconUrl",
    "cover",
    "icon",
  ]) {
    assert.match(e.queries[0].filter, new RegExp(`${column} ~ \\{:needle\\}`));
  }
  assert.deepEqual(e.saved, []);
});

test("clears an image payload and the measurements that belong to it", () => {
  const hook = loadHook();
  const node = nodeRecord("n1", {
    nodeType: "image",
    content: "/api/files/files/file-1/photo.png",
    width: 800,
    height: 600,
    fileSize: 1234,
    annotations: { strokes: [{ color: "#000" }] },
  });
  const e = event([node]);

  hook.detachNodeReferences(e);

  assert.deepEqual(e.saved, ["n1"]);
  assert.equal(node.values.get("content"), "");
  assert.equal(node.values.get("width"), 0);
  assert.equal(node.values.get("height"), 0);
  assert.equal(node.values.get("fileSize"), 0);
  assert.equal(node.values.get("annotations"), null);
});

test("clears a PDF payload and only its own cover address", () => {
  const hook = loadHook();
  const deleted = nodeRecord("n1", {
    nodeType: "pdf",
    content: "/api/files/files/file-1/paper.pdf",
    coverUrl: "/api/files/files/file-1/cover.png",
    pageCount: 12,
    fileSize: 2048,
    annotations: { strokes: [] },
  });
  const liveCover = nodeRecord("n2", {
    nodeType: "pdf",
    content: "/api/files/files/file-1/paper.pdf",
    coverUrl: "/api/files/files/file-2/cover.png",
    pageCount: 3,
    fileSize: 10,
  });
  const e = event([deleted, liveCover]);

  hook.detachNodeReferences(e);

  assert.equal(deleted.values.get("content"), "");
  assert.equal(deleted.values.get("coverUrl"), "");
  assert.equal(deleted.values.get("pageCount"), 0);
  assert.equal(deleted.values.get("fileSize"), 0);
  assert.equal(deleted.values.get("annotations"), null);
  // A cover that belongs to another live resource is not touched, while the
  // payload of the second node is cleared like every other reference.
  assert.equal(
    liveCover.values.get("coverUrl"),
    "/api/files/files/file-2/cover.png",
  );
  assert.equal(liveCover.values.get("content"), "");
  assert.equal(liveCover.values.get("pageCount"), 0);
});

test("clears a video source, poster and playlist but keeps the timeline", () => {
  const hook = loadHook();
  const timestamps = [{ type: "note", at: 3, text: "chapter" }];
  const node = nodeRecord("n1", {
    nodeType: "video",
    content: "/api/files/files/file-1/clip.mp4",
    coverUrl: "/api/files/files/file-1/poster.jpg",
    hlsUrl: "/api/files/files/file-1/index.m3u8",
    duration: 30,
    fileSize: 4096,
    timestamps,
  });
  const e = event([node]);

  hook.detachNodeReferences(e);

  assert.equal(node.values.get("content"), "");
  assert.equal(node.values.get("coverUrl"), "");
  assert.equal(node.values.get("hlsUrl"), "");
  assert.equal(node.values.get("duration"), 0);
  assert.equal(node.values.get("fileSize"), 0);
  // The timeline is the user's work, not part of the file.
  assert.deepEqual(plain(node.values.get("timestamps")), timestamps);
});

test("clears an audio source but keeps the timeline", () => {
  const hook = loadHook();
  const timestamps = [{ type: "subtitle", at: 1, text: "hello" }];
  const node = nodeRecord("n1", {
    nodeType: "audio",
    content: "/api/files/files/file-1/voice.mp3",
    duration: 9,
    fileSize: 512,
    timestamps,
  });
  const e = event([node]);

  hook.detachNodeReferences(e);

  assert.equal(node.values.get("content"), "");
  assert.equal(node.values.get("duration"), 0);
  assert.equal(node.values.get("fileSize"), 0);
  assert.deepEqual(plain(node.values.get("timestamps")), timestamps);
});

test("clears a webpage document address and its byte length", () => {
  const hook = loadHook();
  const node = nodeRecord("n1", {
    nodeType: "webpage",
    content: "/api/files/files/file-1/page_ab12cd34ef.html",
    fileSize: 4096,
    title: "page",
  });
  const e = event([node]);

  hook.detachNodeReferences(e);

  assert.equal(node.values.get("content"), "");
  assert.equal(node.values.get("fileSize"), 0);
  // The title and every other column are not the file.
  assert.equal(node.values.get("title"), "page");
});

test("removes embedded images and keeps the Excalidraw scene", () => {
  const hook = loadHook();
  const docs = {
    type: "doc",
    content: [
      { type: "paragraph", content: [{ type: "text", text: "keep" }] },
      {
        type: "image",
        attrs: { src: "/api/files/files/file-1/photo.png", alt: "gone" },
      },
      {
        type: "excalidraw",
        attrs: {
          src: "/api/files/files/file-1/diagram.png",
          attachmentId: "file-1",
          data: '{"elements":[1,2,3]}',
          title: "diagram.png",
        },
      },
    ],
  };
  const node = nodeRecord("n1", {
    nodeType: "rich-text",
    docs,
    referencedNodes: ["node-2"],
  });
  const e = event([node]);

  hook.detachNodeReferences(e);

  const stored = node.values.get("docs");
  assert.equal(stored.content.length, 2);
  assert.equal(stored.content[0].type, "paragraph");
  assert.equal(stored.content[1].type, "excalidraw");
  const attrs = stored.content[1].attrs;
  assert.equal(attrs.src, "");
  assert.equal(attrs.attachmentId, undefined);
  assert.equal(attrs.size, undefined);
  assert.equal(attrs.data, '{"elements":[1,2,3]}');
  // `referencedNodes` names nodes, not files.
  assert.deepEqual(plain(node.values.get("referencedNodes")), ["node-2"]);
});

test("removes an image block nested inside another block", () => {
  const hook = loadHook();
  const docs = {
    type: "doc",
    content: [
      {
        type: "blockquote",
        content: [
          { type: "image", attrs: { src: "/api/files/files/file-1/x.png" } },
        ],
      },
    ],
  };
  const node = nodeRecord("n1", { nodeType: "rich-text", docs });
  const e = event([node]);

  hook.detachNodeReferences(e);

  const stored = node.values.get("docs");
  assert.deepEqual(plain(stored.content[0].content), []);
});

test("clears a text document that embeds an image", () => {
  const hook = loadHook();
  // A text node stores its document directly in the `content` column.
  const node = nodeRecord("n1", {
    nodeType: "text",
    content: {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "keep" }] },
        { type: "image", attrs: { src: "/api/files/files/file-1/x.png" } },
      ],
    },
  });
  const e = event([node]);

  hook.detachNodeReferences(e);

  const stored = node.values.get("content");
  assert.equal(stored.content.length, 1);
  assert.equal(stored.content[0].type, "paragraph");
});

test("recurses into the wrapped text shape when a build stored one", () => {
  const hook = loadHook();
  const node = nodeRecord("n1", {
    nodeType: "text",
    content: {
      referencedNodes: ["node-2"],
      docs: {
        type: "doc",
        content: [
          { type: "image", attrs: { src: "/api/files/files/file-1/x.png" } },
        ],
      },
    },
  });
  const e = event([node]);

  hook.detachNodeReferences(e);

  const stored = node.values.get("content");
  assert.deepEqual(plain(stored.docs), { type: "doc", content: [] });
  assert.deepEqual(plain(stored.referencedNodes), ["node-2"]);
});

test("keeps a paragraph that merely mentions the address", () => {
  const hook = loadHook();
  const node = nodeRecord("n1", {
    nodeType: "text",
    content: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "see /api/files/files/file-1/photo.png for the picture",
            },
          ],
        },
      ],
    },
  });
  const e = event([node]);

  hook.detachNodeReferences(e);

  assert.deepEqual(e.saved, []);
});

test("clears a website favicon but keeps the website", () => {
  const hook = loadHook();
  const node = nodeRecord("n1", {
    nodeType: "website",
    content: "https://example.com/article",
    faviconUrl: "/api/files/files/file-1/favicon.png",
  });
  const e = event([node]);

  hook.detachNodeReferences(e);

  assert.equal(node.values.get("faviconUrl"), "");
  assert.equal(node.values.get("content"), "https://example.com/article");
});

test("clears a node cover or icon that pointed at the deleted file", () => {
  const hook = loadHook();
  const node = nodeRecord("n1", {
    nodeType: "text",
    content: { type: "doc", content: [] },
    cover: { kind: "image", url: "/api/files/files/file-1/cover.png" },
    icon: { kind: "image", value: "/api/files/files/file-1/icon.png" },
  });
  const e = event([node]);

  hook.detachNodeReferences(e);

  assert.deepEqual(e.saved, ["n1"]);
  assert.equal(node.values.get("cover"), null);
  assert.equal(node.values.get("icon"), null);
});

test("leaves an emoji icon and a node cover alone", () => {
  const hook = loadHook();
  const node = nodeRecord("n1", {
    nodeType: "text",
    content: { type: "doc", content: [] },
    cover: { kind: "node", nodeId: "file-1" },
    icon: { kind: "emoji", value: "📄" },
  });
  const e = event([node]);

  hook.detachNodeReferences(e);

  assert.deepEqual(e.saved, []);
});

test("does not touch a node whose file address is another record", () => {
  const hook = loadHook();
  const node = nodeRecord("n1", {
    nodeType: "image",
    content: "/api/files/files/file-2/photo.png",
    width: 10,
    height: 10,
    fileSize: 10,
  });
  const e = event([node]);

  hook.detachNodeReferences(e);

  assert.deepEqual(e.saved, []);
});

test("decodes a JSON column exposed as raw bytes", () => {
  const hook = loadHook();
  const encode = (value) =>
    Array.from(Buffer.from(JSON.stringify(value), "utf8"));
  const node = nodeRecord("n1", {
    nodeType: "rich-text",
    // PocketBase may hand a JSON field to the hook runtime as its raw bytes.
    docs: encode({
      type: "doc",
      content: [
        { type: "image", attrs: { src: "/api/files/files/file-1/x.png" } },
      ],
    }),
  });
  const e = event([node]);

  hook.detachNodeReferences(e);

  assert.equal(node.values.get("docs").content.length, 0);
});

test("decodes a JSON media address exposed as raw bytes", () => {
  const hook = loadHook();
  const encode = (value) =>
    Array.from(Buffer.from(JSON.stringify(value), "utf8"));
  const node = nodeRecord("n1", {
    nodeType: "image",
    content: encode("/api/files/files/file-1/photo.png"),
    width: 10,
    height: 10,
    fileSize: 10,
  });
  const e = event([node]);

  hook.detachNodeReferences(e);

  assert.equal(node.values.get("content"), "");
});

test("a failing node save does not stop the remaining nodes", () => {
  const hook = loadHook();
  const first = nodeRecord("n1", {
    nodeType: "image",
    content: "/api/files/files/file-1/a.png",
  });
  const second = nodeRecord("n2", {
    nodeType: "image",
    content: "/api/files/files/file-1/b.png",
  });
  const e = event([first, second], { failFor: "n1" });

  hook.detachNodeReferences(e);

  assert.deepEqual(e.saved, ["n2"]);
  assert.equal(hook.warnings.length, 1);
  assert.match(hook.warnings[0], /could not clear node n1 of file-1/);
});

test("a failing node query does not abort the request", () => {
  const hook = loadHook();
  const e = event([], { findFails: true });

  assert.doesNotThrow(() => hook.detachNodeReferences(e));

  assert.deepEqual(e.saved, []);
  assert.equal(hook.warnings.length, 1);
  assert.match(
    hook.warnings[0],
    /could not read the nodes that reference file-1/,
  );
});

test("files.pb.js clears node references before the derived artifacts", () => {
  const source = readFileSync(
    new URL("../../pb/pb_hooks/files.pb.js", import.meta.url),
    "utf8",
  );
  // One after-delete handler runs both cleanups, and the order matters: the
  // node references go first, then the artifact rows (which repeat the same
  // cleanup for their own ids).
  assert.match(
    source,
    /onRecordAfterDeleteSuccess\([\s\S]*lib\/node-references\.js[\s\S]*lib\/media-derived\.js/,
  );
  assert.match(source, /onRecordAfterDeleteSuccess\([\s\S]*?"files"\)/);
});
