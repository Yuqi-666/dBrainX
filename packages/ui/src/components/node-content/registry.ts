// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The runtime node-content registry (§4.9.2).
 *
 * A plugin package exports `NodeContentDescriptor`s; the client bootstrap
 * registers them before the first paint (`apps/web/lib/plugin-ui.bootstrap.ts`
 * feeds this table from the generated plugin map). The UI shell only reads the
 * table: it never imports a plugin package and never asks the server for a node
 * type definition, so an unknown or uninstalled type degrades to
 * `UnknownNodeContent` instead of failing a build or a render.
 *
 * This file holds a table and no JSX, so it stays `.ts`: the registry then runs
 * under `node --test` without a JSX transform.
 */
import type { NodeContentDescriptor } from "@workspace/plugin-sdk/ui";

const registry = new Map<string, NodeContentDescriptor>();

/**
 * Registers one node type's rendering surface.
 *
 * Registering the same `(pluginId, type)` again is idempotent: the entry is
 * replaced, never duplicated, so a hot reload or a regenerated bootstrap cannot
 * grow the table and cannot throw. A *different* plugin claiming a type that is
 * already registered is a packaging error — two packages would fight over
 * persisted content — so it throws and names both plugin ids instead of
 * silently picking a winner.
 */
export function registerNodeContent(descriptor: NodeContentDescriptor): void {
  const previous = registry.get(descriptor.type);
  if (previous && previous.pluginId !== descriptor.pluginId) {
    throw new Error(
      `Node content type collision: type "${descriptor.type}" is claimed by ` +
        `plugin "${previous.pluginId}" and plugin "${descriptor.pluginId}".`,
    );
  }
  registry.set(descriptor.type, descriptor);
}

/**
 * The descriptor for `type`, or `undefined` when no plugin contributes it.
 *
 * The caller renders `UnknownNodeContent` for the missing case; the registry
 * never invents a placeholder descriptor with no `node` or no component.
 */
export function getNodeContentDescriptor(
  type: string,
): NodeContentDescriptor | undefined {
  return registry.get(type);
}

/** Every registered descriptor in registration order (type pickers, menus). */
export function listNodeContentDescriptors(): NodeContentDescriptor[] {
  return [...registry.values()];
}
