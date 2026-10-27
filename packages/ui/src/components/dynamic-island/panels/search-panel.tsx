// SPDX-License-Identifier: AGPL-3.0-only

"use client";
import { buildNodeFilterFields } from "@workspace/ui/lib/node-filter-fields";
import { useI18n, useLocaleMemo } from "@workspace/ui/lib/i18n";

import { useMemo, useState } from "react";
import { useDataStore, useUIStore } from "@workspace/store";
import { FilterQueryBuilder } from "@workspace/ui/components/filter/filter";
import { filterByViewFilterConfig } from "@workspace/utils";
import type { RuleGroupType } from "@workspace/utils";
import { type View } from "@workspace/interfaces";
import { Search, Filter } from "lucide-react";
import { Input } from "@workspace/ui/components/ui/input";
import { Button } from "@workspace/ui/components/ui/button";
import { cn } from "@workspace/ui/lib/utils";
import {
  SEARCH_TABS,
  normalizeKeyword,
  type SearchTabKey,
  type SearchMatch,
  type SearchGroupKey,
} from "./search-types";
import { IslandPanelHeader } from "./panel-header";

export interface SearchPanelProps {
  className?: string;
  onClose?: () => void;
}

export function SearchPanel({ className, onClose }: SearchPanelProps) {
  const { t } = useI18n();

  const nodes = useDataStore((state) => state.nodes);
  const edges = useDataStore((state) => state.edges);
  const nodeSemantics = useDataStore((state) => state.nodeSemantics);
  const edgeSemantics = useDataStore((state) => state.edgeSemantics);

  const [query, setQuery] = useState("");
  const [activeTab, setActiveTab] = useState<SearchTabKey>("all");
  const [filterOpen, setFilterOpen] = useState(false);
  const [filterQuery, setFilterQuery] = useState<RuleGroupType>({
    combinator: "and",
    rules: [],
  });

  const activeTabConfig = SEARCH_TABS.find((t) => t.key === activeTab);

  const filterableNodes = useMemo(() => {
    const hasRules = (filterQuery.rules?.length ?? 0) > 0;
    if (!hasRules) return nodes;

    // Search panel passes only `ruleGroup` (no `selectedNodes`); with the
    // UNION semantics this is a pure ruleGroup match — unchanged behavior.
    const view = { filterConfig: { ruleGroup: filterQuery } } as View;
    const { filteredNodes } = filterByViewFilterConfig(nodes, edges, view);
    return filteredNodes;
  }, [nodes, edges, filterQuery]);

  const filterFields = useLocaleMemo(
    () => buildNodeFilterFields(nodeSemantics),
    [nodeSemantics],
  );

  const setCurrentEditingNodeId = useUIStore(
    (state) => state.setCurrentEditingNodeId,
  );
  const collapseIsland = useUIStore((state) => state.collapseIsland);
  const closePanel = onClose ?? collapseIsland;

  const results = useLocaleMemo<SearchMatch[]>(() => {
    const term = normalizeKeyword(query);
    const matches: SearchMatch[] = [];
    const kind = activeTabConfig?.kind;
    const typeSet = kind === "nodes" ? activeTabConfig?.nodeTypes : undefined;
    const showAll = activeTab === "all";

    if (kind === "nodes") {
      filterableNodes.forEach((node) => {
        if (typeSet && !typeSet.includes(node.nodeType)) return;
        if (term && !matchesNode(node, term)) return;
        const semantic = node.semanticId
          ? nodeSemantics.get(node.semanticId)
          : undefined;
        matches.push({
          id: node.id,
          title: node.title,
          subtitle: node.abstract,
          group: "nodes",
          icon: "node",
          nodeType: node.nodeType,
          semanticId: node.semanticId,
          semanticName: semantic?.name,
          color: semantic?.color,
          // 先收起灵动岛，再打开选中的节点。
          onSelect: () => {
            closePanel();
            setCurrentEditingNodeId(node.id);
          },
        });
      });
    }

    if (kind === "node-types" || showAll) {
      nodeSemantics.forEach((semantic) => {
        if (term && !matchesText(semantic.name, term)) return;
        matches.push({
          id: semantic.id,
          title: semantic.name,
          subtitle: semantic.description,
          group: "types",
          icon: "type",
          semanticKind: "node",
          color: semantic.color,
        });
      });
    }

    if (kind === "edge-types" || showAll) {
      edgeSemantics.forEach((semantic) => {
        if (term && !matchesText(semantic.name, term)) return;
        matches.push({
          id: semantic.id,
          title: semantic.name,
          subtitle: semantic.description,
          group: "types",
          icon: "type",
          edgeType: semantic.category,
          semanticKind: "edge",
          color: semantic.color,
        });
      });
    }

    return matches;
  }, [
    filterableNodes,
    nodeSemantics,
    edgeSemantics,
    query,
    activeTab,
    closePanel,
    setCurrentEditingNodeId,
  ]);

  const grouped = useMemo(() => {
    const g: Record<SearchGroupKey, SearchMatch[]> = {
      nodes: [],
      types: [],
    };
    results.forEach((r) => g[r.group].push(r));
    return g;
  }, [results]);

  const renderGroup = (
    key: SearchGroupKey,
    label: string,
    items: SearchMatch[],
  ) => {
    if (items.length === 0) return null;
    return (
      <div key={key} className="flex flex-col gap-1">
        <p className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={item.onSelect}
            className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-accent"
          >
            <span className="size-1.5 shrink-0 rounded-full bg-primary/60" />
            <span className="min-w-0 flex-1 truncate">{item.title}</span>
            {item.semanticName && item.semanticName !== item.title && (
              <span
                className="max-w-[30%] truncate rounded-full px-2 py-0.5 text-[10px] font-medium"
                style={{
                  backgroundColor: item.color ? `${item.color}1a` : undefined,
                  color: item.color ?? undefined,
                }}
              >
                {item.semanticName}
              </span>
            )}
            {item.semanticKind && (
              <span
                className="rounded-full px-2 py-0.5 text-[10px] font-medium"
                style={{
                  backgroundColor: item.color ? `${item.color}1a` : undefined,
                  color: item.color ?? undefined,
                }}
              >
                {item.semanticKind === "node" ? t("节点") : t("边")}
              </span>
            )}
            {item.subtitle && (
              <span className="max-w-[40%] truncate text-xs text-muted-foreground">
                {item.subtitle}
              </span>
            )}
            {item.nodeType && (
              <span className="text-xs text-muted-foreground">
                {item.nodeType}
              </span>
            )}
            {item.edgeType && (
              <span className="text-xs text-muted-foreground">
                {item.edgeType}
              </span>
            )}
          </button>
        ))}
      </div>
    );
  };

  const filterCount = filterQuery.rules?.length ?? 0;

  return (
    <div className={cn("flex flex-col", className)}>
      <IslandPanelHeader title={t("搜索")} />
      <div className="flex items-center gap-2 border-b p-3">
        <div className="relative flex flex-1 items-center">
          <Search className="absolute left-2.5 size-4 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("Search nodes, types...")}
            className="pl-8 pr-2"
            autoFocus
          />
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setFilterOpen((v) => !v)}
          aria-label={t("筛选")}
          className={cn("relative", filterOpen && "bg-accent")}
        >
          <Filter />
          {filterCount > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex size-4 items-center justify-center rounded-full bg-primary text-[9px] font-semibold text-primary-foreground">
              {filterCount}
            </span>
          )}
        </Button>
      </div>

      <div className="flex flex-wrap gap-1 border-b px-3 py-2">
        {SEARCH_TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActiveTab(tab.key)}
            className={cn(
              "rounded-md px-2.5 py-1 text-xs font-medium text-muted-foreground hover:bg-accent",
              activeTab === tab.key && "bg-accent text-foreground",
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {filterOpen && (
        <div className="border-b p-3">
          <FilterQueryBuilder
            fields={filterFields}
            query={filterQuery}
            onQueryChange={setFilterQuery}
          />
        </div>
      )}

      <div className="max-h-80 overflow-y-auto p-2">
        {renderGroup("nodes", t("节点"), grouped.nodes)}
        {renderGroup("types", t("类型"), grouped.types)}
        {results.length === 0 && (
          <p className="px-2 py-6 text-center text-sm text-muted-foreground">
            {t("No results")}{" "}
          </p>
        )}
      </div>
    </div>
  );
}

function matchesNode(
  node: { title?: string; abstract?: string; semanticId?: string },
  term: string,
): boolean {
  return (
    matchesText(node.title, term) ||
    matchesText(node.abstract, term) ||
    matchesText(node.semanticId, term)
  );
}

function matchesText(value: string | undefined, term: string): boolean {
  if (!value) return false;
  return normalizeKeyword(value).includes(term);
}
