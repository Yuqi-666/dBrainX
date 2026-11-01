// SPDX-License-Identifier: AGPL-3.0-only

"use client";
import { useI18n } from "@workspace/ui/lib/i18n";

import { useCallback, useEffect, useState } from "react";
import { ExternalLink, Globe } from "lucide-react";
import type { WebsiteNodeData } from "@workspace/interfaces";
import { NodeService } from "@workspace/services";
import { cn } from "@workspace/ui/lib/utils";
import { Button } from "@workspace/ui/components/ui/button";
import { Input } from "@workspace/ui/components/ui/input";
import { EmptyHint } from "./empty-hint";

const HTTPS_PATTERN = /^https?:\/\//i;
/** A bare host such as `example.com/path` — schemeless but clearly a page. */
const BARE_HOST_PATTERN = /^[\w-]+(\.[\w-]+)+([/?#].*)?$/;

/**
 * Absolute address to embed, or `""` when the input is not an embeddable page.
 *
 * Only `http(s)` survives: `javascript:` and friends must never reach an
 * iframe `src`. A schemeless host is upgraded to `https://` so typing
 * `example.com` still previews.
 */
function toEmbeddableUrl(raw: string): string {
  const value = raw.trim();
  if (!value) return "";
  if (HTTPS_PATTERN.test(value)) return value;
  if (BARE_HOST_PATTERN.test(value)) return `https://${value}`;
  return "";
}

/**
 * Favicon address for `url`, resolved from its host through Google's favicon
 * service — the same source the preview card and the sidebar show. `undefined`
 * when the address has no host to ask about.
 */
function faviconUrlFor(url: string): string | undefined {
  try {
    const { hostname } = new URL(url);
    if (!hostname) return undefined;
    return `https://www.google.com/s2/favicons?domain=${hostname}&sz=64`;
  } catch {
    return undefined;
  }
}

interface WebsiteNodeContentProps {
  node: WebsiteNodeData;
  className?: string;
}

/**
 * Node content editor for `website` nodes.
 *
 * A website node is its address, so this editor is the address: type one and
 * the page is embedded below in a sandboxed iframe, with a link out for the
 * many sites that refuse to be framed. The favicon is derived from the host on
 * every commit, so the preview card and the attributes sidebar stay in sync.
 */
export function WebsiteNodeContent({
  node,
  className,
}: WebsiteNodeContentProps) {
  const { t } = useI18n();

  // Local draft so the iframe is not re-navigated on every keystroke.
  const [draft, setDraft] = useState(node.content.url);
  const [committed, setCommitted] = useState(node.content.url);

  // Adopt addresses that changed outside this input: another client, or the
  // attributes sidebar, which edits the very same field.
  useEffect(() => {
    if (node.content.url === committed) return;
    setCommitted(node.content.url);
    setDraft(node.content.url);
  }, [node.content.url, committed]);

  const commit = useCallback(
    (value: string) => {
      const raw = value.trim();
      // Store an absolute address so the preview card's link and the embedded
      // frame both resolve; an unembeddable input is kept exactly as typed.
      const url = toEmbeddableUrl(raw) || raw;
      setCommitted(url);
      setDraft(url);
      // The store is updated immediately either way; only the mutation is
      // debounced, so a burst of typing does not fire one request per pause.
      void NodeService.upsert(
        node.id,
        { content: { url, faviconUrl: faviconUrlFor(url) } },
        { debounce: true },
      );
    },
    [node.id],
  );

  // Auto-commit once typing pauses, so the preview follows along.
  useEffect(() => {
    if (draft === committed) return;
    const timer = setTimeout(() => commit(draft), 800);
    return () => clearTimeout(timer);
  }, [draft, committed, commit]);

  const previewUrl = toEmbeddableUrl(node.content.url);

  return (
    <div
      className={cn("flex h-full min-h-[380px] flex-col gap-3 p-4", className)}
    >
      <div className="flex items-center gap-2">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => commit(draft)}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit(draft);
          }}
          placeholder="https://example.com/article"
          className="h-8 text-xs"
        />
        {previewUrl && (
          <Button
            asChild
            size="sm"
            variant="outline"
            className="h-8 shrink-0 gap-1 px-2 text-xs"
          >
            <a href={previewUrl} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="size-3.5" />
              {t("打开")}{" "}
            </a>
          </Button>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-hidden rounded-lg border bg-white">
        {previewUrl ? (
          <iframe
            key={previewUrl}
            title={node.title || t("网站预览")}
            src={previewUrl}
            referrerPolicy="no-referrer"
            sandbox="allow-scripts allow-same-origin allow-popups allow-forms allow-modals"
            className="size-full border-0"
          />
        ) : (
          <EmptyHint
            icon={Globe}
            title={t("输入网址后在此嵌入预览")}
            description={t(
              "部分站点禁止被嵌入，预览空白时可点「打开」在新标签页查看。",
            )}
          />
        )}
      </div>
    </div>
  );
}
