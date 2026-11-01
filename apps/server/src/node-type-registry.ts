// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The node type registry this host process runs.
 *
 * TODO(engine: replaced by the plugin host in W6) — W6 reads the enabled
 * plugins from the plugin store and builds this registry from their manifests
 * and server entries. Until then the host process seeds it from the one plugin
 * package that ships with the app, which is why this module lives in
 * `apps/server` and not in `backend/`: the backend never imports `plugins/**`.
 */
import { nodeTypes } from "@plugin/builtin/server";
import type { INodeTypeRegistry } from "@workspace/domain";
import { createInMemoryNodeTypeRegistry } from "@workspace/plugin-host";

export function createServerNodeTypeRegistry(): INodeTypeRegistry {
  return createInMemoryNodeTypeRegistry(nodeTypes);
}
