// SPDX-License-Identifier: AGPL-3.0-only

"use client";
import { useI18n } from "@workspace/ui/lib/i18n";

import { useEffect, useState } from "react";
import { renameResource, type ResourceRecord } from "@workspace/api-client";
import { Button } from "@workspace/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/ui/dialog";
import { Input } from "@workspace/ui/components/ui/input";
import { Label } from "@workspace/ui/components/ui/label";
import { toast } from "@workspace/ui/components/ui/toast";

/**
 * Renames one resource's display label. Closing the dialog without confirming
 * leaves the record untouched; the stored blob and its URLs never change.
 */
export function RenameResourceDialog({
  resource,
  onClose,
  onRenamed,
}: {
  /** The resource being renamed; `null` keeps the dialog closed. */
  resource: ResourceRecord | null;
  onClose: () => void;
  onRenamed: () => void;
}) {
  const { t } = useI18n();
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);

  // Refill from the target each time the dialog opens, so a previous edit never
  // leaks into the next resource.
  useEffect(() => {
    if (!resource) return;
    setName(resource.name);
    setSaving(false);
  }, [resource]);

  const trimmed = name.trim();
  const unchanged = resource !== null && trimmed === resource.name.trim();
  const canSubmit =
    resource !== null && trimmed !== "" && !unchanged && !saving;

  const submit = async () => {
    if (!resource || !canSubmit) return;
    setSaving(true);
    try {
      await renameResource(resource.id, trimmed);
      toast({ title: t("已重命名"), description: trimmed });
      onRenamed();
      onClose();
    } catch {
      setSaving(false);
      toast({
        title: t("重命名失败，请稍后重试。"),
        variant: "destructive",
      });
    }
  };

  return (
    <Dialog
      open={resource !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="sm:max-w-sm">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <DialogHeader>
            <DialogTitle>{t("重命名资源")}</DialogTitle>
            <DialogDescription>
              {t("给这个文件一个更好认的名字，文件本身不会改变。")}
            </DialogDescription>
          </DialogHeader>
          <div className="mt-4 grid gap-2">
            <Label htmlFor="resource-rename-input">{t("资源名称")}</Label>
            <Input
              id="resource-rename-input"
              autoFocus
              maxLength={120}
              value={name}
              disabled={saving}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <DialogFooter className="mt-6">
            <Button
              type="button"
              variant="outline"
              disabled={saving}
              onClick={onClose}
            >
              {t("取消")}
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {saving ? t("保存中…") : t("保存")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
