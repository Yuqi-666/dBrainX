// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The node type registry this host process runs.
 *
 * TODO(engine: replaced by the plugin host in W6) — W6 reads the enabled
 * plugins from the plugin store and builds this registry from their manifests
 * and server entries. Until then the host process seeds it from the plugin
 * packages that ship with the app, which is why this module lives in
 * `apps/server` and not in `backend/`: the backend never imports `plugins/**`.
 */
import { nodeTypes as builtinNodeTypes } from "@plugin/builtin/server";
import { nodeTypes as counterNodeTypes } from "@plugin/counter/server";
import type { INodeTypeRegistry } from "@workspace/domain";
import { createInMemoryNodeTypeRegistry } from "@workspace/plugin-host";

export function createServerNodeTypeRegistry(): INodeTypeRegistry {
  // Every plugin package that ships in the server bundle contributes its types:
  // the counter fixture is packaged beside the builtin plugin and its UI is in
  // the web bundle map, so the host seeds it from the same list. W6's plugin
  // store replaces this constant with the enabled-plugin set.
  return createInMemoryNodeTypeRegistry([
    ...builtinNodeTypes,
    ...counterNodeTypes,
  ]);
}
