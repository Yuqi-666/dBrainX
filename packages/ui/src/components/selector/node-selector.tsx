// SPDX-License-Identifier: AGPL-3.0-only

"use client";
import { useI18n } from "@workspace/ui/lib/i18n";

import * as React from "react";
import {
  DropdownMenuSubContent,
  DropdownMenuItem,
} from "@workspace/ui/components/ui/dropdown-menu";
import { Input } from "@workspace/ui/components/ui/input";
import { Search } from "lucide-react";
import { useDataStore } from "@workspace/store";
import type { NodeData } from "@workspace/interfaces";

export interface NodeSelectorProps {
  onSelect: (nodeId: string) => void;
  onClose: () => void;
}

/** Node picker content for a DropdownMenuSub; the host supplies the trigger. */
export function NodeSelector({ onSelect, onClose }: NodeSelectorProps) {
  const { t } = useI18n();

  const [search, setSearch] = React.useState("");
  const nodesMap = useDataStore((state) => state.nodes);

  const nodes = React.useMemo(() => Array.from(nodesMap.values()), [nodesMap]);

  const filteredNodes = React.useMemo(() => {
    if (!search.trim()) return nodes;
    const lower = search.toLowerCase();
    return nodes.filter(
      (node: NodeData) =>
        node.title.toLowerCase().includes(lower) ||
        node.abstract?.toLowerCase().includes(lower),
    );
  }, [nodes, search]);

  const handleSelect = (nodeId: string) => {
    onSelect(nodeId);
    onClose();
    setSearch("");
  };

  return (
    <DropdownMenuSubContent className="w-64 p-2" sideOffset={0} alignOffset={0}>
      <div className="relative mb-2">
        <Search className="absolute left-2 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
        <Input
          placeholder={t("Search nodes...")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-8 h-8"
          autoFocus
        />
      </div>
      <div className="max-h-48 overflow-y-auto">
        {filteredNodes.length === 0 ? (
          <div className="px-2 py-1.5 text-sm text-muted-foreground">
            {t("No nodes found")}{" "}
          </div>
        ) : (
          filteredNodes.map((node: NodeData) => (
            <DropdownMenuItem
              key={node.id}
              onClick={() => handleSelect(node.id)}
              className="flex items-center gap-2 px-2 py-1.5 cursor-pointer hover:bg-accent hover:text-accent-foreground rounded-md"
            >
              <span>{node.title}</span>
              {node.abstract && (
                <span className="ml-auto text-xs text-muted-foreground truncate max-w-[120px]">
                  {node.abstract}
                </span>
              )}
            </DropdownMenuItem>
          ))
        )}
      </div>
    </DropdownMenuSubContent>
  );
}
