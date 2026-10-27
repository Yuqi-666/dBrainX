// SPDX-License-Identifier: AGPL-3.0-only

"use client";

import { cn } from "@workspace/ui/lib/utils";
import { useUIStore, useDataStore } from "@workspace/store";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@workspace/ui/components/ui/dialog";
import { NodeContentEditor } from "@workspace/ui/components/node-content/node-content-editor";
import { EditorHeader } from "@workspace/ui/components/header/editor-header/editor-header";
import { AttributesSidebar } from "@workspace/ui/components/header/editor-header/attributes-sidebar";
import type { NodeData } from "@workspace/interfaces";

interface NodeEditorProps {
  className?: string;
}

/**
 * NodeEditor Container
 * - Window mode (graph / dashboard): Dialog弹窗, 显示QuickBar
 * - Fullscreen mode (mainViewType === "editor"): 全屏独占, 隐藏QuickBar
 */
export function NodeEditor({ className }: NodeEditorProps) {
  const mainViewType = useUIStore((state) => state.mainViewType);
  const currentEditingNodeId = useUIStore(
    (state) => state.currentEditingNodeId,
  );
  const setCurrentEditingNodeId = useUIStore(
    (state) => state.setCurrentEditingNodeId,
  );
  const node = useDataStore((state) =>
    currentEditingNodeId ? state.nodes.get(currentEditingNodeId) : undefined,
  );

  if (!node) {
    return null;
  }

  // Handle close (window mode only)
  const handleClose = () => {
    setCurrentEditingNodeId(null);
  };

  return (
    <>
      {/* Window Mode: Dialog */}
      {mainViewType !== "editor" && (
        <Dialog
          open={true}
          onOpenChange={(open) => {
            if (!open) handleClose();
          }}
        >
          <DialogContent
            showCloseButton={false}
            autoFocus={false}
            // The dialog has no visible description; without this Radix logs
            // a missing-description warning on every open.
            aria-describedby={undefined}
            className={cn(
              "sm:max-w-[80%] w-[1200px] h-[80vh] flex flex-col p-2 pt-0",
              "rounded-2xl bg-popover",
              "ring-1 ring-foreground/5 shadow-2xl shadow-foreground/5",
              "data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95",
              "data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
              className,
            )}
          >
            {/* Radix requires a title; the dialog's own header shows it. */}
            <DialogTitle className="sr-only">{node.title}</DialogTitle>
            <NodeEditorContent node={node} />
          </DialogContent>
        </Dialog>
      )}

      {/* Fullscreen Mode */}
      {mainViewType === "editor" && (
        <div
          className={cn(
            "absolute inset-0 z-50 bg-background flex flex-col",
            className,
          )}
        >
          <NodeEditorContent node={node} />
        </div>
      )}
    </>
  );
}

/**
 * NodeEditorContent - 内部通用内容组件
 * 被 Window Mode 和 Fullscreen Mode 共用
 */
interface NodeEditorContentProps {
  node: NodeData;
  className?: string;
}

function NodeEditorContent({ node, className }: NodeEditorContentProps) {
  const attributesSidebarOpen = useUIStore(
    (state) => state.attributesSidebarOpen,
  );

  return (
    <div className={cn("flex flex-col h-full overflow-hidden", className)}>
      <EditorHeader />

      <div className="flex-1  flex overflow-hidden">
        <div className="flex-1 overflow-y-auto">
          <NodeContentEditor node={node} />
        </div>
        {attributesSidebarOpen && (
          <AttributesSidebar className="w-80 flex-shrink-0" />
        )}
      </div>
    </div>
  );
}
