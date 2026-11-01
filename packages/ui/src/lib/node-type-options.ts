// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The type-id source every picker reads (§4.9.2).
 *
 * A picker asks the registry, never a literal list: the builtin ten are just the
 * descriptors the builtin plugin registered at bootstrap, so an extra plugin
 * type shows up in the add-node dialog, the context-menu type selector, the
 * search tabs and the filter builder without any host change.
 */
import type { NodeTypeId } from "@workspace/interfaces";

import { listNodeContentDescriptors } from "../components/node-content/registry.ts";

/** Maps registered descriptors to the ids a picker offers. */
export function nodeTypeIds(
  descriptors: readonly { type: NodeTypeId }[],
): NodeTypeId[] {
  return descriptors.map((descriptor) => descriptor.type);
}

/** The ids every picker offers, in registration order. */
export function listNodeTypeIds(): NodeTypeId[] {
  return nodeTypeIds(listNodeContentDescriptors());
}
