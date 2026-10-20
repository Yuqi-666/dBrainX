// SPDX-License-Identifier: AGPL-3.0-only

import {
  buildNodeFilterFields as buildFields,
  type NodeSemantic,
  type NodeSemanticId,
} from "@workspace/interfaces";
import { NODE_TYPE_LABELS } from "@workspace/ui/lib/node-type-labels";
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
          ? Object.keys(NODE_TYPE_LABELS).map((type) => ({
              name: type,
              label: NODE_TYPE_LABELS[type] ?? type,
            }))
          : field.values,
  }));
}
