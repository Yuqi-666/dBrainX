// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The operation builder pair and the contract types behind them.
 *
 * The compile-time half is the assertion: `OperationContext` and
 * `OperationHandler` must resolve from the SDK's type entry, and an
 * `OperationRun` must be assignable to the domain handler, so the author-facing
 * signature cannot drift from the registry it feeds. `pnpm typecheck` is what
 * proves it; the runtime half exercises the definition-only builder, including
 * the refusal of an operation with no input schema.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  defineOperation,
  defineOperationDefinition,
} from "./define-operation.ts";
import type { OperationDefinitionSpec, OperationRun } from "./define-operation.ts";
import type { OperationContext, OperationHandler } from "./types.ts";

const INPUT_SCHEMA = {
  type: "object",
  properties: { title: { type: "string" } },
  required: ["title"],
  additionalProperties: false,
} as const;

const run: OperationRun<{ readonly title: string }, string> = async (
  input,
  context,
) => `${context.target.kind}:${input.title}`;

const untypedRun: OperationRun = async (input, context) =>
  `${context.target.kind}:${String(input)}`;

const handler: OperationHandler = untypedRun;
const asRun: OperationRun = handler;

function declaration(
  overrides: Partial<OperationDefinitionSpec> = {},
): OperationDefinitionSpec {
  return {
    id: "note.setTitle",
    pluginId: "acme.notes",
    exportName: "noteSetTitle",
    target: "node",
    effect: "update",
    inputSchema: INPUT_SCHEMA,
    requiredCapabilities: ["node.write"],
    ...overrides,
  };
}

test("a run is an OperationHandler and sees the domain OperationContext", async () => {
  assert.equal(handler, untypedRun);
  assert.equal(asRun, untypedRun);

  const context = { target: { kind: "workspace", workspaceId: "w1" } } as unknown as OperationContext;
  assert.equal(await run({ title: "Hello" }, context), "workspace:Hello");
  assert.equal(await handler("x", context), "workspace:x");
});

test("defineOperation keeps the paired handler and completes its export name", () => {
  const operation = defineOperation({
    id: "note.setTitle",
    pluginId: "acme.notes",
    target: "node",
    effect: "update",
    inputSchema: INPUT_SCHEMA,
    requiredCapabilities: ["node.write"],
    run,
  });

  assert.equal(operation.definition.handler, "plugin:acme.notes#");
  assert.equal(
    operation.bindExportName("noteSetTitle").definition.handler,
    "plugin:acme.notes#noteSetTitle",
  );
  assert.equal(
    operation.bindExportName("noteSetTitle").run,
    run,
    "binding must not replace the handler",
  );
});

test("defineOperationDefinition names the handler export and keeps every field", () => {
  const definition = defineOperationDefinition(declaration());

  assert.equal(definition.handler, "plugin:acme.notes#noteSetTitle");
  assert.deepEqual(definition.inputSchema, INPUT_SCHEMA);
  assert.deepEqual(definition.requiredCapabilities, ["node.write"]);
  assert.equal(definition.id, "note.setTitle");
});

test("an operation declared without an input schema is refused", () => {
  const withoutSchema = declaration();
  delete (withoutSchema as { inputSchema?: unknown }).inputSchema;

  assert.throws(() => defineOperationDefinition(withoutSchema), {
    name: "TypeError",
    message: /inputSchema/,
  });
});

test("an export name that is not a module identifier is refused", () => {
  assert.throws(
    () => defineOperationDefinition(declaration({ exportName: "note.set-title" })),
    { name: "TypeError", message: /exportName/ },
  );
});
