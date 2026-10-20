// SPDX-License-Identifier: AGPL-3.0-only

"use client";
import { useI18n } from "@workspace/ui/lib/i18n";

import { useCallback, useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/ui/dialog";
import { Button } from "@workspace/ui/components/ui/button";
import { Input } from "@workspace/ui/components/ui/input";
import { Label } from "@workspace/ui/components/ui/label";
import { toast } from "@workspace/ui/components/ui/toast";
import { useAuthStore, useUIStore } from "@workspace/store";
import { WorkspaceService } from "@workspace/services";
import type { NodeIcon, Workspace } from "@workspace/interfaces";
import { WORKSPACE_NAME_MAX_LENGTH } from "@workspace/utils/workspace";
import { IconSelectorPopover } from "@workspace/ui/components/selector/icon-selector-popover";
import { WorkspaceIcon } from "@workspace/ui/components/icon/workspace-icon";

/** Stable comparison key for "did the icon change?" — `null` means no icon. */
function iconKey(icon: NodeIcon | null | undefined): string | null {
  if (!icon) return null;
  return `${icon.kind}:${icon.value}:${icon.color ?? ""}`;
}

export interface WorkspaceFormValues {
  name: string;
  icon: NodeIcon | null;
}

export interface WorkspaceFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  /** Values the form starts from each time it opens. */
  initialName: string;
  initialIcon: NodeIcon | null;
  /**
   * Called with the trimmed name and the chosen icon. Throw to keep the dialog
   * open and show {@link errorMessage}.
   */
  onSubmit: (values: WorkspaceFormValues) => Promise<void>;
  submitLabel: string;
  submittingLabel: string;
  errorMessage: string;
  /**
   * Edit mode: the submit button stays disabled until the name or the icon
   * differs from {@link initialName} / {@link initialIcon}. The create dialog
   * leaves this off, because any non-empty name is a valid new workspace.
   */
  requireChange?: boolean;
  nameInputId: string;
  placeholder?: string;
}

/**
 * The name + icon form shared by the create and the edit workspace dialogs.
 *
 * Both dialogs are the same field set and the same submit/cancel footer; they
 * differ only in where the initial values come from, what the submit does, and
 * whether an unchanged form may be submitted. Keeping one form keeps the two
 * dialogs from drifting (the icon picker is configured once here).
 *
 * The icon picker only offers the emoji and named-icon tabs: a workspace has no
 * uploaded file of its own, so the `image` kind and the upload tab are hidden.
 */
export function WorkspaceFormDialog({
  open,
  onOpenChange,
  title,
  description,
  initialName,
  initialIcon,
  onSubmit,
  submitLabel,
  submittingLabel,
  errorMessage,
  requireChange = false,
  nameInputId,
  placeholder,
}: WorkspaceFormDialogProps) {
  const { t } = useI18n();

  const [name, setName] = useState(initialName);
  const [icon, setIcon] = useState<NodeIcon | null>(initialIcon);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Refill from the caller's initial values on every open, so a previous edit
  // never leaks into the next target. Both callers pass stable references: the
  // create dialog passes constants and the edit dialog reads them from the
  // workspace that the store replaces as a whole.
  useEffect(() => {
    if (!open) return;
    setName(initialName);
    setIcon(initialIcon);
    setSubmitting(false);
    setError(null);
  }, [open, initialName, initialIcon]);

  const trimmed = name.trim();
  const unchanged =
    trimmed === initialName.trim() && iconKey(icon) === iconKey(initialIcon);
  const canSubmit =
    trimmed !== "" && !submitting && (!requireChange || !unchanged);

  const submit = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!canSubmit) return;
      setSubmitting(true);
      setError(null);
      try {
        await onSubmit({ name: trimmed, icon });
        onOpenChange(false);
      } catch (err) {
        console.error("[WorkspaceFormDialog] Could not save workspace:", err);
        setError(errorMessage);
      } finally {
        setSubmitting(false);
      }
    },
    [canSubmit, trimmed, icon, onSubmit, onOpenChange, errorMessage],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>

          <div className="mt-4 flex items-start gap-3">
            <div className="grid gap-2">
              <Label>{t("图标")}</Label>
              <IconSelectorPopover
                allowedKinds={["emoji", "icon"]}
                showColorPicker={false}
                value={icon ?? undefined}
                onChange={(next) => {
                  setIcon(next ?? null);
                  if (error) setError(null);
                }}
                disabledReason={submitting ? t("保存中…") : undefined}
              >
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="size-10 rounded-lg"
                  aria-label={icon ? t("更换图标") : t("设置图标")}
                  disabled={submitting}
                >
                  <WorkspaceIcon
                    icon={icon}
                    className="size-5"
                    glyphClassName="size-5"
                  />
                </Button>
              </IconSelectorPopover>
            </div>
            <div className="grid min-w-0 flex-1 gap-2">
              <Label htmlFor={nameInputId}>{t("名称")}</Label>
              <Input
                id={nameInputId}
                name="name"
                autoFocus
                value={name}
                maxLength={WORKSPACE_NAME_MAX_LENGTH}
                placeholder={placeholder}
                disabled={submitting}
                onChange={(event) => {
                  setName(event.target.value);
                  if (error) setError(null);
                }}
              />
            </div>
          </div>
          {error && <p className="mt-2 text-xs text-destructive">{error}</p>}

          <DialogFooter className="mt-6">
            <Button
              type="button"
              variant="outline"
              disabled={submitting}
              onClick={() => onOpenChange(false)}
            >
              {t("取消")}
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {submitting ? submittingLabel : submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * 创建 workspace 的 dialog。
 *
 * 与 `NodeSemanticDialog` 同模式：开合状态读自 `useUIStore`，service 调用内联在
 * 本组件里，页面级挂载，任何入口只要调用 `openWorkspaceCreateDialog()` 即可打开。
 * 名称与图标由 `WorkspaceFormDialog` 提供，与编辑 dialog 共用同一套字段。
 */
export function CreateWorkspaceDialog() {
  const { t } = useI18n();
  const { open } = useUIStore((state) => state.workspaceCreateDialog);
  const closeDialog = useUIStore((state) => state.closeWorkspaceCreateDialog);

  /**
   * 创建 workspace 并立即打开它。
   * 服务端 `workspace.add` 需要客户端提供 id + ownerId，因此这里生成 `tmp_`
   * 前缀的 id（与其它 service 的创建约定一致），ownerId 取当前登录用户。
   * 图标随创建一起提交；未选择图标时 `null` 表示使用默认的地球图标。
   * 失败时向上抛出，由表单展示错误。
   */
  const handleSubmit = useCallback(
    async ({ name, icon }: WorkspaceFormValues) => {
      const ownerId = useAuthStore.getState().getUserId();
      if (!ownerId) {
        throw new Error("Cannot create workspace: no authenticated user");
      }

      const now = new Date().toISOString();
      const workspace: Workspace = {
        id: `tmp_${crypto.randomUUID()}`,
        name,
        icon,
        ownerId,
        createdAt: now,
        updatedAt: now,
      };

      const created = await WorkspaceService.upsert(workspace);
      const createdWorkspace = (created ?? workspace) as Workspace;
      // upsert 只写入 store；open() 才会按 workspace 拉取 views/nodes，
      // 并激活第一个视图，让新 workspace 立即可用。
      await WorkspaceService.open(createdWorkspace.id);
    },
    [],
  );

  return (
    <WorkspaceFormDialog
      open={open}
      onOpenChange={(o) => !o && closeDialog()}
      title={t("创建新工作区")}
      description={t("工作区用于隔离你的节点、视图与语义配置。")}
      initialName=""
      initialIcon={null}
      onSubmit={handleSubmit}
      submitLabel={t("创建")}
      submittingLabel={t("创建中…")}
      errorMessage={t("创建失败，请稍后重试")}
      nameInputId="workspace-name"
      placeholder={t("例如：我的知识库")}
    />
  );
}

/**
 * Edit one workspace: its name and its picker icon.
 *
 * The service updates the store optimistically, so the selector label and icon
 * change before this dialog closes. Closing without confirming leaves the
 * workspace untouched. The input limit comes from the shared constant, the same
 * one the domain entity validates, so a name the dialog accepts is never
 * rejected later.
 */
export function EditWorkspaceDialog({
  workspace,
  onClose,
}: {
  /** The workspace being edited; `null` keeps the dialog closed. */
  workspace: Workspace | null;
  onClose: () => void;
}) {
  const { t } = useI18n();

  const submit = useCallback(
    async ({ name, icon }: WorkspaceFormValues) => {
      if (!workspace) return;
      await WorkspaceService.upsert(workspace.id, { name, icon });
      toast({ title: t("已更新工作区"), description: name });
    },
    [workspace, t],
  );

  return (
    <WorkspaceFormDialog
      open={workspace !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={t("编辑工作区")}
      description={t("修改工作区的名称和图标。")}
      initialName={workspace?.name ?? ""}
      initialIcon={workspace?.icon ?? null}
      onSubmit={submit}
      submitLabel={t("保存")}
      submittingLabel={t("保存中…")}
      errorMessage={t("更新工作区失败，请稍后重试。")}
      requireChange
      nameInputId="workspace-edit-name"
    />
  );
}

/**
 * Delete one non-default workspace after an explicit confirmation.
 *
 * The dialog names the workspace and lists what the cascade removes, so nobody
 * removes a workspace by accident. Uploaded resource-library files are not part
 * of the workspace cascade and stay in the library; the copy says so. The
 * selector hides this entry for the default workspace, and the service refuses
 * that case too. After the server confirms the delete, the service switches to
 * another workspace when the deleted one was open.
 */
export function DeleteWorkspaceDialog({
  workspace,
  onClose,
}: {
  /** The workspace being deleted; `null` keeps the dialog closed. */
  workspace: Workspace | null;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [deleting, setDeleting] = useState(false);

  // A new target restarts the dialog: a failed delete must not keep the spinner
  // or the error from the previous attempt.
  useEffect(() => {
    if (!workspace) return;
    setDeleting(false);
  }, [workspace]);

  const confirm = async () => {
    if (!workspace || deleting) return;
    setDeleting(true);
    try {
      await WorkspaceService.delete(workspace.id);
      toast({ title: t("已删除工作区"), description: workspace.name });
      onClose();
    } catch (err) {
      console.error("[DeleteWorkspaceDialog] Could not delete workspace:", err);
      toast({
        title: t("删除工作区失败，请稍后重试。"),
        variant: "destructive",
      });
      setDeleting(false);
    }
  };

  return (
    <Dialog
      open={workspace !== null}
      onOpenChange={(open) => {
        if (!open && !deleting) onClose();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("删除工作区")}</DialogTitle>
          <DialogDescription>
            {t(
              "确定删除“{value1}”？工作区中的节点、关系、视图、语义和 Dashboard 页面会一并删除，且无法撤销。",
              { value1: workspace?.name ?? "" },
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="mt-2 grid gap-3 text-sm">
          <p className="text-muted-foreground">
            {t("资源库中已上传的文件不会被删除。")}
          </p>
        </div>

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
            disabled={deleting}
            onClick={() => void confirm()}
          >
            {deleting ? t("删除中…") : t("删除")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
