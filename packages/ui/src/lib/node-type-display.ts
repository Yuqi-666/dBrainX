// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The display half of the node-content descriptor: the label and glyph a page
 * header, a library row, a preview header, a filter option or a data-view
 * select shows for a node type.
 *
 * Before the plugin upgrade these were two hand-kept ten-type tables
 * (`lib/node-type-labels.ts` and `components/icon/node-type-icons.ts`). Both are
 * gone: a type is displayed from the descriptor its plugin registered
 * (§4.9.2), so a plugin type shows its own name and glyph without a second
 * table, and a type nobody registered — an uninstalled plugin, an old record,
 * the registry before the client bootstrap runs — degrades to its raw id and
 * {@link DEFAULT_NODE_TYPE_ICON}. Nothing here throws and nothing renders blank.
 */
import type { ComponentType } from "react";
import { FileText } from "lucide-react";

import { getNodeContentDescriptor } from "../components/node-content/registry.ts";

/**
 * The props a caller may hand a resolved type glyph.
 *
 * Wider than the descriptor's `{ className?: string }` on purpose: callers mark
 * a glyph decorative with `aria-hidden`, and widening here keeps that at the
 * call site instead of repeating a wrapper around every icon.
 */
export interface NodeTypeIconProps {
  className?: string;
  "aria-hidden"?: boolean | "true" | "false";
}

/** A glyph drawn for a node type, registered or not. */
export type NodeTypeIcon = ComponentType<NodeTypeIconProps>;

/** The glyph for a type with no registered descriptor. */
export const DEFAULT_NODE_TYPE_ICON: NodeTypeIcon = FileText;

/**
 * The label to display for `type`.
 *
 * A registered descriptor's `label` wins. Everything else reads as the raw type
 * id — including a descriptor whose label is blank, because an empty meta line
 * is what the fallback exists to prevent.
 */
export function resolveNodeTypeLabel(type: string): string {
  const label = getNodeContentDescriptor(type)?.label.trim();
  return label ? label : type;
}

/** The glyph to draw for `type`, falling back when no descriptor claims it. */
export function resolveNodeTypeIcon(
  type: string | null | undefined,
): NodeTypeIcon {
  if (!type) return DEFAULT_NODE_TYPE_ICON;
  return getNodeContentDescriptor(type)?.icon ?? DEFAULT_NODE_TYPE_ICON;
}
