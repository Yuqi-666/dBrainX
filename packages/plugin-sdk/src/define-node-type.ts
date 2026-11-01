// SPDX-License-Identifier: AGPL-3.0-only

import type { NodeTypeDefinition } from "@workspace/domain"

/**
 * Declares a node type (§4.2.5).
 *
 * Identity plus a cheap structural check: the authoritative validation
 * (`assertNodeTypeDefinition`, including the `defaultContent()` schema walk)
 * runs in the domain registry when the plugin host registers the type, so it
 * must not be duplicated here. The check below only catches a definition that
 * is obviously broken at import time.
 */
export function defineNodeType<TContent = unknown>(
  definition: NodeTypeDefinition<TContent>,
): NodeTypeDefinition<TContent> {
  if (typeof definition.type !== "string" || definition.type.trim() === "") {
    throw new TypeError("defineNodeType: `type` must be a non-empty string")
  }
  if (!Number.isInteger(definition.version) || definition.version < 1) {
    throw new TypeError(
      `defineNodeType("${definition.type}"): \`version\` must be an integer >= 1`,
    )
  }
  if (
    typeof definition.pluginId !== "string" ||
    definition.pluginId.trim() === ""
  ) {
    throw new TypeError(
      `defineNodeType("${definition.type}"): \`pluginId\` must be a non-empty string`,
    )
  }
  if (typeof definition.schema !== "object" || definition.schema === null) {
    throw new TypeError(
      `defineNodeType("${definition.type}"): \`schema\` must be a JSON Schema object`,
    )
  }
  if (
    typeof definition.defaultContent !== "function" ||
    typeof definition.display?.label !== "string" ||
    typeof definition.display?.icon !== "string" ||
    !Array.isArray(definition.operations)
  ) {
    throw new TypeError(
      `defineNodeType("${definition.type}"): \`defaultContent\`, \`display.label\`, \`display.icon\` and \`operations\` are required`,
    )
  }
  return definition
}
