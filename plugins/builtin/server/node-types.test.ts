// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The builtin node-type registration contract.
 *
 * Every definition must name a real existing type id, be version 1 under the
 * builtin plugin, carry a draft `defaultContent()` that its own JSON Schema
 * accepts, and declare unique namespaced operations. The last case pins the
 * plan's failure scenario: a video draft with no file facts must fail schema
 * validation and name the missing fields, rather than shipping a silent `{}`.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { Validator } from "@cfworker/json-schema";
import type { OutputUnit, Schema } from "@cfworker/json-schema";

import { builtinPluginId, nodeTypes } from "./node-types.ts";

const EXPECTED_TYPE_IDS = [
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
];

const VIDEO_REQUIRED_FIELDS = [
  "url",
  "coverUrl",
  "duration",
  "source",
  "fileSize",
];

type Definition = (typeof nodeTypes)[number];

function validate(definition: Definition, content: unknown) {
  return new Validator(definition.schema as unknown as Schema, "2020-12").validate(
    content,
  );
}

function describeErrors(errors: readonly OutputUnit[]): string {
  return errors
    .map((error) => `${error.instanceLocation} ${error.error}`)
    .join("\n");
}

test("declares exactly the ten builtin type ids, once each", () => {
  const ids = nodeTypes.map((definition) => definition.type);

  assert.deepEqual([...ids].sort(), [...EXPECTED_TYPE_IDS].sort());
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(
    new Set(nodeTypes.map((definition) => `${definition.pluginId}#${definition.type}`))
      .size,
    nodeTypes.length,
  );
});

test("every definition belongs to the builtin plugin at version 1", () => {
  assert.equal(builtinPluginId, "dbrainx.builtin");
  for (const definition of nodeTypes) {
    assert.equal(definition.pluginId, builtinPluginId);
    assert.equal(definition.version, 1);
    assert.notEqual(definition.display.label.trim(), "");
    assert.notEqual(definition.display.icon.trim(), "");
    assert.doesNotThrow(() => JSON.stringify(definition.schema));
  }
});

test("every defaultContent() passes its own schema", () => {
  for (const definition of nodeTypes) {
    const content = definition.defaultContent();
    assert.equal(typeof content, "object", definition.type);
    assert.notEqual(content, null, definition.type);

    const result = validate(definition, content);
    assert.equal(
      result.valid,
      true,
      `${definition.type} defaultContent: ${describeErrors(result.errors)}`,
    );
  }
});

test("defaultContent() returns a fresh draft on every call", () => {
  for (const definition of nodeTypes) {
    assert.notStrictEqual(
      definition.defaultContent(),
      definition.defaultContent(),
      definition.type,
    );
  }
});

test("operations are non-empty, namespaced and unique across the plugin", () => {
  const seen = new Set<string>();

  for (const definition of nodeTypes) {
    assert.ok(definition.operations.length > 0, definition.type);
    assert.equal(
      new Set(definition.operations).size,
      definition.operations.length,
      definition.type,
    );
    for (const operation of definition.operations) {
      assert.ok(
        operation.startsWith(`${definition.type}.`),
        `${operation} is outside ${definition.type}`,
      );
      assert.equal(seen.has(operation), false, `duplicate operation ${operation}`);
      seen.add(operation);
    }
  }
});

test("a video draft without its file facts fails with the missing fields named", () => {
  const video = nodeTypes.find((definition) => definition.type === "video");
  assert.ok(video);

  const result = validate(video, {});
  assert.equal(result.valid, false);

  const messages = result.errors
    .map((error) => error.error)
    .filter((error) => error.startsWith("Instance does not have required property"))
    .join("\n");
  for (const field of VIDEO_REQUIRED_FIELDS) {
    assert.match(messages, new RegExp(`required property "${field}"`));
  }
});
