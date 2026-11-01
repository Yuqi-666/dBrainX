// SPDX-License-Identifier: AGPL-3.0-only

import {
  buildNodeFilterFields as buildFields,
  type NodeSemantic,
  type NodeSemanticId,
  type NodeTypeId,
} from "@workspace/interfaces";
import { resolveNodeTypeLabel } from "@workspace/ui/lib/node-type-display";
import { listNodeTypeIds } from "@workspace/ui/lib/node-type-options";
import { translate } from "./i18n/runtime";

/** Localize built-in filter fields while preserving users' semantic names. */
export function buildNodeFilterFields(
  semantics: ReadonlyMap<NodeSemanticId, NodeSemantic>,
  nodeTypes: readonly NodeTypeId[] = listNodeTypeIds(),
) {
  return buildFields(semantics, nodeTypes).map((field) => ({
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
          ? nodeTypes.map((type) => ({
              name: type,
              label: resolveNodeTypeLabel(type),
            }))
          : field.values,
  }));
}
