// SPDX-License-Identifier: AGPL-3.0-only

"use client";
import { useI18n } from "@workspace/ui/lib/i18n";

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@workspace/ui/components/ui/dropdown-menu";
import { NodeSemanticSelector } from "@workspace/ui/components/selector/node-semantic-selector";
import { NODE_TYPE_LABELS } from "@workspace/ui/components/selector/node-data-type-selector";
import {
  NodeSemanticDialogContent,
  createNodeSemantic,
  type NodeSemanticFormData,
} from "@workspace/ui/components/dialog/semantic-dialog";
import { Button } from "@workspace/ui/components/ui/button";
import { useGraph } from "@workspace/hooks";
import { useDataStore } from "@workspace/store";
import type { NodeDataType } from "@workspace/interfaces";
import { NODE_DATA_TYPES } from "@workspace/interfaces";

export interface AddNodeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AddNodeDialog({ open, onOpenChange }: AddNodeDialogProps) {
  const { t } = useI18n();

  const { onAddNode } = useGraph();
  const nodeSemanticsMap = useDataStore((state) => state.nodeSemantics);
  const [nodeType, setNodeType] = useState<NodeDataType | null>(null);
  const [semanticId, setSemanticId] = useState<string | null>(null);
  const [semanticDialogOpen, setSemanticDialogOpen] = useState(false);

  const semanticName = semanticId
    ? (nodeSemanticsMap.get(semanticId)?.name ?? null)
    : null;

  const handleConfirm = async () => {
    if (!nodeType || !semanticId) return;
    await onAddNode(nodeType, semanticId);
    setNodeType(null);
    setSemanticId(null);
    onOpenChange(false);
  };

  const handleCancel = () => {
    setNodeType(null);
    setSemanticId(null);
    onOpenChange(false);
  };

  // 就地新建语义：创建成功后直接把它填进下方 Semantic 选择，用户无需再
  // 重开下拉重新选一次（拿到 id 后 Create 按钮也随之可用）。
  const handleCreateSemantic = async (data: NodeSemanticFormData) => {
    try {
      const created = await createNodeSemantic(data);
      if (created) {
        setSemanticId(created.id);
        setSemanticDialogOpen(false);
      }
    } catch (error) {
      console.error("Failed to create node semantic:", error);
    }
  };

  // 外层表单关闭时一并收起内层对话框，避免残留状态在下次打开时复现。
  useEffect(() => {
    if (!open) setSemanticDialogOpen(false);
  }, [open]);

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("Add Node")}</DialogTitle>
            <DialogDescription>
              {t("Create a new node and pick its type and semantic.")}{" "}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4 py-2">
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">
                {t("Node Type")}{" "}
              </span>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" className="justify-start">
                    {nodeType
                      ? NODE_TYPE_LABELS[nodeType]
                      : t("Select node type")}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-48">
                  {NODE_DATA_TYPES.map((type) => (
                    <Button
                      key={type}
                      variant="ghost"
                      className="w-full justify-start"
                      onClick={() => {
                        setNodeType(type);
                      }}
                    >
                      {NODE_TYPE_LABELS[type] || type}
                    </Button>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">
                {t("Semantic")}{" "}
              </span>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" className="justify-start">
                    {semanticName ?? "Select semantic"}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="p-0">
                  <NodeSemanticSelector
                    className="w-full"
                    onSelect={(id) => {
                      setSemanticId(id);
                    }}
                    onCreateRequest={() => setSemanticDialogOpen(true)}
                  />
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={handleCancel}>
              {t("Cancel")}{" "}
            </Button>
            <Button disabled={!nodeType || !semanticId} onClick={handleConfirm}>
              {t("Create")}{" "}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <NodeSemanticDialogContent
        open={semanticDialogOpen}
        onOpenChange={setSemanticDialogOpen}
        editingSemantic={null}
        onSubmit={handleCreateSemantic}
      />
    </>
  );
}
