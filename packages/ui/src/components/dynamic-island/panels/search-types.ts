// SPDX-License-Identifier: AGPL-3.0-only

import { translate } from "@workspace/ui/lib/i18n/runtime";
import type { NodeDataType } from "@workspace/interfaces";
import { NODE_DATA_TYPES } from "@workspace/interfaces";
export const SEARCH_TAB_KEYS = [
  "all",
  "text",
  "media",
  "website",
  "collection",
  "database",
  "node-types",
  "edge-types",
] as const;

export type SearchTabKey = (typeof SEARCH_TAB_KEYS)[number];

export interface SearchTabConfig {
  key: SearchTabKey;
  label: string;
  nodeTypes?: NodeDataType[];
  kind: "nodes" | "node-types" | "edge-types";
}

export const SEARCH_TABS: SearchTabConfig[] = [
  {
    key: "all",
    get label() {
      return translate("全部");
    },
    nodeTypes: [...NODE_DATA_TYPES],
    kind: "nodes",
  },
  {
    key: "text",
    get label() {
      return translate("文本");
    },
    nodeTypes: ["text", "rich-text"],
    kind: "nodes",
  },
  {
    key: "media",
    get label() {
      return translate("媒体");
    },
    nodeTypes: ["image", "audio", "video", "pdf"],
    kind: "nodes",
  },
  {
    key: "website",
    get label() {
      return translate("网站");
    },
    nodeTypes: ["webpage", "website"],
    kind: "nodes",
  },
  {
    key: "collection",
    get label() {
      return translate("集合");
    },
    nodeTypes: ["collection"],
    kind: "nodes",
  },
  {
    key: "database",
    get label() {
      return translate("数据");
    },
    nodeTypes: ["database"],
    kind: "nodes",
  },
  {
    key: "node-types",
    get label() {
      return translate("节点类型");
    },
    kind: "node-types",
  },
  {
    key: "edge-types",
    get label() {
      return translate("边类型");
    },
    kind: "edge-types",
  },
];

export type SearchGroupKey = "nodes" | "types";

export type SemanticKind = "node" | "edge";

export interface SearchMatch {
  id: string;
  title: string;
  subtitle?: string;
  group: SearchGroupKey;
  icon?: "node" | "type";
  nodeType?: NodeDataType;
  edgeType?: string;
  semanticId?: string;
  semanticKind?: SemanticKind;
  semanticName?: string;
  color?: string;
  onSelect?: () => void;
}

export function normalizeKeyword(text: string): string {
  return text.toLowerCase().trim();
}
