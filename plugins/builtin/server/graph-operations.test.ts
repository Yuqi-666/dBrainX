// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The edge and view catalogue.
 *
 * The plan fixes this catalogue, so the first case compares it as a set: one
 * operation more or less fails here. The target assertions are the authorisation
 * contract in disguise — `edge.create` / `view.create` are workspace targets and
 * everything else must address its own edge or view, because that is what makes
 * the gateway's endpoint check reachable.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { Validator } from "@cfworker/json-schema";
import type { OutputUnit, Schema } from "@cfworker/json-schema";

import { graphOperations } from "./graph-operations.ts";
import { operations } from "./operations.ts";
import { typeOperations } from "./type-operations.ts";

const EXPECTED_IDS = [
  "edge.create",
  "edge.delete",
  "edge.setDirection",
  "edge.setLabel",
  "edge.setSemanticId",
  "view.create",
  "view.delete",
  "view.setFilter",
  "view.setLayout",
];

interface InputCase {
  readonly valid: unknown;
  readonly invalid: readonly unknown[];
}

const INPUT_CASES: ReadonlyMap<string, InputCase> = new Map([
  [
    "edge.create",
    {
      valid: {
        from: "node-a",
        to: "node-b",
        semanticId: "related",
        direction: "forward",
      },
      invalid: [
        {},
        { from: "node-a", to: "node-b", semanticId: "related" },
        {
          from: "node-a",
          to: "node-b",
          semanticId: "related",
          direction: "sideways",
        },
        {
          from: "",
          to: "node-b",
          semanticId: "related",
          direction: "forward",
        },
        {
          from: "node-a",
          to: "node-b",
          semanticId: "related",
          direction: "forward",
          id: "edge-1",
        },
        {
          from: "node-a",
          to: "node-b",
          semanticId: "related",
          direction: "forward",
          workspaceId: "other",
        },
      ],
    },
  ],
  ["edge.setLabel", { valid: { label: "" }, invalid: [{ label: 42 }, {}] }],
  [
    "edge.setSemanticId",
    { valid: { semanticId: "related" }, invalid: [{ semanticId: "" }, {}] },
  ],
  [
    "edge.setDirection",
    {
      valid: { direction: "bidirectional" },
      invalid: [{ direction: "toggle" }, { direction: "forward", extra: 1 }],
    },
  ],
  ["edge.delete", { valid: {}, invalid: [{ hard: true }] }],
  [
    "view.create",
    {
      valid: { name: "Overview", viewType: "Force" },
      invalid: [
        {},
        { name: "Overview", viewType: "force" },
        { name: "Overview", viewType: "Force", id: "view-1" },
        {
          name: "Overview",
          viewType: "Force",
          visualConfig: { backgroundColor: 1 },
        },
      ],
    },
  ],
  [
    "view.setLayout",
    {
      valid: { visualConfig: { snapToGrid: true } },
      invalid: [{ visualConfig: { unknownField: 1 } }, {}],
    },
  ],
  [
    "view.setFilter",
    {
      valid: { filterConfig: { selectedNodes: ["node-a"] } },
      invalid: [{ filterConfig: { selectedNodes: "node-a" } }, {}],
    },
  ],
  ["view.delete", { valid: {}, invalid: [{ id: "view-1" }] }],
]);

function validate(input: unknown, definition = graphOperations[0]) {
  if (definition === undefined) throw new Error("no definition to validate");
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

test("declares exactly the edge and view catalogue, once each", () => {
  const ids = graphOperations.map((definition) => definition.id);

  assert.deepEqual([...ids].sort(), EXPECTED_IDS);
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual(
    [...INPUT_CASES.keys()].sort(),
    EXPECTED_IDS,
    "every operation is exercised and no exercise is orphaned",
  );
});

test("no operation id is declared twice across the builtin catalogues", () => {
  const seen = new Map<string, string>();
  for (const [catalogue, definitions] of [
    ["shared", operations],
    ["type", typeOperations],
    ["graph", graphOperations],
  ] as const) {
    for (const definition of definitions) {
      const previous = seen.get(definition.id);
      assert.equal(
        previous,
        undefined,
        `${definition.id} is declared in both ${String(previous)} and ${catalogue}`,
      );
      seen.set(definition.id, catalogue);
    }
  }
});

test("create targets the workspace and every other operation targets its object", () => {
  for (const definition of graphOperations) {
    if (definition.effect === "create") {
      assert.equal(definition.target, "workspace", definition.id);
      assert.equal(definition.idempotent, false, definition.id);
      continue;
    }
    assert.notEqual(definition.target, "workspace", definition.id);
    assert.equal(
      definition.target,
      definition.id.slice(0, definition.id.indexOf(".")),
      definition.id,
    );
  }

  for (const definition of graphOperations) {
    if (definition.effect === "delete") {
      assert.equal(definition.idempotent, true, definition.id);
    }
  }
});

test("every definition carries a closed input schema and a capability", () => {
  for (const definition of graphOperations) {
    const schema = definition.inputSchema as Record<string, unknown>;

    assert.equal(schema.type, "object", definition.id);
    assert.equal(schema.additionalProperties, false, definition.id);
    assert.ok(definition.requiredCapabilities.length > 0, definition.id);
    assert.match(
      definition.handler,
      /^plugin:dbrainx\.builtin#[A-Za-z_$][A-Za-z0-9_$]*$/,
      definition.id,
    );
  }
});

test("every operation accepts its minimal input and refuses an invalid one", () => {
  for (const definition of graphOperations) {
    const cases = INPUT_CASES.get(definition.id);
    assert.ok(cases, definition.id);

    const accepted = validate(cases.valid, definition);
    assert.equal(
      accepted.valid,
      true,
      `${definition.id} refused its minimal input: ${describeErrors(accepted.errors)}`,
    );

    assert.ok(cases.invalid.length > 0, definition.id);
    for (const input of cases.invalid) {
      const refused = validate(input, definition);
      assert.equal(
        refused.valid,
        false,
        `${definition.id} accepted ${JSON.stringify(input)}`,
      );
      assert.ok(refused.errors.length > 0, definition.id);
    }
  }
});
