// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The counter fixture plugin (§5.4.11).
 *
 * A third-party type has to be discoverable without a host change, so this
 * suite checks the whole chain the host and the web bundle read: the manifest
 * reader finds the plugin, its type and its operation; the generated UI map
 * imports the plugin's UI entry; and the declarations themselves are valid
 * (closed schema, one `appliesTo` type, the increment rule).
 */

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { Validator } from "@cfworker/json-schema";
import type { Schema } from "@cfworker/json-schema";

import {
  readPluginManifests,
  renderPluginUiModule,
} from "../../../scripts/lib/plugin-packages.mjs";

import { nodeContentDescriptors } from "../ui/index.ts";
import {
  counterIncrementOperation,
  counterNodeType,
  counterPluginId,
  createCounterContent,
  incrementCounter,
  nodeTypes,
  operations,
} from "./index.ts";

const root = fileURLToPath(new URL("../../../", import.meta.url));

function validate(schema: unknown, input: unknown) {
  return new Validator(schema as Schema, "2020-12").validate(input);
}

test("declares the counter type and its increment operation", () => {
  assert.equal(counterPluginId, "dbrainx.counter");
  assert.deepEqual(
    nodeTypes.map((definition) => definition.type),
    ["counter"],
  );
  assert.deepEqual(
    operations.map((definition) => definition.id),
    ["counter.increment", "counter.tick"],
  );
  assert.deepEqual([...counterNodeType.operations], ["counter.increment", "counter.tick"]);
  assert.deepEqual(
    counterNodeType.schedules?.map((schedule) => schedule.operationId),
    ["counter.tick"],
  );

  const draft = createCounterContent();
  assert.deepEqual(draft, { value: 0 });
  assert.equal(
    validate(counterNodeType.schema, draft).valid,
    true,
    "defaultContent() must satisfy the type schema",
  );
});

test("counter.increment is a self node operation on the counter type only", () => {
  const definition = counterIncrementOperation;

  assert.equal(definition.id, "counter.increment");
  assert.equal(definition.target, "node");
  assert.equal(definition.effect, "invoke");
  assert.equal(definition.reach, "self");
  assert.deepEqual(definition.appliesTo, { nodeTypes: ["counter"] });
  assert.deepEqual([...definition.requiredCapabilities], ["node.write"]);
  assert.equal(definition.idempotent, false);
  assert.equal(definition.handler, "plugin:dbrainx.counter#counterIncrement");
});

test("counter.increment takes an optional numeric step and nothing else", () => {
  const schema = counterIncrementOperation.inputSchema;

  assert.equal(validate(schema, { by: 2 }).valid, true);
  assert.equal(validate(schema, {}).valid, true, "the step defaults to one");
  assert.equal(validate(schema, { by: "2" }).valid, false);
  assert.equal(validate(schema, { by: 1, step: 2 }).valid, false);
});

test("the increment rule adds the step, defaulting to one", () => {
  assert.deepEqual(incrementCounter({ value: 2 }), { value: 3 });
  assert.deepEqual(incrementCounter({ value: 2 }, 5), { value: 7 });
  assert.deepEqual(incrementCounter({ value: -1 }, -2), { value: -3 });
});

test("the manifest reader discovers the counter type and its operation", async () => {
  const plugins = await readPluginManifests(root);

  assert.deepEqual(
    plugins.map((plugin) => plugin.id),
    ["dbrainx.builtin", "dbrainx.counter"],
  );

  const counter = plugins.find((plugin) => plugin.id === "dbrainx.counter");
  assert.ok(counter);
  assert.deepEqual(counter.nodeTypeIds, ["counter"]);
  assert.equal(counter.ui, "@plugin/counter/ui");
  assert.equal(counter.nodeTypes, "./server/index.ts");
  assert.ok(counter.nodeTypesPath);
  assert.equal(existsSync(counter.nodeTypesPath), true);
  assert.equal(existsSync(counter.serverPath), true);
});

test("the generated UI map imports both plugins and matches the file on disk", async () => {
  const plugins = await readPluginManifests(root);
  const rendered = renderPluginUiModule(plugins);

  assert.equal(plugins.length, 2);
  assert.match(rendered, /import \* as plugin0 from "@plugin\/builtin\/ui";/);
  assert.match(rendered, /import \* as plugin1 from "@plugin\/counter\/ui";/);
  assert.match(rendered, /pluginId: "dbrainx\.counter"/);

  const generated = await readFile(
    `${root}apps/web/lib/plugin-ui.generated.ts`,
    "utf8",
  );
  assert.equal(
    generated,
    rendered,
    "regenerate with `node scripts/generate-plugin-ui.mjs`",
  );
});

test("the counter UI entry registers one descriptor under the counter plugin", () => {
  const descriptors = nodeContentDescriptors.filter(
    (descriptor) => descriptor.type === "counter",
  );

  assert.equal(descriptors.length, 1);
  const descriptor = descriptors[0];
  assert.ok(descriptor);
  assert.equal(descriptor.pluginId, counterPluginId);
  assert.notEqual(descriptor.label.trim(), "");
  assert.equal(typeof descriptor.editor, "object");
  assert.equal(typeof descriptor.preview, "object");
  assert.equal(typeof descriptor.icon, "function");
});
