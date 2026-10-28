// SPDX-License-Identifier: AGPL-3.0-only

import type { NodeBase } from "../../base";
import type { NodeType } from "../../types";
import type { AnnotationLayerData } from "../annotation";

export interface PdfNodeData extends NodeBase, NodeType<"pdf"> {
  pageCount: number;
  fileSize: number;

  content: PdfContent;
}

export interface PdfContent {
  url: string;
  coverUrl: string;
  /** Absent means "no annotations" — old records stay readable (annotation.md §0.2-①). */
  annotations?: AnnotationLayerData;
}
