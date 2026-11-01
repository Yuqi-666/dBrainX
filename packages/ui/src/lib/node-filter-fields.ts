// SPDX-License-Identifier: AGPL-3.0-only

import {
  buildNodeFilterFields as buildFields,
  NODE_DATA_TYPES,
  type NodeSemantic,
  type NodeSemanticId,
} from "@workspace/interfaces";
import { resolveNodeTypeLabel } from "@workspace/ui/lib/node-type-display";
import { translate } from "./i18n/runtime";

/** Localize built-in filter fields while preserving users' semantic names. */
export function buildNodeFilterFields(
  semantics: ReadonlyMap<NodeSemanticId, NodeSemantic>,
) {
  return buildFields(semantics).map((field) => ({
    ...field,
    label: translate(field.label),
    values:
      field.name === "permission"
        ? [
            { name: "private", label: translate("私有") },
            { name: "public", label: translate("公开") },
            { name: "restricted", label: translate("受限") },
          ]
        : field.name === "nodeType"
          ? NODE_DATA_TYPES.map((type) => ({
              name: type,
              label: resolveNodeTypeLabel(type),
            }))
          : field.values,
  }));
}
