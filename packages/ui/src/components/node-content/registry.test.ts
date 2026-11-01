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
import {
  DEFAULT_NODE_TYPE_ICON,
  resolveNodeTypeIcon,
  resolveNodeTypeLabel,
} from "../../lib/node-type-display.ts";

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

test("a registered type displays its descriptor's label and icon", () => {
  const descriptor = descriptorOf("plugin.display", "display.registered");
  registerNodeContent(descriptor);

  assert.equal(resolveNodeTypeLabel("display.registered"), descriptor.label);
  assert.equal(resolveNodeTypeIcon("display.registered"), descriptor.icon);
  assert.notEqual(descriptor.icon, DEFAULT_NODE_TYPE_ICON);
});

test("an unregistered type displays its raw id and the default icon", () => {
  assert.equal(
    getNodeContentDescriptor("display.unregistered"),
    undefined,
    "the fixture must not be registered by an earlier case",
  );

  assert.doesNotThrow(() => resolveNodeTypeLabel("display.unregistered"));
  assert.equal(resolveNodeTypeLabel("display.unregistered"), "display.unregistered");
  assert.equal(
    resolveNodeTypeIcon("display.unregistered"),
    DEFAULT_NODE_TYPE_ICON,
  );
  assert.equal(resolveNodeTypeIcon(undefined), DEFAULT_NODE_TYPE_ICON);
  assert.equal(resolveNodeTypeIcon(null), DEFAULT_NODE_TYPE_ICON);
});

test("a descriptor with a blank label falls back to the raw id", () => {
  registerNodeContent({
    ...descriptorOf("plugin.blank", "display.blank"),
    label: "   ",
  });

  assert.equal(resolveNodeTypeLabel("display.blank"), "display.blank");
});
