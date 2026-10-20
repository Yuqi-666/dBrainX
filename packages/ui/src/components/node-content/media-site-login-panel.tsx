// SPDX-License-Identifier: AGPL-3.0-only

"use client";
import { useI18n } from "@workspace/ui/lib/i18n";

import { useEffect, useRef, useState } from "react";
import { ChevronDownIcon, KeyRoundIcon, UploadIcon } from "lucide-react";
import {
  connectMediaSiteWithBrowser,
  importMediaCookies,
  type MediaSites,
} from "@workspace/api-client";
import { Button } from "@workspace/ui/components/ui/button";
import { cn } from "@workspace/ui/lib/utils";
import { mediaImportFailure } from "./use-media-url-import";

/**
 * The server rejects a cookie file larger than this (contract §4); checking it
 * here avoids reading a huge file into the renderer just to be refused.
 */
const COOKIE_FILE_MAX_BYTES = 1024 * 1024;

/** What a cookie import connected / failed to connect, as the panel shows it. */
interface CookieImportOutcome {
  connected: { key: string; name: string }[];
  failed: { siteKey: string; message: string }[];
  ignoredDomains: string[];
}

interface MediaSiteLoginPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The site list of the dialog's kind; `null` while it is still loading. */
  sites: MediaSites | null;
  /**
   * Site the browser method applies to (a clicked capsule, or the site the
   * address / the parse belongs to). The cookie method works without it and
   * can connect several sites at once.
   */
  siteKey: string | null;
  /**
   * Fires after a login changed; the dialog refreshes and may re-parse.
   *
   * `method` tells the dialog whether to collapse the panel: a browser
   * connection is one site and the capsule already shows the result, while a
   * cookie import reports connected *and* failed sites that the user should
   * still see.
   */
  onConnected: (siteKeys: string[], method: "browser" | "cookies") => void;
}

/**
 * The login area of both media dialogs (design §4).
 *
 * It sits inside the URL import dialog, collapsed to one row until it is
 * needed: a capsule click, a `login_required` reply, or the user opening it to
 * connect a site in advance. There is no separate sheet, so the address, the
 * capsules, the login state and the parsed result stay in one place and the
 * dialog does not stack two modal layers.
 *
 * Two methods, deliberately different:
 *
 * - **A. This machine's browser** — only when the backend runs locally
 *   (`browserLoginEnabled`). Only the browser's *name* is stored; yt-dlp reads
 *   the cookie from the browser at download time, so nothing secret reaches the
 *   server. Needs a target site, hence hidden without one.
 * - **B. An exported `cookies.txt`** — the user logs in with a normal browser,
 *   exports a Netscape cookie file with an extension, and drops it here. The
 *   server keeps only the supported sites' cookies (the response lists what it
 *   ignored), so one file can light up several capsules at once.
 *
 * The panel never stores a cookie itself and never shows one back: connected
 * sites are reported by name, failures by the server's sanitized message.
 */
export function MediaSiteLoginPanel({
  open,
  onOpenChange,
  sites,
  siteKey,
  onConnected,
}: MediaSiteLoginPanelProps) {
  const { t } = useI18n();
  const fileInputRef = useRef<HTMLInputElement>(null);

  /** Browser name whose connection is in flight; disables the whole panel. */
  const [connectingBrowser, setConnectingBrowser] = useState<string | null>(
    null,
  );
  /** True while the exported cookie file is being uploaded. */
  const [importingCookies, setImportingCookies] = useState(false);
  /** Last failure message (browser connection or cookie import). */
  const [error, setError] = useState<string | null>(null);
  /** Result of the last successful cookie import. */
  const [outcome, setOutcome] = useState<CookieImportOutcome | null>(null);
  /** True while a cookie file is dragged over the drop target. */
  const [dragActive, setDragActive] = useState(false);

  // An opening (or a switch to another site) starts clean: the previous outcome
  // and error belong to a different attempt.
  useEffect(() => {
    if (!open) return;
    setConnectingBrowser(null);
    setImportingCookies(false);
    setError(null);
    setOutcome(null);
    setDragActive(false);
  }, [open, siteKey]);

  const site = siteKey
    ? (sites?.sites.find((candidate) => candidate.key === siteKey) ?? null)
    : null;
  const browsers = sites?.browsers ?? [];
  const canUseBrowser =
    site !== null && (sites?.browserLoginEnabled ?? false) && browsers.length > 0;

  const connectBrowser = async (browserName: string) => {
    if (!site) return;
    setConnectingBrowser(browserName);
    setError(null);
    try {
      await connectMediaSiteWithBrowser(site.key, browserName);
      onConnected([site.key], "browser");
    } catch (cause) {
      setError(mediaImportFailure(cause).message);
    } finally {
      setConnectingBrowser(null);
    }
  };

  const importCookies = async (cookieText: string) => {
    setImportingCookies(true);
    setError(null);
    setOutcome(null);
    try {
      const result = await importMediaCookies(cookieText);
      setOutcome({
        connected: result.connected.map((connected) => ({
          key: connected.key,
          name: connected.name,
        })),
        failed: result.failed.map((failed) => ({
          siteKey: failed.siteKey,
          message: failed.message,
        })),
        ignoredDomains: result.ignoredDomains,
      });
      if (result.connected.length > 0) {
        onConnected(
          result.connected.map((connected) => connected.key),
          "cookies",
        );
      }
    } catch (cause) {
      setError(mediaImportFailure(cause).message);
    } finally {
      setImportingCookies(false);
    }
  };

  const readCookieFile = async (file: File | null | undefined) => {
    if (!file) return;
    if (file.size > COOKIE_FILE_MAX_BYTES) {
      setError(t("Cookie 文件不能超过 1 MiB"));
      return;
    }
    try {
      await importCookies(await file.text());
    } catch {
      setError(t("读取文件失败"));
    }
  };

  const handleFileInput = (event: React.ChangeEvent<HTMLInputElement>) => {
    void readCookieFile(event.target.files?.[0]);
    // Let the same file be picked twice in a row.
    event.target.value = "";
  };

  const handleDrop = (event: React.DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setDragActive(false);
    void readCookieFile(event.dataTransfer.files?.[0]);
  };

  const busy = importingCookies || connectingBrowser !== null;
  /** Localized display name of a site key the server reported back. */
  const siteLabel = (key: string): string => {
    const known = sites?.sites.find((candidate) => candidate.key === key);
    return known ? t(known.name) : key;
  };

  return (
    <section className="rounded-xl border border-border/70 bg-muted/20">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => onOpenChange(!open)}
        className="flex w-full items-center justify-between gap-2 rounded-xl px-3 py-2.5 text-left outline-hidden hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring/40"
      >
        <span className="flex items-center gap-2 text-sm font-medium">
          <KeyRoundIcon
            className="size-4 shrink-0 text-muted-foreground"
            aria-hidden="true"
          />
          {t("站点登录")}
        </span>
        <ChevronDownIcon
          className={cn(
            "size-4 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-180",
          )}
          aria-hidden="true"
        />
      </button>

      {open && (
        <div className="space-y-4 border-t border-border/60 px-3 py-3">
          <p className="text-[11px] text-muted-foreground">
            {t(
              "登录后可以导入需要账号的内容。登录信息只保存在你的服务器上，不会返回浏览器。",
            )}
          </p>

          {canUseBrowser && (
            <div className="space-y-1.5">
              <h4 className="text-xs font-medium">{t("使用本机浏览器")}</h4>
              <p className="text-[11px] text-muted-foreground">
                {t("读取你已登录的浏览器，不会上传账号密码。")}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {browsers.map((browser) => (
                  <Button
                    key={browser.name}
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() => void connectBrowser(browser.name)}
                  >
                    {connectingBrowser === browser.name
                      ? t("正在验证登录…")
                      : browser.label}
                  </Button>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-1.5">
            <h4 className="text-xs font-medium">{t("使用 Cookie 文件")}</h4>
            <p className="text-[11px] text-muted-foreground">
              {t(
                "在浏览器登录站点后，用扩展导出 Netscape 格式的 cookies.txt，再拖到这里。只保留支持站点的 Cookie。",
              )}
            </p>
            <div
              onDragEnter={(event) => {
                event.preventDefault();
                if (busy) return;
                setDragActive(true);
              }}
              onDragOver={(event) => {
                event.preventDefault();
                if (busy) return;
                setDragActive(true);
              }}
              onDragLeave={(event) => {
                event.preventDefault();
                setDragActive(false);
              }}
              onDrop={handleDrop}
              className={cn(
                "flex flex-col items-center gap-2 rounded-lg border border-dashed px-3 py-4 text-center transition-colors",
                dragActive && "border-primary/70 bg-primary/5",
                busy && "opacity-60",
              )}
            >
              <UploadIcon
                className="size-5 text-muted-foreground"
                aria-hidden="true"
              />
              <p className="text-xs text-muted-foreground">
                {importingCookies
                  ? t("正在读取…")
                  : t("把 cookies.txt 拖到这里，或点击选择文件。")}
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => fileInputRef.current?.click()}
              >
                {t("选择 cookies.txt")}
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".txt,text/plain"
                onChange={handleFileInput}
                // Not `display: none`: WebKit refuses to open the picker for an
                // unrendered file input (the same reason the drop zone keeps its
                // input rendered and only moves it off-screen).
                className="absolute -left-[9999px] h-px w-px overflow-hidden opacity-0"
              />
              <p className="text-[11px] text-muted-foreground/80">
                {t("最大 1 MiB。")}
              </p>
            </div>
          </div>

          {error && (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          )}

          {outcome && (
            <div className="space-y-2 text-xs">
              {outcome.connected.length > 0 && (
                <p className="text-emerald-600">
                  {t("已连接 {value1} 个站点", {
                    value1: outcome.connected.length,
                  })}
                </p>
              )}
              {outcome.failed.length > 0 && (
                <div role="alert" className="space-y-1 text-destructive">
                  <p>
                    {t("以下站点验证失败：{value1}", {
                      value1: outcome.failed
                        .map((failed) => siteLabel(failed.siteKey))
                        .join("、"),
                    })}
                  </p>
                  {outcome.failed.map((failed) => (
                    <p key={failed.siteKey} className="text-muted-foreground">
                      {siteLabel(failed.siteKey)}: {failed.message}
                    </p>
                  ))}
                </div>
              )}
              {outcome.ignoredDomains.length > 0 && (
                <p className="text-muted-foreground">
                  {t("已忽略 {value1} 个不在支持列表中的域名", {
                    value1: outcome.ignoredDomains.length,
                  })}
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
