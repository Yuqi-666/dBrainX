// SPDX-License-Identifier: AGPL-3.0-only

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  fileRecordIdsInNode,
  fileRecordIdsInValue,
  nodeReferencesAnyFile,
  nodeWithoutFileReferences,
} from "./resource-references.ts";

const IMAGE_URL = "/api/files/files/abc123DEF/photo_ab12cd34ef.png";
const ABSOLUTE_URL =
  "http://127.0.0.1:8090/api/files/files/recVideo012/clip_mov.mp4";
const GATEWAY_URL = "/session/a1b2c3d4/api/files/files/recAudio345/voice.mp3";
const DESKTOP_URL = "/api/files/files/recPdf678/paper.pdf";

test("reads the record id from every stored address form", () => {
  assert.deepEqual(fileRecordIdsInValue(IMAGE_URL), ["abc123DEF"]);
  assert.deepEqual(fileRecordIdsInValue(ABSOLUTE_URL), ["recVideo012"]);
  assert.deepEqual(fileRecordIdsInValue(GATEWAY_URL), ["recAudio345"]);
  assert.deepEqual(fileRecordIdsInValue(DESKTOP_URL), ["recPdf678"]);
  assert.deepEqual(fileRecordIdsInValue([IMAGE_URL, IMAGE_URL]), ["abc123DEF"]);
  assert.deepEqual(fileRecordIdsInValue("https://example.com/report.pdf"), []);
  assert.deepEqual(fileRecordIdsInValue(undefined), []);
});

test("scans content, icon and cover but not pasted text", () => {
  const node = {
    title: "A node titled like " + IMAGE_URL,
    abstract: IMAGE_URL,
    content: { url: IMAGE_URL },
    cover: { kind: "image", url: IMAGE_URL },
    icon: { kind: "image", value: IMAGE_URL, color: "#fff" },
  };
  assert.deepEqual(fileRecordIdsInNode(node), ["abc123DEF"]);
  assert.equal(nodeReferencesAnyFile(node), true);
  assert.equal(
    nodeReferencesAnyFile({ content: { url: "https://example.com" } }),
    false,
  );
});

test("clears a media payload and its measurements", () => {
  const image = {
    nodeType: "image",
    content: { url: IMAGE_URL },
    width: 800,
    height: 600,
    fileSize: 1024,
  };
  assert.deepEqual(nodeWithoutFileReferences(image, new Set(["abc123DEF"])), {
    content: { url: "" },
    width: 0,
    height: 0,
    fileSize: 0,
  });

  const pdf = {
    nodeType: "pdf",
    content: { url: DESKTOP_URL, coverUrl: "/api/files/files/cover1/c.jpg" },
    pageCount: 12,
    fileSize: 2048,
  };
  assert.deepEqual(nodeWithoutFileReferences(pdf, new Set(["recPdf678"])), {
    content: { url: "", coverUrl: "" },
    pageCount: 0,
    fileSize: 0,
  });

  const video = {
    nodeType: "video",
    content: {
      url: ABSOLUTE_URL,
      coverUrl: "/api/files/files/cover1/c.jpg",
      hlsUrl: "/api/files/files/hls1/index.m3u8",
      timestamps: [{ type: "note", at: 1, text: "keep me" }],
    },
    duration: 30,
    fileSize: 4096,
  };
  assert.deepEqual(nodeWithoutFileReferences(video, new Set(["recVideo012"])), {
    content: {
      url: "",
      coverUrl: "",
      hlsUrl: "",
      timestamps: [{ type: "note", at: 1, text: "keep me" }],
    },
    duration: 0,
    fileSize: 0,
  });

  const audio = {
    nodeType: "audio",
    content: { url: GATEWAY_URL },
    duration: 9,
    fileSize: 512,
  };
  assert.deepEqual(nodeWithoutFileReferences(audio, new Set(["recAudio345"])), {
    content: { url: "" },
    duration: 0,
    fileSize: 0,
  });

  const webpage = {
    nodeType: "webpage",
    content: { url: "/api/files/files/recPage901/page_ab12cd34ef.html" },
    fileSize: 8192,
  };
  assert.deepEqual(
    nodeWithoutFileReferences(webpage, new Set(["recPage901"])),
    { content: { url: "" }, fileSize: 0 },
  );
});

test("keeps a node that references none of the deleted records", () => {
  const node = {
    nodeType: "image",
    content: { url: IMAGE_URL },
    width: 1,
    height: 1,
    fileSize: 1,
  };
  assert.equal(nodeWithoutFileReferences(node, new Set(["other"])), null);
  assert.equal(nodeWithoutFileReferences(node, new Set()), null);
});

test("removes embedded images and keeps the Excalidraw scene", () => {
  const docs = {
    type: "doc",
    content: [
      { type: "paragraph", content: [{ type: "text", text: "keep" }] },
      {
        type: "image",
        attrs: { src: IMAGE_URL, alt: "gone", width: "100%" },
      },
      {
        type: "excalidraw",
        attrs: {
          src: IMAGE_URL,
          attachmentId: "abc123DEF",
          data: '{"elements":[1,2,3]}',
          title: "diagram.png",
        },
      },
    ],
  };
  const updates = nodeWithoutFileReferences(
    { nodeType: "rich-text", content: { referencedNodes: ["n1"], docs } },
    new Set(["abc123DEF"]),
  );
  assert.ok(updates);
  const content = updates.content as {
    referencedNodes: string[];
    docs: { content: Array<Record<string, unknown>> };
  };
  assert.deepEqual(content.referencedNodes, ["n1"]);
  assert.equal(content.docs.content.length, 2);
  assert.equal(content.docs.content[0]?.type, "paragraph");
  assert.equal(content.docs.content[1]?.type, "excalidraw");
  const attrs = (content.docs.content[1] as { attrs: Record<string, unknown> })
    .attrs;
  assert.equal(attrs.src, "");
  assert.equal(attrs.attachmentId, undefined);
  assert.equal(attrs.data, '{"elements":[1,2,3]}');
});

test("clears a text document with an embedded image", () => {
  const updates = nodeWithoutFileReferences(
    {
      nodeType: "text",
      content: {
        docs: {
          type: "doc",
          content: [{ type: "image", attrs: { src: IMAGE_URL } }],
        },
      },
    },
    new Set(["abc123DEF"]),
  );
  assert.ok(updates);
  assert.deepEqual((updates.content as { docs: { content: unknown[] } }).docs, {
    type: "doc",
    content: [],
  });
});

test("clears a node cover or icon that pointed at the deleted file", () => {
  assert.deepEqual(
    nodeWithoutFileReferences(
      {
        nodeType: "text",
        content: { docs: { type: "doc", content: [] } },
        cover: { kind: "image", url: IMAGE_URL },
        icon: { kind: "image", value: IMAGE_URL },
      },
      new Set(["abc123DEF"]),
    ),
    { cover: null, icon: null },
  );
});

test("clears a website favicon but keeps the website address", () => {
  const updates = nodeWithoutFileReferences(
    {
      nodeType: "website",
      content: { url: "https://example.com", faviconUrl: IMAGE_URL },
    },
    new Set(["abc123DEF"]),
  );
  assert.ok(updates);
  const content = updates.content as { url: string; faviconUrl?: string };
  assert.equal(content.url, "https://example.com");
  assert.equal(content.faviconUrl, undefined);
});
