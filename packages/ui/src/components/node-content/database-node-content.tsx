// SPDX-License-Identifier: AGPL-3.0-only

"use client";

import { useCallback, useMemo, useState } from "react";
import type {
  DatabaseCell,
  DatabaseContent,
  DatabaseField,
  DatabaseNodeData,
  DataRow,
  DataView,
} from "@workspace/interfaces";
import {
  DataViewRoot,
  RecordEditor,
  databaseToDataViewSource,
  type OpenRecordOptions,
} from "@workspace/dataview";
import { useDataStore, useUIStore } from "@workspace/store";
import { cn } from "@workspace/ui/lib/utils";

import { useNodeContentWriter } from "./use-node-content-writer";

interface DatabaseNodeContentProps {
  node: DatabaseNodeData;
  className?: string;
}

/**
 * DatabaseNodeContent - the `database` node's content editor.
 *
 * The node owns its table (`content.fields` / `content.rows`); this component
 * only adapts it into a `DataViewSource` and persists what the data views
 * report back. Every write goes through `NodeService.upsert`, i.e. the same
 * optimistic path the rest of the app uses — data views never touch the store.
 *
 * It also renders the **record editing page** (`<RecordEditor>`), which the data
 * views ask for through `DataViewRoot`'s `onOpenRecord`: the page needs this
 * component's live data and write path, so it lives with the node content rather
 * than inside the data view shell.
 *
 * The two rules that make that persistence safe — patch the freshest content,
 * never the render's snapshot; serialize the writes — live with the shared
 * writer (`./use-node-content-writer`), which every handler here goes through.
 * This file must never build a content patch from this render's `node.content`.
 */
export function DatabaseNodeContent({
  node,
  className,
}: DatabaseNodeContentProps) {
  const content = node.content;

  const source = useMemo(
    () => databaseToDataViewSource(content, node.id, node.title),
    [content, node.id, node.title],
  );

  const { liveContent, patchContent } = useNodeContentWriter<DatabaseContent>(
    node.id,
    "database",
    node.content,
  );

  const handleViewsChange = useCallback(
    (views: DataView[]) => {
      patchContent({ views });
    },
    [patchContent],
  );

  const handleCellChange = useCallback(
    (rowId: string, fieldId: string, cell: DatabaseCell) => {
      const rows = liveContent().rows.map((row) =>
        row.id === rowId
          ? { ...row, cells: { ...row.cells, [fieldId]: cell } }
          : row,
      );
      patchContent({ rows });
    },
    [liveContent, patchContent],
  );

  const handleOpenNode = useCallback((nodeId: string) => {
    useUIStore.getState().handleNodeEdit(nodeId);
  }, []);

  /**
   * The record editing page.
   *
   * It belongs to the host, not to `@workspace/dataview`: a record's data and
   * its write path are right here (the data views only report what happened), so
   * `DataViewRoot` merely reports *which* record the user opened and this
   * component renders `<RecordEditor>` with the live callbacks. `hiddenFieldIds`
   * are the fields the calling view does not surface; the editor folds them into
   * its 隐藏字段 block.
   */
  const [openRecord, setOpenRecord] = useState<{
    rowId: string;
    hiddenFieldIds: readonly string[];
  } | null>(null);

  const handleOpenRecord = useCallback(
    (rowId: string, options?: OpenRecordOptions) => {
      setOpenRecord({ rowId, hiddenFieldIds: options?.hiddenFieldIds ?? [] });
    },
    [],
  );

  const handleRowInsert = useCallback(
    (row: DataRow) => {
      patchContent({ rows: [...liveContent().rows, row] });
    },
    [liveContent, patchContent],
  );

  const handleRowDelete = useCallback(
    (rowIds: readonly string[]) => {
      if (rowIds.length === 0) return;
      const removed = new Set(rowIds);
      patchContent({
        rows: liveContent().rows.filter((row) => !removed.has(row.id)),
      });
    },
    [liveContent, patchContent],
  );

  const handleRowReorder = useCallback(
    (rowIds: readonly string[]) => {
      if (rowIds.length === 0) return;
      const rows = liveContent().rows;
      const byId = new Map(rows.map((row) => [row.id, row]));
      const ordered = rowIds
        .map((rowId) => byId.get(rowId))
        .filter((row): row is DataRow => row !== undefined);
      const listed = new Set(rowIds);
      const rest = rows.filter((row) => !listed.has(row.id));
      patchContent({ rows: [...ordered, ...rest] });
    },
    [liveContent, patchContent],
  );

  /**
   * Schema writes from the table view (字段配置 / 字段编辑 / 删除字段).
   *
   * The data view reports the whole next field list plus, when it also had to
   * rewrite cells (a deleted field's cells, a retyped or default-valued one),
   * the matching row set. Both halves land in one `NodeService.upsert`.
   */
  const handleFieldsChange = useCallback(
    (fields: DatabaseField[], rows?: DataRow[]) => {
      patchContent({ fields, rows: rows ?? liveContent().rows });
    },
    [liveContent, patchContent],
  );

  /**
   * Relation cells display the referenced node's title. Read through
   * `getState()` rather than a store selector so a database node does not
   * re-render on every unrelated node change; the lookup runs while the data
   * views build their records.
   */
  const resolveNodeTitle = useCallback(
    (nodeId: string) => useDataStore.getState().nodes.get(nodeId)?.title,
    [],
  );

  /**
   * Node lookup for views that draw a node itself: the gallery's cover field
   * may be a `relation`, and a cover drawn from the referenced node needs the
   * node, not just its title. Same lazy `getState()` read as above.
   */
  const resolveNode = useCallback(
    (nodeId: string) => useDataStore.getState().nodes.get(nodeId),
    [],
  );

  return (
    <div
      className={cn(
        "relative h-full min-h-0 w-full overflow-hidden",
        className,
      )}
    >
      {/**
       * The record page covers this box rather than the viewport (node-content is
       * mounted either full-screen or inside the node editor's dialog window), so
       * the view underneath goes `inert` while it is open: the page is not a
       * modal, and this is what keeps Tab from walking into a covered table.
       */}
      <div
        className="h-full min-h-0 w-full p-4"
        inert={openRecord ? true : undefined}
      >
        <DataViewRoot
          // Remount per node so the view/active-view state re-seeds.
          key={node.id}
          source={source}
          views={content.views}
          onViewsChange={handleViewsChange}
          onCellChange={handleCellChange}
          onOpenRecord={handleOpenRecord}
          onOpenNode={handleOpenNode}
          onRowInsert={handleRowInsert}
          onRowDelete={handleRowDelete}
          onRowReorder={handleRowReorder}
          onFieldsChange={handleFieldsChange}
          resolveNodeTitle={resolveNodeTitle}
          resolveNode={resolveNode}
        />
      </div>
      <RecordEditor
        open={openRecord !== null}
        rowId={openRecord?.rowId ?? null}
        hiddenFieldIds={openRecord?.hiddenFieldIds}
        source={source}
        editable
        onCellChange={handleCellChange}
        onRowInsert={handleRowInsert}
        onRowDelete={handleRowDelete}
        onFieldsChange={handleFieldsChange}
        onOpenNode={handleOpenNode}
        resolveNodeTitle={resolveNodeTitle}
        onOpenChange={(next) => {
          if (!next) setOpenRecord(null);
        }}
      />
    </div>
  );
}
