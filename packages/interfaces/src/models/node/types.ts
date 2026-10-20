// SPDX-License-Identifier: AGPL-3.0-only

export type NodeDataType = SingleNodeDataType | ComplexNodeDataType;
export type SingleNodeDataType =
  | "text"
  | "image"
  | "pdf"
  | "video"
  | "audio"
  | "webpage"
  | "website";

export type ComplexNodeDataType = "collection" | "rich-text" | "database";

export interface NodeType<T extends NodeDataType> {
  nodeType: T;
}

export const NODE_DATA_TYPES: NodeDataType[] = [
  "text",
  "image",
  "pdf",
  "video",
  "audio",
  "webpage",
  "website",
  "collection",
  "rich-text",
  "database",
];

export const SINGLE_NODE_DATA_TYPES: SingleNodeDataType[] = [
  "text",
  "image",
  "pdf",
  "video",
  "audio",
  "webpage",
  "website",
];

export const COMPLEX_NODE_DATA_TYPES: ComplexNodeDataType[] = [
  "collection",
  "rich-text",
  "database",
];
