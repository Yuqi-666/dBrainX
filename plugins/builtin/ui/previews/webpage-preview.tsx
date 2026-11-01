// SPDX-License-Identifier: AGPL-3.0-only

"use client";
import { useI18n } from "@workspace/ui/lib/i18n";

import type { WebpageNodeData } from "@workspace/interfaces";
import { FileCode2 } from "lucide-react";
import { storedFileName } from "@workspace/utils/node-content";

/**
 * Hover preview for webpage nodes.
 *
 * The document is a stored object, not record content, so a preview would have
 * to download the file — an 11 MB page on hover is not a preview, it is a fetch
 * the user did not ask for. The card therefore names the stored file instead,
 * and the node view is where the page is actually rendered.
 */
export function WebpagePreview({ node }: { node: WebpageNodeData }) {
  const { t } = useI18n();

  const name = storedFileName(node.content?.url ?? "");

  return (
    <div className="space-y-2">
      <div className="relative flex aspect-video w-full flex-col items-center justify-center gap-2 overflow-hidden rounded-lg bg-muted">
        <FileCode2 className="size-10 text-muted-foreground" />
        <span className="w-full truncate px-3 text-center text-xs text-muted-foreground">
          {name || t("网页")}
        </span>
      </div>
    </div>
  );
}
