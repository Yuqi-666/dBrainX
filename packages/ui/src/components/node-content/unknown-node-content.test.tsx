// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The fallback view must stay renderable for any persisted payload: content
 * reaches it as runtime data, so a cycle, a huge string, a bigint or a throwing
 * getter cannot be allowed to blank the page.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { NodeData } from "@workspace/interfaces";

import {
  summarizeNodeContent,
  UnknownNodeContent,
} from "./unknown-node-content.tsx";

test("a cyclic payload becomes a marked summary instead of throwing", () => {
  const cyclic: Record<string, unknown> = { title: "Example" };
  cyclic.self = cyclic;

  const summary = summarizeNodeContent(cyclic);

  assert.match(summary, /"title":"Example"/);
  assert.match(summary, /\[Circular\]/);
});

test("a huge payload is truncated at the cap", () => {
  const summary = summarizeNodeContent({ text: "x".repeat(50_000) }, 64);

  assert.equal(summary.length, 65);
  assert.ok(summary.endsWith("…"));
});

test("a bigint and a throwing getter are reported, never thrown", () => {
  assert.match(summarizeNodeContent({ size: 10n }), /"size":"10n"/);

  const broken = {
    get boom(): never {
      throw new Error("getter exploded");
    },
  };
  assert.match(summarizeNodeContent(broken), /unserializable: getter exploded/);
});

test("the fallback renders a cyclic node's type and summary", () => {
  const content: Record<string, unknown> = { title: "Example" };
  content.self = content;
  const node = { nodeType: "ghost", content } as unknown as NodeData;

  const html = renderToStaticMarkup(<UnknownNodeContent node={node} />);

  assert.match(html, /data-node-content-fallback=""/);
  assert.match(html, /ghost/);
  assert.match(html, /\[Circular\]/);
});
