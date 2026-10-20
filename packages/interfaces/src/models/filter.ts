// SPDX-License-Identifier: AGPL-3.0-only

import type { RuleGroupType, Field } from "@workspace/utils";
import type { NodeId, NodeSemantic, NodeSemanticId } from "./node";
import { NODE_DATA_TYPES } from "./node/types";

export interface FilterConfig {
  //Filter->selectedNodes AND ruleGroup
  //example
  //[1,2,3,4,5,6]
  //selectedNodes:[1,6] ruleGroup:even
  //filter->[1,2,4,6]
  selectedNodes?: NodeId[];
  ruleGroup?: RuleGroupType;
  collectionType?: string;
}

/**
 * Build the node filter fields for react-querybuilder.
 *
 * The `semanticId` field is rendered as a select whose options are the current
 * node-semantic set (subscribed by the caller), so users pick a semantic type
 * by its display name rather than typing a raw id.
 */
export function buildNodeFilterFields(
  nodeSemantics: ReadonlyMap<NodeSemanticId, NodeSemantic>,
): Field[] {
  return [
    {
      name: "title",
      label: "标题",
      inputType: "text",
    },
    {
      name: "abstract",
      label: "摘要",
      inputType: "text",
    },
    {
      name: "permission",
      label: "权限",
      inputType: "select",
      values: [
        { name: "private", label: "私有" },
        { name: "public", label: "公开" },
        { name: "restricted", label: "受限" },
      ],
    },
    {
      name: "semanticId",
      label: "语义类型",
      inputType: "select",
      values: Array.from(nodeSemantics.values(), (semantic) => ({
        name: semantic.id,
        label: semantic.name,
      })),
    },
    {
      name: "tags",
      label: "标签",
      inputType: "text",
    },
    {
      name: "nodeType",
      label: "节点类型",
      inputType: "select",
      values: NODE_DATA_TYPES.map((type) => ({ name: type, label: type })),
    },
    {
      name: "createdAt",
      label: "创建时间",
      inputType: "date",
    },
    {
      name: "updatedAt",
      label: "更新时间",
      inputType: "date",
    },
  ];
}
