// SPDX-License-Identifier: AGPL-3.0-only

/**
 * `NodeContentEditor` is a registry host, not a ten-way switch.
 *
 * The test registers one descriptor per builtin type id — the same ids the
 * builtin plugin declares — and proves the host renders *that* type's editor for
 * each of them and nothing for a type no plugin contributes. Each stub editor
 * carries a `data-editor-control` marker unique to its type, so a host that
 * routed a node to the wrong component, or kept a hardcoded fallback, fails here
 * instead of merely "rendering without throwing".
 *
 * The real editors live in `plugins/builtin/ui/node-content/`; a `packages/ui`
 * test cannot import them (`packages/ui` must not import `plugins/*`, and the UI
 * test runner refuses a module outside the package). The descriptors below are
 * therefore stand-ins for that table's *shape*; the plugin's own components are
 * exercised by the web build and by `pnpm --filter @plugin/builtin typecheck`.
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

import { registerNodeContent } from "./registry.ts";
import { NodeContentEditor } from "./node-content-editor.tsx";

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

function makeNode(nodeType: string): NodeData {
  return {
    id: "node-1",
    nodeType,
    content: { title: "Example" },
  } as unknown as NodeData;
}

function editorOf(type: string): ComponentType<NodeContentViewProps> {
  return function StubEditor({ node }: NodeContentViewProps) {
    return (
      <div data-editor-control={type} data-node-type={node.nodeType}>
        {`editor:${type}`}
      </div>
    );
  };
}

function previewOf(type: string): ComponentType<NodeContentViewProps> {
  return function StubPreview() {
    return <div data-preview-control={type}>{`preview:${type}`}</div>;
  };
}

function descriptorOf(type: string): NodeContentDescriptor {
  const Editor = editorOf(type);
  const Preview = previewOf(type);
  return {
    type,
    pluginId: "dbrainx.builtin",
    label: type,
    editor: lazy(async () => ({ default: Editor })),
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

test("every builtin type renders its own editor through the registry", async () => {
  for (const type of BUILTIN_TYPES) {
    const { container, unmount } = await renderInDom(
      <NodeContentEditor node={makeNode(type)} />,
    );
    const controls = container.querySelectorAll("[data-editor-control]");
    assert.equal(controls.length, 1, `${type} mounts exactly one editor`);
    assert.equal(controls[0]?.getAttribute("data-editor-control"), type);
    assert.equal(controls[0]?.getAttribute("data-node-type"), type);
    assert.equal(
      container.querySelector("[data-node-content-fallback]"),
      null,
      `${type} does not degrade`,
    );
    await unmount();
  }
});

test("two types never share an editor component", async () => {
  const seen = new Map<string, Element | null>();
  for (const type of BUILTIN_TYPES) {
    const { container, unmount } = await renderInDom(
      <NodeContentEditor node={makeNode(type)} />,
    );
    const control = container.querySelector("[data-editor-control]");
    assert.ok(control, `${type} has a control`);
    assert.equal(seen.get(type), undefined);
    seen.set(type, control);
    await unmount();
  }
  const labels = [...seen.keys()];
  assert.deepEqual(labels, [...BUILTIN_TYPES]);
});

test("an unregistered type renders the fallback and no editor control", () => {
  const html = renderToStaticMarkup(
    <NodeContentEditor node={makeNode("plugin.unregistered")} />,
  );

  assert.match(html, /data-node-content-fallback=""/);
  assert.match(html, /plugin\.unregistered/);
  assert.doesNotMatch(html, /data-editor-control/);
});
