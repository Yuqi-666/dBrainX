// SPDX-License-Identifier: AGPL-3.0-only

"use client";
import { translate } from "@workspace/ui/lib/i18n/runtime";
import { useI18n } from "@workspace/ui/lib/i18n";

import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { ImagePlusIcon } from "lucide-react";
import type { NodeCover, NodeData } from "@workspace/interfaces";
import { resolveFileUrl } from "@workspace/api-client";
import { Button } from "@workspace/ui/components/ui/button";
import {
  CommandEmpty,
  CommandItem,
  CommandList,
} from "@workspace/ui/components/ui/command";
import { NodePreviewCover } from "@workspace/ui/components/preview-block/node-preview-cover";
import { SelectorUploadPane } from "@workspace/ui/components/selector/shared/selector-upload-pane";
import {
  SelectorPopoverShell,
  type SelectorPopoverTab,
} from "@workspace/ui/components/selector/shared/selector-popover-shell";
import { SelectorSearchInput } from "@workspace/ui/components/selector/shared/selector-search-input";
import { SelectorUrlInput } from "@workspace/ui/components/selector/shared/selector-url-input";
import { cn } from "@workspace/ui/lib/utils";

const COVER_TABS: SelectorPopoverTab[] = [
  {
    value: "upload",
    get label() {
      return translate("上传");
    },
  },
  {
    value: "node",
    get label() {
      return translate("从节点选");
    },
  },
];

export interface CoverSelectorPopoverProps {
  nodeId: string;
  value?: NodeCover;
  onChange: (next: NodeCover | undefined) => void;
  onRemove?: () => void;
  disabledReason?: string;
  /**
   * 「从节点选」的数据源，由宿主注入（同 dataview 的 `resolveNode` 约定：渲染器
   * 需要节点就向宿主索取）。不传时该 tab 只有空态。
   */
  listNodes?: (query: string) => NodeData[] | Promise<NodeData[]>;
  /** 触发按钮文案，默认「添加封面」/「更换封面」；传 `children` 时忽略。 */
  label?: string;
  children?: ReactNode;
  className?: string;
}

export function CoverSelectorPopover({
  nodeId,
  value,
  onChange,
  onRemove,
  disabledReason,
  listNodes,
  label,
  children,
  className,
}: CoverSelectorPopoverProps) {
  const { t } = useI18n();

  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState("upload");
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<NodeData[]>([]);

  useEffect(() => {
    if (!open || tab !== "node" || !listNodes) return;
    let cancelled = false;
    void Promise.resolve(listNodes(""))
      .then((nodes) => {
        if (!cancelled) setCandidates(nodes);
      })
      .catch(() => {
        if (!cancelled) setCandidates([]);
      });
    return () => {
      cancelled = true;
    };
  }, [open, tab, listNodes]);

  // sel §6.4: 移除只清顶层 `cover`，不碰 `content.coverUrl`（pdf / video 因此回落
  // 到机器产出的封面）。宿主没给 `onRemove` 时退化成 `onChange(undefined)`。
  const clear = () => {
    if (onRemove) onRemove();
    else onChange(undefined);
  };

  const defaultTrigger = (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className={cn("gap-1", className)}
      aria-label={value ? t("更换封面") : t("添加封面")}
    >
      <ImagePlusIcon className="size-4" />
      {value ? t("更换封面") : (label ?? t("添加封面"))}
    </Button>
  );

  if (disabledReason) {
    return (
      <span
        className={cn("inline-flex opacity-50", className)}
        title={disabledReason}
        aria-disabled
      >
        {children ?? defaultTrigger}
      </span>
    );
  }

  const previewBox =
    value?.kind === "image" ? (
      <div className="aspect-video w-full overflow-hidden rounded-md bg-muted">
        <img
          src={resolveFileUrl(value.url)}
          alt=""
          draggable={false}
          className="size-full object-cover"
        />
      </div>
    ) : null;

  return (
    <SelectorPopoverShell
      open={open}
      onOpenChange={setOpen}
      trigger={children ?? defaultTrigger}
      tabs={COVER_TABS}
      activeTab={tab}
      onTabChange={setTab}
      width={420}
      bodyMaxHeight="min(360px, 52vh)"
      actions={
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label={t("移除封面")}
          disabled={!value}
          onClick={clear}
        >
          {t("移除")}{" "}
        </Button>
      }
    >
      {tab === "upload" ? (
        <div className="flex flex-col gap-1">
          {previewBox}
          <SelectorUploadPane
            nodeId={nodeId}
            variant="cover"
            accept="image/*"
            onUploadStart={() => setError(null)}
            onError={(uploadError) => setError(uploadError.message)}
          />
          {/* sel §6.1 的错误条：不写库、不清空已有值。 */}
          {error ? (
            <p className="px-1 text-xs text-destructive">{error}</p>
          ) : null}
          <SelectorUrlInput
            value={url}
            onValueChange={setUrl}
            onSubmit={(next) => {
              onChange({ kind: "image", url: next });
              setUrl("");
            }}
            placeholder={t("Or add via URL")}
          />
        </div>
      ) : null}

      {tab === "node" ? (
        <>
          <SelectorSearchInput placeholder={t("Click to filter…")} autoFocus />
          <CommandList>
            {candidates.map((candidate) => (
              <CommandItem
                key={candidate.id}
                value={`${candidate.title} ${candidate.nodeType}`}
                onSelect={() =>
                  onChange({ kind: "node", nodeId: candidate.id })
                }
                className="flex items-center gap-2"
              >
                <span className="size-8 shrink-0 overflow-hidden rounded border border-border/60">
                  <NodePreviewCover node={candidate} className="size-full" />
                </span>
                <span className="truncate text-sm">{candidate.title}</span>
              </CommandItem>
            ))}
            <CommandEmpty>{t("没有可选节点")}</CommandEmpty>
          </CommandList>
        </>
      ) : null}
    </SelectorPopoverShell>
  );
}
