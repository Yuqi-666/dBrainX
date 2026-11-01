// SPDX-License-Identifier: AGPL-3.0-only

"use client";

/**
 * The node content **host** — the type-agnostic half of the node editor.
 *
 * It knows one thing: a node's `nodeType` names a descriptor in the plugin
 * registry, and that descriptor owns the editor. It does not know the ten
 * builtin types: they live in `plugins/builtin/ui/node-content/` and reach this
 * component only through `registerNodeContent` (§4.9.2), so a plugin type renders
 * exactly like a builtin one and an unregistered type degrades to
 * `UnknownNodeContent` instead of a blank panel.
 */
import type { NodeData } from "@workspace/interfaces";

import { NodeContentHost } from "../plugin-ui/node-content-host";

/** Props for the NodeContentEditor component */
interface NodeContentEditorProps {
  /** The node data to edit */
  node: NodeData;
  /** Optional CSS class name */
  className?: string;
}

/** Renders the registered editor for the node's type. */
export function NodeContentEditor({ node, className }: NodeContentEditorProps) {
  return <NodeContentHost node={node} className={className} slot="editor" />;
}
