// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The operator-side setup the F3 sandbox scenario needs (plan item 83).
 *
 * Two facts on a real server are deployment state, not request input:
 * `sandboxes` holds the one provisioned environment of a `(workspace, plugin)`,
 * and `plugin_grants` holds the authority a workspace approved for a plugin.
 * No HTTP surface provisions either yet, so this helper performs the same two
 * writes an operator would: it drives the real `SandboxLifecycle.provision`
 * (which creates the namespace root the file store later checks) and inserts
 * the counter manifest's declared grants through PocketBase's operator API.
 *
 * The helper prints no credential. When the operator credential is absent it
 * reports `available: false` with the reason, and the scenario skips instead of
 * pretending a sandbox decision was made.
 */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { computeScopeKey } from "../../../backend/domain/src/models/plugin/capability.ts";
import type {
  SandboxCall,
  SandboxInstance,
} from "../../../backend/domain/src/repositories/sandbox.repository.ts";
import { PocketBaseSandboxStore } from "../../../backend/infrastructure/src/sandbox/pocketbase-sandbox-store.ts";
import { defaultUploadDir } from "../../../backend/infrastructure/src/storage/file-upload-sessions.ts";
import { sandboxRootPath } from "../../../backend/sandbox/src/sandbox-file-store.ts";
import { SandboxLifecycle } from "../../../backend/sandbox/src/sandbox-lifecycle.ts";

const COUNTER_PLUGIN_ID = "dbrainx.counter";
const COUNTER_MANIFEST = resolve(
  process.cwd(),
  "plugins/counter/plugin.json",
);

interface Permission {
  readonly capability: string;
  readonly scope: readonly string[];
}

interface CounterManifest {
  readonly permissions: readonly Permission[];
}

interface PocketBaseList<T> {
  readonly items: readonly T[];
}

interface PocketBaseRecord {
  readonly id: string;
}

interface SandboxCallRow extends SandboxCall {
  readonly id: string;
}

export interface SandboxProbe {
  /** `false` when this process cannot reach the operator API. */
  readonly available: boolean;
  /** Why {@link available} is false. */
  readonly reason?: string;
  provision(
    workspaceId: string,
    pluginId?: string,
  ): Promise<SandboxInstance>;
  grantCounterCapabilities(workspaceId: string): Promise<void>;
  revokeCapability(
    workspaceId: string,
    pluginId: string,
    capability: string,
  ): Promise<void>;
  calls(workspaceId: string): Promise<readonly SandboxCallRow[]>;
  setNodeContent(
    nodeId: string,
    content: Record<string, unknown>,
  ): Promise<void>;
  cleanup(workspaceId: string, pluginId?: string): Promise<void>;
}

function operatorCredential(): { email: string; password: string } | null {
  if (process.env.DBRAINX_ADMIN_EMAIL === undefined) {
    try {
      process.loadEnvFile(resolve(process.cwd(), ".env"));
    } catch {
      // No `.env` in this checkout; the environment may still carry the pair.
    }
  }
  const email = process.env.DBRAINX_ADMIN_EMAIL?.trim() ?? "";
  const direct = process.env.DBRAINX_ADMIN_PASSWORD ?? "";
  const file = process.env.DBRAINX_ADMIN_PASSWORD_FILE?.trim() ?? "";
  let password = direct;
  if (password === "" && file !== "") {
    try {
      password = readFileSync(file, "utf8").replace(/[\r\n]+$/, "");
    } catch {
      password = "";
    }
  }
  return email === "" || password === "" ? null : { email, password };
}

function pocketBaseUrl(): string {
  return process.env.DBRAINX_PB_URL ?? "http://127.0.0.1:8090";
}

function storageRoot(): string {
  const configured = process.env.DBRAINX_SANDBOX_ROOT?.trim();
  return configured === undefined || configured === ""
    ? join(defaultUploadDir(), "sandbox-storage")
    : configured;
}

export function createSandboxProbe(): SandboxProbe {
  const credential = operatorCredential();
  const url = pocketBaseUrl();
  const root = storageRoot();
  let token: Promise<string> | null = null;
  let provisioned: SandboxInstance | null = null;

  async function adminToken(): Promise<string> {
    if (credential === null) {
      throw new Error("the sandbox probe needs DBRAINX_ADMIN_EMAIL and DBRAINX_ADMIN_PASSWORD");
    }
    if (token === null) {
      token = (async () => {
        const response = await fetch(
          `${url}/api/collections/_superusers/auth-with-password`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              identity: credential.email,
              password: credential.password,
            }),
          },
        );
        const body = (await response.json()) as { token?: string };
        if (!response.ok || body.token === undefined) {
          throw new Error(`operator authentication failed with HTTP ${response.status}`);
        }
        return body.token;
      })();
    }
    return token;
  }

  async function list<T>(
    collection: string,
    filter: string,
  ): Promise<readonly T[]> {
    const auth = await adminToken();
    const response = await fetch(
      `${url}/api/collections/${collection}/records?perPage=200&filter=${encodeURIComponent(filter)}`,
      { headers: { Authorization: auth } },
    );
    const body = (await response.json()) as PocketBaseList<T>;
    if (!response.ok) {
      throw new Error(
        `listing ${collection} failed with HTTP ${response.status}: ${JSON.stringify(body)}`,
      );
    }
    return body.items;
  }

  async function create(
    collection: string,
    record: Record<string, unknown>,
  ): Promise<PocketBaseRecord> {
    const auth = await adminToken();
    const response = await fetch(
      `${url}/api/collections/${collection}/records`,
      {
        method: "POST",
        headers: {
          Authorization: auth,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(record),
      },
    );
    const body = (await response.json()) as PocketBaseRecord & {
      message?: string;
    };
    if (!response.ok) {
      throw new Error(
        `creating ${collection} failed with HTTP ${response.status}: ${JSON.stringify(body)}`,
      );
    }
    return body;
  }

  async function remove(collection: string, id: string): Promise<void> {
    const auth = await adminToken();
    const response = await fetch(
      `${url}/api/collections/${collection}/records/${id}`,
      { method: "DELETE", headers: { Authorization: auth } },
    );
    if (!response.ok && response.status !== 404) {
      throw new Error(`deleting ${collection}/${id} failed with HTTP ${response.status}`);
    }
  }

  async function patch(
    collection: string,
    id: string,
    record: Record<string, unknown>,
  ): Promise<void> {
    const auth = await adminToken();
    const response = await fetch(
      `${url}/api/collections/${collection}/records/${id}`,
      {
        method: "PATCH",
        headers: {
          Authorization: auth,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(record),
      },
    );
    if (!response.ok) {
      throw new Error(
        `patching ${collection}/${id} failed with HTTP ${response.status}: ${await response.text()}`,
      );
    }
  }

  return {
    available: credential !== null,
    ...(credential === null
      ? {
          reason:
            "the sandbox scenario needs the operator credential (DBRAINX_ADMIN_EMAIL plus DBRAINX_ADMIN_PASSWORD or DBRAINX_ADMIN_PASSWORD_FILE) to provision a sandbox row and read sandbox_calls; set it and rerun",
        }
      : {}),

    async provision(workspaceId, pluginId = COUNTER_PLUGIN_ID) {
      const lifecycle = new SandboxLifecycle({
        repository: new PocketBaseSandboxStore({
          url,
          adminEmail: credential!.email,
          adminPassword: credential!.password,
        }),
        storageRoot: root,
      });
      const sandboxId = `sbx-${workspaceId}`.slice(0, 100);
      provisioned = await lifecycle.provision({
        sandboxId,
        workspaceId,
        pluginId,
        backend: "bubblewrap",
        status: "ready",
        rootPath: sandboxRootPath(root, workspaceId, sandboxId),
        policyHash: "e2e-task-83",
        maxBytes: 64 * 1024 * 1024,
        maxFiles: 100,
        maxProcesses: 2,
        lastUsedAt: new Date().toISOString(),
      });
      return provisioned;
    },

    async grantCounterCapabilities(workspaceId) {
      const manifest = JSON.parse(
        readFileSync(COUNTER_MANIFEST, "utf8"),
      ) as CounterManifest;
      for (const permission of manifest.permissions) {
        const scopeKey = computeScopeKey(
          permission.capability as never,
          permission.scope,
        );
        const existing = await list<PocketBaseRecord>(
          "plugin_grants",
          `workspaceId = "${workspaceId}" && pluginId = "${COUNTER_PLUGIN_ID}" && capability = "${permission.capability}" && scopeKey = "${scopeKey}"`,
        );
        if (existing.length > 0) continue;
        await create("plugin_grants", {
          workspaceId,
          pluginId: COUNTER_PLUGIN_ID,
          capability: permission.capability,
          scope: [...permission.scope],
          scopeKey,
          grantedBy: "e2e:task-83",
          grantedAt: new Date().toISOString(),
        });
      }
    },

    async revokeCapability(workspaceId, pluginId, capability) {
      const rows = await list<PocketBaseRecord>(
        "plugin_grants",
        `workspaceId = "${workspaceId}" && pluginId = "${pluginId}" && capability = "${capability}"`,
      );
      for (const row of rows) await remove("plugin_grants", row.id);
    },

    async calls(workspaceId) {
      return list<SandboxCallRow>(
        "sandbox_calls",
        `workspaceId = "${workspaceId}"`,
      );
    },

    async setNodeContent(nodeId, content) {
      await patch("nodes", nodeId, { content });
    },

    async cleanup(workspaceId, pluginId = COUNTER_PLUGIN_ID) {
      if (provisioned === null) return;
      const lifecycle = new SandboxLifecycle({
        repository: new PocketBaseSandboxStore({
          url,
          adminEmail: credential!.email,
          adminPassword: credential!.password,
        }),
        storageRoot: root,
      });
      await lifecycle.cleanupSandbox(workspaceId, provisioned.sandboxId);
      provisioned = null;
    },
  };
}
