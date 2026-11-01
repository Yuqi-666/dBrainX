// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The after-delete hook that clears a deleted file from the nodes.
 *
 * `pb/pb_hooks/lib/node-references.js` runs inside PocketBase's Go-hosted
 * runtime; `node:vm` gives it a plain global scope, which is enough because it
 * only touches the `e.app` it is handed.
 *
 * Since `0000000011_dynamic_engine.js` `nodes.content` is the only type
 * payload: a media node keeps its address and its measurements inside that one
 * JSON object, a rich-text or text node keeps its block map at `content.docs`,
 * and only `cover` and `icon` stay top-level. The tests pin one node type at a
 * time, plus the malformed payloads the hook must skip instead of throwing.
 *
 * The hook must be best effort: the file is already gone, so a node that fails
 * to save must not stop the remaining nodes (or the derived-artifact cleanup
 * that runs after it).
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
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

/** Every JavaScript source PocketBase loads from `pb/pb_hooks`. */
function hookSources() {
  const sources = [];
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = `${directory}/${entry.name}`;
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith(".js")) sources.push(readFileSync(path, "utf8"));
    }
  };
  walk(fileURLToPath(new URL("../../pb/pb_hooks", import.meta.url)));
  return sources;
}

test("searches every field a node can store a file address in", () => {
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
  for (const column of ["content", "cover", "icon"]) {
    assert.match(e.queries[0].filter, new RegExp(`${column} ~ \\{:needle\\}`));
  }
  // A retired per-type column would make PocketBase reject the filter.
  assert.doesNotMatch(
    e.queries[0].filter,
    /\b(docs|coverUrl|hlsUrl|faviconUrl|annotations|timestamps) ~/,
  );
  assert.deepEqual(e.saved, []);
});

test("clears an image payload and the measurements that belong to it", () => {
  const hook = loadHook();
  const node = nodeRecord("n1", {
    nodeType: "image",
    content: {
      url: "/api/files/files/file-1/photo.png",
      width: 800,
      height: 600,
      fileSize: 1234,
      location: "Kyoto",
      shootingTime: "2026-05-01T10:00:00Z",
      annotations: { strokes: [{ color: "#000" }] },
    },
  });
  const e = event([node]);

  hook.detachNodeReferences(e);

  assert.deepEqual(e.saved, ["n1"]);
  const stored = node.values.get("content");
  assert.equal(stored.url, "");
  assert.equal(stored.width, 0);
  assert.equal(stored.height, 0);
  assert.equal(stored.fileSize, 0);
  // The annotation layer was drawn on the removed payload.
  assert.equal(stored.annotations, undefined);
  // Where and when the picture was taken is the user's data, not the file's.
  assert.equal(stored.location, "Kyoto");
  assert.equal(stored.shootingTime, "2026-05-01T10:00:00Z");
});

test("clears a PDF payload and only its own cover address", () => {
  const hook = loadHook();
  const deleted = nodeRecord("n1", {
    nodeType: "pdf",
    content: {
      url: "/api/files/files/file-1/paper.pdf",
      coverUrl: "/api/files/files/file-1/cover.png",
      pageCount: 12,
      fileSize: 2048,
      annotations: { strokes: [] },
    },
  });
  const liveCover = nodeRecord("n2", {
    nodeType: "pdf",
    content: {
      url: "/api/files/files/file-1/paper.pdf",
      coverUrl: "/api/files/files/file-2/cover.png",
      pageCount: 3,
      fileSize: 10,
    },
  });
  const e = event([deleted, liveCover]);

  hook.detachNodeReferences(e);

  const first = deleted.values.get("content");
  assert.equal(first.url, "");
  assert.equal(first.coverUrl, "");
  assert.equal(first.pageCount, 0);
  assert.equal(first.fileSize, 0);
  assert.equal(first.annotations, undefined);
  // A cover that belongs to another live resource is not touched, while the
  // payload of the second node is cleared like every other reference.
  const second = liveCover.values.get("content");
  assert.equal(second.coverUrl, "/api/files/files/file-2/cover.png");
  assert.equal(second.url, "");
  assert.equal(second.pageCount, 0);
});

test("clears a video source, poster and playlist but keeps the timeline", () => {
  const hook = loadHook();
  const timestamps = [{ type: "note", at: 3, text: "chapter" }];
  const node = nodeRecord("n1", {
    nodeType: "video",
    content: {
      url: "/api/files/files/file-1/clip.mp4",
      coverUrl: "/api/files/files/file-1/poster.jpg",
      hlsUrl: "/api/files/files/file-1/index.m3u8",
      duration: 30,
      fileSize: 4096,
      source: "online",
      sourceUrl: "https://example.com/clip",
      timestamps,
    },
  });
  const e = event([node]);

  hook.detachNodeReferences(e);

  const stored = node.values.get("content");
  assert.equal(stored.url, "");
  assert.equal(stored.coverUrl, "");
  assert.equal(stored.hlsUrl, "");
  assert.equal(stored.duration, 0);
  assert.equal(stored.fileSize, 0);
  // The timeline is the user's work, not part of the file.
  assert.deepEqual(plain(stored.timestamps), timestamps);
  assert.equal(stored.source, "online");
  assert.equal(stored.sourceUrl, "https://example.com/clip");
});

test("clears only the poster of a video whose source is another file", () => {
  const hook = loadHook();
  const node = nodeRecord("n1", {
    nodeType: "video",
    content: {
      url: "/api/files/files/file-2/clip.mp4",
      coverUrl: "/api/files/files/file-1/poster.jpg",
      duration: 30,
      fileSize: 4096,
      source: "local",
    },
  });
  const e = event([node]);

  hook.detachNodeReferences(e);

  const stored = node.values.get("content");
  assert.equal(stored.coverUrl, "");
  assert.equal(stored.url, "/api/files/files/file-2/clip.mp4");
  assert.equal(stored.duration, 30);
  assert.equal(stored.fileSize, 4096);
});

test("clears an audio source but keeps the timeline", () => {
  const hook = loadHook();
  const timestamps = [{ type: "subtitle", at: 1, text: "hello" }];
  const node = nodeRecord("n1", {
    nodeType: "audio",
    content: {
      url: "/api/files/files/file-1/voice.mp3",
      duration: 9,
      fileSize: 512,
      timestamps,
    },
  });
  const e = event([node]);

  hook.detachNodeReferences(e);

  const stored = node.values.get("content");
  assert.equal(stored.url, "");
  assert.equal(stored.duration, 0);
  assert.equal(stored.fileSize, 0);
  assert.deepEqual(plain(stored.timestamps), timestamps);
});

test("clears a webpage document address and its byte length", () => {
  const hook = loadHook();
  const node = nodeRecord("n1", {
    nodeType: "webpage",
    content: {
      url: "/api/files/files/file-1/page_ab12cd34ef.html",
      fileSize: 4096,
    },
    title: "page",
  });
  const e = event([node]);

  hook.detachNodeReferences(e);

  const stored = node.values.get("content");
  assert.equal(stored.url, "");
  assert.equal(stored.fileSize, 0);
  // The title and every other column are not the file.
  assert.equal(node.values.get("title"), "page");
});

test("removes embedded images and keeps the Excalidraw scene", () => {
  const hook = loadHook();
  const docs = {
    "block-1": {
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
    },
  };
  const node = nodeRecord("n1", {
    nodeType: "rich-text",
    content: { docs, referencedNodes: ["node-2"] },
  });
  const e = event([node]);

  hook.detachNodeReferences(e);

  const stored = node.values.get("content");
  const blocks = stored.docs["block-1"].content;
  assert.equal(blocks.length, 2);
  assert.equal(blocks[0].type, "paragraph");
  assert.equal(blocks[1].type, "excalidraw");
  const attrs = blocks[1].attrs;
  assert.equal(attrs.src, "");
  assert.equal(attrs.attachmentId, undefined);
  assert.equal(attrs.size, undefined);
  assert.equal(attrs.data, '{"elements":[1,2,3]}');
  // `referencedNodes` names nodes, not files.
  assert.deepEqual(plain(stored.referencedNodes), ["node-2"]);
});

test("removes an image block nested inside another block", () => {
  const hook = loadHook();
  const docs = {
    "block-1": {
      type: "doc",
      content: [
        {
          type: "blockquote",
          content: [
            { type: "image", attrs: { src: "/api/files/files/file-1/x.png" } },
          ],
        },
      ],
    },
  };
  const node = nodeRecord("n1", {
    nodeType: "rich-text",
    content: { docs, referencedNodes: [] },
  });
  const e = event([node]);

  hook.detachNodeReferences(e);

  const stored = node.values.get("content");
  assert.deepEqual(plain(stored.docs["block-1"].content[0].content), []);
});

test("clears a text block map that embeds an image", () => {
  const hook = loadHook();
  const docs = {
    "block-1": {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "keep" }] },
        { type: "image", attrs: { src: "/api/files/files/file-1/x.png" } },
      ],
    },
  };
  const node = nodeRecord("n1", { nodeType: "text", content: { docs } });
  const e = event([node]);

  hook.detachNodeReferences(e);

  const stored = node.values.get("content");
  assert.equal(stored.docs["block-1"].content.length, 1);
  assert.equal(stored.docs["block-1"].content[0].type, "paragraph");
});

test("keeps a paragraph that merely mentions the address", () => {
  const hook = loadHook();
  const node = nodeRecord("n1", {
    nodeType: "text",
    content: {
      docs: {
        "block-1": {
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
      },
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
    content: {
      url: "https://example.com/article",
      faviconUrl: "/api/files/files/file-1/favicon.png",
    },
  });
  const e = event([node]);

  hook.detachNodeReferences(e);

  const stored = node.values.get("content");
  assert.equal(stored.url, "https://example.com/article");
  assert.equal(stored.faviconUrl, undefined);
});

test("clears a node cover or icon that pointed at the deleted file", () => {
  const hook = loadHook();
  const node = nodeRecord("n1", {
    nodeType: "text",
    content: { docs: {} },
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
    content: { docs: {} },
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
    content: {
      url: "/api/files/files/file-2/photo.png",
      width: 10,
      height: 10,
      fileSize: 10,
    },
  });
  const e = event([node]);

  hook.detachNodeReferences(e);

  assert.deepEqual(e.saved, []);
});

test("skips an image whose content has no url and logs it", () => {
  const hook = loadHook();
  const content = { width: 800, height: 600, fileSize: 1234 };
  const node = nodeRecord("n1", { nodeType: "image", content });
  const e = event([node]);

  assert.doesNotThrow(() => hook.detachNodeReferences(e));

  assert.deepEqual(e.saved, []);
  assert.deepEqual(plain(node.values.get("content")), content);
  assert.equal(hook.warnings.length, 1);
  assert.equal(
    hook.warnings[0],
    "[node-references] skipping node n1 (image): content has no url",
  );
});

test("clears a poster address even when the payload has no url", () => {
  const hook = loadHook();
  const node = nodeRecord("n1", {
    nodeType: "pdf",
    content: {
      coverUrl: "/api/files/files/file-1/cover.png",
      pageCount: 3,
      fileSize: 10,
    },
  });
  const e = event([node]);

  hook.detachNodeReferences(e);

  const stored = node.values.get("content");
  assert.equal(stored.coverUrl, "");
  assert.equal(stored.pageCount, 3);
  assert.equal(hook.warnings.length, 1);
  assert.match(hook.warnings[0], /content has no url/);
});

test("skips a node whose content is not a JSON object and logs it", () => {
  const hook = loadHook();
  const node = nodeRecord("n1", {
    nodeType: "image",
    content: "not a payload",
  });
  const e = event([node]);

  assert.doesNotThrow(() => hook.detachNodeReferences(e));

  assert.deepEqual(e.saved, []);
  assert.equal(node.values.get("content"), "not a payload");
  assert.equal(hook.warnings.length, 1);
  assert.equal(
    hook.warnings[0],
    "[node-references] skipping node n1 (image): content is not a JSON object",
  );
});

test("a malformed node does not stop the remaining nodes", () => {
  const hook = loadHook();
  const broken = nodeRecord("n1", {
    nodeType: "image",
    content: { width: 10, height: 10, fileSize: 10 },
  });
  const live = nodeRecord("n2", {
    nodeType: "image",
    content: {
      url: "/api/files/files/file-1/b.png",
      width: 10,
      height: 10,
      fileSize: 10,
    },
  });
  const e = event([broken, live]);

  hook.detachNodeReferences(e);

  assert.deepEqual(e.saved, ["n2"]);
  assert.equal(hook.warnings.length, 1);
  assert.match(hook.warnings[0], /content has no url/);
  assert.equal(live.values.get("content").url, "");
});

test("reads a content payload serialized as JSON text", () => {
  const hook = loadHook();
  const node = nodeRecord("n1", {
    nodeType: "image",
    content: JSON.stringify({
      url: "/api/files/files/file-1/photo.png",
      width: 10,
      height: 10,
      fileSize: 10,
    }),
  });
  const e = event([node]);

  hook.detachNodeReferences(e);

  const stored = node.values.get("content");
  assert.equal(stored.url, "");
  assert.equal(stored.fileSize, 0);
});

test("decodes a JSON column exposed as raw bytes", () => {
  const hook = loadHook();
  const encode = (value) =>
    Array.from(Buffer.from(JSON.stringify(value), "utf8"));
  const node = nodeRecord("n1", {
    nodeType: "rich-text",
    // PocketBase may hand a JSON field to the hook runtime as its raw bytes.
    content: encode({
      docs: {
        "block-1": {
          type: "doc",
          content: [
            { type: "image", attrs: { src: "/api/files/files/file-1/x.png" } },
          ],
        },
      },
      referencedNodes: [],
    }),
  });
  const e = event([node]);

  hook.detachNodeReferences(e);

  const stored = node.values.get("content");
  assert.equal(stored.docs["block-1"].content.length, 0);
});

test("decodes a JSON media address exposed as raw bytes", () => {
  const hook = loadHook();
  const encode = (value) =>
    Array.from(Buffer.from(JSON.stringify(value), "utf8"));
  const node = nodeRecord("n1", {
    nodeType: "image",
    content: encode({
      url: "/api/files/files/file-1/photo.png",
      width: 10,
      height: 10,
      fileSize: 10,
    }),
  });
  const e = event([node]);

  hook.detachNodeReferences(e);

  const stored = node.values.get("content");
  assert.equal(stored.url, "");
  assert.equal(stored.width, 0);
});

test("a failing node save does not stop the remaining nodes", () => {
  const hook = loadHook();
  const first = nodeRecord("n1", {
    nodeType: "image",
    content: {
      url: "/api/files/files/file-1/a.png",
      width: 1,
      height: 1,
      fileSize: 1,
    },
  });
  const second = nodeRecord("n2", {
    nodeType: "image",
    content: {
      url: "/api/files/files/file-1/b.png",
      width: 1,
      height: 1,
      fileSize: 1,
    },
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

test("no hook reads a column the 0011 migration dropped", () => {
  const retired = [
    "width",
    "height",
    "fileSize",
    "location",
    "shootingTime",
    "coverUrl",
    "pageCount",
    "duration",
    "hlsUrl",
    "source",
    "sourceUrl",
    "url",
    "screenshotUrl",
    "codeLanguage",
    "faviconUrl",
    "filterConfig",
    "referencedNodes",
    "docs",
    "fields",
    "rows",
    "views",
    "annotations",
    "timestamps",
  ];
  const sources = hookSources();
  assert.ok(sources.length >= 4, "found the hook sources to scan");
  for (const source of sources) {
    for (const name of retired) {
      const read = new RegExp(`\\.get(?:String)?\\("${name}"\\)`);
      assert.doesNotMatch(
        source,
        read,
        `a hook still reads the retired "${name}" column`,
      );
    }
  }
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
