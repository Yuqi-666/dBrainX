// SPDX-License-Identifier: AGPL-3.0-only

"use client";
import { useI18n } from "@workspace/ui/lib/i18n";

import type { WebsiteNodeData } from "@workspace/interfaces";
import { ExternalLink } from "lucide-react";

export function WebsitePreview({ node }: { node: WebsiteNodeData }) {
  const { t } = useI18n();

  const getDomain = (url: string) => {
    try {
      return new URL(url).hostname;
    } catch {
      return url;
    }
  };

  return (
    <div className="flex items-center gap-2">
      {node.content?.faviconUrl && (
        <img
          src={node.content.faviconUrl}
          alt=""
          className="size-4 shrink-0 rounded"
        />
      )}
      {node.content?.url ? (
        <a
          href={node.content.url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <span className="truncate">{getDomain(node.content.url)}</span>
          <ExternalLink className="size-3.5 shrink-0" />
        </a>
      ) : (
        <p className="text-xs text-muted-foreground">{t("暂无网址")}</p>
      )}
    </div>
  );
}
