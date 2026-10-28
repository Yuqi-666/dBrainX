// SPDX-License-Identifier: AGPL-3.0-only

"use client";
import { useI18n } from "@workspace/ui/lib/i18n";

import { useState } from "react";
import { cn } from "@workspace/ui/lib/utils";
import { useDataStore, useUIStore } from "@workspace/store";
import { useGraph } from "@workspace/hooks";
import { NodeService } from "@workspace/services";
import {
  AlignLeft,
  Clock,
  Database,
  FileText,
  Globe,
  History,
  LayoutGrid,
  LinkIcon,
  Plus,
  Tag,
  Type,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { EdgeData, NodeData, NodeTagId } from "@workspace/interfaces";
import { Input } from "@workspace/ui/components/ui/input";
import { Textarea } from "@workspace/ui/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@workspace/ui/components/ui/dropdown-menu";
import { Button } from "@workspace/ui/components/ui/button";
import { Popover, PopoverTrigger } from "@workspace/ui/components/ui/popover";
import { NodeTagSelector } from "@workspace/ui/components/selector/node-tag-selector";
import { TagPill } from "@workspace/ui/components/tag/tag-pill";
import { NodeSemanticSelector } from "@workspace/ui/components/selector/node-semantic-selector";
import { useNodeContentWriter } from "@workspace/ui/components/node-content/use-node-content-writer";

interface AttributesSidebarProps {
  className?: string;
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  useI18n();

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-all",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
        active
          ? "bg-background text-foreground shadow-sm ring-1 ring-border"
          : "text-muted-foreground hover:bg-muted/70 hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function FieldLabel({
  icon: Icon,
  children,
}: {
  icon: LucideIcon;
  children: React.ReactNode;
}) {
  useI18n();

  return (
    <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
      <Icon className="size-3.5 shrink-0" />
      {children}
    </span>
  );
}

export function AttributesSidebar({ className }: AttributesSidebarProps) {
  const { t } = useI18n();

  const [activeTab, setActiveTab] = useState<"metadata" | "relationships">(
    "metadata",
  );

  const currentEditingNodeId = useUIStore(
    (state) => state.currentEditingNodeId,
  );
  const nodes = useDataStore((state) => state.nodes);
  const edges = useDataStore((state) => state.edges);

  const currentNode = currentEditingNodeId
    ? nodes.get(currentEditingNodeId)
    : null;

  if (!currentEditingNodeId || !currentNode) return null;

  const nodeEdges = Array.from(edges.values()).filter(
    (edge: EdgeData) =>
      edge.from === currentEditingNodeId || edge.to === currentEditingNodeId,
  );

  return (
    <div
      className={cn(
        "flex flex-col h-full bg-popover border rounded-sm",
        className,
      )}
    >
      <div className="flex items-center px-3 py-2 border-b">
        <div className="flex items-center gap-0.5 rounded-lg bg-muted p-0.5">
          <TabButton
            active={activeTab === "metadata"}
            onClick={() => setActiveTab("metadata")}
          >
            <FileText className="size-3.5" />
            {t("元数据")}{" "}
          </TabButton>
          <TabButton
            active={activeTab === "relationships"}
            onClick={() => setActiveTab("relationships")}
          >
            <LinkIcon className="size-3.5" />
            {t("关联")}{" "}
            {nodeEdges.length > 0 && (
              <span className="ml-0.5 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium leading-none text-muted-foreground tabular-nums">
                {nodeEdges.length}
              </span>
            )}
          </TabButton>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {activeTab === "metadata" ? (
          <MetadataTabContent
            node={currentNode}
            nodeId={currentEditingNodeId}
          />
        ) : (
          <RelationshipsTabContent
            edges={nodeEdges}
            currentNodeId={currentEditingNodeId}
          />
        )}
      </div>
    </div>
  );
}

function MetadataTabContent({
  node,
  nodeId,
}: {
  node: NodeData;
  nodeId: string;
}) {
  const { t } = useI18n();

  const nodeSemanticsMap = useDataStore((state) => state.nodeSemantics);
  const allSemantics = Array.from(nodeSemanticsMap.values());

  const handleAbstractChange = (value: string) => {
    void NodeService.upsert(nodeId, { abstract: value }, { debounce: true });
  };

  const handleSemanticIdChange = (value: string) => {
    void NodeService.upsert(nodeId, { semanticId: value }, { debounce: true });
  };

  const nodeTagsMap = useDataStore((state) => state.nodeTags);
  const allTags = Array.from(nodeTagsMap.values());

  const [tagPopoverOpen, setTagPopoverOpen] = useState(false);
  const { onCreateTag, onDeleteTag } = useGraph();

  const selectedSemantic = node.semanticId
    ? allSemantics.find((s) => s.id === node.semanticId)
    : undefined;

  const handleToggleTag = (tagId: NodeTagId) => {
    const currentTags = node.tags || [];
    if (currentTags.includes(tagId)) {
      void NodeService.upsert(
        nodeId,
        { tags: currentTags.filter((t) => t !== tagId) },
        { debounce: true },
      );
    } else {
      void NodeService.upsert(
        nodeId,
        { tags: [...currentTags, tagId] },
        { debounce: true },
      );
    }
  };

  const handleDeleteTag = (tagId: NodeTagId) => {
    const currentTags = node.tags || [];
    void NodeService.upsert(
      nodeId,
      { tags: currentTags.filter((t) => t !== tagId) },
      { debounce: true },
    );
  };

  /**
   * Content writes go through the shared writer: it merges each patch into the
   * **live** `content` and serializes the upserts. Building a whole `content`
   * object here from this render's `node.content` snapshot (the old behaviour)
   * wiped every sibling half — `annotations`, a video's `timestamps` — on a
   * single 内容链接 edit.
   */
  const { liveContent, patchContent } = useNodeContentWriter<
    Record<string, unknown>
  >(nodeId, node.nodeType, node.content as unknown as Record<string, unknown>);

  const handleContentUrlChange = (field: string, value: string) => {
    patchContent({ [field]: value } as Record<string, unknown>);
  };

  const handleCollectionTypeChange = (value: string) => {
    if (node.nodeType !== "collection") return;
    const newCollectionType = value as "ordered" | "unordered" | "cards";
    // The filter config is its own half of `content`, so read the live value and
    // merge into it rather than replacing it with this render's copy.
    const current = liveContent();
    patchContent({
      filterConfig: {
        ...(current.filterConfig as Record<string, unknown>),
        collectionType: newCollectionType,
      },
    });
  };

  // Helper to get content url based on node type. A webpage node references its
  // stored document the same way a PDF node does.
  const getContentUrl = () => {
    if (!node.content) return "";
    switch (node.nodeType) {
      case "video":
      case "audio":
      case "image":
      case "pdf":
      case "webpage":
        return (node.content as { url?: string }).url || "";
      case "website":
        return (node.content as { url?: string }).url || "";
      default:
        return "";
    }
  };

  const getContentUrlField = () => {
    switch (node.nodeType) {
      case "video":
      case "audio":
      case "image":
      case "pdf":
      case "webpage":
      case "website":
        return "url";
      default:
        return "";
    }
  };

  const showContentUrl =
    node.nodeType === "video" ||
    node.nodeType === "audio" ||
    node.nodeType === "image" ||
    node.nodeType === "pdf" ||
    node.nodeType === "webpage" ||
    node.nodeType === "website";

  const showFaviconUrl = node.nodeType === "website";

  const showCollectionType = node.nodeType === "collection";

  return (
    <div className="space-y-4 text-sm">
      {/* Read-only: Title header */}
      <div className="flex items-center gap-2.5 rounded-lg border bg-muted/40 p-3">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
          <FileText className="size-4" />
        </div>
        <div className="flex min-w-0 flex-1 items-center">
          <h3 className="truncate text-sm font-semibold leading-snug">
            {node.title || t("未命名")}
          </h3>
        </div>
      </div>

      {/* Editable: Semantic type */}
      <div className="space-y-1.5">
        <FieldLabel icon={Type}>{t("类型")}</FieldLabel>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="h-8 w-full justify-start gap-2 px-2.5 text-xs font-normal"
            >
              {selectedSemantic ? (
                <span className="flex min-w-0 items-center gap-2">
                  {selectedSemantic.color && (
                    <span
                      className="size-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: selectedSemantic.color }}
                    />
                  )}
                  <span className="truncate font-medium text-foreground">
                    {selectedSemantic.name}
                  </span>
                </span>
              ) : (
                <span className="text-muted-foreground">
                  {t("选择语义标签")}
                </span>
              )}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <NodeSemanticSelector onSelect={handleSemanticIdChange} />
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Editable: Tags */}
      <div className="space-y-1.5">
        <FieldLabel icon={Tag}>{t("标签")}</FieldLabel>
        {node.tags && node.tags.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {node.tags.map((tagId) => {
              const tag = allTags.find((t) => t.id === tagId);
              return (
                <TagPill
                  key={tagId}
                  tag={tag}
                  tagId={tagId}
                  onRemove={() => handleDeleteTag(tagId)}
                />
              );
            })}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">{t("暂无标签")}</p>
        )}
        <Popover open={tagPopoverOpen} onOpenChange={setTagPopoverOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="h-8 w-full justify-start gap-1.5 px-2.5 text-xs font-normal text-muted-foreground hover:text-foreground"
            >
              <Plus className="size-3.5" />
              {t("添加标签")}{" "}
            </Button>
          </PopoverTrigger>
          <NodeTagSelector
            appliedTagIds={node.tags || []}
            onToggleTag={handleToggleTag}
            onDeleteTag={onDeleteTag}
            onCreateTag={onCreateTag}
          />
        </Popover>
      </div>

      {/* Editable: Abstract */}
      <div className="space-y-1.5">
        <FieldLabel icon={AlignLeft}>{t("摘要")}</FieldLabel>
        <Textarea
          value={node.abstract || ""}
          onChange={(e) => handleAbstractChange(e.target.value)}
          placeholder={t("输入摘要...")}
          className="min-h-24 resize-none text-xs leading-relaxed"
        />
      </div>

      {/* Editable: Content URL (for relevant node types) */}
      {showContentUrl && (
        <div className="space-y-1.5">
          <FieldLabel icon={LinkIcon}>{t("内容链接")}</FieldLabel>
          <Input
            value={getContentUrl()}
            onChange={(e) =>
              handleContentUrlChange(getContentUrlField(), e.target.value)
            }
            placeholder={
              node.nodeType === "website"
                ? t("输入网站地址...")
                : t("输入内容URL...")
            }
            className="h-8 text-xs"
          />
        </div>
      )}

      {/* Editable: Favicon URL (website only) */}
      {showFaviconUrl && (
        <div className="space-y-1.5">
          <FieldLabel icon={Globe}>{t("网站图标")}</FieldLabel>
          <Input
            value={(node.content as { faviconUrl?: string })?.faviconUrl || ""}
            onChange={(e) =>
              handleContentUrlChange("faviconUrl", e.target.value)
            }
            placeholder={t("输入网站图标URL...")}
            className="h-8 text-xs"
          />
        </div>
      )}

      {/* Editable: Collection Type (collection only) */}
      {showCollectionType && (
        <div className="space-y-1.5">
          <FieldLabel icon={LayoutGrid}>{t("集合类型")}</FieldLabel>
          <Select
            value={
              (node as { collectionType?: string }).collectionType ||
              "unordered"
            }
            onValueChange={handleCollectionTypeChange}
          >
            <SelectTrigger className="h-8 text-xs">
              <SelectValue placeholder={t("选择集合类型")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ordered">{t("有序")}</SelectItem>
              <SelectItem value="unordered">{t("无序")}</SelectItem>
              <SelectItem value="cards">{t("卡片")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Read-only: Metadata footer */}
      <div className="space-y-2.5 border-t border-border pt-4">
        <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground/70">
          {t("属性")}{" "}
        </p>
        <div className="flex items-center justify-between gap-3">
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Database className="size-3.5 shrink-0" />
            {t("数据类型")}{" "}
          </span>
          <span className="rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-medium">
            {node.nodeType}
          </span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Clock className="size-3.5 shrink-0" />
            {t("创建时间")}{" "}
          </span>
          <span className="truncate text-xs font-medium">
            {node.createdAt || t("未知")}
          </span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <History className="size-3.5 shrink-0" />
            {t("更新时间")}{" "}
          </span>
          <span className="truncate text-xs font-medium">
            {node.updatedAt || t("未知")}
          </span>
        </div>
      </div>
    </div>
  );
}

function RelationshipsTabContent({
  edges,
  currentNodeId,
}: {
  edges: any[];
  currentNodeId: string;
}) {
  const { t } = useI18n();

  const edgeSemantics = useDataStore((state) => state.edgeSemantics);
  const nodes = useDataStore((state) => state.nodes);
  const setCurrentEditingNodeId = useUIStore(
    (state) => state.setCurrentEditingNodeId,
  );

  if (edges.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
        <div className="flex size-10 items-center justify-center rounded-full bg-muted">
          <LinkIcon className="size-4 text-muted-foreground" />
        </div>
        <p className="text-sm text-muted-foreground">{t("暂无关联关系")}</p>
        <p className="text-xs text-muted-foreground/70">
          {t("当前节点还没有连接到其他节点")}{" "}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {edges.map((edge) => {
        const isSource = edge.from === currentNodeId;
        const otherNodeId = isSource ? edge.to : edge.from;
        const semantic = edge.semanticId
          ? edgeSemantics.get(edge.semanticId)
          : undefined;
        const otherNode = nodes.get(otherNodeId);
        return (
          <button
            key={edge.id}
            type="button"
            onClick={() => setCurrentEditingNodeId(otherNodeId)}
            className="flex w-full items-center gap-2.5 rounded-lg border bg-muted/40 p-2.5 text-left transition-colors hover:bg-muted/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
          >
            <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-background text-muted-foreground ring-1 ring-border">
              <LinkIcon className="size-3" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-medium">
                {otherNode?.title || t("未命名")}
              </p>
            </div>
            <span
              className={cn(
                "shrink-0 text-sm font-medium",
                isSource ? "text-primary" : "text-muted-foreground",
              )}
            >
              {isSource ? "→" : "←"}
            </span>
            <span className="shrink-0 rounded-full bg-background px-2 py-0.5 text-[11px] text-muted-foreground ring-1 ring-border">
              {semantic?.category || semantic?.name || t("关联")}
            </span>
          </button>
        );
      })}
    </div>
  );
}
