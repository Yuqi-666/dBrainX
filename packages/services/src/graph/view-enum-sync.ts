// SPDX-License-Identifier: AGPL-3.0-only

import type { NodeData, NodeId, View } from "@workspace/interfaces";
import { useDataStore, useUIStore } from "@workspace/store";
import { filterByViewFilterConfig } from "@workspace/utils";
import { ViewService } from "./view.service";

/**
 * Data-element → view-enumeration container sync hook.
 *
 * When a node is created at the workspace level but does NOT match the active
 * (non-global) view's ruleGroup and is NOT already enumerated in selectedNodes,
 * ADD it to the view's selectedNodes so it becomes visible in that view.
 * Global views (empty filter + empty enumeration) are NEVER touched.
 */
export function syncViewEnumerationOnCreate(nodeId: NodeId): void {
  const view = getActiveView();
  if (!view) return;
  const fc = view.filterConfig;
  // Skip global view: both filter and enumeration empty.
  if ((!fc.selectedNodes || fc.selectedNodes.length === 0) && !fc.ruleGroup) {
    return;
  }
  const alreadyInEnumeration = fc.selectedNodes?.includes(nodeId) ?? false;
  if (alreadyInEnumeration) return;
  // If the node ALREADY matches the ruleGroup, it is visible without
  // enumeration — skip. Re-evaluate the filter on this single node to avoid
  // polluting the enumeration with nodes the filter already shows
  // (view = filter(workspace) ∪ {枚举}).
  if (nodeMatchesFilter(nodeId, view)) {
    return;
  }
  const selectedNodes = [...(fc.selectedNodes ?? []), nodeId];
  const updatedView: View = { ...view, filterConfig: { ...fc, selectedNodes } };
  // Optimistic store update + debounced persist so the enum array stays in sync.
  void ViewService.upsert(
    view.id,
    { filterConfig: updatedView.filterConfig },
    { debounce: true },
  );
}

/** When a node is deleted, REMOVE its id from every (non-global) view's selectedNodes. */
export function syncViewEnumerationOnDelete(nodeId: NodeId): void {
  const views = useDataStore.getState().views;
  const result: View[] = [];
  for (const view of views.values()) {
    const fc = view.filterConfig;
    if (!fc.selectedNodes || !fc.selectedNodes.includes(nodeId)) continue;
    const selectedNodes = fc.selectedNodes.filter((id) => id !== nodeId);
    result.push({ ...view, filterConfig: { ...fc, selectedNodes } });
  }
  for (const v of result) {
    void ViewService.upsert(
      v.id,
      { filterConfig: v.filterConfig },
      { debounce: true },
    );
  }
}

function getActiveView(): View | undefined {
  const { currentViewId } = useUIStore.getState();
  if (!currentViewId) return undefined;
  return useDataStore.getState().views.get(currentViewId);
}

function nodeMatchesFilter(nodeId: NodeId, view: View): boolean {
  const { nodes, edges } = useDataStore.getState();
  const node = nodes.get(nodeId);
  if (!node || !view.filterConfig.ruleGroup) return false;
  const { filteredNodes } = filterByViewFilterConfig(
    new Map<NodeId, NodeData>([[nodeId, node]]),
    edges,
    view,
  );
  return filteredNodes.has(nodeId);
}
