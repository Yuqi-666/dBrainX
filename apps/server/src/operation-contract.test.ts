// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The contract between the attribute panel and the operation catalogue.
 *
 * The panel builds exactly one input per edit and the executor validates it
 * against the operation's `inputSchema` before the handler runs, so a field that
 * names an operation whose schema expects a different key is refused at runtime
 * and no unit test of either side notices. This file closes that gap by taking
 * the payloads the panel really produces — from `packages/ui`, bundled with
 * esbuild so the workspace imports resolve, and from the descriptor table in
 * `plugins/builtin/ui` — and validating each one with the same validator the
 * executor uses.
 *
 * A field's control decides whether it can raise an edit at all: a `timeline`
 * row is edited in the media sidebar, so its declared operation is documentation
 * and is not validated here. Everything else (url, text, cover, select) is sent.
 */
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { build, stop } from "esbuild";

import { builtinAttributeFields } from "../../../plugins/builtin/ui/attribute-fields.ts";
import { operations } from "../../../plugins/builtin/server/operations.ts";
import { typeOperations } from "../../../plugins/builtin/server/type-operations.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const uiLib = join(root, "packages/ui/src/lib");
const requireFromApplication = createRequire(
  join(root, "backend/application/package.json"),
);
const { Validator } = requireFromApplication("@cfworker/json-schema") as {
  Validator: new (schema: unknown, draft?: string) => {
    validate(input: unknown): { valid: boolean; errors: unknown[] };
  };
};

interface PanelField {
  readonly field: string;
  readonly kind: string;
  readonly operationId?: string;
  readonly options?: readonly { readonly value: string }[];
}

interface AttributeRequest {
  readonly nodeId: string;
  readonly operationId?: string;
  readonly input: Record<string, unknown>;
}

interface Intent {
  readonly kind: "operation" | "legacy";
  readonly operationId?: string;
  readonly input?: Record<string, unknown>;
  readonly patch?: Record<string, unknown>;
}

interface PanelModule {
  attributeFieldRequest(
    nodeId: string,
    field: PanelField,
    value: string,
  ): AttributeRequest;
  tagRequest(nodeId: string, tagId: string, applied: boolean): AttributeRequest;
  translateNodePatch(
    nodeType: string,
    patch: Record<string, unknown>,
  ): readonly Intent[];
  readonly MEDIA_ATTACH_OPERATIONS: Readonly<Record<string, string>>;
}

let outDir = "";
let panel: PanelModule;

before(async () => {
  outDir = await mkdtemp(join(tmpdir(), "server-operation-contract-"));
  const outfile = join(outDir, "panel.mjs");
  await build({
    stdin: {
      contents: [
        'export { attributeFieldRequest, tagRequest } from "./attribute-operations.ts";',
        'export { MEDIA_ATTACH_OPERATIONS } from "./media-attach.ts";',
        'export { translateNodePatch } from "../components/node-content/node-content-patches.ts";',
      ].join("\n"),
      resolveDir: uiLib,
      loader: "ts",
    },
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node24",
    outfile,
    logLevel: "warning",
  });
  panel = (await import(pathToFileURL(outfile).href)) as PanelModule;
});

after(async () => {
  // The build starts a service process; leaving it running keeps the test
  // process alive, which `--test-isolation=none` reports as a hang rather than
  // as a failure.
  stop();
  if (outDir !== "") await rm(outDir, { recursive: true, force: true });
});

const catalogue = new Map(
  [...operations, ...typeOperations].map((definition) => [
    definition.id,
    definition,
  ]),
);

function definitionOf(operationId: string) {
  const definition = catalogue.get(operationId);
  assert.ok(definition, `no operation "${operationId}" is declared`);
  return definition;
}

function assertAccepts(operationId: string, input: unknown): void {
  const definition = definitionOf(operationId);
  const validator = new Validator(
    definition.inputSchema as unknown,
    "2020-12",
  );
  const result = validator.validate(input);
  assert.equal(
    result.valid,
    true,
    `${operationId} refuses ${JSON.stringify(input)}: ${JSON.stringify(result.errors)}`,
  );
}

function sampleValueFor(field: PanelField): string {
  switch (field.kind) {
    case "select":
      return field.options?.[0]?.value ?? "sample";
    case "url":
      return "https://example.com/page";
    case "cover":
      return "https://example.com/cover.png";
    default:
      return "sample";
  }
}

test("every editable descriptor field validates against its operation", () => {
  let checked = 0;

  for (const [type, fields] of Object.entries(builtinAttributeFields)) {
    for (const field of fields as readonly PanelField[]) {
      const request = panel.attributeFieldRequest(
        "node_1",
        field,
        sampleValueFor(field),
      );

      if (field.operationId === undefined) {
        assert.equal(
          request.operationId,
          undefined,
          `${type}.${field.field} invents an operation the catalogue does not declare`,
        );
        continue;
      }

      assert.equal(request.operationId, field.operationId);
      const definition = definitionOf(field.operationId);
      assert.equal(definition.target, "node", field.operationId);
      if (definition.appliesTo !== undefined) {
        assert.ok(
          definition.appliesTo.nodeTypes.includes(type),
          `${field.operationId} is declared for ${type} but not offered to it`,
        );
      }
      if (field.kind === "timeline") continue;
      assertAccepts(field.operationId, request.input);
      checked += 1;
    }
  }

  assert.ok(checked >= 4, `only ${checked} editable descriptor fields were checked`);
});

test("a schema that names another key fails the descriptor contract", () => {
  const definition = definitionOf("webpage.replaceDocument");
  const panelInput = panel.attributeFieldRequest(
    "node_1",
    { field: "url", kind: "url", operationId: "webpage.replaceDocument" },
    "https://example.com/page",
  ).input;

  const asUploadId = {
    type: "object",
    properties: { uploadId: { type: "string", minLength: 1 } },
    required: ["uploadId"],
    additionalProperties: false,
  };
  const validator = new Validator(asUploadId, "2020-12");
  assert.equal(
    validator.validate(panelInput).valid,
    false,
    "the check would pass whatever the schema said",
  );
  assertAccepts(definition.id, panelInput);
});

test("the tag pair takes the one tag the panel toggles", () => {
  const added = panel.tagRequest("node_1", "tag_blue", false);
  assert.equal(added.operationId, "node.addTag");
  assert.deepEqual(added.input, { tag: "tag_blue" });
  assertAccepts("node.addTag", added.input);

  const removed = panel.tagRequest("node_1", "tag_blue", true);
  assert.equal(removed.operationId, "node.removeTag");
  assert.deepEqual(removed.input, { tag: "tag_blue" });
  assertAccepts("node.removeTag", removed.input);
});

test("the metadata queue's icon and cover writes validate", () => {
  const set = panel.translateNodePatch("image", {
    icon: { kind: "emoji", value: "📄" },
    cover: { kind: "image", url: "https://example.com/cover.png" },
    title: "contract",
  });
  const operationsOnly = set.filter(
    (intent) => intent.kind === "operation" && intent.operationId !== undefined,
  );
  assert.deepEqual(
    operationsOnly.map((intent) => intent.operationId),
    ["node.setIcon", "node.setCover", "node.setTitle"],
  );
  for (const intent of operationsOnly) {
    assertAccepts(intent.operationId!, intent.input);
  }

  const cleared = panel
    .translateNodePatch("image", { icon: null, cover: null })
    .filter((intent) => intent.kind === "operation");
  assert.deepEqual(
    cleared.map((intent) => [intent.operationId, intent.input]),
    [
      ["node.clearIcon", {}],
      ["node.clearCover", {}],
    ],
  );
  for (const intent of cleared) {
    assertAccepts(intent.operationId!, intent.input);
  }
});

test("the media attach ids the drop zone uses take an upload id", () => {
  for (const [mediaType, operationId] of Object.entries(
    panel.MEDIA_ATTACH_OPERATIONS,
  )) {
    const definition = definitionOf(operationId);
    assert.deepEqual(definition.appliesTo, { nodeTypes: [mediaType] });
    assertAccepts(operationId, { uploadId: "rec_attachment_1" });

    const validator = new Validator(definition.inputSchema as unknown, "2020-12");
    assert.equal(
      validator.validate({ url: "/api/files/files/rec_attachment_1/a.png" }).valid,
      false,
      `${operationId} must not accept a client-supplied address`,
    );
  }
});
