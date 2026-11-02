// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The live tRPC surface `pnpm dev` serves, as the F3 specs call it.
 *
 * The browser reaches the server over one WebSocket (`ws://…:3001/trpc`) and
 * names its workspace in the connection parameters; these helpers do the same,
 * so a scenario drives the production route (`operation.invoke`, `plugin.*`,
 * `event.onEvent`) rather than a test double.
 *
 * `@trpc/client` and `superjson` are resolved from `packages/api-client`, the
 * workspace that owns them, the way `scripts/release/server-smoke.mjs` does.
 * They are loaded with `require` because Playwright compiles a spec to
 * CommonJS: a static ESM import of those packages would be a module-kind
 * mismatch inside the worker.
 */
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { dirname, join, parse, resolve } from "node:path";

/**
 * The checkout root, found from the working directory.
 *
 * Playwright runs the suite from the repository root; a direct `node` run of a
 * scenario helper may start elsewhere. Walking up to the workspace that owns
 * `@trpc/client` serves both without relying on `__dirname` (absent in ESM) or
 * `import.meta` (absent in the CommonJS module Playwright compiles a spec to).
 */
function findRepoRoot(start: string): string {
  let current = resolve(start);
  const { root } = parse(current);
  for (;;) {
    if (existsSync(join(current, "packages/api-client/package.json"))) {
      return current;
    }
    if (current === root) {
      throw new Error(
        `no dBrainX checkout above ${start}: packages/api-client/package.json was not found`,
      );
    }
    current = dirname(current);
  }
}

const repoRoot = findRepoRoot(process.cwd());
const apiRequire = createRequire(join(repoRoot, "packages/api-client/package.json"));

const { createTRPCClient, createWSClient, wsLink } = apiRequire("@trpc/client");
const superjson = apiRequire("superjson").default ?? apiRequire("superjson");

export const DEFAULT_SERVER_URL =
  process.env.DBRAINX_E2E_SERVER_URL ?? "http://localhost:3001";

export interface StreamEvent {
  readonly eventType: string;
  readonly aggregateId?: string;
  readonly eventId?: string;
  readonly cursor?: string;
  readonly workspaceId?: string;
  readonly data: { readonly id?: string } & Record<string, unknown>;
}

export interface NodeSnapshot {
  readonly id: string;
  readonly workspaceId: string;
  readonly nodeType: string;
  readonly title: string;
  readonly isPinned: boolean;
  readonly updatedAt: string;
}

export interface OperationResult {
  readonly operationId: string;
  readonly output?: Record<string, unknown>;
  readonly node?: NodeSnapshot;
}

export interface OperationBody {
  readonly operationId: string;
  readonly target:
    | { readonly kind: "workspace"; readonly workspaceId: string }
    | { readonly kind: "node"; readonly nodeId: string };
  readonly input: unknown;
  readonly expectedVersion?: string;
  readonly correlationId?: string;
}

export interface PluginSummary {
  readonly pluginId: string;
  readonly status: string;
  readonly nodeTypes: readonly string[];
}

interface LiveClient {
  readonly operation: {
    readonly invoke: {
      mutate(body: OperationBody): Promise<OperationResult>;
    };
  };
  readonly plugin: {
    readonly list: {
      query(input: { workspaceId: string }): Promise<{
        canManage: boolean;
        plugins: readonly PluginSummary[];
        available: readonly unknown[];
      }>;
    };
    readonly enable: {
      mutate(input: {
        workspaceId: string;
        pluginId: string;
      }): Promise<{ pluginId: string; status: string }>;
    };
    readonly disable: {
      mutate(input: {
        workspaceId: string;
        pluginId: string;
      }): Promise<{ pluginId: string; status: string }>;
    };
    readonly grant: {
      mutate(input: {
        workspaceId: string;
        pluginId: string;
        capability: string;
        scope: readonly string[];
      }): Promise<unknown>;
    };
    readonly revoke: {
      mutate(input: {
        workspaceId: string;
        pluginId: string;
        capability: string;
        scope: readonly string[];
      }): Promise<unknown>;
    };
  };
  readonly node: {
    readonly listByWorkspace: {
      query(input: { workspaceId: string }): Promise<readonly NodeSnapshot[]>;
    };
    readonly getById: {
      query(input: { id: string }): Promise<NodeSnapshot>;
    };
  };
  readonly nodeType: {
    readonly list: {
      query(): Promise<{ nodeTypes: readonly { type: string }[] }>;
    };
  };
  readonly run: {
    readonly list: {
      query(input: {
        workspaceId: string;
        limit?: number;
      }): Promise<{ runs: readonly RunSummary[] }>;
    };
  };
  readonly event: {
    readonly onEvent: {
      subscribe(
        input: { cursor?: string } | undefined,
        handlers: {
          onData(event: StreamEvent): void;
          onError(error: unknown): void;
        },
      ): { unsubscribe(): void };
    };
  };
}

export interface RunSummary {
  readonly operationId: string;
  readonly decision: string;
  readonly status: string;
}

interface Connection {
  readonly client: LiveClient;
  close(): void;
}

/** `http://host:port` → the WebSocket URL the tRPC client dials. */
export function trpcUrl(serverUrl: string): string {
  return `${serverUrl.replace(/^http/, "ws")}/trpc`;
}

/**
 * One connection. `workspaceId` becomes the `x-workspace-id` connection
 * parameter, the value the server verifies against membership before any write
 * may use it.
 */
export async function connect({
  serverUrl = DEFAULT_SERVER_URL,
  token,
  sourceId = `e2e-${process.pid}`,
  workspaceId,
}: {
  serverUrl?: string;
  token?: string;
  sourceId?: string;
  workspaceId?: string;
} = {}): Promise<Connection> {
  const ws = createWSClient({
    url: trpcUrl(serverUrl),
    connectionParams: {
      ...(token === undefined ? {} : { token }),
      sourceId,
      ...(workspaceId === undefined ? {} : { "x-workspace-id": workspaceId }),
    },
  });
  const client = createTRPCClient({
    links: [wsLink({ client: ws, transformer: superjson })],
  }) as LiveClient;
  return { client, close: () => ws.close() };
}

/** Register a user; the connection is closed before this resolves. */
export async function register({
  serverUrl = DEFAULT_SERVER_URL,
  email,
  password = "Password123!",
  nickname = "F3",
}: {
  serverUrl?: string;
  email: string;
  password?: string;
  nickname?: string;
}): Promise<{ token: string; user: { id: string } }> {
  const api = await connect({ serverUrl });
  try {
    const result = await (
      api.client as unknown as {
        auth: {
          register: {
            mutate(input: {
              email: string;
              password: string;
              nickname: string;
            }): Promise<{ token: string; user: { id: string } }>;
          };
        };
      }
    ).auth.register.mutate({ email, password, nickname });
    return result;
  } finally {
    api.close();
  }
}

/** The workspace first login provisions: owner membership plus one global view. */
export async function provisionDefault({
  token,
  serverUrl = DEFAULT_SERVER_URL,
}: {
  token: string;
  serverUrl?: string;
}): Promise<{ id: string; name: string }> {
  const api = await connect({ token, serverUrl });
  try {
    return await (
      api.client as unknown as {
        workspace: {
          provisionDefault: {
            mutate(): Promise<{ id: string; name: string }>;
          };
        };
      }
    ).workspace.provisionDefault.mutate();
  } finally {
    api.close();
  }
}

/** A workspace-scoped connection plus the helpers a scenario needs. */
export async function workspaceApi({
  token,
  workspaceId,
  serverUrl = DEFAULT_SERVER_URL,
  sourceId,
}: {
  token: string;
  workspaceId: string;
  serverUrl?: string;
  sourceId?: string;
}): Promise<
  Connection & {
    readonly workspaceId: string;
    invoke(body: OperationBody): Promise<OperationResult>;
    listPlugins(): Promise<{
      canManage: boolean;
      plugins: readonly PluginSummary[];
    }>;
    listRuns(limit?: number): Promise<readonly RunSummary[]>;
    nodeTypeIds(): Promise<readonly string[]>;
    nodeIds(): Promise<readonly string[]>;
    node(nodeId: string): Promise<NodeSnapshot>;
  }
> {
  const api = await connect({ serverUrl, token, sourceId, workspaceId });
  const { client } = api;
  return {
    ...api,
    workspaceId,
    invoke: (body) => client.operation.invoke.mutate(body),
    listPlugins: () => client.plugin.list.query({ workspaceId }),
    listRuns: async (limit = 50) =>
      (await client.run.list.query({ workspaceId, limit })).runs,
    nodeTypeIds: async () =>
      (await client.nodeType.list.query()).nodeTypes.map((type) => type.type),
    nodeIds: async () =>
      (await client.node.listByWorkspace.query({ workspaceId })).map(
        (node) => node.id,
      ),
    node: (nodeId) => client.node.getById.query({ id: nodeId }),
  };
}

/**
 * Upload a blob through the collection the browser posts to.
 *
 * `files` is PocketBase's own collection; a loopback client reaches it on
 * `:8090` directly, which is what `resolveBackendUrls()` returns for
 * `http://localhost:3000`.
 */
export async function uploadFile({
  token,
  serverUrl = DEFAULT_SERVER_URL,
  bytes = "f3 upload payload",
  name = "f3-upload.txt",
  type = "text/plain",
  workspaceId,
}: {
  token: string;
  serverUrl?: string;
  bytes?: string;
  name?: string;
  type?: string;
  workspaceId?: string;
}): Promise<Record<string, unknown>> {
  const pocketbase = serverUrl.replace(/:3001\b/, ":8090");
  const form = new FormData();
  form.append("file", new Blob([bytes], { type }), name);
  form.append("name", name);
  if (workspaceId !== undefined) form.append("workspaceId", workspaceId);
  const response = await fetch(`${pocketbase}/api/collections/files/records`, {
    method: "POST",
    headers: { Authorization: token },
    body: form,
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      `upload failed: ${response.status} ${JSON.stringify(body).slice(0, 300)}`,
    );
  }
  return body as Record<string, unknown>;
}
