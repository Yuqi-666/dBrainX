// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The shipped composition discovers its packages from `plugins/<directory>/plugin.json`.
 *
 * These cases drive the same seam `apps/server/src/index.ts` uses — the package
 * list comes from `createShippedPluginPackages`, never from a hand-built
 * `hostFor([...])` — and prove that a package added beside the shipped ones is
 * served, installable, enableable, invocable through its worker, and removable
 * without an edit in `apps/server`.
 */
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import type { NodeOperationPort } from "../../../backend/application/src/commands/operation/node-operation-handlers.ts";
import type { NodeDTO } from "../../../backend/application/src/dto/node.dto.ts";
import { createExecutionScope } from "../../../backend/domain/src/models/plugin/capability.ts";
import { createTestOperationContext } from "../../../backend/domain/src/ports/operation-context.fixture.ts";
import type { OperationContext } from "../../../backend/domain/src/ports/operation-context.ts";
import type { IPluginGrantRepository } from "../../../backend/domain/src/repositories/plugin-grant.repository.ts";
import { createProcessPluginStore } from "../../../backend/adapter-front/src/di/plugin-install-store.ts";
import {
  INVALID_CONTRIBUTION,
  INVALID_MANIFEST,
  createLivePluginRegistries,
  createPluginHost,
  createPluginLifecycle,
  refusalCode,
} from "../../../backend/plugin-host/src/index.ts";
import type {
  LivePluginRegistries,
  PluginHost,
} from "../../../backend/plugin-host/src/index.ts";
import { acmeHandlers } from "../../../plugins/counter/server/index.ts";

import {
  createCounterOperationHandlers,
  createServerOperationHandlers,
  type AttachmentReaderProvider,
  type GraphOperationPortProvider,
} from "./operation-registry.ts";
import { createShippedPluginPackages } from "./plugin-packages.ts";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const pluginsRoot = join(root, "plugins");
const DEMO_ID = "dbrainx.demo";
const DEMO_TYPE = "demo.card";
const DEMO_OPERATION = "demo.ping";

const DEMO_ENTRY = `import {
  defineNodeType,
  defineOperationDefinition,
} from "@workspace/plugin-sdk";

const pluginId = "dbrainx.demo";

interface DemoContent {
  readonly greeting: string;
}

export const demoCard = defineNodeType<DemoContent>({
  type: "demo.card",
  version: 1,
  pluginId,
  schema: {
    type: "object",
    required: ["greeting"],
    properties: { greeting: { type: "string" } },
    additionalProperties: false,
  },
  defaultContent: () => ({ greeting: "hello" }),
  display: { label: "Demo card", icon: "Sparkles" },
  operations: ["demo.ping"],
});

export const demoPingOperation = defineOperationDefinition({
  id: "demo.ping",
  pluginId,
  exportName: "demoPing",
  target: "node",
  appliesTo: { nodeTypes: ["demo.card"] },
  effect: "invoke",
  reach: "self",
  inputSchema: {
    type: "object",
    properties: { value: { type: "string" } },
    additionalProperties: false,
  },
  requiredCapabilities: [],
  idempotent: true,
});

export const nodeTypes = [demoCard];
export const operations = [demoPingOperation];

export async function demoPing(
  input: { value?: string },
): Promise<{ pong: string }> {
  return { pong: input.value ?? "demo" };
}
`;

const nodePort: NodeOperationPort = {
  createNode: async () => ({ id: "node_demo" }) as unknown as NodeDTO,
  updateNode: async (command) => ({ id: command.id }) as unknown as NodeDTO,
  deleteNode: async () => undefined,
};

const graphStub: GraphOperationPortProvider = () => {
  const edge = { id: "edge_demo" };
  const view = { id: "view_demo" };
  return {
    edges: {
      createEdge: async () => edge,
      updateEdge: async () => edge,
      deleteEdge: async () => undefined,
    },
    views: {
      createView: async () => view,
      updateView: async () => view,
      deleteView: async () => undefined,
    },
  };
};

const noAttachments: AttachmentReaderProvider = () => ({
  find: async () => null,
});

const noGrants: IPluginGrantRepository = {
  async grant() {
    throw new Error("the demo package declares no permissions");
  },
  async find() {
    return null;
  },
  async listForPlugin() {
    return [];
  },
  async revoke() {
    return false;
  },
  async revokeAllForPlugin() {
    return 0;
  },
};

function shippedHandlers() {
  return {
    "dbrainx.builtin": createServerOperationHandlers(
      () => nodePort,
      graphStub,
      noAttachments,
    ),
    "dbrainx.counter": createCounterOperationHandlers(() => nodePort),
  };
}

async function shippedPackages() {
  return createShippedPluginPackages(shippedHandlers(), {
    "dbrainx.counter": Object.keys(acmeHandlers()),
  });
}

function hostOver(
  packages: Awaited<ReturnType<typeof shippedPackages>>,
): PluginHost {
  return createPluginHost({
    packages,
    env: {},
    workers: {
      capabilities: {},
      timeoutMs: 5_000,
      startupTimeoutMs: 10_000,
    },
  });
}

function nodeContext(): OperationContext {
  return createTestOperationContext({
    actor: { kind: "user", userId: "user_demo" },
    workspaceId: "ws_demo",
    scope: createExecutionScope({ kind: "workspace", workspaceId: "ws_demo" }),
    target: { kind: "node", nodeId: "node_demo" },
    correlationId: "corr_demo",
    node: {
      id: "node_demo",
      nodeType: DEMO_TYPE,
      workspaceId: "ws_demo",
      title: "",
      permission: "private",
      semanticId: "node:node_demo",
      tags: [],
      isPinned: false,
      content: { greeting: "hello" },
      typeVersion: 1,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
  });
}

function servedDemo(live: LivePluginRegistries) {
  return {
    revision: live.revision(),
    nodeType: live.nodeTypes.get(DEMO_TYPE)?.type ?? null,
    operation: live.operations.get(DEMO_OPERATION)?.definition.id ?? null,
  };
}

/** Write one package below `plugins/`, refusing to overwrite a real package. */
async function writePackage(
  name: string,
  files: Readonly<Record<string, string>>,
): Promise<string> {
  const directory = join(pluginsRoot, name);
  assert.equal(
    existsSync(directory),
    false,
    `plugins/${name} must not already exist when the test starts`,
  );
  for (const [relative, content] of Object.entries(files)) {
    const path = join(directory, relative);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content, "utf8");
  }
  return directory;
}

async function removePackage(directory: string): Promise<void> {
  await rm(directory, { recursive: true, force: true });
}

async function linkPluginSdk(directory: string): Promise<void> {
  const modules = join(directory, "node_modules", "@workspace");
  await mkdir(modules, { recursive: true });
  await symlink(
    await realpath(join(root, "packages", "plugin-sdk")),
    join(modules, "plugin-sdk"),
    process.platform === "win32" ? "junction" : "dir",
  );
}

test("a package dropped under plugins/ is discovered, served, installable and removable", async () => {
  const directory = await writePackage("demo", {
    "plugin.json": `${JSON.stringify(
      {
        id: DEMO_ID,
        name: "dBrainX discovery demo",
        version: "0.1.0",
        apiVersion: "1",
        serverEntry: "./server/index.ts",
        nodeTypes: [DEMO_TYPE],
        dependencies: [],
        permissions: [],
      },
      null,
      2,
    )}\n`,
    "package.json": `${JSON.stringify(
      {
        name: "@plugin/demo",
        version: "0.0.0",
        private: true,
        type: "module",
        dependencies: { "@workspace/plugin-sdk": "workspace:*" },
      },
      null,
      2,
    )}\n`,
    "server/index.ts": DEMO_ENTRY,
  });
  let host: PluginHost | undefined;
  try {
    await linkPluginSdk(directory);
    const packages = await shippedPackages();
    assert.ok(
      packages.length >= 3,
      `discovery found ${packages.length} packages, expected builtin, counter and demo`,
    );

    host = hostOver(packages);
    const listed = await host.listPackages();
    assert.ok(
      listed.some((entry) => entry.id === DEMO_ID && entry.kind === "builtin"),
      `the demo package reached PluginHostConfig.packages: ${listed
        .map((entry) => `${entry.id}:${entry.kind}`)
        .join(", ")}`,
    );

    const live = createLivePluginRegistries(host);
    assert.deepEqual(servedDemo(live), {
      revision: 0,
      nodeType: null,
      operation: null,
    });

    await host.loadBuiltins();
    console.log(
      `[plugin-discovery] packaged ${listed.map((entry) => entry.id).join(", ")}`,
    );
    console.log(
      `[plugin-discovery] served before install ${JSON.stringify(servedDemo(live))}`,
    );
    assert.equal(servedDemo(live).nodeType, DEMO_TYPE);
    assert.equal(servedDemo(live).operation, DEMO_OPERATION);

    const plugins = createProcessPluginStore();
    const lifecycle = createPluginLifecycle({
      host,
      plugins,
      grants: noGrants,
      now: () => "2026-11-03T00:00:00.000Z",
    });
    const request = {
      pluginId: DEMO_ID,
      workspaceId: "ws_demo",
      actor: "owner-demo",
    };
    const installed = await lifecycle.install(request);
    assert.equal(installed.kind, "installed");
    const enabled = await lifecycle.enable(request);
    assert.ok(enabled.plugins.some((entry) => entry.id === DEMO_ID));
    assert.equal((await plugins.findById(DEMO_ID))?.status, "enabled");
    console.log(
      `[plugin-discovery] served after enable ${JSON.stringify(servedDemo(live))}`,
    );

    const pong = await live.operations.resolve(DEMO_OPERATION)(
      { value: "worked" },
      nodeContext(),
    );
    assert.deepEqual(pong, { pong: "worked" });

    const disabled = await lifecycle.disable(request);
    assert.equal((await plugins.findById(DEMO_ID))?.status, "disabled");
    assert.equal(servedDemo(live).nodeType, null);
    assert.equal(servedDemo(live).operation, null);
    assert.ok(
      !disabled.plugins.some((entry) => entry.id === DEMO_ID),
      "disable took the demo out of the served snapshot",
    );
    assert.ok(
      (await host.listPackages()).some((entry) => entry.id === DEMO_ID),
      "disable stops serving the package; it does not unpackage it",
    );
    console.log(
      `[plugin-discovery] served after disable ${JSON.stringify(servedDemo(live))}`,
    );
  } finally {
    await host?.shutdown();
    await removePackage(directory);
  }
});

test("a discovered manifest without a server entry refuses by name", async () => {
  const directory = await writePackage("broken-manifest", {
    "plugin.json": `${JSON.stringify(
      {
        id: "dbrainx.broken",
        name: "broken manifest",
        version: "0.1.0",
        apiVersion: "1",
      },
      null,
      2,
    )}\n`,
  });
  try {
    await assert.rejects(shippedPackages(), (error: unknown) => {
      assert.equal(refusalCode(error), INVALID_MANIFEST);
      assert.match((error as Error).message, /dbrainx\.broken/);
      assert.match((error as Error).message, /serverEntry/);
      return true;
    });
  } finally {
    await removePackage(directory);
  }
});

test("a discovered server entry that throws refuses by name at startup", async () => {
  const directory = await writePackage("broken-entry", {
    "plugin.json": `${JSON.stringify(
      {
        id: "dbrainx.broken-entry",
        name: "broken entry",
        version: "0.1.0",
        apiVersion: "1",
        serverEntry: "./server/index.ts",
        dependencies: [],
        permissions: [],
      },
      null,
      2,
    )}\n`,
    "server/index.ts": 'throw new Error("demo boot failure");\n',
  });
  try {
    await assert.rejects(shippedPackages(), (error: unknown) => {
      assert.equal(refusalCode(error), INVALID_MANIFEST);
      assert.match((error as Error).message, /dbrainx\.broken-entry/);
      assert.match((error as Error).message, /demo boot failure/);
      return true;
    });
  } finally {
    await removePackage(directory);
  }
});

test("a non-array contribution refuses by name instead of failing in the host", async () => {
  const directory = await writePackage("broken-contributions", {
    "plugin.json": `${JSON.stringify(
      {
        id: "dbrainx.broken-contributions",
        name: "broken contributions",
        version: "0.1.0",
        apiVersion: "1",
        serverEntry: "./server/index.ts",
        dependencies: [],
        permissions: [],
      },
      null,
      2,
    )}\n`,
    "server/index.ts":
      "export const nodeTypes = 42;\nexport const operations = [];\n",
  });
  try {
    await assert.rejects(shippedPackages(), (error: unknown) => {
      assert.equal(refusalCode(error), INVALID_CONTRIBUTION);
      assert.match((error as Error).message, /dbrainx\.broken-contributions/);
      assert.match((error as Error).message, /nodeTypes/);
      return true;
    });
  } finally {
    await removePackage(directory);
  }
});
