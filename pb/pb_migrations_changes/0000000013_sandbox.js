// SPDX-License-Identifier: AGPL-3.0-only

// Migration 0013: sandbox instances, their file index, and the per-call audit.
//
// The design document calls this file `0000000012_sandbox.js`, but 0012 is
// already taken by `0000000012_node_timestamps.js`; a released change migration
// is immutable, so the sandbox tables take the next free number. The base
// schema carries the same three collections, so a new database is born with
// them and never runs this script.
//
// All three tables are server-only (`listRule` / `viewRule` / `createRule` /
// `updateRule` / `deleteRule` are `null`). `sandboxes.rootPath` is a host path
// and must never reach a client; the file layer derives it from the configured
// storage root and refuses a stored value that differs.
/// <reference path="../pb_data/types.d.ts" />

const SANDBOX_TABLES = ["sandboxes", "sandbox_files", "sandbox_calls"];

const SERVER_ONLY = {
  listRule: null,
  viewRule: null,
  createRule: null,
  updateRule: null,
  deleteRule: null,
};

function collectionNames(app) {
  const names = new Set();
  for (const collection of app.findAllCollections()) names.add(collection.name);
  return names;
}

function hasCollection(app, name) {
  return collectionNames(app).has(name);
}

function createSandboxTables(app) {
  app.save(
    new Collection({
      ...SERVER_ONLY,
      name: "sandboxes",
      type: "base",
      fields: [
        { name: "sandboxId", type: "text", required: true, max: 100 },
        { name: "workspaceId", type: "text", required: true, max: 100 },
        { name: "pluginId", type: "text", required: true, max: 100 },
        { name: "backend", type: "text", required: true, max: 40 },
        {
          name: "status",
          type: "select",
          required: true,
          values: ["ready", "unavailable", "disabled"],
        },
        { name: "rootPath", type: "text", required: true, max: 1024 },
        { name: "policyHash", type: "text", required: true, max: 128 },
        { name: "maxBytes", type: "number", required: true },
        { name: "maxFiles", type: "number", required: true },
        { name: "maxProcesses", type: "number", required: true },
        { name: "lastUsedAt", type: "date" },
      ],
      indexes: [
        "CREATE UNIQUE INDEX idx_sandboxes_key ON sandboxes (workspaceId, pluginId)",
      ],
    }),
  );

  app.save(
    new Collection({
      ...SERVER_ONLY,
      name: "sandbox_files",
      type: "base",
      fields: [
        { name: "sandboxId", type: "text", required: true, max: 100 },
        { name: "path", type: "text", required: true, max: 1024 },
        { name: "ownerNodeId", type: "text", max: 100 },
        { name: "size", type: "number", required: true },
        { name: "sha256", type: "text", required: true, max: 64 },
        { name: "mime", type: "text", max: 255 },
        { name: "createdByRunId", type: "text", max: 100 },
        { name: "deletedAt", type: "date" },
      ],
      indexes: [
        "CREATE UNIQUE INDEX idx_sandbox_files_path ON sandbox_files (sandboxId, path)",
        "CREATE INDEX idx_sandbox_files_owner ON sandbox_files (ownerNodeId)",
      ],
    }),
  );

  app.save(
    new Collection({
      ...SERVER_ONLY,
      name: "sandbox_calls",
      type: "base",
      fields: [
        { name: "sandboxId", type: "text", required: true, max: 100 },
        { name: "runId", type: "text", required: true, max: 100 },
        { name: "pluginId", type: "text", required: true, max: 100 },
        { name: "workspaceId", type: "text", required: true, max: 100 },
        { name: "capability", type: "text", required: true, max: 80 },
        { name: "path", type: "text", max: 1024 },
        { name: "executable", type: "text", max: 100 },
        { name: "exitCode", type: "number" },
        { name: "stdoutBytes", type: "number" },
        { name: "stderrBytes", type: "number" },
        {
          name: "decision",
          type: "select",
          required: true,
          values: ["allowed", "denied"],
        },
        { name: "errorCode", type: "text", max: 80 },
        { name: "startedAt", type: "date", required: true },
        { name: "durationMs", type: "number" },
      ],
      indexes: [
        "CREATE INDEX idx_sandbox_calls_run ON sandbox_calls (runId)",
        "CREATE INDEX idx_sandbox_calls_sandbox ON sandbox_calls (sandboxId, startedAt)",
      ],
    }),
  );
}

migrate(
  (app) => {
    const existing = collectionNames(app);
    const present = SANDBOX_TABLES.filter((name) => existing.has(name));
    if (present.length === SANDBOX_TABLES.length) {
      console.log("[0013] sandbox schema already current, nothing to migrate");
      return;
    }
    if (present.length > 0) {
      throw new Error(
        `[0013] partial sandbox schema: ${present.join(", ")} already exist(s) but ` +
          `${SANDBOX_TABLES.filter((name) => !existing.has(name)).join(", ")} ` +
          "do(es) not; remove the partial collections before re-running",
      );
    }
    createSandboxTables(app);
    console.log("[0013] created sandboxes, sandbox_files, sandbox_calls");
  },
  (app) => {
    // `down` probes every collection: a run that stopped after creating one or
    // two tables must still roll back instead of failing on a missing name.
    for (const name of ["sandbox_calls", "sandbox_files", "sandboxes"]) {
      if (!hasCollection(app, name)) continue;
      app.delete(app.findCollectionByNameOrId(name));
      console.log(`[0013] dropped ${name}`);
    }
  },
);
