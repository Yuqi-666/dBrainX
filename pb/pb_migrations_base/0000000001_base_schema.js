// SPDX-License-Identifier: AGPL-3.0-only

// Full schema for new databases. Update this with every new schema change.
// Existing databases use immutable scripts in pb_migrations_changes instead.
/// <reference path="../pb_data/types.d.ts" />
migrate(
  (app) => {
    // 1. 给 users 表添加 nickname 字段
    const usersCollection = app.findCollectionByNameOrId("users");
    usersCollection.fields.addAt(
      3,
      new TextField({
        name: "nickname",
      }),
    );
    app.save(usersCollection);

    // 2. 创建 node_semantics 表
    const nodeSemantics = new Collection({
      name: "node_semantics",
      type: "base",
      listRule: "",
      viewRule: "",
      createRule: "",
      updateRule: "",
      deleteRule: "",
      fields: [
        { name: "name", type: "text", required: true },
        { name: "description", type: "text" },
        { name: "color", type: "text" },
        { name: "icon", type: "text" },
        { name: "workspaceId", type: "text" },
      ],
    });
    app.save(nodeSemantics);

    // 3. 创建 edge_semantics 表
    const edgeSemantics = new Collection({
      name: "edge_semantics",
      type: "base",
      listRule: "",
      viewRule: "",
      createRule: "",
      updateRule: "",
      deleteRule: "",
      fields: [
        { name: "name", type: "text" },
        {
          name: "category",
          type: "select",
          required: true,
          values: ["hierarchy", "flow", "association", "interaction"],
        },
        { name: "color", type: "text" },
        { name: "description", type: "text" },
        { name: "workspaceId", type: "text" },
      ],
    });
    app.save(edgeSemantics);

    // 4. 创建 node_tags 表
    const nodeTags = new Collection({
      name: "node_tags",
      type: "base",
      listRule: "",
      viewRule: "",
      createRule: "",
      updateRule: "",
      deleteRule: "",
      fields: [
        { name: "name", type: "text" },
        { name: "color", type: "text" },
        { name: "workspaceId", type: "text" },
      ],
    });
    app.save(nodeTags);

    // 5. 创建 workspaces 表
    const workspaces = new Collection({
      name: "workspaces",
      type: "base",
      listRule: "",
      viewRule: "",
      createRule: "",
      updateRule: "",
      deleteRule: "",
      fields: [
        { name: "name", type: "text", required: true },
        { name: "ownerId", type: "text", required: true },
        // User-editable picker icon: `{ kind: "emoji" | "icon", value }`.
        // `null` / a missing value means the picker shows its fallback glyph.
        { name: "icon", type: "json" },
        // Server-owned: true for the workspace provisioned on first login.
        // Such a workspace cannot be deleted; a rename stays allowed.
        { name: "isDefault", type: "bool" },
      ],
    });
    app.save(workspaces);

    // 6. 创建 workspace_members 表
    const workspaceMembers = new Collection({
      name: "workspace_members",
      type: "base",
      listRule: "",
      viewRule: "",
      createRule: "",
      updateRule: "",
      deleteRule: "",
      fields: [
        { name: "workspaceId", type: "text", required: true },
        { name: "userId", type: "text", required: true },
        {
          name: "role",
          type: "select",
          required: true,
          values: ["owner", "editor", "viewer"],
        },
      ],
    });
    app.save(workspaceMembers);

    // 7. 创建 views 表
    const views = new Collection({
      name: "views",
      type: "base",
      listRule: "",
      viewRule: "",
      createRule: "",
      updateRule: "",
      deleteRule: "",
      fields: [
        { name: "name", type: "text" },
        {
          name: "viewType",
          type: "select",
          required: true,
          values: ["Force", "Flow"],
        },
        { name: "visualConfig", type: "json" },
        { name: "filterConfig", type: "json" },
        { name: "isPinned", type: "bool" },
        { name: "workspaceId", type: "text" },
        // Server-owned: true for the global view created with a workspace.
        // Such a view cannot be deleted; a rename stays allowed.
        { name: "isDefault", type: "bool" },
      ],
    });
    app.save(views);

    // 8. 创建 nodes 表
    const nodes = new Collection({
      name: "nodes",
      type: "base",
      listRule: "",
      viewRule: "",
      createRule: "",
      updateRule: "",
      deleteRule: "",
      fields: [
        { name: "title", type: "text" },
        { name: "abstract", type: "text" },
        {
          name: "permission",
          type: "select",
          required: true,
          values: ["private", "public", "restricted"],
        },
        { name: "semanticId", type: "text" },
        { name: "tags", type: "json" },
        { name: "isPinned", type: "bool" },
        { name: "stateData", type: "json" },
        { name: "nodeType", type: "text", required: true },
        // The only type payload: every node type keeps its whole content here,
        // including the facts (`width`, `duration`, `pageCount`, …) that used to
        // have a column of their own. Adding a node type therefore needs no
        // migration. PocketBase caps a JSON field at 1 MiB unless a size is
        // given; the ceiling stays at 24 MiB because a database upgraded from
        // the column-per-type shape may still hold an inline web page source
        // until `0000000007_webpage_object_storage.js` runs.
        {
          name: "content",
          type: "json",
          maxSize: 24 * 1024 * 1024,
        },
        { name: "workspaceId", type: "text" },
        { name: "icon", type: "json" },
        { name: "cover", type: "json" },
        // The content-version marker of the node type (`1` today); it is also
        // the resume marker of the `content` fold in
        // `0000000011_dynamic_engine.js`.
        { name: "typeVersion", type: "number", min: 1 },
        { name: "deletedAt", type: "date" },
        // The stored timestamps the node mapper reads. `updated` is also the
        // version marker `expectedVersion` compares against; a PocketBase base
        // collection declares no such columns itself, so both are named here
        // (`0000000012_node_timestamps.js` adds them to an existing database).
        { name: "created", type: "autodate", onCreate: true },
        { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
      ],
      // `idx_nodes_ws_updated` from the design document is still not declared:
      // `updated` exists now, but no query filters it together with
      // `workspaceId`. Add the index with the query that needs it.
      indexes: [
        "CREATE INDEX idx_nodes_ws_type ON nodes (workspaceId, nodeType)",
        "CREATE INDEX idx_nodes_ws_pinned ON nodes (workspaceId, isPinned)",
        "CREATE UNIQUE INDEX idx_nodes_semantic ON nodes (workspaceId, semanticId) WHERE semanticId <> ''",
      ],
    });
    app.save(nodes);

    // 9. 创建 edges 表
    const edges = new Collection({
      name: "edges",
      type: "base",
      listRule: "",
      viewRule: "",
      createRule: "",
      updateRule: "",
      deleteRule: "",
      fields: [
        { name: "from", type: "text", required: true },
        { name: "to", type: "text", required: true },
        {
          name: "direction",
          type: "select",
          required: true,
          values: ["forward", "reverse", "bidirectional", "undirected"],
        },
        { name: "semanticId", type: "text" },
        { name: "stateData", type: "json" },
        { name: "workspaceId", type: "text" },
        // Who created the edge (a user id or a plugin id), and the run that
        // produced it. Both stay empty for an edge a person drew.
        { name: "createdBy", type: "text", max: 100 },
        { name: "runId", type: "text", max: 100 },
        // The stored timestamps the edge mapper reads; `updated` is the version
        // marker of the record, as on `nodes`. See
        // `0000000012_node_timestamps.js`.
        { name: "created", type: "autodate", onCreate: true },
        { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
      ],
      indexes: [
        "CREATE INDEX idx_edges_ws_from ON edges (workspaceId, from)",
        "CREATE INDEX idx_edges_ws_to ON edges (workspaceId, to)",
      ],
    });
    app.save(edges);

    // 10. 创建 files 表
    const files = new Collection({
      name: "files",
      type: "base",
      listRule: "",
      viewRule: "",
      createRule: "",
      updateRule: "",
      deleteRule: "",
      fields: [
        {
          name: "file",
          type: "file",
          required: true,
          maxSelect: 1,
          maxSize: 104857600,
        },
        // Server-owned media metadata (see the hook in `pb_hooks/files.pb.js`):
        // the stored byte length the quota counts, and the MIME type the resource
        // library groups by. `displayName` is the one user-editable label; the
        // stored file bytes never change when a resource is renamed.
        { name: "size", type: "number", min: 0 },
        { name: "mimeType", type: "text", max: 200 },
        { name: "displayName", type: "text", max: 300 },
        // The result of parsing a PDF or packaging a video is cached on the
        // resource record that owns the blob, once, so every node that
        // references that resource reuses it (`FileCommandService`). The fields
        // are written by the analysis endpoints; a client may not set the size
        // or the stored file through an update.
        { name: "pageCount", type: "number", min: 0, onlyInt: true },
        { name: "width", type: "number", min: 0, onlyInt: true },
        { name: "height", type: "number", min: 0, onlyInt: true },
        { name: "duration", type: "number", min: 0 },
        { name: "coverUrl", type: "text", max: 1000 },
        { name: "hlsUrl", type: "text", max: 1000 },
        // Provenance of an artifact the server derived from a resource (a PDF
        // cover, an HLS playlist, its segments, a poster): the id of the source
        // record. The resource library lists only records without it, and
        // deleting the resource deletes the artifacts (`pb_hooks/files.pb.js`).
        { name: "derivedFrom", type: "text", max: 100 },
        { name: "created", type: "autodate", onCreate: true },
        { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
      ],
    });
    app.save(files);

    // 11. 创建 dashboard_configs 表
    const users = app.findCollectionByNameOrId("users");
    const workspace = app.findCollectionByNameOrId("workspaces");
    const access =
      '@request.auth.id != "" && ownerId = @request.auth.id && (workspaceId.ownerId = @request.auth.id || (@collection.workspace_members:dashboard.workspaceId ?= workspaceId && @collection.workspace_members:dashboard.userId ?= @request.auth.id))';
    app.save(
      new Collection({
        name: "dashboard_configs",
        type: "base",
        listRule: access,
        viewRule: access,
        createRule: access,
        updateRule: null,
        deleteRule: null,
        fields: [
          {
            name: "ownerId",
            type: "relation",
            required: true,
            maxSelect: 1,
            collectionId: users.id,
            cascadeDelete: true,
          },
          {
            name: "workspaceId",
            type: "relation",
            required: true,
            maxSelect: 1,
            collectionId: workspace.id,
            cascadeDelete: true,
          },
          {
            name: "revision",
            type: "number",
            required: true,
            min: 1,
            onlyInt: true,
          },
          { name: "config", type: "json", required: true, maxSize: 5000000 },
        ],
        indexes: [
          "CREATE UNIQUE INDEX idx_dashboard_revision ON dashboard_configs (ownerId, workspaceId, revision)",
        ],
      }),
    );
    // Current access rules and fields.
    {
      const auth = '@request.auth.id != ""';
      const owner =
        "@collection.workspaces:workspace_scope.id ?= workspaceId && @collection.workspaces:workspace_scope.ownerId ?= @request.auth.id";
      const member =
        "@collection.workspace_members:membership_scope.workspaceId ?= workspaceId && @collection.workspace_members:membership_scope.userId ?= @request.auth.id";
      const editor =
        member +
        ' && @collection.workspace_members:membership_scope.role ?!= "viewer"';
      const read = auth + " && (" + owner + " || (" + member + "))";
      const write = auth + " && (" + owner + " || (" + editor + "))";
      for (const name of [
        "nodes",
        "edges",
        "views",
        "node_semantics",
        "edge_semantics",
        "node_tags",
      ]) {
        const c = app.findCollectionByNameOrId(name);
        c.listRule = read;
        c.viewRule = read;
        c.createRule = write;
        c.updateRule = write + " && @request.body.workspaceId:changed = false";
        // A view's isDefault is server-owned: a client update must not clear it,
        // or the protected view would become deletable.
        if (name === "views")
          c.updateRule += " && @request.body.isDefault:changed = false";
        c.deleteRule = write;
        app.save(c);
      }
      const workspace = app.findCollectionByNameOrId("workspaces");
      workspace.listRule =
        auth +
        " && (ownerId = @request.auth.id || (@collection.workspace_members:membership_scope.workspaceId ?= id && @collection.workspace_members:membership_scope.userId ?= @request.auth.id))";
      workspace.viewRule = workspace.listRule;
      workspace.createRule = auth + " && ownerId = @request.auth.id";
      // `isDefault` is server-owned for the same reason: clearing it through an
      // update would make the default workspace deletable.
      workspace.updateRule =
        auth +
        " && ownerId = @request.auth.id && @request.body.ownerId:changed = false" +
        " && @request.body.isDefault:changed = false";
      workspace.deleteRule = auth + " && ownerId = @request.auth.id";
      app.save(workspace);
      const members = app.findCollectionByNameOrId("workspace_members");
      members.listRule = read;
      members.viewRule = read;
      members.createRule = auth + " && (" + owner + ")";
      members.updateRule =
        members.createRule +
        " && @request.body.workspaceId:changed = false && @request.body.userId:changed = false";
      members.deleteRule = members.createRule;
      app.save(members);
      const users = app.findCollectionByNameOrId("users");
      users.listRule = auth + " && id = @request.auth.id";
      users.viewRule = users.listRule;
      users.createRule = "";
      users.updateRule = users.listRule;
      users.deleteRule = null;
      app.save(users);
      const files = app.findCollectionByNameOrId("files");
      files.fields.add(
        new RelationField({
          name: "ownerId",
          collectionId: users.id,
          maxSelect: 1,
        }),
      );
      files.fields.add(new TextField({ name: "workspaceId" }));
      files.listRule =
        auth +
        " && (ownerId = @request.auth.id || (" +
        owner +
        ") || (" +
        member +
        "))";
      files.viewRule = files.listRule;
      files.createRule =
        auth + ' && (workspaceId = "" || (' + owner + ") || (" + editor + "))";
      // A rename, the analysis cache and an in-place blob replacement are the
      // updates an owner may make. The file payload (`file`, `size`,
      // `mimeType`) is written by the update hook
      // (`pb_hooks/lib/storage-limits.js`), so the request body may not set
      // `size` or `mimeType`; only the stored blob itself may be replaced, and
      // the hook re-checks the ceiling and the quota and recomputes the
      // metadata. Everything that decides where the bytes land or who owns them
      // stays pinned.
      files.updateRule =
        auth +
        " && ownerId = @request.auth.id" +
        " && @request.body.ownerId:changed = false" +
        " && @request.body.workspaceId:changed = false" +
        " && @request.body.size:changed = false" +
        " && @request.body.mimeType:changed = false" +
        " && @request.body.derivedFrom:changed = false";
      files.deleteRule =
        auth +
        " && (ownerId = @request.auth.id || (" +
        owner +
        ") || (" +
        editor +
        "))";
      app.save(files);
      // Historic anonymous files have no safe owner. Auto-assign only for a one-user DB.
      const existingUsers = app.findRecordsByFilter("users", "", "", 2);
      if (existingUsers.length === 1) {
        const records = app.findAllRecords("files");
        for (const record of records) {
          record.set("ownerId", existingUsers[0].id);
          app.save(record);
        }
      }
    }
    // Current file limit.
    {
      const files = app.findCollectionByNameOrId("files");
      files.fields.getByName("file").maxSize = 2147483648;
      app.save(files);
    }
    // Current edge semantics.
    {
      const collection = app.findCollectionByNameOrId("edge_semantics");
      collection.fields.add(new TextField({ name: "icon" }));
      app.save(collection);
    }
    // 12. 创建 media_site_auths 表
    // Saved logins of the media import (video and audio), one record per owner
    // and site. The cookie is a credential and never reaches the database in
    // plaintext: `cookieCiphertext`, `nonce` and `tag` hold its AES-256-GCM
    // encryption, written by `PocketBaseMediaSiteAuthRepository`. A `browser`
    // login stores only the browser name, because yt-dlp reads that browser's
    // cookie itself; its three cookie columns are empty.
    //
    // Every rule is owner-scoped, like the collections above. The unique index
    // backs the "one login per owner and site" contract at the database level
    // even though the repository already looks the record up before writing.
    {
      const mediaSiteAuthsOwner =
        '@request.auth.id != "" && ownerId = @request.auth.id';
      const mediaSiteAuths = new Collection({
        name: "media_site_auths",
        type: "base",
        listRule: mediaSiteAuthsOwner,
        viewRule: mediaSiteAuthsOwner,
        createRule: mediaSiteAuthsOwner,
        updateRule: mediaSiteAuthsOwner,
        deleteRule: mediaSiteAuthsOwner,
        fields: [
          { name: "ownerId", type: "text", required: true, max: 100 },
          { name: "siteKey", type: "text", required: true, max: 100 },
          // Reserved for the domains a login was stored for. The domain model
          // derives them from the site catalog, so this column is written empty
          // today; it stays in the schema so an implementation may cache them
          // without a migration.
          { name: "hosts", type: "text", max: 2000 },
          // A Netscape `cookies.txt` is capped at 1 MiB by the import endpoint;
          // hex encoding doubles it, so 4 MiB leaves room for a full export.
          { name: "cookieCiphertext", type: "text", max: 4194304 },
          { name: "nonce", type: "text", max: 64 },
          { name: "tag", type: "text", max: 64 },
          { name: "accountLabel", type: "text", max: 300 },
          { name: "authMethod", type: "text", max: 32 },
          { name: "browserName", type: "text", max: 64 },
          { name: "status", type: "text", max: 32 },
          { name: "lastCheckedAt", type: "text", max: 64 },
          { name: "lastUsedAt", type: "text", max: 64 },
        ],
        indexes: [
          "CREATE UNIQUE INDEX idx_media_site_auths_owner_site ON media_site_auths (ownerId, siteKey)",
        ],
      });
      app.save(mediaSiteAuths);
    }

    // 13. 执行引擎：事件流、投递、运行记录、插件安装事实与调度
    //
    // 这几张表与 `0000000011_dynamic_engine.js` 创建的完全同形：新库只跑基线，
    // 已有的库只跑变更迁移，两边必须逐字段一致（`scripts/lib/pocketbase-migrations.test.mjs`
    // 建两种库并逐字段比对）。除了 `automations`，其余表都不开放 API 规则，
    // 由服务端写入。
    //
    // `event_log` 只追加：`sequence` 是聚合内的序号，`workspaceSequence` 是
    // 工作区内的全局序号，唯一的 `(workspaceId, workspaceSequence)` 让读取
    // 一次事件的键集游标只走一条索引。
    const engineRules = {
      listRule: null,
      viewRule: null,
      createRule: null,
      updateRule: null,
      deleteRule: null,
    };
    const engineTables = [
      {
        name: "event_log",
        fields: [
          { name: "eventId", type: "text", required: true, max: 100 },
          { name: "eventType", type: "text", required: true, max: 200 },
          { name: "aggregateType", type: "text", required: true, max: 32 },
          { name: "aggregateId", type: "text", max: 100 },
          { name: "workspaceId", type: "text", required: true, max: 100 },
          { name: "sequence", type: "number", required: true, min: 0 },
          { name: "workspaceSequence", type: "number", required: true, min: 0 },
          { name: "payload", type: "json" },
          { name: "metadata", type: "json" },
          { name: "created", type: "autodate", onCreate: true },
        ],
        indexes: [
          "CREATE UNIQUE INDEX idx_event_log_event_id ON event_log (eventId)",
          "CREATE UNIQUE INDEX idx_event_log_aggregate ON event_log (aggregateType, aggregateId, sequence)",
          "CREATE UNIQUE INDEX idx_event_log_workspace_sequence ON event_log (workspaceId, workspaceSequence)",
          "CREATE INDEX idx_event_log_workspace ON event_log (workspaceId, created)",
        ],
      },
      {
        name: "event_deliveries",
        fields: [
          { name: "eventId", type: "text", required: true, max: 100 },
          { name: "triggerId", type: "text", required: true, max: 200 },
          { name: "targetKey", type: "text", required: true, max: 200 },
          { name: "pluginId", type: "text", required: true, max: 100 },
          { name: "workspaceId", type: "text", required: true, max: 100 },
          {
            name: "status",
            type: "select",
            required: true,
            values: ["pending", "processing", "done", "failed", "dead"],
          },
          { name: "attempts", type: "number", min: 0 },
          { name: "availableAt", type: "date" },
          { name: "leaseOwner", type: "text", max: 100 },
          { name: "leaseUntil", type: "date" },
          { name: "lastError", type: "text", max: 4000 },
        ],
        indexes: [
          "CREATE UNIQUE INDEX idx_delivery_event_trigger ON event_deliveries (eventId, triggerId, targetKey)",
          "CREATE INDEX idx_delivery_pending ON event_deliveries (status, availableAt)",
        ],
      },
      {
        name: "operation_runs",
        fields: [
          { name: "deliveryId", type: "text", max: 100 },
          { name: "eventId", type: "text", max: 100 },
          { name: "triggerId", type: "text", max: 200 },
          { name: "pluginId", type: "text", required: true, max: 100 },
          { name: "pluginVersion", type: "text", max: 40 },
          { name: "correlationId", type: "text", max: 100 },
          {
            name: "actorKind",
            type: "select",
            required: true,
            values: ["user", "plugin", "scheduler", "system"],
          },
          { name: "actorId", type: "text", max: 200 },
          { name: "operationId", type: "text", required: true, max: 200 },
          {
            name: "targetType",
            type: "select",
            required: true,
            values: ["workspace", "node", "edge", "view"],
          },
          { name: "targetId", type: "text", required: true, max: 200 },
          { name: "nodeId", type: "text", max: 100 },
          { name: "workspaceId", type: "text", required: true, max: 100 },
          { name: "idempotencyKey", type: "text", required: true, max: 300 },
          {
            name: "status",
            type: "select",
            required: true,
            values: ["running", "succeeded", "failed", "dead"],
          },
          { name: "decision", type: "select", values: ["allowed", "denied"] },
          { name: "capability", type: "text", max: 60 },
          { name: "attempt", type: "number", min: 1 },
          { name: "input", type: "json" },
          { name: "output", type: "json" },
          { name: "error", type: "text", max: 4000 },
          { name: "startedAt", type: "date" },
          { name: "finishedAt", type: "date" },
          { name: "durationMs", type: "number", min: 0 },
        ],
        indexes: [
          "CREATE UNIQUE INDEX idx_runs_idempotency ON operation_runs (idempotencyKey)",
          "CREATE INDEX idx_runs_delivery ON operation_runs (deliveryId)",
          "CREATE INDEX idx_runs_workspace ON operation_runs (workspaceId, startedAt)",
          "CREATE INDEX idx_runs_node ON operation_runs (nodeId, startedAt)",
          "CREATE INDEX idx_runs_target ON operation_runs (targetType, targetId, startedAt)",
          "CREATE INDEX idx_runs_actor ON operation_runs (actorKind, actorId, startedAt)",
        ],
      },
      {
        name: "plugins",
        fields: [
          { name: "pluginId", type: "text", required: true, max: 100 },
          { name: "version", type: "text", required: true, max: 40 },
          { name: "manifest", type: "json", required: true },
          { name: "checksum", type: "text", max: 200 },
          { name: "publisher", type: "text", max: 100 },
          { name: "signature", type: "text", max: 4000 },
          { name: "publicKeyId", type: "text", max: 100 },
          {
            name: "status",
            type: "select",
            required: true,
            values: ["installed", "enabled", "disabled", "upgrading", "failed"],
          },
          { name: "installedBy", type: "text", max: 100 },
          { name: "installedAt", type: "date" },
          { name: "enabledAt", type: "date" },
        ],
        indexes: ["CREATE UNIQUE INDEX idx_plugins_id ON plugins (pluginId)"],
      },
      {
        name: "plugin_grants",
        fields: [
          { name: "pluginId", type: "text", required: true, max: 100 },
          { name: "workspaceId", type: "text", required: true, max: 100 },
          { name: "capability", type: "text", required: true, max: 60 },
          { name: "scope", type: "json" },
          { name: "scopeKey", type: "text", required: true, max: 300 },
          { name: "grantedBy", type: "text", required: true, max: 100 },
          { name: "grantedAt", type: "date" },
        ],
        indexes: [
          "CREATE UNIQUE INDEX idx_grant_unique ON plugin_grants (pluginId, workspaceId, capability, scopeKey)",
        ],
      },
      {
        name: "plugin_secrets",
        fields: [
          { name: "pluginId", type: "text", required: true, max: 100 },
          { name: "workspaceId", type: "text", required: true, max: 100 },
          { name: "name", type: "text", required: true, max: 100 },
          { name: "ciphertext", type: "text", required: true, max: 20000 },
          { name: "iv", type: "text", required: true, max: 64 },
          { name: "tag", type: "text", required: true, max: 64 },
          { name: "keyVersion", type: "number", min: 1 },
          { name: "createdBy", type: "text", max: 100 },
        ],
        indexes: [
          "CREATE UNIQUE INDEX idx_secret_unique ON plugin_secrets (pluginId, workspaceId, name)",
        ],
      },
      {
        name: "automations",
        fields: [
          { name: "name", type: "text", required: true, max: 200 },
          { name: "workspaceId", type: "text", required: true, max: 100 },
          { name: "entryNodeIds", type: "json" },
          { name: "triggerIds", type: "json" },
          { name: "maxDepth", type: "number", min: 1 },
          { name: "enabled", type: "bool" },
        ],
        indexes: [
          "CREATE INDEX idx_automations_workspace ON automations (workspaceId)",
        ],
        rules: { listRule: "", viewRule: "", createRule: "", updateRule: "", deleteRule: "" },
      },
      {
        name: "automation_scope",
        fields: [
          { name: "automationId", type: "text", required: true, max: 100 },
          { name: "nodeId", type: "text", required: true, max: 100 },
          { name: "workspaceId", type: "text", required: true, max: 100 },
          { name: "recomputedAt", type: "autodate", onCreate: true, onUpdate: true },
        ],
        indexes: [
          "CREATE UNIQUE INDEX idx_scope_unique ON automation_scope (automationId, nodeId)",
          "CREATE INDEX idx_scope_lookup ON automation_scope (workspaceId, nodeId)",
        ],
      },
      {
        name: "scheduled_jobs",
        fields: [
          { name: "pluginId", type: "text", required: true, max: 100 },
          { name: "workspaceId", type: "text", required: true, max: 100 },
          { name: "automationId", type: "text", max: 100 },
          { name: "nodeId", type: "text", max: 100 },
          { name: "operationId", type: "text", required: true, max: 200 },
          { name: "intervalMs", type: "number", min: 1000 },
          { name: "nextRunAt", type: "date" },
          { name: "scheduledFor", type: "date" },
          { name: "enabled", type: "bool" },
          { name: "leaseOwner", type: "text", max: 100 },
          { name: "leaseUntil", type: "date" },
        ],
        indexes: [
          "CREATE UNIQUE INDEX idx_jobs_unique ON scheduled_jobs (pluginId, operationId, nodeId, workspaceId)",
          "CREATE INDEX idx_jobs_next ON scheduled_jobs (enabled, nextRunAt)",
          "CREATE INDEX idx_jobs_lease ON scheduled_jobs (enabled, leaseUntil)",
        ],
      },
    ];
    for (const table of engineTables) {
      app.save(
        new Collection(
          Object.assign({ type: "base" }, engineRules, table.rules || {}, {
            name: table.name,
            fields: table.fields,
            indexes: table.indexes,
          }),
        ),
      );
    }
  },
  (app) => {
    for (const name of [
      "scheduled_jobs",
      "automation_scope",
      "automations",
      "plugin_secrets",
      "plugin_grants",
      "plugins",
      "operation_runs",
      "event_deliveries",
      "event_log",
    ]) {
      app.delete(app.findCollectionByNameOrId(name));
    }
    app.delete(app.findCollectionByNameOrId("media_site_auths"));
    app.delete(app.findCollectionByNameOrId("dashboard_configs"));
    app.delete(app.findCollectionByNameOrId("files"));
    app.delete(app.findCollectionByNameOrId("edges"));
    app.delete(app.findCollectionByNameOrId("nodes"));
    app.delete(app.findCollectionByNameOrId("views"));
    app.delete(app.findCollectionByNameOrId("workspace_members"));
    app.delete(app.findCollectionByNameOrId("workspaces"));
    app.delete(app.findCollectionByNameOrId("node_tags"));
    app.delete(app.findCollectionByNameOrId("edge_semantics"));
    app.delete(app.findCollectionByNameOrId("node_semantics"));

    // 移除 users 表的 nickname 字段
    const usersCollection = app.findCollectionByNameOrId("users");
    usersCollection.fields.removeByName("nickname");
    app.save(usersCollection);
  },
);
