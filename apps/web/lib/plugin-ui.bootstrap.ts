// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The node-content bootstrap (§5.4.9).
 *
 * Registration has to be **complete before the first render**. A descriptor that
 * arrives after paint makes every page flash `UnknownNodeContent` first, and an
 * `await import(...)` cannot fix that: the server render cannot await, so the
 * first HTML would still be the fallback. The generated map therefore imports
 * each plugin entry with a literal specifier, and this module registers those
 * descriptors while it is evaluated — before React renders the tree that
 * imports it.
 *
 * Both apps share this exact file: `apps/web/app/providers.tsx` imports
 * `@/lib/plugin-ui.bootstrap`, and `apps/desktop/app/providers.tsx` imports the
 * same specifier. The desktop tsconfig maps `@/*` to `apps/web/*` (it already
 * serves `@/components/*` from the web app), so the desktop static export
 * registers exactly what the web app registers instead of a hand-kept copy.
 *
 * `packages/ui` stays on the other side of the boundary: it owns the registry
 * and never imports a plugin package. This file is the only place that knows
 * both.
 */
import { registerNodeContent } from "@workspace/ui/components/node-content/registry";

import { pluginUiDescriptors } from "./plugin-ui.generated";

let registered: readonly string[] | undefined;

/**
 * Registers every descriptor the generated map lists and returns the
 * `pluginId:type` keys it registered.
 *
 * Idempotent: a second call returns the first call's list without touching the
 * registry, so a hot reload or a second importer cannot duplicate the work. A
 * descriptor whose `pluginId` disagrees with its manifest fails here rather than
 * silently registering under the wrong owner: the registry's collision rule
 * would then blame the wrong package.
 */
export function registerPluginNodeContent(): readonly string[] {
  if (registered) return registered;
  const keys: string[] = [];
  for (const plugin of pluginUiDescriptors) {
    for (const descriptor of plugin.module.nodeContentDescriptors) {
      if (descriptor.pluginId !== plugin.pluginId) {
        throw new Error(
          `Plugin UI entry ${plugin.entry} registers node type "${descriptor.type}" ` +
            `for plugin "${descriptor.pluginId}" but its manifest id is "${plugin.pluginId}".`,
        );
      }
      registerNodeContent(descriptor);
      keys.push(`${descriptor.pluginId}:${descriptor.type}`);
    }
  }
  registered = keys;
  return registered;
}

// Registers while this module is evaluated, so an importer cannot forget the
// call and the registry cannot be empty when the first node renders.
registerPluginNodeContent();
