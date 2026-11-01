// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The shared builtin operation catalogue.
 *
 * The plan fixes this catalogue, so the first case compares it as a set: one
 * operation more or less fails here. Every definition carries an input schema
 * and is exercised with one minimal valid and one refused input, because an
 * operation the executor cannot validate must never reach the registry.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { Validator } from "@cfworker/json-schema";
import type { OutputUnit, Schema } from "@cfworker/json-schema";
import {
  defineOperationDefinition,
  type OperationDefinitionSpec,
} from "@workspace/plugin-sdk";

import { builtinPluginId } from "./node-types.ts";
import { operations } from "./operations.ts";

const EXPECTED_OPERATION_IDS = [
  "audio.attachFile",
  "image.attachFile",
  "node.add",
  "node.addTag",
  "node.clearContent",
  "node.clearCover",
  "node.clearIcon",
  "node.delete",
  "node.pin",
  "node.removeTag",
  "node.setAbstract",
  "node.setCover",
  "node.setIcon",
  "node.setPermission",
  "node.setSemanticId",
  "node.setStateData",
  "node.setTitle",
  "node.unpin",
  "pdf.attachFile",
  "video.attachFile",
  "webpage.attachFile",
];

const MEDIA_ATTACH_OPERATIONS = new Map([
  ["image.attachFile", "image"],
  ["pdf.attachFile", "pdf"],
  ["video.attachFile", "video"],
  ["audio.attachFile", "audio"],
]);

interface InputCase {
  readonly valid: unknown;
  readonly invalid: readonly unknown[];
}

/** One minimal valid input and the inputs the schema must refuse. */
const INPUT_CASES: ReadonlyMap<string, InputCase> = new Map([
  [
    "node.add",
    {
      valid: { nodeType: "text" },
      invalid: [
        {},
        { nodeType: "text", title: "Untitled" },
        { nodeType: "text", content: {} },
        { nodeType: "text", id: "node-1" },
        { nodeType: "text", workspaceId: "workspace-1" },
      ],
    },
  ],
  [
    "node.clearContent",
    { valid: {}, invalid: [{ content: {} }, { nodeId: "n1" }] },
  ],
  [
    "webpage.attachFile",
    {
      valid: { uploadId: "file-1" },
      invalid: [{}, { uploadId: "" }, { uploadId: "file-1", fileSize: 12 }],
    },
  ],
  [
    "video.attachFile#provenance",
    {
      valid: { uploadId: "file-1", source: "online", sourceUrl: "https://x/y" },
      invalid: [{ uploadId: "file-1", source: "network" }],
    },
  ],
  [
    "node.setTitle",
    {
      valid: { title: "" },
      invalid: [{ title: 42 }, { title: "a", abstract: "b" }],
    },
  ],
  [
    "node.setAbstract",
    { valid: { abstract: "Summary" }, invalid: [{ abstract: null }, {}] },
  ],
  [
    "node.setSemanticId",
    { valid: { semanticId: "node:abc" }, invalid: [{ semanticId: "" }, {}] },
  ],
  [
    "node.setIcon",
    {
      valid: { icon: { kind: "emoji", value: "📄" } },
      invalid: [
        { icon: { kind: "emoji" } },
        { icon: { kind: "emoji", value: "x", extra: 1 } },
        { icon: null },
      ],
    },
  ],
  ["node.clearIcon", { valid: {}, invalid: [{ icon: null }] }],
  [
    "node.setCover",
    {
      valid: { cover: { kind: "image", url: "https://cdn.example/x.png" } },
      invalid: [
        { cover: { kind: "image" } },
        { cover: { kind: "node" } },
        { cover: null },
      ],
    },
  ],
  [
    "node.clearCover",
    { valid: {}, invalid: [{ cover: { kind: "node", nodeId: "n1" } }] },
  ],
  ["node.pin", { valid: {}, invalid: [{ isPinned: true }] }],
  ["node.unpin", { valid: {}, invalid: [{ isPinned: false }] }],
  [
    "node.setPermission",
    { valid: { permission: "public" }, invalid: [{ permission: "owner" }, {}] },
  ],
  [
    "node.addTag",
    { valid: { tag: "research" }, invalid: [{ tag: "" }, { tags: ["a"] }] },
  ],
  ["node.removeTag", { valid: { tag: "research" }, invalid: [{}] }],
  [
    "node.setStateData",
    {
      valid: { stateData: { client: {}, server: {} } },
      invalid: [
        { stateData: { client: {} } },
        { stateData: { client: {}, server: {}, deletedAt: null } },
      ],
    },
  ],
  ...["image", "pdf", "video", "audio"].map(
    (type): [string, InputCase] => [
      `${type}.attachFile`,
      {
        valid: { uploadId: "upload-1" },
        invalid: [
          { uploadId: "" },
          { uploadId: "upload-1", fileSize: 1024 },
          {},
        ],
      },
    ],
  ),
  ["node.delete", { valid: {}, invalid: [{ hard: true }] }],
]);

function validate(definition: (typeof operations)[number], input: unknown) {
  return new Validator(
    definition.inputSchema as unknown as Schema,
    "2020-12",
  ).validate(input);
}

function describeErrors(errors: readonly OutputUnit[]): string {
  return errors
    .map((error) => `${error.instanceLocation} ${error.error}`)
    .join("\n");
}

test("declares exactly the shared catalogue, once each", () => {
  const ids = operations.map((definition) => definition.id);

  assert.deepEqual([...ids].sort(), EXPECTED_OPERATION_IDS);
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual(
    [...new Set([...INPUT_CASES.keys()].map((key) => key.replace(/#.*$/, "")))].sort(),
    [...EXPECTED_OPERATION_IDS].sort(),
    "every operation is exercised and no exercise is orphaned",
  );
});

test("ids follow <domain>.<verb> and handler references stay inside the plugin", () => {
  const handlers = new Set<string>();

  for (const definition of operations) {
    assert.match(
      definition.id,
      /^[A-Za-z][A-Za-z0-9-]*(?:\.[A-Za-z][A-Za-z0-9-]*)+$/,
      definition.id,
    );
    assert.match(
      definition.handler,
      new RegExp(`^plugin:${builtinPluginId.replace(/\./g, "\\.")}#[A-Za-z_$][A-Za-z0-9_$]*$`),
      definition.id,
    );
    assert.equal(handlers.has(definition.handler), false, definition.handler);
    handlers.add(definition.handler);
  }
});

test("node.add is the only create, and only an attach or a clear narrows appliesTo", () => {
  for (const definition of operations) {
    if (definition.id === "node.add") {
      assert.equal(definition.target, "workspace");
      assert.equal(definition.effect, "create");
      assert.equal(definition.idempotent, false, "every call creates a node");
      continue;
    }

    assert.equal(definition.target, "node", definition.id);
    const mediaType = MEDIA_ATTACH_OPERATIONS.get(definition.id);
    if (mediaType !== undefined) {
      assert.deepEqual(definition.appliesTo, { nodeTypes: [mediaType] });
      continue;
    }
    // The two shared operations that name the types they apply to: a web page
    // document can only be attached to a web page node, and only a type with
    // one payload can be cleared.
    if (definition.id === "webpage.attachFile") {
      assert.deepEqual(definition.appliesTo, { nodeTypes: ["webpage"] });
      continue;
    }
    if (definition.id === "node.clearContent") {
      assert.deepEqual(definition.appliesTo, {
        nodeTypes: [
          "text",
          "rich-text",
          "webpage",
          "website",
          "image",
          "pdf",
          "video",
          "audio",
        ],
      });
      continue;
    }
    assert.equal(
      definition.appliesTo,
      undefined,
      `${definition.id} must stay shared by every node type`,
    );
  }

  assert.equal(
    operations.filter((definition) => definition.effect === "create").length,
    1,
  );
  assert.equal(
    operations.filter((definition) => definition.effect === "delete").length,
    1,
  );
});

test("every definition carries a closed input schema and a capability", () => {
  for (const definition of operations) {
    const schema = definition.inputSchema as Record<string, unknown>;

    assert.equal(schema.type, "object", definition.id);
    assert.equal(schema.additionalProperties, false, definition.id);
    assert.ok(definition.requiredCapabilities.length > 0, definition.id);
    for (const capability of definition.requiredCapabilities)
      assert.equal(typeof capability, "string", definition.id);
  }
});

test("every operation accepts its minimal input and refuses an invalid one", () => {
  for (const definition of operations) {
    const cases = INPUT_CASES.get(definition.id);
    assert.ok(cases, definition.id);

    const accepted = validate(definition, cases.valid);
    assert.equal(
      accepted.valid,
      true,
      `${definition.id} refused its minimal input: ${describeErrors(accepted.errors)}`,
    );

    assert.ok(cases.invalid.length > 0, definition.id);
    for (const input of cases.invalid) {
      const refused = validate(definition, input);
      assert.equal(
        refused.valid,
        false,
        `${definition.id} accepted ${JSON.stringify(input)}`,
      );
      assert.ok(refused.errors.length > 0, definition.id);
    }
  }
});

test("node.add refuses a title, a content block and a client id", () => {
  const add = operations.find((definition) => definition.id === "node.add");
  assert.ok(add);

  for (const field of ["title", "content", "id"]) {
    const result = validate(add, { nodeType: "text", [field]: {} });
    assert.equal(result.valid, false, field);
    assert.match(describeErrors(result.errors), /additional propert/i, field);
  }
});

test("an operation declared without an input schema is refused", () => {
  const withoutSchema = {
    id: "node.setTitle",
    pluginId: builtinPluginId,
    exportName: "nodeSetTitle",
    target: "node",
    effect: "update",
    requiredCapabilities: ["node.write"],
  } as unknown as OperationDefinitionSpec;

  assert.throws(() => defineOperationDefinition(withoutSchema), {
    name: "TypeError",
    message: /inputSchema/,
  });
});
