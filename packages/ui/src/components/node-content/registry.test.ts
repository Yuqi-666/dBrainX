// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The registry's three rules: a same-plugin re-registration is idempotent, a
 * cross-plugin collision throws and names both plugins, and an unregistered type
 * reads as `undefined` rather than a fabricated descriptor.
 *
 * This is a plain `.ts` test on `node:test`, so the registry runs without a JSX
 * transform (`node --experimental-strip-types --test <this file>`).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { lazy } from "react";
import type { ComponentType } from "react";
import type {
  NodeContentDescriptor,
  NodeContentViewProps,
} from "@workspace/plugin-sdk/ui";

import {
  getNodeContentDescriptor,
  listNodeContentDescriptors,
  registerNodeContent,
} from "./registry.ts";

function NullContent() {
  return null;
}

function descriptorOf(pluginId: string, type: string): NodeContentDescriptor {
  const Content = NullContent as ComponentType<NodeContentViewProps>;
  return {
    type,
    pluginId,
    label: `${pluginId}:${type}`,
    editor: lazy(async () => ({ default: Content })),
    preview: lazy(async () => ({ default: Content })),
    icon: NullContent,
  };
}

test("one plugin registering one type twice keeps a single descriptor", () => {
  const first = descriptorOf("plugin.solo", "registry.same");
  const second = descriptorOf("plugin.solo", "registry.same");

  registerNodeContent(first);
  assert.doesNotThrow(() => registerNodeContent(second));

  const matching = listNodeContentDescriptors().filter(
    (descriptor) => descriptor.type === "registry.same",
  );
  assert.equal(matching.length, 1);
  assert.equal(getNodeContentDescriptor("registry.same"), second);
});

test("two plugins claiming one type throw and name both plugin ids", () => {
  registerNodeContent(descriptorOf("plugin.owner", "registry.collision"));

  assert.throws(
    () => registerNodeContent(descriptorOf("plugin.intruder", "registry.collision")),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /registry\.collision/);
      assert.match(error.message, /plugin\.owner/);
      assert.match(error.message, /plugin\.intruder/);
      return true;
    },
  );

  assert.equal(
    getNodeContentDescriptor("registry.collision")?.pluginId,
    "plugin.owner",
  );
});

test("an unregistered type reads as undefined and stays out of the list", () => {
  assert.equal(getNodeContentDescriptor("registry.missing"), undefined);
  assert.ok(
    !listNodeContentDescriptors().some(
      (descriptor) => descriptor.type === "registry.missing",
    ),
  );
});
