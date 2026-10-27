// SPDX-License-Identifier: AGPL-3.0-only

"use client";
import { useI18n } from "@workspace/ui/lib/i18n";

import { useEffect, useRef, useState } from "react";
import type { NodeData } from "@workspace/interfaces";
import { useDataStore, useUIStore } from "@workspace/store";
import { NodeService } from "@workspace/services";
import { Button } from "@workspace/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/ui/dialog";
import { ScrollArea } from "@workspace/ui/components/ui/scroll-area";
import { toast } from "@workspace/ui/components/ui/toast";
// Relative rather than the `@workspace/ui/components/resources/*` alias: the
// package's `./components/*` export appends `.tsx`, and `format-bytes` is a
// plain `.ts` module the bundler would not find through the alias.
import { CategoryIcon, categoryLabel } from "../resources/resource-category";
import { formatBytes } from "../resources/format-bytes";
import { cn } from "@workspace/ui/lib/utils";
import {
  applyNodeClear,
  applyNodeDelete,
  deleteNodeResources,
  listNodeDispositionResources,
  type NodeDispositionMode,
  type NodeDispositionResource,
} from "@workspace/ui/lib/node-disposition";
import { AlertTriangleIcon } from "lucide-react";

/**
 * 「删除节点 / 清空节点」的确认对话框，两种入口（图的右键菜单、编辑页的选项
 * 菜单）共用。
 *
 * 它只在节点引用了已上传资源时打开（`node-disposition.ts` 的 `request*` 决定），
 * 因为那时用户还面临第二个选择：上传的文件要不要一起删。节点本身是否保留由
 * 打开时的 `mode` 决定，与文件选择互不影响：
 *
 * - `mode === "delete"`：`NodeService.delete`；
 * - `mode === "clear"`：`NodeService.upsert(clearedNodeUpdates(node))`。
 *
 * 打开时按 `fileRecordIdsInNode(node)` 从资源库取回这些文件（`listResourcesByIds`，
 * 派生文件不列出——它们随源文件一起消失，单独删会重复删同一批字节），再逐个问
 * `NodeService.listNodesReferencingFile` 哪些**其他**节点也引用它，对话框据此警告
 * 「那些节点的链接也会被清空」。关闭时由 `finally` 统一收尾。
 */
export function NodeDispositionDialog() {
  const { open, mode, nodeId } = useUIStore(
    (state) => state.nodeDispositionDialog,
  );
  const closeDialog = useUIStore((state) => state.closeNodeDispositionDialog);
  const liveNode = useDataStore((state) =>
    nodeId ? state.getNode(nodeId) : undefined,
  );

  // Keep the last live copy of the target so the dialog does not unmount the
  // instant the user confirms a delete (the node leaves the store before the
  // files are deleted). The dialog is closed by its own `finally`, not by the
  // node disappearing; a node deleted from somewhere else still lets the
  // confirm fail into the error toast instead of closing silently.
  const snapshot = useRef<NodeData | null>(null);
  useEffect(() => {
    if (liveNode) snapshot.current = liveNode;
  }, [liveNode]);

  const node =
    liveNode ??
    (nodeId !== null && snapshot.current?.id === nodeId
      ? snapshot.current
      : undefined);

  if (!open || !node) return null;

  // A fresh child per (mode, node) pair: its resource list, radio choice and
  // busy flag are mounted with the question and dropped with it, so reopening
  // the dialog can never show the previous question's answer.
  return (
    <NodeDispositionDialogContent
      key={`${mode}:${node.id}`}
      node={node}
      mode={mode}
      onClose={closeDialog}
    />
  );
}

interface NodeDispositionDialogContentProps {
  node: NodeData;
  mode: NodeDispositionMode;
  onClose: () => void;
}

function NodeDispositionDialogContent({
  node,
  mode,
  onClose,
}: NodeDispositionDialogContentProps) {
  const { t } = useI18n();

  /** Referenced files; `null` while the query is in flight. */
  const [resources, setResources] = useState<NodeDispositionResource[] | null>(
    null,
  );
  /** Whether the user chose to delete the uploaded files too. Safe default. */
  const [deleteFiles, setDeleteFiles] = useState(false);
  const [busy, setBusy] = useState(false);

  /**
   * Load the files once per opening, from the node as it is when the dialog
   * mounts. Deliberately keyed on `node.id`, not the node object: the dialog
   * stays open while the store updates (a debounced title write) and must not
   * reload or reshuffle its list on every keystroke.
   */
  useEffect(() => {
    const target = useDataStore.getState().nodes.get(node.id);
    if (!target) {
      setResources([]);
      return;
    }
    let cancelled = false;
    void listNodeDispositionResources(target)
      .then((loaded) => {
        if (!cancelled) setResources(loaded);
      })
      .catch((error) => {
        console.error(
          "[NodeDispositionDialog] Could not load the referenced resources.",
          error,
        );
        // An unreadable list must not block the node action: show an empty list
        // and let the user dispose of the node alone.
        if (!cancelled) setResources([]);
      });
    return () => {
      cancelled = true;
    };
  }, [node.id]);

  const nodeTitle = node.title || t("未命名节点");
  const loaded = resources ?? [];
  const otherResourceCount = loaded.filter(
    (item) => item.otherNodeIds.length > 0,
  ).length;
  const loading = resources === null;

  const modeTitle = mode === "delete" ? t("删除节点") : t("清空节点");
  const confirmLabel =
    mode === "delete"
      ? busy
        ? t("删除中…")
        : t("删除")
      : busy
        ? t("清空中…")
        : t("清空");

  const confirm = async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (mode === "delete") {
        await applyNodeDelete(node.id);
      } else {
        const cleared = await applyNodeClear(node);
        if (!cleared) return;
      }

      const chosen = loaded.map((item) => item.resource);
      if (deleteFiles && chosen.length > 0) {
        const { deletedIds, failed } = await deleteNodeResources(chosen);
        if (deletedIds.length > 0) {
          // One sweep for every deleted file: a node that referenced two of
          // them is updated once, and the nodes of other workspaces are left to
          // the server hook (they are not in this store).
          await NodeService.detachFileReferences(deletedIds);
        }
        if (failed.length > 0) {
          toast({
            title: t("部分资源删除失败，请稍后重试。"),
            description: failed.map((item) => item.name).join("、"),
            variant: "destructive",
          });
          return;
        }
      }

      toast({ title: mode === "delete" ? t("已删除") : t("节点已清空") });
    } catch (error) {
      console.error(
        "[NodeDispositionDialog] Could not finish the node disposition.",
        error,
      );
      toast({
        title:
          mode === "delete"
            ? t("删除失败，请稍后重试。")
            : t("清空失败，请稍后重试。"),
        variant: "destructive",
      });
    } finally {
      setBusy(false);
      onClose();
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next && !busy) onClose();
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{modeTitle}</DialogTitle>
          <DialogDescription>
            {mode === "delete"
              ? t("确定删除“{value1}”？此操作无法撤销。", {
                  value1: nodeTitle,
                })
              : t("确定清空“{value1}”？此操作无法撤销。", {
                  value1: nodeTitle,
                })}
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <p className="text-sm text-muted-foreground">{t("正在加载资源…")}</p>
        ) : loaded.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t("没有找到引用的已上传资源。")}
          </p>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              {t("这个节点引用了以下已上传资源：")}
            </p>
            <ScrollArea className="max-h-48 rounded-md border">
              <ul className="divide-y">
                {loaded.map(({ resource }) => {
                  const name = resource.name || t("未命名文件");
                  return (
                    <li
                      key={resource.id}
                      className="flex items-center gap-3 px-3 py-2"
                    >
                      {resource.category === "image" && resource.url ? (
                        <img
                          src={resource.url}
                          alt=""
                          loading="lazy"
                          className="size-8 shrink-0 rounded object-cover"
                        />
                      ) : (
                        <CategoryIcon
                          category={resource.category}
                          className="size-8 shrink-0 text-muted-foreground"
                        />
                      )}
                      <span
                        className="min-w-0 flex-1 truncate text-sm"
                        title={name}
                      >
                        {name}
                      </span>
                      <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                        {categoryLabel(resource.category, t)} ·{" "}
                        {formatBytes(resource.fileSize)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </ScrollArea>

            {otherResourceCount > 0 && (
              <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0" />
                <span>
                  {t(
                    "其中 {value1} 个资源还被其他节点引用，那些节点里的链接会一并清空。",
                    { value1: otherResourceCount },
                  )}
                </span>
              </div>
            )}

            <div
              role="radiogroup"
              aria-label={modeTitle}
              className="flex flex-col gap-2"
            >
              <DispositionChoice
                selected={!deleteFiles}
                onSelect={() => setDeleteFiles(false)}
                title={mode === "delete" ? t("仅删除节点") : t("仅清空节点")}
                description={t("保留已上传的文件，之后仍可在资源库中使用。")}
              />
              <DispositionChoice
                selected={deleteFiles}
                onSelect={() => setDeleteFiles(true)}
                title={t("同时删除已上传资源")}
                description={t("文件会从资源库和存储中删除，无法恢复。")}
                destructive
              />
            </div>
          </>
        )}

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={onClose}
          >
            {t("取消")}
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={busy || loading}
            onClick={() => void confirm()}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * One radio-style choice. A real `<input type="radio">` would need its own
 * styling to match the dialog, so the control is a button that carries the
 * radio role and state; keyboard users still reach it with Tab and activate it
 * with Enter/Space.
 */
function DispositionChoice({
  selected,
  onSelect,
  title,
  description,
  destructive = false,
}: {
  selected: boolean;
  onSelect: () => void;
  title: string;
  description: string;
  destructive?: boolean;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={cn(
        "flex w-full items-start gap-3 rounded-md border px-3 py-2 text-left transition-colors",
        selected ? "bg-muted/60" : "hover:bg-muted/40",
        selected && destructive && "border-destructive/40",
        selected && !destructive && "border-foreground/30",
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border",
          selected && (destructive ? "border-destructive" : "border-primary"),
        )}
      >
        {selected && (
          <span
            className={cn(
              "size-2 rounded-full",
              destructive ? "bg-destructive" : "bg-primary",
            )}
          />
        )}
      </span>
      <span className="min-w-0">
        <span
          className={cn(
            "block text-sm font-medium",
            destructive && "text-destructive",
          )}
        >
          {title}
        </span>
        <span className="block text-xs text-muted-foreground">
          {description}
        </span>
      </span>
    </button>
  );
}
