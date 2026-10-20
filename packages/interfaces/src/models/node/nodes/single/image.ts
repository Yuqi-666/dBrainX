// SPDX-License-Identifier: AGPL-3.0-only

import type { NodeBase } from "../../base";
import type { NodeType } from "../../types";
import type { AnnotationLayerData } from "../annotation";

export interface ImageNodeData extends NodeBase, NodeType<"image"> {
  width: number;
  height: number;
  fileSize: number;
  location?: string;
  shootingTime?: string;

  content: ImageContent;
}

export interface ImageContent {
  url: string;
  /** Absent means "no annotations" — old records stay readable (annotation.md §0.2-①). */
  annotations?: AnnotationLayerData;
}
