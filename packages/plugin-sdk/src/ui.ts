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

/**
 * How the shared attribute panel draws one contributed field (§3.5.4.6).
 *
 * - `url` / `text` / `cover`: an editable text control. `cover` only changes
 *   the glyph, because an image address and a body string are typed the same
 *   way and the difference is what the label and the icon say.
 * - `timeline`: a **read-only** count of the entries under the field. The
 *   timeline is edited by the type's own editor, so the panel never writes it.
 * - `select`: one of {@link NodeAttributeField.options}.
 */
export type NodeAttributeFieldKind =
  | "url"
  | "text"
  | "cover"
  | "timeline"
  | "select"

/** One choice of a `select` attribute field. */
export interface NodeAttributeFieldOption {
  value: string
  label: string
}

/**
 * One field the shared attribute panel shows for a node type.
 *
 * The panel reads this declaration and nothing else: it does not branch on the
 * type id, so a plugin type gets its own property row with no host change.
 */
export interface NodeAttributeField {
  /**
   * Dotted path inside `node.content`, for example `url` or
   * `filterConfig.collectionType`.
   */
  field: string
  /** Label the plugin finished translating before it registered the descriptor. */
  label: string
  kind: NodeAttributeFieldKind
  /** Placeholder for an empty editable value; already translated. */
  placeholder?: string
  /**
   * The value may stay absent. The panel then labels the row as optional
   * instead of treating an empty value as a missing required one.
   */
  optional?: boolean
  /** The choices a `select` field offers. */
  options?: readonly NodeAttributeFieldOption[]
  /**
   * The operation that writes this field once the panel is wired to
   * `operation.invoke` (todo 39). Absent when the operation catalog has no
   * operation for the field yet; the panel then keeps the edit local instead
   * of inventing an operation id.
   */
  operationId?: string
}

/** The declarative half of a type's attribute-panel contribution. */
export interface NodeAttributesContribution {
  /** Fields the shared panel renders, in this order. */
  fields: readonly NodeAttributeField[]
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
  /**
   * The property panel contribution shown next to the editor.
   *
   * A field list is rendered by the shared panel in `packages/ui` from this
   * declaration alone, so the host never branches on the node type. A component
   * value stays accepted for a plugin panel that cannot be expressed as fields;
   * the shared panel keeps its own shell for it and does not invent a field
   * list.
   */
  attributes?:
    | NodeAttributesContribution
    | ComponentType<NodeContentViewProps<T>>
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
