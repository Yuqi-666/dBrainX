// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The preview slot is registry-driven, and a type no plugin contributes degrades
 * to the JSON summary instead of borrowing `TextPreview`'s rendering.
 *
 * The test mounts the same host `NodePreviewBody` mounts (`slot="preview"`); it
 * cannot mount `NodePreviewBody` itself, because the body renders
 * `PreviewHeader`, and the UI test runner loads `@workspace/*` imports through
 * Node's ESM resolver, which cannot follow the extensionless imports inside
 * `@workspace/store` and `@workspace/api-client`. The body file is a thin wrapper
 * around this host, so the dispatch rule asserted here is the rule it obeys.
 *
 * Each stub preview carries a `data-preview-control` marker unique to its type,
 * so a slot that mis-routes a node — or that kept the old
 * `default: <TextPreview/>` branch — fails here. The real previews live in
 * `plugins/builtin/ui/previews/`, which a `packages/ui` test may not import.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { act, lazy } from "react";
import type { ComponentType, ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import type { NodeData } from "@workspace/interfaces";
import type {
  NodeContentDescriptor,
  NodeContentViewProps,
} from "@workspace/plugin-sdk/ui";

import { registerNodeContent } from "../node-content/registry.ts";
import { NodeContentHost } from "../plugin-ui/node-content-host.tsx";

const jsdomSpecifier = "jsdom";
interface JsdomModule {
  JSDOM: new (
    html?: string,
    options?: { url?: string },
  ) => { window: Window & typeof globalThis };
}
const { JSDOM } = (await import(jsdomSpecifier)) as JsdomModule;

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://localhost",
});
const globals = globalThis as unknown as {
  window: Window & typeof globalThis;
  document: Document;
  IS_REACT_ACT_ENVIRONMENT: boolean;
};
globals.window = dom.window;
globals.document = dom.window.document;
globals.IS_REACT_ACT_ENVIRONMENT = true;

/** The ten node type ids `plugins/builtin/plugin.json` declares. */
const BUILTIN_TYPES = [
  "text",
  "rich-text",
  "image",
  "pdf",
  "video",
  "audio",
  "webpage",
  "website",
  "collection",
  "database",
] as const;

function NullIcon() {
  return null;
}

function makeNode(nodeType: string, content: unknown = {}): NodeData {
  return {
    id: "node-1",
    nodeType,
    content,
  } as unknown as NodeData;
}

function previewOf(type: string): ComponentType<NodeContentViewProps> {
  return function StubPreview({ node }: NodeContentViewProps) {
    return (
      <div data-preview-control={type} data-node-type={node.nodeType}>
        {`preview:${type}`}
      </div>
    );
  };
}

function descriptorOf(type: string): NodeContentDescriptor {
  const Preview = previewOf(type);
  return {
    type,
    pluginId: "dbrainx.builtin",
    label: type,
    editor: lazy(async () => ({ default: Preview })),
    preview: lazy(async () => ({ default: Preview })),
    icon: NullIcon,
  };
}

for (const type of BUILTIN_TYPES) registerNodeContent(descriptorOf(type));

async function renderInDom(element: ReactElement): Promise<{
  container: HTMLElement;
  unmount: () => Promise<void>;
}> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container, { onCaughtError: () => {} });
  await act(async () => {
    root.render(element);
  });
  return {
    container,
    unmount: async () => {
      await act(async () => root.unmount());
      container.remove();
    },
  };
}

test("every builtin type renders its own preview through the registry", async () => {
  for (const type of BUILTIN_TYPES) {
    const { container, unmount } = await renderInDom(
      <NodeContentHost node={makeNode(type)} slot="preview" />,
    );
    const controls = container.querySelectorAll("[data-preview-control]");
    assert.equal(controls.length, 1, `${type} mounts exactly one preview`);
    assert.equal(controls[0]?.getAttribute("data-preview-control"), type);
    assert.equal(controls[0]?.getAttribute("data-node-type"), type);
    assert.equal(
      container.querySelector("[data-node-content-fallback]"),
      null,
      `${type} does not degrade`,
    );
    await unmount();
  }
});

test("an unknown type renders the JSON preview, never the text preview", async () => {
  const { container, unmount } = await renderInDom(
    <NodeContentHost
      node={makeNode("plugin.unregistered", { title: "Ghost" })}
      slot="preview"
    />,
  );

  const fallback = container.querySelector("[data-node-content-fallback]");
  assert.ok(fallback, "the fallback is mounted");
  assert.match(
    fallback.querySelector("[data-node-content-fallback-summary]")
      ?.textContent ?? "",
    /"title":"Ghost"/,
    "the fallback shows the node content as JSON",
  );
  assert.equal(container.querySelector("[data-preview-control]"), null);
  assert.equal(
    container.querySelector("p.line-clamp-5"),
    null,
    "the deleted default branch no longer borrows TextPreview's body",
  );
  await unmount();
});

test("a registered preview is what an unregistered type never borrows", async () => {
  const { container, unmount } = await renderInDom(
    <NodeContentHost node={makeNode("text")} slot="preview" />,
  );
  assert.equal(
    container
      .querySelector("[data-preview-control]")
      ?.getAttribute("data-preview-control"),
    "text",
  );
  assert.equal(container.querySelector("[data-node-content-fallback]"), null);
  await unmount();
});

test("server rendering an unknown preview shows the JSON summary", () => {
  const html = renderToStaticMarkup(
    <NodeContentHost
      node={makeNode("plugin.unregistered", { n: 1 })}
      slot="preview"
    />,
  );
  assert.match(html, /data-node-content-fallback=""/);
  assert.match(html, /plugin\.unregistered/);
  // React escapes the quotes of a text child on the server.
  assert.match(html, /&quot;n&quot;:1/);
});
