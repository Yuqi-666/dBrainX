// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The attribute panel drops its local draft as soon as the caller's edit
 * settles, so a refused operation leaves the control showing the value the
 * store still holds. Server rendering cannot show that: it never runs an edit.
 * This file mounts a real client root in jsdom and types into the control.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { act, lazy } from "react";
import type { ComponentType } from "react";
import type {
  NodeContentDescriptor,
  NodeContentViewProps,
} from "@workspace/plugin-sdk/ui";

import { registerNodeContent } from "../node-content/registry.ts";
import { AttributeFieldsHost } from "./attribute-fields-host.tsx";

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

const { createRoot } = (await import(
  "react-dom/client"
)) as typeof import("react-dom/client");

function NullContent() {
  return null;
}

function descriptorOf(type: string): NodeContentDescriptor {
  const preview = NullContent as ComponentType<NodeContentViewProps>;
  return {
    type,
    pluginId: "plugin.panel",
    label: type,
    editor: lazy(async () => ({ default: preview })),
    preview: lazy(async () => ({ default: preview })),
    icon: NullContent,
  };
}

const TYPE = "panel.video";

registerNodeContent({
  ...descriptorOf(TYPE),
  attributes: {
    fields: [
      {
        field: "coverUrl",
        label: "Cover",
        kind: "cover",
        optional: true,
        operationId: "video.setCover",
      },
    ],
  },
});

const READ_ONLY_TYPE = "panel.image";

registerNodeContent({
  ...descriptorOf(READ_ONLY_TYPE),
  attributes: {
    fields: [
      {
        field: "url",
        label: "Content URL",
        kind: "url",
        placeholder: "https://…",
      },
    ],
  },
});

const valueSetter = Object.getOwnPropertyDescriptor(
  dom.window.HTMLInputElement.prototype,
  "value",
)?.set;

function typeInto(input: HTMLInputElement, value: string): void {
  assert.ok(valueSetter, "jsdom exposes the native input value setter");
  valueSetter.call(input, value);
  input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
}

test("a refused field edit shows the stored value again", async () => {
  const seen: Array<{ field: string; value: string }> = [];
  let settle: () => void = () => {};

  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(
      <AttributeFieldsHost
        type={TYPE}
        content={{ coverUrl: "/files/stored.png" }}
        onFieldChange={(field, value) => {
          seen.push({ field: field.field, value });
          return new Promise<void>((resolve) => {
            settle = resolve;
          });
        }}
      />,
    );
  });

  const input = container.querySelector("input");
  assert.ok(input);
  assert.equal(input.value, "/files/stored.png");

  await act(async () => {
    typeInto(input, "/files/typed.png");
  });

  assert.deepEqual(seen, [{ field: "coverUrl", value: "/files/typed.png" }]);
  assert.equal(
    input.value,
    "/files/typed.png",
    "the typed value stays visible while the operation is in flight",
  );

  await act(async () => {
    settle();
  });

  assert.equal(
    input.value,
    "/files/stored.png",
    "the draft was refused, so the control falls back to the store's value",
  );

  await act(async () => root.unmount());
  container.remove();
});

test("a field with no declared operation is read-only", async () => {
  const seen: string[] = [];
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(
      <AttributeFieldsHost
        type={READ_ONLY_TYPE}
        content={{ url: "/api/files/files/rec1/photo.png" }}
        onFieldChange={(field) => {
          seen.push(field.field);
        }}
      />,
    );
  });

  const row = container.querySelector("[data-attribute-field='url']");
  assert.ok(row);
  assert.notEqual(row.getAttribute("data-read-only"), null);
  const input = container.querySelector("input");
  assert.ok(input);
  assert.equal(input.value, "/api/files/files/rec1/photo.png");
  assert.equal(input.disabled, true);
  assert.equal(input.readOnly, true);

  await act(async () => {
    typeInto(input, "/api/files/files/rec2/other.png");
  });

  assert.deepEqual(seen, [], "a read-only field raises no operation");
  assert.equal(input.value, "/api/files/files/rec1/photo.png");

  await act(async () => root.unmount());
  container.remove();
});
