// SPDX-License-Identifier: AGPL-3.0-only

import { FilterConfig } from "@workspace/domain/models/filter/value-objects";
import { NodeId } from "@workspace/domain/models/node/value-objects";

/**
 * `FilterConfig` 的持久化形态：`selectedNodes` 是纯字符串 id。
 *
 * PocketBase 的 `filterConfig` 是 JSON 字段，直接写入 `NodeId` 值对象会被
 * `JSON.stringify` 成 `[{ "_value": "..." }]`，前端按字符串 id 比对时全部失配
 * （表现：视图勾选的节点在节点图中不显示）。所有写库路径都必须经过
 * `filterConfigToRecord` 显式拆包。
 */
export interface FilterConfigRecord {
  selectedNodes?: string[];
  ruleGroup?: FilterConfig["ruleGroup"];
  collectionType?: string;
}

/**
 * 读取 `selectedNodes` 的单个条目。
 *
 * 兼容两种历史形态，读取时无需数据迁移：
 * - `"node_id"` —— 期望形态
 * - `{ _value: "node_id" }` / `{ value: "node_id" }` —— 旧 mapper 漏拆包写下的 VO
 */
function readNodeId(entry: unknown): string | undefined {
  if (typeof entry === "string") {
    return entry.length > 0 ? entry : undefined;
  }
  if (entry !== null && typeof entry === "object") {
    const raw = entry as { value?: unknown; _value?: unknown };
    const value = typeof raw.value === "string" ? raw.value : raw._value;
    return typeof value === "string" && value.length > 0 ? value : undefined;
  }
  return undefined;
}

/** 持久化记录（或前端入参）→ 领域值对象。 */
export function filterConfigFromRecord(raw: unknown): FilterConfig {
  const record = (raw ?? {}) as Omit<FilterConfigRecord, "selectedNodes"> & {
    selectedNodes?: unknown;
  };

  const selectedNodes = Array.isArray(record.selectedNodes)
    ? record.selectedNodes
        .map(readNodeId)
        .filter((id): id is string => id !== undefined)
        .map((id) => new NodeId(id))
    : [];

  return FilterConfig.create({
    selectedNodes,
    ruleGroup: record.ruleGroup,
    collectionType: record.collectionType,
  });
}

/** 领域值对象 → 持久化记录（`selectedNodes` 拆成纯字符串 id）。 */
export function filterConfigToRecord(config: FilterConfig): FilterConfigRecord {
  return {
    selectedNodes: config.selectedNodes.map((nodeId) => nodeId.value),
    ruleGroup: config.ruleGroup,
    collectionType: config.collectionType,
  };
}
