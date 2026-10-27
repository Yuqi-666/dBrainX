// SPDX-License-Identifier: AGPL-3.0-only

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  clearedNodeUpdates,
  emptyRichTextDocument,
  isHtmlDocument,
  storedFileName,
} from "./node-content.ts";

test("clears the editable document of a text or rich-text node", () => {
  assert.deepEqual(clearedNodeUpdates({ nodeType: "text", content: {} }), {
    content: { docs: emptyRichTextDocument() },
  });
  assert.deepEqual(
    clearedNodeUpdates({
      nodeType: "rich-text",
      content: { referencedNodes: ["a", "b"], docs: { type: "doc" } },
    }),
    { content: { referencedNodes: [], docs: emptyRichTextDocument() } },
  );
});

test("clears the media link and the measurements that belong to it", () => {
  assert.deepEqual(
    clearedNodeUpdates({
      nodeType: "image",
      content: { url: "/api/files/files/x/a.png" },
    }),
    { content: { url: "" }, width: 0, height: 0, fileSize: 0 },
  );
  assert.deepEqual(
    clearedNodeUpdates({
      nodeType: "pdf",
      content: { url: "u", coverUrl: "c" },
    }),
    { content: { url: "", coverUrl: "" }, pageCount: 0, fileSize: 0 },
  );
  assert.deepEqual(
    clearedNodeUpdates({
      nodeType: "video",
      content: { url: "u", coverUrl: "c", hlsUrl: "h" },
    }),
    {
      content: { url: "", coverUrl: "", hlsUrl: "", timestamps: undefined },
      duration: 0,
      fileSize: 0,
    },
  );
  assert.deepEqual(
    clearedNodeUpdates({
      nodeType: "audio",
      content: { url: "u" },
    }),
    { content: { url: "", timestamps: undefined }, duration: 0, fileSize: 0 },
  );
  // An imported audio node carries the music site's cover. Clearing the node
  // replaces `content` whole, so the now-orphaned cover address is dropped
  // with the other media fields while the measurements reset like video.
  assert.deepEqual(
    clearedNodeUpdates({
      nodeType: "audio",
      content: {
        url: "u",
        coverUrl: "/api/files/files/rec1/cover.jpg",
        timestamps: [],
      },
    }),
    { content: { url: "", timestamps: undefined }, duration: 0, fileSize: 0 },
  );
});

test("keeps the user's timeline when the media link is cleared", () => {
  const timestamps = [{ type: "note", at: 3, text: "chapter" }];
  assert.deepEqual(
    clearedNodeUpdates({
      nodeType: "video",
      content: { url: "u", coverUrl: "", hlsUrl: "", timestamps },
    }),
    {
      content: { url: "", coverUrl: "", hlsUrl: "", timestamps },
      duration: 0,
      fileSize: 0,
    },
  );
  // An audio node's timeline holds lyrics cues as well as notes, and neither is
  // part of the file payload — only the cover is, so it is the one thing the
  // clear drops.
  assert.deepEqual(
    clearedNodeUpdates({
      nodeType: "audio",
      content: {
        url: "u",
        coverUrl: "/api/files/files/rec1/cover.jpg",
        timestamps,
      },
    }),
    { content: { url: "", timestamps }, duration: 0, fileSize: 0 },
  );
});

test("clears the stored document of a webpage and the address of a website", () => {
  assert.deepEqual(
    clearedNodeUpdates({
      nodeType: "webpage",
      content: { url: "/api/files/files/rec1/page_ab12cd34ef.html" },
    }),
    { content: { url: "" }, fileSize: 0 },
  );
  assert.deepEqual(
    clearedNodeUpdates({
      nodeType: "website",
      content: { url: "https://example.com", faviconUrl: "f" },
    }),
    { content: { url: "" } },
  );
});

test("reads the stored name and the document kind from a stored address", () => {
  assert.equal(
    storedFileName("/api/files/files/rec1/page_ab12cd34ef.html"),
    "page_ab12cd34ef.html",
  );
  assert.equal(
    storedFileName(
      "https://example.com/session/a/api/files/files/rec1/My%20Page.html?x=1",
    ),
    "My Page.html",
  );
  assert.equal(storedFileName(""), "");
  assert.equal(isHtmlDocument("/api/files/files/rec1/page.html"), true);
  assert.equal(isHtmlDocument("/api/files/files/rec1/page.HTM"), true);
  assert.equal(isHtmlDocument("/api/files/files/rec1/page.xhtml"), true);
  assert.equal(isHtmlDocument("/api/files/files/rec1/app.js"), false);
  // A title that merely looks like an extension is not the stored name.
  assert.equal(isHtmlDocument("/api/files/files/rec1"), false);
});

test("does not offer to clear a collection or a database", () => {
  assert.equal(
    clearedNodeUpdates({ nodeType: "collection", content: {} }),
    null,
  );
  assert.equal(clearedNodeUpdates({ nodeType: "database", content: {} }), null);
});
