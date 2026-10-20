// SPDX-License-Identifier: AGPL-3.0-only

"use client";

import * as React from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
} from "@workspace/ui/components/ui/dropdown-menu";
import { GraphContextMenuGroupSelect } from "./graph-context-menu-group-select";
import { GraphContextMenuAddEdge } from "./graph-context-menu-add-edge";
import { GraphContextMenuNode } from "./graph-context-menu-node";
import { GraphContextMenuEdge } from "./graph-context-menu-edge";
import { GraphContextMenuCanvas } from "./graph-context-menu-canvas";
import { useGraph } from "@workspace/hooks";

export type GraphContextMenuType = "node" | "edge" | "canvas" | "groupSelect" | "add-edge";

export interface GraphContextMenuNodeContext {
  nodeId: string;
}

export interface GraphContextMenuEdgeContext {
  edgeId: string;
}

export interface GraphContextMenuGroupSelectContext {
  nodeIds: string[];
  edgeIds: string[];
}

export interface GraphContextMenuAddEdgeContext {
  sourceIds: string[];
  targetId: string | null;
}

export interface GraphContextMenuCanvasContext {
  simX: number;
  simY: number;
  viewId: string;
}

export type GraphContextMenuProps =
  | { x: number; y: number; visible: boolean; type: "node"; context: GraphContextMenuNodeContext; onClose: () => void }
  | { x: number; y: number; visible: boolean; type: "edge"; context: GraphContextMenuEdgeContext; onClose: () => void }
  | { x: number; y: number; visible: boolean; type: "canvas"; context: GraphContextMenuCanvasContext; onClose: () => void }
  | { x: number; y: number; visible: boolean; type: "groupSelect"; context: GraphContextMenuGroupSelectContext; onClose: () => void }
  | { x: number; y: number; visible: boolean; type: "add-edge"; context: GraphContextMenuAddEdgeContext; onClose: () => void };

const GraphContextMenu = React.forwardRef<
  React.ElementRef<typeof DropdownMenuContent>,
  GraphContextMenuProps & { setContextMenu?: (...args: any[]) => void }
>((props, ref) => {
  const { x, y, visible, type, context, onClose, setContextMenu } = props;

  const {
    onEditNode,
    onAddNode,
    onDeleteEdge,
    onDeleteSelected,
    onChangeEdgeDirection,
    onChangeEdgeSemantic,
    onChangeNodeSemantic,
    onCreateEdge,
  } = useGraph();

  if (!visible) return null;

  return (
    <DropdownMenu open={visible} onOpenChange={(open) => !open && onClose()}>
      <DropdownMenuContent
        ref={ref}
        style={{ position: "absolute", left: x, top: y }}
        className="w-48 p-1 shadow-lg rounded-lg border bg-popover text-popover-foreground"
        onEscapeKeyDown={onClose}
        onPointerDownOutside={onClose}
      >
        {type === "node" && <GraphContextMenuNode nodeId={context.nodeId} onEditNode={onEditNode} onChangeNodeSemantic={onChangeNodeSemantic} onClose={onClose} />}
        {type === "edge" && <GraphContextMenuEdge edgeId={context.edgeId} onDeleteEdge={onDeleteEdge} onChangeEdgeDirection={onChangeEdgeDirection} onChangeEdgeSemantic={onChangeEdgeSemantic} onClose={onClose} />}
        {type === "canvas" && <GraphContextMenuCanvas onAddNode={onAddNode} simX={context.simX} simY={context.simY} viewId={context.viewId} onClose={onClose} />}
        {type === "groupSelect" && <GraphContextMenuGroupSelect nodeIds={context.nodeIds} edgeIds={context.edgeIds} onDeleteSelected={onDeleteSelected} onClose={onClose} />}
        {type === "add-edge" && (
          <GraphContextMenuAddEdge
            sourceIds={context.sourceIds}
            targetId={context.targetId}
            x={x}
            y={y}
            onCreateEdge={onCreateEdge as any}
            onClose={onClose}
            setContextMenu={setContextMenu as any}
          />
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
});

GraphContextMenu.displayName = "GraphContextMenu";

export { GraphContextMenu };
