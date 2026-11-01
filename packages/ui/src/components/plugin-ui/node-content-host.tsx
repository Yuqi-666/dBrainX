// SPDX-License-Identifier: AGPL-3.0-only

"use client";

import { Component, Suspense } from "react";
import type { ReactNode } from "react";
import type { NodeData } from "@workspace/interfaces";
import { translate } from "@workspace/ui/lib/i18n/runtime";
import { cn } from "@workspace/ui/lib/utils";

import { getNodeContentDescriptor } from "../node-content/registry";
import { UnknownNodeContent } from "../node-content/unknown-node-content";

/** Which descriptor component the host mounts for a node. */
export type NodeContentSlot = "editor" | "preview";

export interface NodeContentHostProps {
  node: NodeData;
  className?: string;
  /** Defaults to `"editor"`; the preview surface passes `"preview"`. */
  slot?: NodeContentSlot;
}

interface NodeContentErrorBoundaryProps {
  children: ReactNode;
  fallback: ReactNode;
}

interface NodeContentErrorBoundaryState {
  failed: boolean;
}

/**
 * Catches a descriptor component that throws, including a `React.lazy` import
 * that rejects while loading, and renders `fallback` instead (§4.9.2).
 *
 * `Suspense` alone cannot do this: its fallback covers "still loading", and a
 * rejected chunk is an error, not a pending promise. Without this boundary the
 * rejection reaches the route and blanks the page.
 */
export class NodeContentErrorBoundary extends Component<
  NodeContentErrorBoundaryProps,
  NodeContentErrorBoundaryState
> {
  override state: NodeContentErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): NodeContentErrorBoundaryState {
    return { failed: true };
  }

  override render(): ReactNode {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

/** Placeholder while a descriptor's lazy chunk loads. */
export function NodeContentSkeleton({
  className,
  label,
}: {
  className?: string;
  label?: string;
}) {
  return (
    <div
      data-node-content-skeleton=""
      aria-busy="true"
      className={cn(
        "animate-pulse rounded-md bg-muted/40 p-4 text-sm text-muted-foreground",
        className,
      )}
    >
      {translate("加载中…")}
      {label ? ` ${label}` : ""}
    </div>
  );
}

/**
 * Mounts the registered editor (or preview) for a node.
 *
 * The host only reads the registry: it imports no plugin package, so the same
 * bundle serves whatever the client bootstrap registered. Three paths, all
 * visible rather than blank: no descriptor renders `UnknownNodeContent`
 * directly; a registered component that throws renders it through the error
 * boundary; a component that is still loading renders `NodeContentSkeleton`.
 */
export function NodeContentHost({
  node,
  className,
  slot = "editor",
}: NodeContentHostProps) {
  const nodeType = (node as { nodeType?: string } | undefined)?.nodeType;
  const descriptor = nodeType ? getNodeContentDescriptor(nodeType) : undefined;
  if (!descriptor) {
    return <UnknownNodeContent node={node} className={className} />;
  }

  const Content = slot === "preview" ? descriptor.preview : descriptor.editor;

  return (
    <NodeContentErrorBoundary
      key={`${descriptor.pluginId}:${descriptor.type}:${slot}`}
      fallback={<UnknownNodeContent node={node} className={className} />}
    >
      <Suspense
        fallback={
          <NodeContentSkeleton className={className} label={descriptor.label} />
        }
      >
        <Content node={node} className={className} />
      </Suspense>
    </NodeContentErrorBoundary>
  );
}
