// SPDX-License-Identifier: AGPL-3.0-only

/**
 * `database` host adapter: a database node already is a normalized table, so
 * this is close to the identity function. It exists anyway so hosts never
 * construct a `DataViewSource` by hand (README §4.2).
 *
 * `nodeTitle` is the host node's display name — provenance alongside `nodeId`,
 * and what a view that labels the whole set defaults to (the gantt's 表头 =
 * 节点名). The host has the node, the rows do not.
 */
import type { DatabaseContent, DataViewSource } from "@workspace/interfaces";

export function databaseToDataViewSource(
  content: DatabaseContent | undefined,
  nodeId?: string,
  nodeTitle?: string,
): DataViewSource {
  return {
    kind: "database",
    nodeId,
    nodeTitle,
    fields: content?.fields ?? [],
    rows: content?.rows ?? [],
  };
}
