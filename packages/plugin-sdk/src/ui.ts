// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The node content descriptor contract (§4.9.2).
 *
 * `packages/ui` keeps the runtime table; a plugin package only exports
 * descriptors. This entry is imported by browser bundles (the generated plugin
 * UI map), so it stays free of Node builtins and of every runtime import: the
 * two imports below are type-only and disappear at build time.
 */

import type { ComponentType, LazyExoticComponent } from "react"
import type { NodeData } from "@workspace/interfaces"

/** Props every node content editor, preview and attribute panel receives. */
export interface NodeContentViewProps<T extends NodeData = NodeData> {
  node: T
  className?: string
}

/** One registered node type's rendering surface. */
export interface NodeContentDescriptor<T extends NodeData = NodeData> {
  /**
   * Node type id, for example `"text"` or `"aws.monitor"`.
   *
   * Node types are runtime data after the plugin upgrade (§4.2.6), so the id is
   * `string`; the compile-time `NodeDataType` union is no longer the registry
   * key and is not used here.
   */
  type: string
  /** Plugin that contributes the type; the registry rejects a cross-plugin type collision. */
  pluginId: string
  /** Display name; the plugin finishes i18n before it registers the descriptor. */
  label: string
  editor: LazyExoticComponent<ComponentType<NodeContentViewProps<T>>>
  preview: LazyExoticComponent<ComponentType<NodeContentViewProps<T>>>
  icon: ComponentType<{ className?: string }>
  /** Optional property panel shown next to the editor. */
  attributes?: ComponentType<NodeContentViewProps<T>>
  /**
   * The editor seeds itself once per mount, so replacing the store content
   * requires a remount instead of a re-render (today: `text`, `rich-text`).
   * Consumed by `packages/ui/src/lib/node-disposition.ts`.
   */
  uncontrolledEditors?: boolean
  /**
   * The type has one clearable payload, so the options menu may offer "clear".
   * A type without one (`collection`, `database`) must hide the action instead
   * of opening a dialog that does nothing. Consumed by `options-menu.tsx`.
   */
  clearable?: boolean
}
