// SPDX-License-Identifier: AGPL-3.0-only

"use client";
import { useI18n, useLocaleMemo } from "@workspace/ui/lib/i18n";

import { useCallback, useState } from "react";
import { ListFilter } from "lucide-react";
import type {
  CollectionContent,
  CollectionNodeData,
  DataView,
  FilterConfig,
} from "@workspace/interfaces";
import {
  DataViewRoot,
  RecordEditor,
  collectionToDataViewSource,
  type OpenRecordOptions,
} from "@workspace/dataview";
import { useDataStore, useUIStore } from "@workspace/store";
import { Button } from "@workspace/ui/components/ui/button";
import { cn } from "@workspace/ui/lib/utils";

import { CollectionFilterDialog } from "@workspace/ui/components/dialog/collection-filter-dialog";
import { useNodeContentWriter } from "./use-node-content-writer";

interface CollectionNodeContentProps {
  node: CollectionNodeData;
  className?: string;
}

/**
 * CollectionNodeContent - the `collection` node's content editor.
 *
 * The collection's rows are a read-only projection of the graph nodes its
 * `filterConfig` selects, so the embedded data views are read-only for data
 * but still fully manageable (add / rename / configure views). Opening a row
 * navigates the editor to the underlying graph node.
 *
 * It also owns the **filter editor** (`<CollectionFilterDialog>`): the filter is
 * node content, so the node content is where it is read and written. Its entry is
 * this component's own control, pinned to the right end of the view tab strip
 * through `DataViewRoot`'s host slot (`tabActions`) — a data view renders data
 * and handles host chrome not at all (README §3.4). Every view in this box draws
 * the same filtered projection, so the entry belongs to all of them equally.
 */
export function CollectionNodeContent({
  node,
  className,
}: CollectionNodeContentProps) {
  const { t } = useI18n();

  const nodes = useDataStore((state) => state.nodes);
  const nodeSemantics = useDataStore((state) => state.nodeSemantics);
  const nodeTags = useDataStore((state) => state.nodeTags);

  const content = node.content;

  const source = useLocaleMemo(
    () =>
      collectionToDataViewSource(node, nodes, {
        semantics: nodeSemantics,
        tags: nodeTags,
      }),
    [node, nodes, nodeSemantics, nodeTags],
  );

  /**
   * Content writes go through the shared writer
   * (`./use-node-content-writer`), which carries the two rules this host used to
   * document inline: patch the freshest content read back from the store, never
   * this render's `node.content`; and serialize the writes, because PocketBase's
   * SDK aborts a pending request when another one for the same record starts.
   * The collection's two writers (view management and the filter editor) are
   * exactly why a stale snapshot here starts dropping the other one's change.
   */
  const { patchContent } = useNodeContentWriter<CollectionContent>(
    node.id,
    "collection",
    node.content,
  );

  const handleViewsChange = useCallback(
    (views: DataView[]) => {
      patchContent({ views });
    },
    [patchContent],
  );

  const handleFilterSubmit = useCallback(
    (filterConfig: FilterConfig) => {
      patchContent({ filterConfig });
    },
    [patchContent],
  );

  const handleOpenNode = useCallback((nodeId: string) => {
    useUIStore.getState().handleNodeEdit(nodeId);
  }, []);

  /** Whether this node content's own filter editor is open. */
  const [filterOpen, setFilterOpen] = useState(false);

  /**
   * The record editing page — the host's, like the database host's (see
   * `database-node-content.tsx`). Here the projection is read-only, so the page
   * shows the row's fields without editing affordances and offers 打开节点 to
   * jump to the graph node behind it.
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

  /**
   * Node lookup for the views that draw a node itself rather than a cell (the
   * gallery's card cover). Read through `getState()` so resolving a cover never
   * subscribes this projection to unrelated node changes; the host already
   * re-renders when the node map it projects changes.
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
      {/* The record page covers this box, not the viewport — see the database
          host for why the covered view goes `inert`. */}
      <div
        className="h-full min-h-0 w-full p-4"
        inert={openRecord ? true : undefined}
      >
        <DataViewRoot
          // Remount per node so the view/active-view state re-seeds.
          key={node.id}
          source={source}
          views={content.views}
          readOnly
          onViewsChange={handleViewsChange}
          onOpenRecord={handleOpenRecord}
          onOpenNode={handleOpenNode}
          resolveNode={resolveNode}
          // The filter is this node content's own content, so its entry is this
          // node content's own control — pinned to the right end of the shell's
          // view tab strip (`tabActions`). The shell only reserves the spot: no
          // data view is involved, and the write happens here.
          tabActions={
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setFilterOpen(true)}
              className="h-7 gap-1.5 px-2 text-xs font-normal text-muted-foreground"
            >
              <ListFilter className="size-3.5" />
              {t("编辑过滤")}{" "}
            </Button>
          }
        />
      </div>
      <RecordEditor
        open={openRecord !== null}
        rowId={openRecord?.rowId ?? null}
        hiddenFieldIds={openRecord?.hiddenFieldIds}
        source={source}
        editable={false}
        onOpenNode={handleOpenNode}
        onOpenChange={(next) => {
          if (!next) setOpenRecord(null);
        }}
      />
      <CollectionFilterDialog
        open={filterOpen}
        onOpenChange={setFilterOpen}
        filterConfig={content.filterConfig}
        nodes={nodes}
        nodeSemantics={nodeSemantics}
        onSubmit={handleFilterSubmit}
      />
    </div>
  );
}
