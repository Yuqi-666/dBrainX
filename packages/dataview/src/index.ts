// SPDX-License-Identifier: AGPL-3.0-only

/**
 * `@workspace/dataview` public API.
 *
 * `<DataViewRoot />` is the only component a host mounts; everything else here
 * is either a type, a source adapter, or an extension point (registry,
 * renderer/config-editor contracts).
 */
export { DataViewRoot } from "./data-view-root";
export type { DataViewRootProps } from "./data-view-root";

export {
  DataViewToolbar,
  type DataViewToolbarProps,
} from "./toolbar/data-view-toolbar";
export { ViewSwitcher, type ViewSwitcherProps } from "./toolbar/view-switcher";

export * from "./source";
export * from "./shared";
export * from "./registry";
export * from "./defaults";
