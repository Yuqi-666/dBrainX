// SPDX-License-Identifier: AGPL-3.0-only

"use client";
import { useI18n } from "@workspace/ui/lib/i18n";

import { useState } from "react";
import { cn } from "@workspace/ui/lib/utils";
import { useDataStore, useUIStore } from "@workspace/store";
import { NodeTagService } from "@workspace/services";
import {
  AlignLeft,
  Clock,
  Database,
  FileText,
  History,
  LinkIcon,
  Plus,
  Tag,
  Type,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type {
  EdgeData,
  NodeData,
  NodeTag,
  NodeTagId,
} from "@workspace/interfaces";
import type { NodeAttributeField } from "@workspace/plugin-sdk/ui";
import { Textarea } from "@workspace/ui/components/ui/textarea";
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
import { AttributeFieldsHost } from "@workspace/ui/components/plugin-ui/attribute-fields-host";
import { useAttributeDraft } from "@workspace/ui/hooks/use-attribute-draft";
import { useAttributeOperation } from "@workspace/ui/hooks/use-attribute-operation";
import {
  abstractRequest,
  attributeFieldRequest,
  semanticRequest,
  tagRequest,
} from "@workspace/ui/lib/attribute-operations";

/** Colors a new tag starts with, matching the ones `useGraph` used to pick. */
const TAG_COLORS = [
  "#3B82F6",
  "#10B981",
  "#8B5CF6",
  "#F59E0B",
  "#EF4444",
  "#EC4899",
];

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

  const applyOperation = useAttributeOperation();

  const abstract = useAttributeDraft(node.abstract ?? "", (value) =>
    applyOperation(abstractRequest(nodeId, value)),
  );

  const handleSemanticIdChange = async (value: string) => {
    await applyOperation(semanticRequest(nodeId, value));
  };

  const nodeTagsMap = useDataStore((state) => state.nodeTags);
  const allTags = Array.from(nodeTagsMap.values());

  const [tagPopoverOpen, setTagPopoverOpen] = useState(false);

  const selectedSemantic = node.semanticId
    ? allSemantics.find((s) => s.id === node.semanticId)
    : undefined;

  const applyTag = async (tagId: NodeTagId, applied: boolean) => {
    await applyOperation(tagRequest(nodeId, tagId, applied));
  };

  const handleToggleTag = (tagId: NodeTagId) => {
    const applied = (node.tags || []).includes(tagId);
    void applyTag(tagId, applied);
  };

  const handleDeleteTag = async (tagId: NodeTagId) => {
    try {
      await NodeTagService.delete(tagId);
    } catch (error) {
      console.error("Failed to delete tag:", error);
    }
  };

  const handleRemoveTag = (tagId: NodeTagId) => {
    void applyTag(tagId, true);
  };

  const handleCreateTag = async (name: string): Promise<NodeTag | null> => {
    const tagName = name.trim();
    if (!tagName) return null;
    try {
      const tag = await NodeTagService.upsert({
        id: `tmp_${tagName.toLowerCase().replace(/\s+/g, "-")}`,
        name: tagName,
        color: TAG_COLORS[Math.floor(Math.random() * TAG_COLORS.length)],
      });
      return (tag as NodeTag) ?? null;
    } catch (error) {
      console.error("Failed to create tag:", error);
      return null;
    }
  };

  const handleAttributeFieldChange = async (
    field: NodeAttributeField,
    value: string,
  ) => {
    await applyOperation(attributeFieldRequest(nodeId, field, value));
  };

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
                  onRemove={() => handleRemoveTag(tagId)}
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
            onDeleteTag={handleDeleteTag}
            onCreateTag={handleCreateTag}
          />
        </Popover>
      </div>

      {/* Editable: Abstract */}
      <div className="space-y-1.5">
        <FieldLabel icon={AlignLeft}>{t("摘要")}</FieldLabel>
        <Textarea
          value={abstract.value}
          onChange={(e) => abstract.change(e.target.value)}
          placeholder={t("输入摘要...")}
          className="min-h-24 resize-none text-xs leading-relaxed"
        />
      </div>

      {/* Descriptor-driven: the fields the node type's plugin contributes */}
      <AttributeFieldsHost
        key={`${node.id}:${node.nodeType}`}
        type={node.nodeType}
        content={node.content}
        onFieldChange={handleAttributeFieldChange}
      />

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
