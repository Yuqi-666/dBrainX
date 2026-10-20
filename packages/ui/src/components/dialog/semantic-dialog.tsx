// SPDX-License-Identifier: AGPL-3.0-only

"use client";
import { ColorPicker } from "@workspace/ui/components/selector/color-picker";
import { IconSelectorPopover } from "@workspace/ui/components/selector/icon-selector-popover";
import { IconView } from "@workspace/ui/components/icon/icon-view";
import { translate } from "@workspace/ui/lib/i18n/runtime";
import { useI18n } from "@workspace/ui/lib/i18n";

import { useCallback, useState } from "react";
import { cn } from "@workspace/ui/lib/utils";
import { useDataStore, useUIStore } from "@workspace/store";
import { NodeSemanticService, EdgeSemanticService } from "@workspace/services";
import { useGraph } from "@workspace/hooks";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@workspace/ui/components/ui/dialog";
import { Button } from "@workspace/ui/components/ui/button";
import { Input } from "@workspace/ui/components/ui/input";
import { Textarea } from "@workspace/ui/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/ui/select";
import { Label } from "@workspace/ui/components/ui/label";
import type {
  NodeSemantic,
  NodeSemanticId,
  EdgeSemantic,
  EdgeSemanticId,
  EdgeType,
} from "@workspace/interfaces";
import { Trash2Icon, PlusIcon, SmilePlus } from "lucide-react";

export interface NodeSemanticFormData {
  name: string;
  description?: string;
  color?: string;
  icon?: string;
}

/**
 * 节点语义表单值 → 落库载荷：裁剪空白；图标用空串明确清除旧值。
 * 语义对话框与「Add Node」表单共用，保证两个入口创建出的语义完全一致。
 */
export function buildNodeSemanticPayload(formData: NodeSemanticFormData) {
  return {
    name: formData.name.trim(),
    description: formData.description?.trim() || undefined,
    color: formData.color || undefined,
    icon: formData.icon?.trim() || "",
  };
}

/** 以表单值新建一个节点语义（`tmp_` 占位 id 由 service 换成后端 id）。 */
export async function createNodeSemantic(
  formData: NodeSemanticFormData,
): Promise<NodeSemantic | void> {
  const id = "tmp_" as NodeSemanticId;
  return NodeSemanticService.upsert({
    id,
    ...buildNodeSemanticPayload(formData),
  });
}

export function NodeSemanticDialog() {
  useI18n();

  const { open, editingSemantic, afterCreate } = useUIStore(
    (state) => state.nodeSemanticDialog,
  );
  const closeDialog = useUIStore((state) => state.closeNodeSemanticDialog);
  const { onChangeNodeSemantic, onAddNode } = useGraph();

  const handleSubmit = useCallback(
    async (formData: NodeSemanticFormData) => {
      if (!formData.name.trim()) return;

      try {
        if (editingSemantic) {
          await NodeSemanticService.upsert(
            editingSemantic.id,
            buildNodeSemanticPayload(formData),
          );
        } else {
          const created = await createNodeSemantic(formData);

          // 从节点右键菜单进来新建时把新语义选给那个节点；从画布/侧边栏
          // Add Node 进来新建时用新语义把节点补建出来。两条路径都省去用户
          // 「创建 → 重开菜单 → 再选一次」的往返。
          if (afterCreate && created) {
            if (afterCreate.kind === "assign") {
              await onChangeNodeSemantic(afterCreate.nodeId, created.id);
            } else {
              await onAddNode(
                afterCreate.nodeType,
                created.id,
                afterCreate.simX,
                afterCreate.simY,
                afterCreate.viewId,
              );
            }
          }
        }

        closeDialog();
      } catch (error) {
        console.error("Failed to save node semantic:", error);
      }
    },
    [
      editingSemantic,
      afterCreate,
      onChangeNodeSemantic,
      onAddNode,
      closeDialog,
    ],
  );

  return (
    <NodeSemanticDialogContent
      open={open}
      onOpenChange={(o) => !o && closeDialog()}
      editingSemantic={editingSemantic}
      onSubmit={handleSubmit}
      onDelete={
        editingSemantic
          ? () => NodeSemanticService.delete(editingSemantic.id)
          : undefined
      }
    />
  );
}

interface NodeSemanticDialogContentProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editingSemantic: NodeSemantic | null;
  onSubmit: (data: NodeSemanticFormData) => void;
  onDelete?: () => void;
}

export function NodeSemanticDialogContent({
  open,
  onOpenChange,
  editingSemantic,
  onSubmit,
  onDelete,
}: NodeSemanticDialogContentProps) {
  const { t } = useI18n();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>
            {editingSemantic ? t("Edit Node Semantic") : t("Add Node Semantic")}
          </DialogTitle>
        </DialogHeader>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            const form = e.currentTarget;
            const data = {
              name: (form.elements.namedItem("name") as HTMLInputElement).value,
              description: (
                form.elements.namedItem("description") as HTMLTextAreaElement
              ).value,
              color: (form.elements.namedItem("color") as HTMLInputElement)
                .value,
              icon: (form.elements.namedItem("icon") as HTMLInputElement).value,
            };
            onSubmit(data);
          }}
        >
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="node-name">{t("Name")}</Label>
              <Input
                id="node-name"
                name="name"
                defaultValue={editingSemantic?.name ?? ""}
                placeholder={t("e.g., Concept, Person, Event")}
                required
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="node-description">{t("Description")}</Label>
              <Textarea
                id="node-description"
                name="description"
                defaultValue={editingSemantic?.description ?? ""}
                placeholder={t("Optional description")}
              />
            </div>

            <div className="grid gap-2">
              <Label>{t("Color")}</Label>
              <SemanticColorField
                key={editingSemantic?.id ?? "new"}
                defaultValue={editingSemantic?.color ?? "#6366f1"}
                aria-label={t("Color")}
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="node-icon">{t("图标")}</Label>
              <SemanticIconField
                key={editingSemantic?.id ?? "new"}
                defaultValue={editingSemantic?.icon ?? ""}
              />
            </div>
          </div>

          <DialogFooter>
            {onDelete && (
              <Button
                type="button"
                variant="destructive"
                onClick={() => {
                  onDelete();
                  onOpenChange(false);
                }}
                className="mr-auto"
              >
                {t("Delete")}{" "}
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              {t("Cancel")}{" "}
            </Button>
            <Button type="submit">
              {editingSemantic ? t("Update") : t("Create")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const EDGE_TYPE_OPTIONS: { value: EdgeType; label: string }[] = [
  {
    value: "hierarchy",
    get label() {
      return translate("Hierarchy");
    },
  },
  {
    value: "flow",
    get label() {
      return translate("Flow");
    },
  },
  {
    value: "association",
    get label() {
      return translate("Association");
    },
  },
  {
    value: "interaction",
    get label() {
      return translate("Interaction");
    },
  },
];

export function EdgeSemanticDialog() {
  useI18n();

  const { open, editingSemantic, assignToEdgeId } = useUIStore(
    (state) => state.edgeSemanticDialog,
  );
  const closeDialog = useUIStore((state) => state.closeEdgeSemanticDialog);
  const { onChangeEdgeSemantic } = useGraph();

  const handleSubmit = useCallback(
    async (formData: {
      name: string;
      category: EdgeType;
      description?: string;
      color?: string;
      icon?: string;
    }) => {
      if (!formData.name.trim()) return;

      try {
        const semanticData = {
          name: formData.name.trim(),
          description: formData.description?.trim() || undefined,
          category: formData.category,
          color: formData.color || undefined,
          icon: formData.icon?.trim() || "",
        };

        if (editingSemantic) {
          await EdgeSemanticService.upsert(editingSemantic.id, semanticData);
        } else {
          const id = "tmp_" as EdgeSemanticId;
          const created = await EdgeSemanticService.upsert({
            id,
            ...semanticData,
          });

          // 从边的右键菜单进来新建时，直接把新语义选给那条边，
          // 省去用户「创建 → 重开菜单 → 再选一次」的往返。
          if (assignToEdgeId && created) {
            await onChangeEdgeSemantic(assignToEdgeId, created.id);
          }
        }

        closeDialog();
      } catch (error) {
        console.error("Failed to save edge semantic:", error);
      }
    },
    [editingSemantic, assignToEdgeId, onChangeEdgeSemantic, closeDialog],
  );

  return (
    <EdgeSemanticDialogContent
      open={open}
      onOpenChange={(o) => !o && closeDialog()}
      editingSemantic={editingSemantic}
      onSubmit={handleSubmit}
      onDelete={
        editingSemantic
          ? () => EdgeSemanticService.delete(editingSemantic.id)
          : undefined
      }
    />
  );
}

interface EdgeSemanticDialogContentProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editingSemantic: EdgeSemantic | null;
  onSubmit: (data: {
    name: string;
    category: EdgeType;
    description?: string;
    color?: string;
    icon?: string;
  }) => void;
  onDelete?: () => void;
}

export function EdgeSemanticDialogContent({
  open,
  onOpenChange,
  editingSemantic,
  onSubmit,
  onDelete,
}: EdgeSemanticDialogContentProps) {
  const { t } = useI18n();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>
            {editingSemantic ? t("Edit Edge Semantic") : t("Add Edge Semantic")}
          </DialogTitle>
        </DialogHeader>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            const form = e.currentTarget;
            const data = {
              name: (form.elements.namedItem("name") as HTMLInputElement).value,
              category: (
                form.elements.namedItem("category") as HTMLInputElement
              ).value as EdgeType,
              icon: (form.elements.namedItem("icon") as HTMLInputElement).value,
              description: (
                form.elements.namedItem("description") as HTMLTextAreaElement
              ).value,
              color: (form.elements.namedItem("color") as HTMLInputElement)
                .value,
            };
            onSubmit(data);
          }}
        >
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="edge-name">{t("Name")}</Label>
              <Input
                id="edge-name"
                name="name"
                defaultValue={editingSemantic?.name ?? ""}
                placeholder={t("e.g., Causes, Part Of, References")}
                required
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="edge-category">{t("Category")}</Label>
              <Select
                name="category"
                defaultValue={editingSemantic?.category ?? "association"}
              >
                <SelectTrigger id="edge-category" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent position="popper">
                  {EDGE_TYPE_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="edge-description">{t("Description")}</Label>
              <Textarea
                id="edge-description"
                name="description"
                defaultValue={editingSemantic?.description ?? ""}
                placeholder={t("Optional description")}
              />
            </div>

            <div className="grid gap-2">
              <Label>{t("Color")}</Label>
              <SemanticColorField
                key={editingSemantic?.id ?? "new"}
                defaultValue={editingSemantic?.color ?? "#6366f1"}
                aria-label={t("Color")}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="edge-icon">{t("图标")}</Label>
              <SemanticIconField
                key={editingSemantic?.id ?? "new"}
                id="edge-icon"
                defaultValue={editingSemantic?.icon ?? ""}
              />
            </div>
          </div>

          <DialogFooter>
            {onDelete && (
              <Button
                type="button"
                variant="destructive"
                onClick={() => {
                  onDelete();
                  onOpenChange(false);
                }}
                className="mr-auto"
              >
                {t("Delete")}{" "}
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              {t("Cancel")}{" "}
            </Button>
            <Button type="submit">
              {editingSemantic ? t("Update") : t("Create")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function NodeSemanticManager({ className }: { className?: string }) {
  const { t } = useI18n();

  const nodeSemantics = useDataStore((state) => state.getAllNodeSemantics());
  const openDialog = useUIStore((state) => state.openNodeSemanticDialog);

  const handleDelete = async (id: NodeSemanticId) => {
    try {
      await NodeSemanticService.delete(id);
    } catch (error) {
      console.error("Failed to delete node semantic:", error);
    }
  };

  return (
    <div className={cn("space-y-3", className)}>
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-medium">{t("Node Semantics")}</h4>
        <Button size="sm" variant="ghost" onClick={() => openDialog()}>
          <PlusIcon className="h-4 w-4 mr-1" />
          {t("Add")}{" "}
        </Button>
      </div>

      {nodeSemantics.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t("No node semantics yet.")}
        </p>
      ) : (
        <div className="space-y-2">
          {nodeSemantics.map((semantic) => (
            <div
              key={semantic.id}
              className="flex items-center justify-between p-2 rounded-lg border bg-card hover:bg-accent/50 transition-colors"
            >
              <div className="flex items-center gap-2 min-w-0">
                {semantic.color && (
                  <div
                    className="w-3 h-3 rounded-full flex-shrink-0"
                    style={{ backgroundColor: semantic.color }}
                  />
                )}
                <span className="text-sm truncate">{semantic.name}</span>
              </div>
              <div className="flex items-center gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => openDialog(semantic)}
                >
                  {t("Edit")}{" "}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => handleDelete(semantic.id)}
                >
                  <Trash2Icon className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function EdgeSemanticManager({ className }: { className?: string }) {
  const { t } = useI18n();

  const edgeSemantics = useDataStore((state) => state.getAllEdgeSemantics());
  const openDialog = useUIStore((state) => state.openEdgeSemanticDialog);

  const handleDelete = async (id: EdgeSemanticId) => {
    try {
      await EdgeSemanticService.delete(id);
    } catch (error) {
      console.error("Failed to delete edge semantic:", error);
    }
  };

  return (
    <div className={cn("space-y-3", className)}>
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-medium">{t("Edge Semantics")}</h4>
        <Button size="sm" variant="ghost" onClick={() => openDialog()}>
          <PlusIcon className="h-4 w-4 mr-1" />
          {t("Add")}{" "}
        </Button>
      </div>

      {edgeSemantics.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t("No edge semantics yet.")}
        </p>
      ) : (
        <div className="space-y-2">
          {edgeSemantics.map((semantic) => (
            <div
              key={semantic.id}
              className="flex items-center justify-between p-2 rounded-lg border bg-card hover:bg-accent/50 transition-colors"
            >
              <div className="flex items-center gap-2 min-w-0">
                {semantic.color && (
                  <div
                    className="w-3 h-3 rounded-full flex-shrink-0"
                    style={{ backgroundColor: semantic.color }}
                  />
                )}
                <span className="text-sm truncate">{semantic.name}</span>
                <span className="text-xs text-muted-foreground">
                  ({semantic.category})
                </span>
              </div>
              <div className="flex items-center gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => openDialog(semantic)}
                >
                  {t("Edit")}{" "}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => handleDelete(semantic.id)}
                >
                  <Trash2Icon className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Select a Lucide icon and include its name in the semantic form submission. */
function SemanticIconField({
  defaultValue,
  id = "node-icon",
}: {
  defaultValue: string;
  id?: string;
}) {
  const { t } = useI18n();
  const [icon, setIcon] = useState(defaultValue);
  const value = icon ? { kind: "icon" as const, value: icon } : undefined;

  return (
    <>
      <input type="hidden" name="icon" value={icon} />
      <IconSelectorPopover
        allowedKinds={["icon"]}
        showColorPicker={false}
        value={value}
        onChange={(next) => setIcon(next?.value ?? "")}
      >
        <Button
          id={id}
          type="button"
          variant="outline"
          className="w-full justify-start"
          aria-label={t("设置图标")}
        >
          <IconView
            icon={value}
            className="size-4"
            fallback={<SmilePlus className="size-4" />}
          />
          {icon || t("设置图标")}
        </Button>
      </IconSelectorPopover>
    </>
  );
}

/** The semantic form embeds the palette and includes its value in form submission. */
function SemanticColorField({
  defaultValue,
  "aria-label": label,
}: {
  defaultValue: string;
  "aria-label": string;
}) {
  const [color, setColor] = useState(defaultValue);
  return (
    <div className="max-w-80 rounded-xl border border-border/60 bg-muted/10">
      <input type="hidden" name="color" value={color} />
      <ColorPicker value={color} onChange={setColor} aria-label={label} />
    </div>
  );
}
