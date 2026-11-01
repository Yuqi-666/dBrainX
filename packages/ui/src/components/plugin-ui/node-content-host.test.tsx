// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The host degrades instead of white-screening: a descriptor whose lazy import
 * rejects, or whose component throws, renders `UnknownNodeContent`.
 *
 * Server rendering cannot prove this — React's server renderer does not run
 * error boundaries, so a throw there aborts the render instead of hitting the
 * fallback. The file therefore mounts a real client root in jsdom and asserts on
 * the rendered output.
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
import { NodeContentHost } from "./node-content-host.tsx";
import { AttributeFieldsHost } from "./attribute-fields-host.tsx";
import {
  resolveNodeTypeIcon,
  resolveNodeTypeLabel,
} from "../../lib/node-type-display.ts";

/**
 * jsdom ships no type declarations and `@types/jsdom` is not a dependency, so
 * the specifier travels through a variable: `import(string)` types as `any`
 * while the compiled test still loads the real package at runtime.
 */
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

function NullContent() {
  return null;
}

function makeNode(nodeType: string): NodeData {
  return {
    id: "node-1",
    nodeType,
    content: { title: "Example" },
  } as unknown as NodeData;
}

function descriptorOf(
  type: string,
  editor: ComponentType<NodeContentViewProps>,
): NodeContentDescriptor {
  const preview = editor;
  return {
    type,
    pluginId: "plugin.host",
    label: type,
    editor: lazy(async () => ({ default: editor })),
    preview: lazy(async () => ({ default: preview })),
    icon: NullContent,
  };
}

function rejectingDescriptor(type: string): NodeContentDescriptor {
  const reject = () => Promise.reject(new Error("chunk failed to load"));
  return {
    type,
    pluginId: "plugin.host",
    label: type,
    editor: lazy(reject),
    preview: lazy(reject),
    icon: NullContent,
  };
}

/**
 * The specifier travels through a variable on purpose: the point of the case is
 * a module the build *cannot* resolve, so neither `tsc` nor esbuild may turn it
 * into a compile error, and the failure must reach React as a rejected chunk.
 */
const missingChunk = "./__node-content-chunk-that-does-not-exist__.ts";

function missingChunkDescriptor(type: string): NodeContentDescriptor {
  return {
    type,
    pluginId: "plugin.host",
    label: type,
    editor: lazy(() => import(missingChunk)),
    preview: lazy(() => import(missingChunk)),
    icon: NullContent,
  };
}

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

function assertFallback(container: HTMLElement, nodeType: string): void {
  assert.ok(
    container.querySelector("[data-node-content-fallback]"),
    "the unknown fallback is mounted",
  );
  assert.equal(container.querySelector("[data-node-content-skeleton]"), null);
  const text = container.textContent ?? "";
  assert.match(text, new RegExp(nodeType.replace(/\./g, "\\.")));
  assert.match(text, /"title":"Example"/);
}

/**
 * The shape of a real consumer (a page header, a library row, a preview header):
 * it asks the resolver for a glyph and a label and renders both.
 */
function DisplayRow({ type }: { type: string }) {
  const Icon = resolveNodeTypeIcon(type);
  return (
    <div data-display-row="">
      <Icon className="size-4" aria-hidden />
      <span data-display-label="">{resolveNodeTypeLabel(type)}</span>
    </div>
  );
}

test("an unregistered node type renders the unknown fallback", () => {
  const html = renderToStaticMarkup(
    <NodeContentHost node={makeNode("host.unregistered")} />,
  );
  assert.match(html, /data-node-content-fallback=""/);
  assert.match(html, /host\.unregistered/);
});

test("an unregistered node type renders the JSON fallback in the browser", async () => {
  const { container, unmount } = await renderInDom(
    <NodeContentHost node={makeNode("host.unregistered.browser")} />,
  );

  assertFallback(container, "host.unregistered.browser");

  await unmount();
});

test("a registered descriptor renders through the host", async () => {
  registerNodeContent(
    descriptorOf("host.ok", ({ node }) => <p>{`rendered-${node.nodeType}`}</p>),
  );
  const { container, unmount } = await renderInDom(
    <NodeContentHost node={makeNode("host.ok")} />,
  );
  assert.equal(container.querySelector("[data-node-content-fallback]"), null);
  assert.match(container.textContent ?? "", /rendered-host\.ok/);
  await unmount();
});

test("a lazy import that rejects renders the unknown fallback", async () => {
  registerNodeContent(rejectingDescriptor("host.rejects"));
  const { container, unmount } = await renderInDom(
    <NodeContentHost node={makeNode("host.rejects")} />,
  );
  assertFallback(container, "host.rejects");
  await unmount();
});

test("a lazy chunk that does not exist renders that type's fallback, not an error page", async () => {
  registerNodeContent(missingChunkDescriptor("host.missing-chunk"));
  const { container, unmount } = await renderInDom(
    <NodeContentHost node={makeNode("host.missing-chunk")} />,
  );

  assertFallback(container, "host.missing-chunk");
  assert.ok(
    container.isConnected,
    "the surrounding page is still mounted, so the route did not blank",
  );

  await unmount();
});

test("a component that throws renders the unknown fallback", async () => {
  function Exploding(): never {
    throw new Error("render boom");
  }
  registerNodeContent(
    descriptorOf("host.throws", Exploding as ComponentType<NodeContentViewProps>),
  );
  const { container, unmount } = await renderInDom(
    <NodeContentHost node={makeNode("host.throws")} />,
  );
  assertFallback(container, "host.throws");
  await unmount();
});

test("a consumer renders a registered type's label and icon, and degrades for an unknown one", async () => {
  function RegisteredGlyph({ className }: { className?: string }) {
    return <svg className={className} data-glyph="registered" />;
  }
  registerNodeContent({
    type: "display.rendered",
    pluginId: "plugin.host",
    label: "Rendered type",
    editor: lazy(async () => ({ default: NullContent })),
    preview: lazy(async () => ({ default: NullContent })),
    icon: RegisteredGlyph,
  });

  const { container, unmount } = await renderInDom(
    <>
      <DisplayRow type="display.rendered" />
      <DisplayRow type="display.missing" />
    </>,
  );

  const rows = container.querySelectorAll("[data-display-row]");
  const registered = rows[0];
  const missing = rows[1];

  assert.equal(
    registered?.querySelector("[data-display-label]")?.textContent,
    "Rendered type",
  );
  assert.ok(
    registered?.querySelector("svg[data-glyph='registered']"),
    "the descriptor's own icon is what the consumer draws",
  );

  assert.equal(
    missing?.querySelector("[data-display-label]")?.textContent,
    "display.missing",
  );
  assert.ok(
    missing?.querySelector("svg"),
    "an unregistered type still draws the default glyph instead of going blank",
  );

  await unmount();
});

test("the attribute panel draws the fields a descriptor contributes", () => {
  registerNodeContent({
    ...descriptorOf("attr.registered", NullContent),
    attributes: {
      fields: [
        { field: "url", label: "Content URL", kind: "url" },
        { field: "coverUrl", label: "Cover", kind: "cover", optional: true },
        {
          field: "timestamps",
          label: "Timeline",
          kind: "timeline",
          optional: true,
        },
      ],
    },
  });

  const html = renderToStaticMarkup(
    <AttributeFieldsHost
      type="attr.registered"
      content={{
        url: "/files/a.mp4",
        timestamps: [{ type: "note" }, { type: "subtitle" }],
      }}
    />,
  );

  assert.match(html, /data-attribute-field="url"/);
  assert.match(html, /data-attribute-field="coverUrl"/);
  assert.match(html, /data-attribute-field="timestamps"/);
  assert.match(html, /Content URL/);
  assert.match(html, /Timeline/);
  assert.match(html, /value="\/files\/a\.mp4"/);
  assert.match(html, /2 条记录/);
  assert.doesNotMatch(html, /data-attribute-fields-empty/);
});

test("an unregistered type renders an empty attribute panel with a notice", () => {
  let html = "";

  assert.doesNotThrow(() => {
    html = renderToStaticMarkup(
      <AttributeFieldsHost type="attr.unregistered" content={{}} />,
    );
  });

  assert.match(html, /data-attribute-fields-empty=""/);
  assert.match(html, /attr\.unregistered/);
  assert.match(html, /该类型未注册属性面板/);
  assert.doesNotMatch(html, /data-attribute-field=/);
});

test("a registered type that contributes no field renders nothing", () => {
  registerNodeContent({
    ...descriptorOf("attr.empty", NullContent),
    attributes: { fields: [] },
  });

  const html = renderToStaticMarkup(
    <AttributeFieldsHost type="attr.empty" content={{}} />,
  );

  assert.equal(html, "");
});
