// SPDX-License-Identifier: AGPL-3.0-only

"use client";
import { useI18n } from "@workspace/ui/lib/i18n";

import * as React from "react";
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@workspace/ui/components/ui/dropdown-menu";
import { Edit, Trash2, Link2 } from "lucide-react";
import { useDataStore, useUIStore } from "@workspace/store";
import { requestNodeDelete } from "@workspace/ui/lib/node-disposition";
import { NodeSemanticSelector } from "@workspace/ui/components/selector/node-semantic-selector";

export interface GraphContextMenuNodeProps {
  nodeId: string;
  onEditNode?: (id: string) => void;
  onStartAddEdge?: (nodeId: string) => void;
  onChangeNodeSemantic?: (nodeId: string, semanticId: string) => void;
  onClose: () => void;
}

export function GraphContextMenuNode({
  nodeId,
  onEditNode,
  onStartAddEdge,
  onChangeNodeSemantic,
  onClose,
}: GraphContextMenuNodeProps) {
  const { t } = useI18n();

  const node = useDataStore((state) => state.nodes.get(nodeId));
  const nodeSemantics = useDataStore((state) => state.nodeSemantics);
  const openNodeSemanticDialog = useUIStore(
    (state) => state.openNodeSemanticDialog,
  );
  const currentSemantic = node?.semanticId
    ? nodeSemantics.get(node.semanticId)
    : undefined;

  const handleSemanticSelect = (semanticId: string) => {
    onChangeNodeSemantic?.(nodeId, semanticId);
    onClose();
  };

  return (
    <>
      <div className="flex flex-col gap-1 px-2 py-1.5">
        <DropdownMenuSub>
          <DropdownMenuSubTrigger
            className="flex items-center gap-2 px-2 py-1.5 cursor-pointer hover:bg-accent hover:text-accent-foreground rounded-md"
            onClick={(e) => e.preventDefault()}
          >
            {currentSemantic ? (
              <>
                {currentSemantic.color && (
                  <span
                    className="size-3 rounded-full flex-shrink-0"
                    style={{ backgroundColor: currentSemantic.color }}
                  />
                )}
                <span className="text-xs text-muted-foreground truncate max-w-[100px]">
                  {currentSemantic.name}
                </span>
              </>
            ) : (
              <span className="text-xs text-muted-foreground">
                {t("请选择类型")}
              </span>
            )}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <NodeSemanticSelector
              onSelect={handleSemanticSelect}
              onCreateRequest={() =>
                openNodeSemanticDialog(null, { kind: "assign", nodeId })
              }
            />
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      </div>
      <DropdownMenuSeparator />
      <DropdownMenuItem
        onClick={() => {
          onEditNode?.(nodeId);
          onClose();
        }}
        className="flex items-center gap-2 px-2 py-1.5 cursor-pointer hover:bg-accent hover:text-accent-foreground rounded-md"
      >
        <Edit className="size-4" />
        <span>{t("Edit")}</span>
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem
        onSelect={(e) => {
          e.preventDefault();
          onStartAddEdge?.(nodeId);
        }}
        className="flex items-center gap-2 px-2 py-1.5 cursor-pointer hover:bg-accent hover:text-accent-foreground rounded-md"
      >
        <Link2 className="size-4" />
        <span>{t("Connect To")}</span>
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem
        onClick={() => {
          // The helper decides: a node with no uploaded file is deleted here,
          // one that references a file opens the disposition dialog instead.
          void requestNodeDelete(nodeId);
          onClose();
        }}
        className="flex items-center gap-2 px-2 py-1.5 cursor-pointer text-destructive hover:bg-destructive/10 hover:text-destructive rounded-md"
      >
        <Trash2 className="size-4" />
        <span>{t("Delete")}</span>
      </DropdownMenuItem>
    </>
  );
}
