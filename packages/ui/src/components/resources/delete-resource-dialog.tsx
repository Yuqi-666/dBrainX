// SPDX-License-Identifier: AGPL-3.0-only

"use client";
import { useI18n } from "@workspace/ui/lib/i18n";

import { useEffect, useState } from "react";
import {
  deleteResource,
  type NodeFileReference,
  type ResourceRecord,
} from "@workspace/api-client";
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
import { toast } from "@workspace/ui/components/ui/toast";

/**
 * Deletes one stored file.
 *
 * This is the only place that frees storage: removing a node that references
 * the file leaves the blob in place, and the dialog says so.
 *
 * The dialog also names the nodes that still point at the file, so the user
 * knows exactly what will stop loading it. `NodeService.listNodesReferencingFile`
 * unions the open store with the database: the store holds the nodes the user
 * is looking at (and, on desktop, the only ones PocketBase knows), the database
 * adds the nodes in other workspaces. The delete stays enabled even when no node
 * is found, because the list is advisory. After the record is gone,
 * `detachFileReferences` clears the open nodes as well, or the graph would keep
 * the stale address until a reload.
 */
export function DeleteResourceDialog({
  resource,
  onClose,
  onDeleted,
}: {
  /** The resource being deleted; `null` keeps the dialog closed. */
  resource: ResourceRecord | null;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const { t } = useI18n();
  const [deleting, setDeleting] = useState(false);
  const [references, setReferences] = useState<NodeFileReference[] | null>(
    null,
  );
  const [loadingReferences, setLoadingReferences] = useState(false);

  // Reset for the next target, then load the nodes that point at its file. A
  // late answer for a resource the user has already closed is dropped.
  useEffect(() => {
    if (!resource) return;
    let cancelled = false;
    setDeleting(false);
    setReferences(null);
    setLoadingReferences(true);
    void NodeService.listNodesReferencingFile(resource.storedUrl)
      .then((nodes) => {
        if (!cancelled) setReferences(nodes);
      })
      .catch(() => {
        // A failed lookup must not block a deletion the user already confirmed:
        // the list is advisory and the server hook still clears the references.
        if (!cancelled) setReferences([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingReferences(false);
      });
    return () => {
      cancelled = true;
    };
  }, [resource]);

  const referencesReady = !loadingReferences && references !== null;

  const confirm = async () => {
    if (!resource || deleting || !referencesReady) return;
    setDeleting(true);
    try {
      await deleteResource(resource.id);
    } catch {
      setDeleting(false);
      toast({
        title: t("删除失败，请稍后重试。"),
        variant: "destructive",
      });
      return;
    }
    try {
      // The record is already gone; a failure to refresh the open nodes only
      // leaves them stale until the next sync, so it must not read as a failed
      // delete.
      await NodeService.detachFileReferences([resource.id]);
    } catch (error) {
      console.error(
        `[DeleteResourceDialog] Could not detach the deleted file from its nodes.`,
        error,
      );
    }
    toast({ title: t("已删除"), description: resource.name });
    onDeleted();
    onClose();
  };

  return (
    <Dialog
      open={resource !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("删除资源")}</DialogTitle>
          <DialogDescription>
            {resource
              ? t("确定删除“{value1}”？此操作无法撤销。", {
                  value1: resource.name,
                })
              : null}
          </DialogDescription>
        </DialogHeader>

        {loadingReferences ? (
          <p role="status" className="mt-4 text-xs text-muted-foreground">
            {t("正在查找引用此资源的节点…")}
          </p>
        ) : references && references.length > 0 ? (
          // Capped height: a widely referenced file keeps the dialog short.
          <div className="mt-4">
            <h3 className="text-sm font-medium">{t("此资源关联以下节点")}</h3>
            <ul className="mt-2 max-h-48 divide-y divide-border/60 overflow-y-auto rounded-lg border bg-muted/20">
              {references.map((node) => {
                const title = node.title || t("未命名节点");
                return (
                  <li key={node.id} className="min-w-0 px-3 py-2">
                    <span title={title} className="block truncate text-sm">
                      {title}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}

        <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
          {t(
            "引用这个文件的节点会失去该链接（显示为空）。删除节点不会释放存储；只有在这里删除才会释放。",
          )}
        </p>

        <DialogFooter className="mt-6">
          <Button
            type="button"
            variant="outline"
            disabled={deleting}
            onClick={onClose}
          >
            {t("取消")}
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={resource === null || deleting || !referencesReady}
            onClick={() => void confirm()}
          >
            {deleting ? t("删除中…") : t("删除")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
