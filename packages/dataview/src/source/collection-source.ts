// SPDX-License-Identifier: AGPL-3.0-only

import { NODE_TYPE_LABELS } from "@workspace/ui/lib/node-type-labels";
import { translate } from "@workspace/ui/lib/i18n/runtime";
/**
 * `collection` host adapter: projects the graph nodes a collection selects
 * into a fixed "node attribute table" with the same shape a database produces,
 * so view renderers never need a second data path.
 *
 * Field ids are `__`-prefixed to guarantee they cannot collide with a user
 * database field id.
 *
 * See `docs/dataview/README.md` §4.2.
 */
import type {
  CollectionNodeData,
  DatabaseCell,
  DatabaseField,
  DatabaseRow,
  DataViewSource,
  FilterConfig,
  NodeData,
  NodeId,
  NodeSemantic,
  NodeSemanticId,
  NodeTag,
  NodeTagId,
  Permission,
  View,
} from "@workspace/interfaces";
import { NODE_DATA_TYPES } from "@workspace/interfaces";
import { filterByViewFilterConfig } from "@workspace/utils";

/** Field ids of the fixed collection projection schema. */
export const COLLECTION_FIELD_IDS = {
  title: "__title",
  abstract: "__abstract",
  nodeType: "__nodeType",
  semantic: "__semantic",
  tags: "__tags",
  permission: "__permission",
  weight: "__weight",
  createdAt: "__createdAt",
  updatedAt: "__updatedAt",
} as const;

/** The projection's primary column — its main title field. */
export const COLLECTION_PRIMARY_FIELD_ID = COLLECTION_FIELD_IDS.title;

const PERMISSION_OPTIONS: { id: Permission; name: string }[] = [
  {
    id: "private",
    get name() {
      return translate("私有");
    },
  },
  {
    id: "public",
    get name() {
      return translate("公开");
    },
  },
  {
    id: "restricted",
    get name() {
      return translate("受限");
    },
  },
];

/** Lookup maps the projection needs to name semantics / tags. */
export interface CollectionSourceOptions {
  semantics?: ReadonlyMap<NodeSemanticId, NodeSemantic>;
  tags?: ReadonlyMap<NodeTagId, NodeTag>;
}

/** Stable id for the throwaway view the rule evaluator needs. */
const RULE_EVAL_VIEW_ID = "dataview:collection-projection";

/**
 * The projected schema.
 *
 * `options` are only attached where the values are enumerable; `weight` is a
 * plain number and the two timestamps are dates, so they carry none.
 */
export function buildCollectionFields(
  options: CollectionSourceOptions = {},
): DatabaseField[] {
  const semantics = Array.from(options.semantics?.values() ?? []);
  const tags = Array.from(options.tags?.values() ?? []);

  return [
    { id: COLLECTION_FIELD_IDS.title, name: translate("标题"), type: "text" },
    {
      id: COLLECTION_FIELD_IDS.abstract,
      name: translate("摘要"),
      type: "text",
    },
    {
      id: COLLECTION_FIELD_IDS.nodeType,
      name: translate("节点类型"),
      type: "select",
      options: NODE_DATA_TYPES.map((type) => ({
        id: type,
        name: NODE_TYPE_LABELS[type] ?? type,
      })),
    },
    {
      id: COLLECTION_FIELD_IDS.semantic,
      name: translate("语义类型"),
      type: "select",
      options: semantics.map((semantic) => ({
        id: semantic.id,
        name: semantic.name,
        color: semantic.color,
      })),
    },
    {
      id: COLLECTION_FIELD_IDS.tags,
      name: translate("标签"),
      type: "multiSelect",
      options: tags.map((tag) => ({
        id: tag.id,
        name: tag.name,
        color: tag.color,
      })),
    },
    {
      id: COLLECTION_FIELD_IDS.permission,
      name: translate("权限"),
      type: "select",
      options: PERMISSION_OPTIONS.map((option) => ({ ...option })),
    },
    {
      id: COLLECTION_FIELD_IDS.weight,
      name: translate("权重"),
      type: "number",
    },
    {
      id: COLLECTION_FIELD_IDS.createdAt,
      name: translate("创建时间"),
      type: "date",
    },
    {
      id: COLLECTION_FIELD_IDS.updatedAt,
      name: translate("更新时间"),
      type: "date",
    },
  ];
}

/**
 * Resolves the row set implied by a collection's filter config.
 *
 * A missing/empty selection plus no rule means "everything". Otherwise
 * `selectedNodes` and `ruleGroup` are two halves of one predicate and combine
 * as a UNION (`inEnumeration || matchesRule`), which is exactly what the graph
 * does — the whole thing is delegated to the canonical
 * `filterByViewFilterConfig` rather than re-implemented, so a collection and a
 * graph view configured the same way select the same nodes.
 *
 * Rows therefore come back in store iteration order, not in the order the ids
 * happen to sit in `selectedNodes`, and an id naming a deleted node simply
 * drops out. Note also that the canonical evaluator treats a rule on a field it
 * does not know as "matches everything" — a collection inherits that too, which
 * is the point of delegating rather than re-implementing.
 */
export function resolveCollectionNodeIds(
  filterConfig: FilterConfig | undefined,
  nodes: ReadonlyMap<NodeId, NodeData>,
): NodeId[] {
  const hasSelection = (filterConfig?.selectedNodes?.length ?? 0) > 0;
  const hasRule = filterConfig?.ruleGroup !== undefined;
  if (!filterConfig || (!hasSelection && !hasRule)) {
    return Array.from(nodes.keys());
  }

  const projectionView: View = {
    id: RULE_EVAL_VIEW_ID,
    name: "collection-projection",
    viewType: "Force",
    visualConfig: {},
    filterConfig,
  };
  const { filteredNodes } = filterByViewFilterConfig(
    new Map(nodes),
    new Map(),
    projectionView,
  );
  return Array.from(filteredNodes.keys());
}

function toCell(value: DatabaseCell): DatabaseCell {
  return value;
}

function projectRow(node: NodeData): DatabaseRow {
  return {
    id: node.id,
    cells: {
      [COLLECTION_FIELD_IDS.title]: toCell({ type: "text", text: node.title }),
      [COLLECTION_FIELD_IDS.abstract]: toCell({
        type: "text",
        text: node.abstract ?? "",
      }),
      [COLLECTION_FIELD_IDS.nodeType]: toCell({
        type: "select",
        optionId: node.nodeType,
      }),
      [COLLECTION_FIELD_IDS.semantic]: toCell({
        type: "select",
        optionId: node.semanticId || null,
      }),
      [COLLECTION_FIELD_IDS.tags]: toCell({
        type: "multiSelect",
        optionIds: node.tags ?? [],
      }),
      [COLLECTION_FIELD_IDS.permission]: toCell({
        type: "select",
        optionId: node.permission,
      }),
      [COLLECTION_FIELD_IDS.weight]: toCell({
        type: "number",
        number: node.stateData?.server?.weight ?? null,
      }),
      [COLLECTION_FIELD_IDS.createdAt]: toCell({
        type: "date",
        date: node.createdAt ?? null,
      }),
      [COLLECTION_FIELD_IDS.updatedAt]: toCell({
        type: "date",
        date: node.updatedAt ?? null,
      }),
    },
  };
}

/**
 * Builds the read-only node-attribute table for a collection node.
 *
 * `rows` and `nodeIds` stay index-aligned: `rows[i]` is the projection of
 * `nodes.get(nodeIds[i])`, which is how views map a row back to a graph node.
 *
 * The collection's own name travels as `nodeTitle` — provenance, like `nodeId`,
 * not a column of the projection (a view that labels the whole set defaults to
 * it; the gantt's 表头).
 */
export function collectionToDataViewSource(
  node: CollectionNodeData,
  nodes: ReadonlyMap<NodeId, NodeData>,
  options: CollectionSourceOptions = {},
): DataViewSource {
  const filterConfig = node.content?.filterConfig;
  const nodeIds = resolveCollectionNodeIds(filterConfig, nodes);

  const rows = nodeIds
    .map((nodeId) => nodes.get(nodeId))
    .filter((candidate): candidate is NodeData => candidate !== undefined)
    .map(projectRow);

  return {
    kind: "collection",
    nodeId: node.id,
    nodeTitle: node.title,
    fields: buildCollectionFields(options),
    rows,
    filterConfig,
    nodeIds: rows.map((row) => row.id),
  };
}
