// SPDX-License-Identifier: AGPL-3.0-only

"use client";

import type { LucideIcon } from "lucide-react";
import {
  FileEdit,
  FileText,
  FileType,
  Folder,
  Globe,
  Image as ImageIcon,
  Table,
  Video,
  Volume,
} from "lucide-react";
import type { NodeDataType } from "@workspace/interfaces";

export const NODE_TYPE_ICONS: Record<NodeDataType, LucideIcon> = {
  text: FileText,
  image: ImageIcon,
  video: Video,
  pdf: FileType,
  audio: Volume,
  webpage: Globe,
  website: Globe,
  collection: Folder,
  "rich-text": FileEdit,
  database: Table,
};
