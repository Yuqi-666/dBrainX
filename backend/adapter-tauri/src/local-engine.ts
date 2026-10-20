// SPDX-License-Identifier: AGPL-3.0-only

/** Desktop procedure adapter. Storage and the future sync transport stay outside this engine. */
import {
  DEFAULT_VIEW_NAME,
  DEFAULT_WORKSPACE_NAME,
  WORKSPACE_NAME_MAX_LENGTH,
} from "@workspace/utils/workspace";
import { DEFAULT_STORAGE_LIMITS } from "@workspace/utils/storage-limits";

export type Entity = Record<string, unknown> & { id: string };
export const collections = [
  "workspace",
  "node",
  "edge",
  "view",
  "nodeSemantic",
  "edgeSemantic",
  "nodeTag",
  "dashboard",
] as const;
export type Collection = (typeof collections)[number];
export interface PendingChange {
  sequence: number;
  collection: Collection;
  entityId: string;
  operation: "put" | "delete";
  value?: Entity;
  occurredAt: string;
}
export interface LocalState {
  version: 1;
  sequence: number;
  records: Record<Collection, Entity[]>;
  outbox: PendingChange[];
}
export const localUser = {
  id: "desktop-local",
  nickname: "本地用户",
  email: "",
  avatarUrl: null,
};
export function emptyState(): LocalState {
  return {
    version: 1,
    sequence: 0,
    records: {
      workspace: [],
      node: [],
      edge: [],
      view: [],
      nodeSemantic: [],
      edgeSemantic: [],
      nodeTag: [],
      dashboard: [],
    },
    outbox: [],
  };
}
export class LocalProcedureError extends Error {
  constructor(
    message: string,
    readonly code: "CONFLICT" | "BAD_REQUEST" | "NOT_FOUND" = "BAD_REQUEST",
  ) {
    super(message);
  }
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new LocalProcedureError("Expected an object");
  return value as Record<string, unknown>;
}
function text(value: unknown): string {
  if (typeof value !== "string" || !value.trim())
    throw new LocalProcedureError("Expected a nonempty string");
  return value;
}
/** The shared workspace name rule: trimmed, non-empty, within the shared limit. */
function workspaceName(value: unknown): string {
  const name = text(value).trim();
  if (name.length > WORKSPACE_NAME_MAX_LENGTH)
    throw new LocalProcedureError(
      `Workspace name cannot exceed ${WORKSPACE_NAME_MAX_LENGTH} characters`,
    );
  return name;
}
/**
 * The workspace picker icon, validated like the server router does: only an
 * emoji or a Lucide graphic name, never an uploaded image (the desktop has no
 * file of the workspace's own to point at). `null` is the clear sentinel.
 */
function workspaceIcon(value: unknown): Record<string, unknown> | null {
  if (value === null) return null;
  const icon = object(value);
  if (icon.kind !== "emoji" && icon.kind !== "icon")
    throw new LocalProcedureError(
      "Workspace icon must be an emoji or a named icon",
    );
  const result: Record<string, unknown> = {
    kind: icon.kind,
    value: text(icon.value),
  };
  if (icon.color !== undefined) {
    if (typeof icon.color !== "string")
      throw new LocalProcedureError("Workspace icon color must be a string");
    result.color = icon.color;
  }
  return result;
}
function put(
  state: LocalState,
  collection: Collection,
  value: Entity,
  now: string,
) {
  const records = state.records[collection];
  const index = records.findIndex((record) => record.id === value.id);
  if (index < 0) records.push(value);
  else records[index] = value;
  state.outbox.push({
    sequence: ++state.sequence,
    collection,
    entityId: value.id,
    operation: "put",
    value: structuredClone(value),
    occurredAt: now,
  });
}
function remove(
  state: LocalState,
  collection: Collection,
  id: string,
  now: string,
) {
  state.records[collection] = state.records[collection].filter(
    (record) => record.id !== id,
  );
  state.outbox.push({
    sequence: ++state.sequence,
    collection,
    entityId: id,
    operation: "delete",
    occurredAt: now,
  });
}
function workspace(state: LocalState, id: unknown) {
  const found = state.records.workspace.find(
    (record) => record.id === text(id),
  );
  if (!found) throw new LocalProcedureError("Workspace not found", "NOT_FOUND");
  return found;
}

/**
 * Repairs default flags on local state written before the flag existed.
 *
 * The desktop database has no schema migration: an install that predates
 * `isDefault` keeps its records as they are. The provisioning code wrote the
 * default workspace first and each workspace's global view first, so storage
 * order distinguishes them. Marking them here makes the delete guard effective
 * on the first write after the upgrade instead of leaving the old default
 * deletable forever.
 *
 * The repair is idempotent and runs at the start of every entity call; a
 * read-only IndexedDB transaction simply does not persist it, and the next
 * write does.
 */
function repairDefaultInstances(state: LocalState) {
  const workspaces = state.records.workspace;
  if (workspaces.length === 0) return;
  // Only a record without the property at all is pre-upgrade state. A modern
  // record always carries the boolean explicitly (false for user-created
  // instances), so this never promotes a workspace the user created later.
  if (workspaces.every((record) => record.isDefault === undefined)) {
    const [oldest] = workspaces;
    if (oldest) oldest.isDefault = true;
  }
  for (const ws of workspaces) {
    const views = state.records.view.filter(
      (record) => record.workspaceId === ws.id,
    );
    if (views.length === 0) continue;
    if (!views.every((record) => record.isDefault === undefined)) continue;
    const [defaultView] = views;
    if (defaultView) defaultView.isDefault = true;
  }
}

function createWorkspace(
  state: LocalState,
  input: Record<string, unknown>,
  now: string,
  isDefault: boolean,
): Entity {
  const value: Entity = {
    ...input,
    id: text(input.id),
    name: text(input.name),
    ownerId: localUser.id,
    // Server-owned flag: only the provisioning path marks a workspace default,
    // and a client-supplied value never survives.
    isDefault,
    createdAt: now,
    updatedAt: now,
  };
  // Keep the stored icon equal to the server's validated shape; a create with
  // no icon stays without the property instead of writing `icon: undefined`.
  if (input.icon === undefined) delete value.icon;
  else {
    const icon = workspaceIcon(input.icon);
    if (icon) value.icon = icon;
    else delete value.icon;
  }
  if (state.records.workspace.some((record) => record.id === value.id))
    throw new LocalProcedureError("Workspace already exists", "CONFLICT");
  put(state, "workspace", value, now);
  put(
    state,
    "view",
    {
      id: crypto.randomUUID(),
      name: DEFAULT_VIEW_NAME,
      viewType: "Force",
      visualConfig: { showMinimap: true },
      filterConfig: {},
      isPinned: true,
      // Every workspace is created with its global view, so the view is the
      // workspace's default view and cannot be deleted (renaming stays allowed).
      isDefault: true,
      workspaceId: value.id,
    },
    now,
  );
  return value;
}

/** Mutates only the transaction's private snapshot. A thrown error must abort its commit. */
export function executeLocal(
  state: LocalState,
  path: string,
  rawInput?: unknown,
  now = new Date().toISOString(),
): unknown {
  const [name, action] = path.split(".");
  const input = rawInput === undefined ? {} : object(rawInput);
  if (name === "auth") {
    if (action === "me") return localUser;
    if (action === "logout") return { success: true };
    throw new LocalProcedureError(
      "Local mode does not use cloud authentication",
    );
  }
  if (name === "file")
    throw new LocalProcedureError(
      "此功能需要桌面文件处理适配器，目前可保留原始文件。",
    );
  // The desktop local mode has no operator `.env` to read a storage policy from,
  // so it answers with the shared built-in limits. The resource library then
  // renders the same quota bar as the server deployment, and the local
  // PocketBase hook enforces the same defaults.
  if (name === "storage") {
    if (action === "limits") return DEFAULT_STORAGE_LIMITS;
    throw new LocalProcedureError(`Unsupported local procedure: ${path}`);
  }
  if (!collections.includes(name as Collection))
    throw new LocalProcedureError(`Unsupported local procedure: ${path}`);
  const collection = name as Collection;
  // Older local databases have no default flags yet; normalize them before any
  // entity call so the delete guards cover the pre-existing instances too.
  repairDefaultInstances(state);
  const records = state.records[collection];
  if (collection === "workspace" && action === "provisionDefault") {
    return (
      records[0] ??
      createWorkspace(
        state,
        { id: crypto.randomUUID(), name: DEFAULT_WORKSPACE_NAME },
        now,
        true,
      )
    );
  }
  if (collection === "workspace" && action === "getMembers") {
    const ws = workspace(state, input.workspaceId);
    return [
      {
        id: `owner-${ws.id}`,
        workspaceId: ws.id,
        userId: localUser.id,
        role: "owner",
      },
    ];
  }
  if (collection === "dashboard") {
    workspace(state, input.workspaceId);
    const id = text(input.workspaceId);
    const current = records.find((record) => record.id === id);
    const saved = current?.state ?? {
      revision: 0,
      pages: [],
      candidates: [],
      activePageId: null,
    };
    if (action === "get") return saved;
    if (action === "save") {
      const next = object(input.state);
      if (next.revision !== object(saved).revision)
        throw new LocalProcedureError(
          "Dashboard revision conflict",
          "CONFLICT",
        );
      if (!Array.isArray(next.pages) || !Array.isArray(next.candidates))
        throw new LocalProcedureError("Invalid dashboard state");
      const value = { ...next, revision: Number(next.revision) + 1 };
      put(state, "dashboard", { id, workspaceId: id, state: value }, now);
      return value;
    }
  }
  if (action === "getById")
    return records.find((record) => record.id === input.id) ?? null;
  if (
    ["list", "listByUser", "listByWorkspace", "getPinned"].includes(
      action ?? "",
    )
  ) {
    if (action === "listByWorkspace") workspace(state, input.workspaceId);
    const filter =
      action === "getPinned"
        ? { isPinned: true }
        : action === "listByUser"
          ? {}
          : input;
    return records.filter((record) =>
      Object.entries(filter).every(
        ([key, value]) => value === undefined || record[key] === value,
      ),
    );
  }
  if (action === "add") {
    if (collection === "workspace")
      return createWorkspace(state, input, now, false);
    const id = text(input.id);
    if (records.some((record) => record.id === id))
      throw new LocalProcedureError("Entity already exists", "CONFLICT");
    workspace(state, input.workspaceId);
    let defaults: Record<string, unknown> = {};
    if (collection === "node")
      defaults = {
        title: "",
        permission: "private",
        tags: [],
        stateData: { client: {}, server: {} },
      };
    if (collection === "edge") {
      if (input.from === input.to)
        throw new LocalProcedureError("Edge cannot connect a node to itself");
      for (const endpoint of [input.from, input.to]) {
        if (
          !state.records.node.some(
            (node) =>
              node.id === endpoint && node.workspaceId === input.workspaceId,
          )
        )
          throw new LocalProcedureError(
            "Edge endpoint must belong to the same workspace",
          );
      }
      defaults = { stateData: { client: {}, server: {} } };
    }
    if (collection === "view")
      defaults = { filterConfig: {}, visualConfig: { showMinimap: true } };
    const value: Entity = {
      ...defaults,
      ...input,
      id,
      createdAt: now,
      updatedAt: now,
    };
    // A user-created view is never the workspace's default view.
    if (collection === "view") value.isDefault = false;
    put(state, collection, value, now);
    return value;
  }
  const current = records.find((record) => record.id === input.id);
  if (!current) throw new LocalProcedureError("Entity not found", "NOT_FOUND");
  if (action === "update") {
    const updates = object(input.updates);
    // A workspace rename follows the same rule as the server entity: trim the
    // name, reject a blank name and reject a name over the shared limit.
    if (collection === "workspace" && updates.name !== undefined)
      updates.name = workspaceName(updates.name);
    // A workspace icon is validated here too, so both modes store the same
    // shape; `null` falls through to the generic clear below.
    if (collection === "workspace" && updates.icon !== undefined)
      updates.icon = workspaceIcon(updates.icon);
    // The default flag is server-owned: an update may rename or reconfigure
    // the instance, but it may not clear the protection flag.
    if (collection === "workspace" || collection === "view")
      delete updates.isDefault;
    if (
      updates.workspaceId !== undefined &&
      updates.workspaceId !== current.workspaceId
    )
      throw new LocalProcedureError(
        "Moving entities between workspaces is unsupported",
      );
    const value: Entity = {
      ...current,
      ...Object.fromEntries(
        Object.entries(updates).filter(([, v]) => v !== undefined),
      ),
      id: current.id,
      updatedAt: now,
    };
    for (const key of ["icon", "cover"])
      if (value[key] === null) delete value[key];
    put(state, collection, value, now);
    return value;
  }
  if (action === "delete") {
    if (collection === "workspace" && current.isDefault === true)
      throw new LocalProcedureError("The default workspace cannot be deleted");
    if (collection === "view" && current.isDefault === true)
      throw new LocalProcedureError("The default view cannot be deleted");
    if (collection === "workspace") {
      for (const key of collections) {
        if (key === "workspace") continue;
        for (const record of [...state.records[key]])
          if (record.workspaceId === current.id)
            remove(state, key, record.id, now);
      }
    }
    if (collection === "node") {
      for (const edge of [...state.records.edge])
        if (edge.from === current.id || edge.to === current.id)
          remove(state, "edge", edge.id, now);
    }
    remove(state, collection, current.id, now);
    return { success: true, id: current.id };
  }
  throw new LocalProcedureError(`Unsupported local procedure: ${path}`);
}
