// SPDX-License-Identifier: AGPL-3.0-only

"use client";
import { useI18n } from "@workspace/ui/lib/i18n";

import * as React from "react";
import { useDataStore } from "@workspace/store";
import type { NodeTag, NodeTagId } from "@workspace/interfaces";
import { PopoverContent } from "@workspace/ui/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@workspace/ui/components/ui/command";
import { CheckIcon, Plus, Trash2 } from "lucide-react";

export interface NodeTagSelectorProps {
  appliedTagIds: NodeTagId[];
  onToggleTag: (tagId: NodeTagId) => void;
  onDeleteTag: (tagId: NodeTagId) => void;
  onCreateTag: (name: string) => Promise<NodeTag | null>;
}

/** Node tag picker with PopoverContent; the host supplies Popover and its trigger. */
export function NodeTagSelector({
  appliedTagIds,
  onToggleTag,
  onDeleteTag,
  onCreateTag,
}: NodeTagSelectorProps) {
  const { t } = useI18n();

  const [search, setSearch] = React.useState("");
  const nodeTagsMap = useDataStore((state) => state.nodeTags);
  const allTags = React.useMemo(
    () => Array.from(nodeTagsMap.values()),
    [nodeTagsMap],
  );

  const filteredTags = React.useMemo(() => {
    return allTags.filter(
      (tag) =>
        !appliedTagIds.includes(tag.id) &&
        tag.name.toLowerCase().includes(search.toLowerCase()),
    );
  }, [allTags, appliedTagIds, search]);

  const exactMatch = allTags.find(
    (t) => t.name.toLowerCase() === search.toLowerCase(),
  );

  const handleCreateAndApply = async () => {
    if (!search.trim()) return;
    const newTag = await onCreateTag(search.trim());
    if (newTag) {
      onToggleTag(newTag.id);
    }
    setSearch("");
  };

  return (
    <PopoverContent className="w-64 p-0" align="start">
      <Command>
        <CommandInput
          placeholder={t("搜索或创建标签...")}
          value={search}
          onValueChange={setSearch}
        />
        <CommandList>
          <CommandEmpty className="py-3 text-center text-xs text-muted-foreground">
            {search ? (
              <span>
                {t('按 Enter 创建 "')}
                {search}"
              </span>
            ) : (
              <span>{t("无匹配标签")}</span>
            )}
          </CommandEmpty>
          {filteredTags.length > 0 && (
            <CommandGroup heading={t("可用标签")}>
              {filteredTags.map((tag) => (
                <CommandItem
                  key={tag.id}
                  value={tag.id}
                  onSelect={() => {
                    onToggleTag(tag.id);
                    setSearch("");
                  }}
                  className="flex items-center gap-2"
                >
                  {tag.color && (
                    <div
                      className="w-3 h-3 rounded-full"
                      style={{ backgroundColor: tag.color }}
                    />
                  )}
                  <span className="flex-1">{tag.name}</span>
                  <CheckIcon className="size-3 opacity-0 group-selected:opacity-100" />
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteTag(tag.id);
                    }}
                    className="rounded-sm p-0.5 hover:bg-destructive/10 hover:text-destructive"
                  >
                    <Trash2 className="size-3" />
                  </button>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
          {search && !exactMatch && (
            <CommandGroup heading={t("创建")}>
              <CommandItem
                value={`__create__${search}`}
                onSelect={handleCreateAndApply}
                className="flex items-center gap-2"
              >
                <Plus className="size-3" />
                <span>
                  {t('创建 "')}
                  {search}"
                </span>
              </CommandItem>
            </CommandGroup>
          )}
        </CommandList>
      </Command>
    </PopoverContent>
  );
}
