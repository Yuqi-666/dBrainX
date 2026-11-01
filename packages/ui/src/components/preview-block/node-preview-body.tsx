// SPDX-License-Identifier: AGPL-3.0-only

"use client";

/**
 * The node preview's **body** — the type-specific half of `PreviewBlock`.
 *
 * It deliberately carries **no positioning, no hover chrome and no
 * `data-preview-block` shell** — those stay in `preview-block.tsx`.
 *
 * The body used to be a ten-way `switch` whose `default` rendered `TextPreview`,
 * so an unknown type was shown as text. It is now the same registry lookup as the
 * editor host: the descriptor supplies the preview, and a type no installed
 * plugin contributes falls back to `UnknownNodeContent` — a JSON summary, never
 * someone else's rendering (§5.1.8).
 */
import type { ReactNode } from "react";
import type { NodeData } from "@workspace/interfaces";
import { cn } from "@workspace/ui/lib/utils";
import { NodeContentHost } from "../plugin-ui/node-content-host";
import { PreviewHeader } from "./preview-header";

export interface PreviewBodyProps {
  node: NodeData;
  className?: string;
}

export function NodePreviewBody({
  node,
  className,
}: PreviewBodyProps): ReactNode {
  return (
    <>
      <PreviewHeader node={node} />
      <div className={cn("px-4 pb-4 pt-2", className)}>
        <NodeContentHost node={node} slot="preview" />
      </div>
    </>
  );
}
