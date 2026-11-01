// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The ten builtin types' self-operation catalogue (§4.3.5).
 *
 * The first case pins the catalogue per type, so one operation more or less
 * fails here. The rest prove the properties the registry relies on: globally
 * unique ids that never repeat a shared metadata operation, one `appliesTo`
 * type each, a closed input schema that accepts a minimal input and refuses a
 * malformed one, and node types that advertise exactly the declared ids.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { Validator } from "@cfworker/json-schema";
import type { OutputUnit, Schema } from "@cfworker/json-schema";

import { nodeTypes } from "./node-types.ts";
import { operations } from "./operations.ts";
import type { BuiltinTypeId } from "./type-operations.ts";
import { selfOperationIds, typeOperations } from "./type-operations.ts";

const EXPECTED_SELF_OPERATIONS: Readonly<Record<BuiltinTypeId, readonly string[]>> =
  {
    text: ["text.setDocument", "text.append", "text.replaceRange"],
    "rich-text": [
      "rich-text.setDocument",
      "rich-text.insertBlock",
      "rich-text.updateBlock",
      "rich-text.removeBlock",
    ],
    image: ["image.addAnnotation", "image.removeAnnotation", "image.setMetadata"],
    pdf: ["pdf.addAnnotation", "pdf.removeAnnotation", "pdf.moveAnnotation"],
    video: [
      "video.timeline.add",
      "video.timeline.update",
      "video.timeline.remove",
      "video.setCover",
    ],
    audio: [
      "audio.timeline.add",
      "audio.timeline.update",
      "audio.timeline.remove",
    ],
    webpage: ["webpage.replaceDocument"],
    website: ["website.setFavicon"],
    collection: [
      "collection.setFilter",
      "collection.setView",
      "collection.removeView",
    ],
    database: [
      "database.addField",
      "database.removeField",
      "database.addRow",
      "database.updateCell",
      "database.deleteRow",
      "database.setView",
    ],
  };

/**
 * Operations the design document sketches as `external` or `system` examples.
 * None of them may be declared: an operation without a handler must fail at
 * enablement, not at its first call (§4.3.9).
 */
const UNIMPLEMENTED_EXAMPLE_OPERATIONS = [
  "text.quoteInto",
  "rich-text.extractBlockToNode",
  "image.linkAnnotationToNode",
  "image.analyze",
  "image.renderCover",
  "pdf.createQuoteNode",
  "pdf.analyze",
  "video.createNoteNode",
  "video.transcode",
  "audio.createTranscriptNode",
  "audio.transcode",
  "webpage.createSummaryNode",
  "webpage.fetchSnapshot",
  "website.createBookmarkNode",
  "website.fetchMetadata",
  "collection.exportToDatabase",
  "database.createNodeFromRow",
  "database.syncRowsFromNodes",
];

const TIMELINE_NOTE = {
  id: "note_1",
  type: "note",
  timeMs: 1200,
  content: {},
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

interface InputCase {
  readonly valid: unknown;
  readonly invalid: readonly unknown[];
}

const INPUT_CASES: ReadonlyMap<string, InputCase> = new Map([
  [
    "text.setDocument",
    { valid: { docs: {} }, invalid: [{}, { docs: [] }, { docs: {}, blocks: 1 }] },
  ],
  [
    "text.append",
    {
      valid: { blockId: "b1", document: {} },
      invalid: [{ blockId: "", document: {} }, { blockId: "b1" }, {}],
    },
  ],
  [
    "text.replaceRange",
    {
      valid: { blockId: "b1", from: 0, to: 3, text: "hey" },
      invalid: [
        { blockId: "b1", from: -1, to: 3, text: "x" },
        { blockId: "b1", from: 0.5, to: 3, text: "x" },
        { blockId: "b1", from: 0, to: 3 },
      ],
    },
  ],
  [
    "rich-text.setDocument",
    {
      valid: { docs: {} },
      invalid: [{}, { docs: {}, referencedNodes: [1] }],
    },
  ],
  [
    "rich-text.setDocument#referencedNodes",
    { valid: { docs: {}, referencedNodes: ["n1"] }, invalid: [{ docs: [] }] },
  ],
  [
    "rich-text.insertBlock",
    {
      valid: { blockId: "b1", document: {} },
      invalid: [{ blockId: "", document: {} }, {}],
    },
  ],
  [
    "rich-text.updateBlock",
    {
      valid: { blockId: "b1", document: {} },
      invalid: [{ blockId: "b1" }, { blockId: "b1", document: [], extra: 1 }],
    },
  ],
  [
    "rich-text.removeBlock",
    { valid: { blockId: "b1" }, invalid: [{}, { blockId: "" }] },
  ],
  [
    "image.addAnnotation",
    { valid: { annotation: {} }, invalid: [{}, { annotation: [] }] },
  ],
  [
    "image.removeAnnotation",
    { valid: { annotationId: "a1" }, invalid: [{}, { annotationId: "" }] },
  ],
  [
    "image.setMetadata",
    {
      valid: { width: 10 },
      invalid: [{}, { width: -1 }, { width: 1, extra: true }],
    },
  ],
  [
    "pdf.addAnnotation",
    { valid: { annotation: { id: "a1" } }, invalid: [{}, { annotation: "a" }] },
  ],
  [
    "pdf.removeAnnotation",
    { valid: { annotationId: "a1" }, invalid: [{ annotationId: null }] },
  ],
  [
    "pdf.moveAnnotation",
    {
      valid: { annotationId: "a1", page: 0 },
      invalid: [{ annotationId: "a1", page: -1 }, { annotationId: "a1" }],
    },
  ],
  [
    "video.timeline.add",
    {
      valid: { item: TIMELINE_NOTE },
      invalid: [
        {},
        { item: { ...TIMELINE_NOTE, type: "chapter" } },
        { item: { ...TIMELINE_NOTE, timeMs: -1 } },
      ],
    },
  ],
  [
    "video.timeline.update",
    {
      valid: { itemId: "note_1", item: TIMELINE_NOTE },
      invalid: [{ itemId: "note_1" }, { itemId: "", item: TIMELINE_NOTE }],
    },
  ],
  [
    "video.timeline.remove",
    { valid: { itemId: "note_1" }, invalid: [{}, { itemId: "" }] },
  ],
  ["video.setCover", { valid: { coverUrl: "" }, invalid: [{}, { coverUrl: null }] }],
  [
    "audio.timeline.add",
    {
      valid: { item: { type: "subtitle", timeMs: 0, content: "hi" } },
      invalid: [{ item: { type: "subtitle", content: "hi" } }, {}],
    },
  ],
  [
    "audio.timeline.update",
    {
      valid: { itemId: "note_1", item: TIMELINE_NOTE },
      invalid: [{ item: TIMELINE_NOTE }],
    },
  ],
  [
    "audio.timeline.remove",
    { valid: { itemId: "note_1" }, invalid: [{ itemId: 1 }] },
  ],
  [
    "webpage.replaceDocument",
    {
      valid: { uploadId: "upload-1" },
      invalid: [{}, { uploadId: "" }, { uploadId: "u", url: "/api/files/x" }],
    },
  ],
  [
    "website.setFavicon",
    { valid: { faviconUrl: "" }, invalid: [{}, { faviconUrl: 1 }] },
  ],
  [
    "collection.setFilter",
    { valid: { filterConfig: {} }, invalid: [{}, { filterConfig: [] }] },
  ],
  [
    "collection.setView",
    { valid: { view: {} }, invalid: [{ view: [] }, { view: {}, name: "x" }] },
  ],
  [
    "collection.removeView",
    { valid: { viewId: "v1" }, invalid: [{}, { viewId: "" }] },
  ],
  [
    "database.addField",
    {
      valid: { field: { id: "f1", name: "Name", type: "text" } },
      invalid: [
        { field: { id: "f1", name: "Name" } },
        { field: { id: "f1", name: "Name", type: "money" } },
        { field: { id: "f1", name: "Name", type: "text", extra: 1 } },
      ],
    },
  ],
  [
    "database.removeField",
    { valid: { fieldId: "f1" }, invalid: [{}, { fieldId: "" }] },
  ],
  ["database.addRow", { valid: { cells: {} }, invalid: [{}, { cells: [] }] }],
  [
    "database.updateCell",
    {
      valid: { rowId: "r1", fieldId: "f1", cell: { type: "text" } },
      invalid: [
        { rowId: "r1", fieldId: "f1" },
        { rowId: "r1", fieldId: "f1", cell: "x" },
        { rowId: "r1", fieldId: "f1", cell: { type: "money" } },
      ],
    },
  ],
  ["database.deleteRow", { valid: { rowId: "r1" }, invalid: [{}, { rowId: "" }] }],
  ["database.setView", { valid: { view: {} }, invalid: [{}, { view: "v1" }] }],
]);

function validate(
  definition: (typeof typeOperations)[number],
  input: unknown,
) {
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

test("declares exactly the self catalogue, per type", () => {
  for (const [type, expected] of Object.entries(EXPECTED_SELF_OPERATIONS)) {
    assert.deepEqual(
      [...selfOperationIds[type as BuiltinTypeId]],
      expected,
      `${type} self operations`,
    );
  }

  const ids = typeOperations.map((definition) => definition.id);
  const expected = Object.values(EXPECTED_SELF_OPERATIONS).flat();
  assert.deepEqual([...ids].sort(), [...expected].sort());
  assert.equal(ids.length, 31);
});

test("ids are globally unique and never repeat a shared metadata operation", () => {
  const shared = new Set(operations.map((definition) => definition.id));
  const seen = new Set<string>();

  for (const definition of typeOperations) {
    assert.equal(shared.has(definition.id), false, definition.id);
    assert.equal(seen.has(definition.id), false, definition.id);
    seen.add(definition.id);
  }

  const handlers = new Set<string>();
  for (const definition of typeOperations) {
    assert.match(definition.handler, /^plugin:dbrainx\.builtin#[A-Za-z_$][A-Za-z0-9_$]*$/);
    assert.equal(handlers.has(definition.handler), false, definition.handler);
    handlers.add(definition.handler);
  }
});

test("every operation is a self update on exactly one node type", () => {
  for (const [type, ids] of Object.entries(EXPECTED_SELF_OPERATIONS)) {
    for (const id of ids) {
      const definition = typeOperations.find((entry) => entry.id === id);
      assert.ok(definition, id);
      assert.equal(definition.target, "node", id);
      assert.equal(definition.effect, "update", id);
      assert.equal(definition.reach, "self", id);
      assert.deepEqual(definition.appliesTo, { nodeTypes: [type] }, id);
      assert.ok(definition.id.startsWith(`${type}.`), id);
      assert.deepEqual(definition.requiredCapabilities[0], "node.write", id);
      assert.equal(typeof definition.idempotent, "boolean", id);
    }
  }

  assert.deepEqual(
    [
      ...new Set(
        typeOperations
          .filter((definition) => definition.requiredCapabilities.length > 1)
          .map((definition) => definition.id),
      ),
    ],
    ["webpage.replaceDocument"],
    "only a stored-document replacement reads storage",
  );
});

test("node types advertise exactly the declared ids, and no example operation", () => {
  for (const definition of nodeTypes) {
    assert.deepEqual(
      [...definition.operations],
      [...selfOperationIds[definition.type as BuiltinTypeId]],
      definition.type,
    );
  }

  const declared = new Set(typeOperations.map((definition) => definition.id));
  for (const id of UNIMPLEMENTED_EXAMPLE_OPERATIONS)
    assert.equal(declared.has(id), false, `${id} has no handler and must not be declared`);
});

test("every definition carries a closed input schema", () => {
  for (const definition of typeOperations) {
    const schema = definition.inputSchema as Record<string, unknown>;

    assert.equal(schema.type, "object", definition.id);
    assert.equal(schema.additionalProperties, false, definition.id);
  }
});

test("every operation accepts its minimal input and refuses a malformed one", () => {
  const exercised = new Set(
    [...INPUT_CASES.keys()].map((key) => key.replace(/#.*$/, "")),
  );
  assert.deepEqual(
    [...exercised].sort(),
    typeOperations.map((definition) => definition.id).sort(),
    "every operation is exercised and no exercise is orphaned",
  );

  for (const definition of typeOperations) {
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
    }
  }

  const richText = typeOperations.find(
    (definition) => definition.id === "rich-text.setDocument",
  );
  assert.ok(richText);
  const withReferences = INPUT_CASES.get("rich-text.setDocument#referencedNodes");
  assert.ok(withReferences);
  assert.equal(
    validate(richText, withReferences.valid).valid,
    true,
    "referencedNodes is optional but accepted when sent",
  );
});
