// SPDX-License-Identifier: AGPL-3.0-only

"use client";
import { useI18n } from "@workspace/ui/lib/i18n";

import {
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@workspace/ui/components/ui/dropdown-menu";
import { ArrowLeft, ArrowRight, Trash2 } from "lucide-react";
import type { EdgeId, EdgeDirection } from "@workspace/interfaces";
import { useDataStore, useUIStore } from "@workspace/store";
import { EdgeSemanticSelector } from "@workspace/ui/components/selector/edge-semantic-selector";

function directionToFlags(direction: EdgeDirection): [boolean, boolean] {
  switch (direction) {
    case "forward":
      return [true, false];
    case "reverse":
      return [false, true];
    case "bidirectional":
      return [true, true];
    case "undirected":
      return [false, false];
  }
}

function flagsToDirection(
  showFromTo: boolean,
  showToFrom: boolean,
): EdgeDirection {
  if (showFromTo && showToFrom) return "bidirectional";
  if (showFromTo) return "forward";
  if (showToFrom) return "reverse";
  return "undirected";
}

export interface GraphContextMenuEdgeProps {
  edgeId: EdgeId;
  onDeleteEdge?: (edgeId: EdgeId) => void;
  onChangeEdgeDirection?: (edgeId: EdgeId, direction: EdgeDirection) => void;
  onChangeEdgeSemantic?: (edgeId: EdgeId, semanticId: string) => void;
  onClose: () => void;
}

export function GraphContextMenuEdge({
  edgeId,
  onDeleteEdge,
  onChangeEdgeDirection,
  onChangeEdgeSemantic,
  onClose,
}: GraphContextMenuEdgeProps) {
  const { t } = useI18n();

  const edge = useDataStore((state) => state.edges.get(edgeId));
  const edgeSemantics = useDataStore((state) => state.edgeSemantics);
  const openEdgeSemanticDialog = useUIStore(
    (state) => state.openEdgeSemanticDialog,
  );
  const currentDirection = edge?.direction ?? "forward";
  const [showFromTo, showToFrom] = directionToFlags(currentDirection);
  const currentSemantic = edge?.semanticId
    ? edgeSemantics.get(edge.semanticId)
    : undefined;

  if (!edge) return null;

  const toggleFromTo = () => {
    const newDirection = flagsToDirection(!showFromTo, showToFrom);
    onChangeEdgeDirection?.(edgeId, newDirection);
  };

  const toggleToFrom = () => {
    const newDirection = flagsToDirection(showFromTo, !showToFrom);
    onChangeEdgeDirection?.(edgeId, newDirection);
  };

  const handleSemanticSelect = (semanticId: string) => {
    onChangeEdgeSemantic?.(edgeId, semanticId);
    onClose();
  };

  return (
    <>
      <div className="flex flex-col gap-1 px-2 py-1.5">
        <DropdownMenuSub>
          <DropdownMenuSubTrigger
            className="flex items-center gap-2 px-2 py-1.5 cursor-pointer hover:bg-accent hover:text-accent-foreground rounded-md"
            onClick={(e) => e.preventDefault()}
          >
            {currentSemantic ? (
              <>
                {currentSemantic.color && (
                  <span
                    className="size-3 rounded-full flex-shrink-0"
                    style={{ backgroundColor: currentSemantic.color }}
                  />
                )}
                <span className="text-xs text-muted-foreground truncate max-w-[100px]">
                  {currentSemantic.name}
                </span>
              </>
            ) : (
              <span className="text-xs text-muted-foreground">
                {t("请选择类型")}
              </span>
            )}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <EdgeSemanticSelector
              onSelect={handleSemanticSelect}
              onCreateRequest={() => openEdgeSemanticDialog(null, edgeId)}
            />
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <div className="flex items-center gap-1">
          <DropdownMenuItem
            onSelect={(e) => e.preventDefault()}
            onClick={toggleToFrom}
            className={`flex-1 flex items-center justify-center size-8 cursor-pointer rounded-md ${
              showToFrom
                ? "bg-primary text-primary-foreground focus:bg-primary focus:text-primary-foreground data-[highlighted]:bg-primary data-[highlighted]:text-primary-foreground"
                : "hover:bg-accent hover:text-accent-foreground"
            }`}
            title={t("Toggle to ← from arrow")}
          >
            <ArrowLeft className="size-4" />
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={(e) => e.preventDefault()}
            onClick={toggleFromTo}
            className={`flex-1 flex items-center justify-center size-8 cursor-pointer rounded-md ${
              showFromTo
                ? "bg-primary text-primary-foreground focus:bg-primary focus:text-primary-foreground data-[highlighted]:bg-primary data-[highlighted]:text-primary-foreground"
                : "hover:bg-accent hover:text-accent-foreground"
            }`}
            title={t("Toggle from → to arrow")}
          >
            <ArrowRight className="size-4" />
          </DropdownMenuItem>
        </div>
      </div>
      <DropdownMenuSeparator />
      <DropdownMenuItem
        onClick={() => {
          onDeleteEdge?.(edgeId);
          onClose();
        }}
        className="flex items-center gap-2 px-2 py-1.5 cursor-pointer text-destructive hover:bg-destructive/10 hover:text-destructive rounded-md"
      >
        <Trash2 className="size-4" />
        <span>{t("Delete")}</span>
      </DropdownMenuItem>
    </>
  );
}
