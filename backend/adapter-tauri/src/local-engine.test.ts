// SPDX-License-Identifier: AGPL-3.0-only

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  emptyState,
  executeLocal,
  LocalProcedureError,
} from "./local-engine.ts";

const create = (state: ReturnType<typeof emptyState>, id: string) =>
  executeLocal(state, "workspace.add", { id, name: id });
const addNode = (
  state: ReturnType<typeof emptyState>,
  id: string,
  workspaceId: string,
) =>
  executeLocal(state, "node.add", {
    id,
    workspaceId,
    nodeType: "text",
    semanticId: "s",
    content: { docs: {} },
  });

test("offline provisioning is idempotent and creates a usable global view", () => {
  const state = emptyState();
  const workspace = executeLocal(state, "workspace.provisionDefault") as {
    id: string;
    name: string;
    isDefault: boolean;
  };
  executeLocal(state, "workspace.provisionDefault");
  assert.equal(state.records.workspace.length, 1);
  assert.equal(state.records.view.length, 1);
  assert.equal(
    state.records.view[0]?.workspaceId,
    state.records.workspace[0]?.id,
  );
  assert.equal(workspace.name, "默认工作区");
  assert.equal(workspace.isDefault, true);
  assert.equal(state.records.view[0]?.name, "全部");
  assert.equal(state.records.view[0]?.isDefault, true);
});
test("provisioned default instances cannot be deleted but may be renamed", () => {
  const state = emptyState();
  const workspace = executeLocal(state, "workspace.provisionDefault") as {
    id: string;
  };
  const view = state.records.view[0]!;
  assert.throws(
    () => executeLocal(state, "workspace.delete", { id: workspace.id }),
    /The default workspace cannot be deleted/,
  );
  assert.throws(
    () => executeLocal(state, "view.delete", { id: view.id }),
    /The default view cannot be deleted/,
  );
  // A rename stays allowed, and an update may not clear the protection flag.
  const renamed = executeLocal(state, "workspace.update", {
    id: workspace.id,
    updates: { name: "改名" },
  }) as { name: string; isDefault: boolean };
  assert.equal(renamed.name, "改名");
  const patched = executeLocal(state, "workspace.update", {
    id: workspace.id,
    updates: { isDefault: false },
  }) as { isDefault: boolean };
  assert.equal(patched.isDefault, true);
  const renamedView = executeLocal(state, "view.update", {
    id: view.id,
    updates: { name: "新视图", isDefault: false },
  }) as { name: string; isDefault: boolean };
  assert.equal(renamedView.name, "新视图");
  assert.equal(renamedView.isDefault, true);
});
test("workspace icon is validated, stored by update and cleared by null", () => {
  const state = emptyState();
  const workspace = executeLocal(state, "workspace.add", {
    id: "a",
    name: "a",
  } as never) as { id: string; icon?: unknown };
  assert.equal(workspace.icon, undefined);

  const icon = { kind: "icon", value: "Globe" };
  const updated = executeLocal(state, "workspace.update", {
    id: workspace.id,
    updates: { icon },
  }) as { icon?: unknown; name: string };
  assert.deepEqual(updated.icon, icon);
  // An icon edit must not rename the workspace.
  assert.equal(updated.name, "a");

  // The desktop rejects an uploaded-image icon exactly like the server router.
  assert.throws(
    () =>
      executeLocal(state, "workspace.update", {
        id: workspace.id,
        updates: { icon: { kind: "image", value: "book_icon.png" } },
      }),
    /Workspace icon must be an emoji or a named icon/,
  );

  const emoji = { kind: "emoji", value: "🧠", color: "#6366f1" };
  assert.deepEqual(
    (
      executeLocal(state, "workspace.update", {
        id: workspace.id,
        updates: { icon: emoji },
      }) as { icon?: unknown }
    ).icon,
    emoji,
  );

  // `null` is the write-side clear sentinel.
  const cleared = executeLocal(state, "workspace.update", {
    id: workspace.id,
    updates: { icon: null },
  }) as { icon?: unknown };
  assert.equal(cleared.icon, undefined);

  // The create dialog sends the icon with the workspace itself.
  const createdWithIcon = create(state, "with-icon") as { icon?: unknown };
  assert.equal(createdWithIcon.icon, undefined);
  const created = executeLocal(state, "workspace.add", {
    id: "with-emoji",
    name: "with-emoji",
    icon: emoji,
  }) as { icon?: unknown };
  assert.deepEqual(created.icon, emoji);
});

test("user-created workspace and view are not default and can be deleted", () => {
  const state = emptyState();
  const workspace = executeLocal(state, "workspace.add", {
    id: "a",
    name: "a",
    isDefault: true,
  }) as { isDefault: boolean };
  assert.equal(workspace.isDefault, false);
  const view = executeLocal(state, "view.add", {
    id: "v",
    workspaceId: "a",
    name: "v",
    viewType: "Force",
    isDefault: true,
  }) as { isDefault: boolean };
  assert.equal(view.isDefault, false);
  executeLocal(state, "view.delete", { id: "v" });
  executeLocal(state, "workspace.delete", { id: "a" });
  assert.equal(state.records.workspace.length, 0);
  assert.equal(state.records.view.length, 0);
});
test("legacy local state gets default flags on the first entity call", () => {
  const state = emptyState();
  const workspace = executeLocal(state, "workspace.provisionDefault") as {
    id: string;
  };
  const view = state.records.view[0]!;
  // State written before `isDefault` existed has no property on either record.
  delete state.records.workspace[0]!.isDefault;
  delete state.records.view[0]!.isDefault;

  executeLocal(state, "workspace.listByUser");
  assert.equal(state.records.workspace[0]?.isDefault, true);
  assert.equal(state.records.view[0]?.isDefault, true);
  assert.throws(
    () => executeLocal(state, "workspace.delete", { id: workspace.id }),
    /The default workspace cannot be deleted/,
  );
  assert.throws(
    () => executeLocal(state, "view.delete", { id: view.id }),
    /The default view cannot be deleted/,
  );
});
test("restart snapshot retains rich content and queries isolate workspaces", () => {
  const state = emptyState();
  create(state, "a");
  create(state, "b");
  addNode(state, "n", "a");
  addNode(state, "other", "b");
  const content = {
    docs: {
      main: { type: "doc", content: [{ type: "paragraph", text: "离线内容" }] },
    },
  };
  executeLocal(state, "node.update", { id: "n", updates: { content } });
  const restarted = JSON.parse(JSON.stringify(state));
  const nodes = executeLocal(restarted, "node.listByWorkspace", {
    workspaceId: "a",
  }) as { id: string; content: unknown }[];
  assert.deepEqual(
    nodes.map((node) => node.id),
    ["n"],
  );
  assert.deepEqual(nodes[0]?.content, content);
});
test("cross-workspace edges and entity moves are rejected", () => {
  const state = emptyState();
  create(state, "a");
  create(state, "b");
  addNode(state, "n", "a");
  addNode(state, "m", "b");
  assert.throws(
    () =>
      executeLocal(state, "edge.add", {
        id: "e",
        from: "n",
        to: "m",
        workspaceId: "a",
      }),
    LocalProcedureError,
  );
  assert.throws(
    () =>
      executeLocal(state, "node.update", {
        id: "n",
        updates: { workspaceId: "b" },
      }),
    LocalProcedureError,
  );
});
test("workspace deletion cascades all scoped entities and records tombstones", () => {
  const state = emptyState();
  create(state, "a");
  create(state, "b");
  addNode(state, "n", "a");
  addNode(state, "m", "a");
  addNode(state, "other", "b");
  executeLocal(state, "edge.add", {
    id: "e",
    from: "n",
    to: "m",
    workspaceId: "a",
  });
  executeLocal(state, "nodeSemantic.add", {
    id: "s",
    name: "类型",
    workspaceId: "a",
  });
  executeLocal(state, "dashboard.save", {
    workspaceId: "a",
    state: { revision: 0, pages: [], candidates: [], activePageId: null },
  });
  executeLocal(state, "workspace.delete", { id: "a" });
  for (const records of Object.values(state.records))
    assert.equal(
      records.some((record) => record.workspaceId === "a" || record.id === "a"),
      false,
    );
  assert.equal(state.records.node[0]?.id, "other");
  for (const id of ["a", "n", "m", "e", "s"])
    assert.ok(
      state.outbox.some(
        (change) => change.entityId === id && change.operation === "delete",
      ),
    );
});
test("workspace rename trims the name and enforces the shared limit", () => {
  const state = emptyState();
  create(state, "a");
  const renamed = executeLocal(state, "workspace.update", {
    id: "a",
    updates: { name: "  新名称  " },
  }) as { name: string };
  assert.equal(renamed.name, "新名称");
  assert.throws(
    () =>
      executeLocal(state, "workspace.update", {
        id: "a",
        updates: { name: "a".repeat(51) },
      }),
    (error: unknown) =>
      error instanceof LocalProcedureError &&
      error.message.includes("cannot exceed 50 characters"),
  );
  assert.throws(
    () =>
      executeLocal(state, "workspace.update", {
        id: "a",
        updates: { name: "   " },
      }),
    LocalProcedureError,
  );
  // A rejected rename must not change the stored name.
  assert.equal(
    (executeLocal(state, "workspace.getById", { id: "a" }) as { name: string })
      .name,
    "新名称",
  );
});
test("dashboard optimistic revisions prevent stale overwrites", () => {
  const state = emptyState();
  create(state, "a");
  const input = {
    workspaceId: "a",
    state: { revision: 0, pages: [], candidates: [], activePageId: null },
  };
  executeLocal(state, "dashboard.save", input);
  assert.throws(
    () => executeLocal(state, "dashboard.save", input),
    (error: unknown) =>
      error instanceof LocalProcedureError && error.code === "CONFLICT",
  );
  assert.equal(
    (
      executeLocal(state, "dashboard.get", { workspaceId: "a" }) as {
        revision: number;
      }
    ).revision,
    1,
  );
});
test("outbox snapshots are immutable and sequences remain monotonic", () => {
  const state = emptyState();
  create(state, "a");
  addNode(state, "n", "a");
  executeLocal(state, "node.update", { id: "n", updates: { title: "edited" } });
  const changes = state.outbox.filter((change) => change.entityId === "n");
  assert.equal(changes[0]?.value?.title, "");
  assert.equal(changes[1]?.value?.title, "edited");
  assert.deepEqual(
    state.outbox.map((change) => change.sequence),
    state.outbox.map((_, index) => index + 1),
  );
});
