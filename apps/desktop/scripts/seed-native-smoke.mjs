// SPDX-License-Identifier: AGPL-3.0-only

/** Send backend events into the actual native window for the visual smoke check. */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const requireClient = createRequire(join(root, "packages/api-client/package.json"));
const { createTRPCClient, createWSClient, wsLink } = await import(pathToFileURL(requireClient.resolve("@trpc/client")).href);
const { default: superjson } = await import(pathToFileURL(requireClient.resolve("superjson")).href);
const descriptor = JSON.parse(await readFile(process.argv[2], "utf8"));
const ws = createWSClient({ url: descriptor.trpc, connectionParams: { token: descriptor.token, sourceId: "native-window-smoke" } });
const client = createTRPCClient({ links: [wsLink({ client: ws, transformer: superjson })] });
const temporaryId = () => `tmp_${crypto.randomUUID()}`;
try {
  const workspaces = await client.workspace.listByUser.query({});
  assert.equal(workspaces.length, 1, "native frontend provisioned its default workspace");
  const workspaceId = workspaces[0].id;
  const semantic = await client.nodeSemantic.add.mutate({ id: temporaryId(), name: "本地笔记", workspaceId });
  for (const title of ["完整本地后端", "离线存储已接入"]) {
    await client.node.add.mutate({ id: temporaryId(), title, nodeType: "text", semanticId: semantic.id, content: { docs: {} }, workspaceId });
  }
} finally { ws.close(); }
