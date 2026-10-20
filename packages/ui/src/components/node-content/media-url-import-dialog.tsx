// SPDX-License-Identifier: AGPL-3.0-only

"use client";
import { useI18n } from "@workspace/ui/lib/i18n";

import { useEffect, useId, useState } from "react";
import {
  probeMediaSource,
  type MediaProbe,
  type MediaSites,
} from "@workspace/api-client";
import type { MediaKind } from "@workspace/interfaces";
import { Button } from "@workspace/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/ui/dialog";
import { Input } from "@workspace/ui/components/ui/input";
import { Label } from "@workspace/ui/components/ui/label";
import { MediaProbeCard, qualityDisabledReason } from "./media-probe-card";
import { MediaSiteCapsules } from "./media-site-capsules";
import { MediaSiteLoginPanel } from "./media-site-login-panel";
import { useMediaSiteAuth } from "./use-media-site-auth";
import { mediaImportFailure } from "./use-media-url-import";

/** What the zone must start once the user confirms the parsed result. */
export interface MediaImportRequest {
  kind: MediaKind;
  url: string;
  probeId?: string;
  formatId?: string;
}

interface MediaUrlImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Which flow the dialog serves; also which site capsules it shows. */
  kind: MediaKind;
  /**
   * Starts the import. The zone owns the API call, the progress view and the
   * node write; the dialog closes itself before calling this.
   */
  onSubmit: (request: MediaImportRequest) => void;
  /** Address to prefill, e.g. the one a failed attempt used. */
  initialUrl?: string;
  /** Rejection to show under the field, e.g. why the previous attempt failed. */
  initialError?: string | null;
}

/**
 * Accepts only an absolute HTTP(S) address.
 *
 * A pasted media link must be a page the backend can fetch; a bare host or a
 * `file:` URL would only fail later, after a round trip. This is a cheap
 * client-side gate, not the real validation — the server decides whether the
 * site is supported and whether it needs a login.
 */
function isHttpUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * The listed site a pasted address belongs to, computed with the same host
 * suffix rule the server uses (`host === entry` or `host.endsWith("." + entry)`).
 */
function siteKeyForUrl(
  sites: MediaSites["sites"] | undefined,
  url: string,
): string | null {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
  if (host === "") return null;
  const site = sites?.find((candidate) =>
    candidate.hosts.some(
      (entry) => host === entry || host.endsWith(`.${entry}`),
    ),
  );
  return site?.key ?? null;
}

/**
 * The URL → parse → confirm dialog both media empty states share (design §3,
 * audio §3-§5).
 *
 * The flow is deliberately two-step: the URL is parsed first, and only the
 * parsed result can be imported. That is what lets the user pick a quality /
 * audio tier, see what the video or song actually is, and recover from a login
 * wall before a minutes-long download starts.
 *
 * The dialog ends at the confirm: it closes on import and the drop zone takes
 * over with its progress view, because the download outlives this component.
 * The site capsules and the inline login area are shared with the other kind —
 * one exported `cookies.txt` can connect video and music sites at the same
 * time.
 */
export function MediaUrlImportDialog({
  open,
  onOpenChange,
  kind,
  onSubmit,
  initialUrl = "",
  initialError = null,
}: MediaUrlImportDialogProps) {
  const { t } = useI18n();
  const inputId = useId();
  const {
    snapshot: siteSnapshot,
    refresh: refreshSites,
    verify: verifySite,
    disconnect: disconnectSite,
  } = useMediaSiteAuth(kind);

  /** Address being imported. */
  const [url, setUrl] = useState("");
  /** Inline rejection: client validation, the previous attempt, or a probe error. */
  const [error, setError] = useState<string | null>(null);
  /** True while `probeMediaSource` is running. */
  const [probing, setProbing] = useState(false);
  /** Successful parse, `null` until the URL is parsed. */
  const [probe, setProbe] = useState<MediaProbe | null>(null);
  /** Selected quality / audio tier (a yt-dlp format id). */
  const [selectedFormatId, setSelectedFormatId] = useState<string | null>(null);
  /** Site whose capsule the last parse said needs a login. */
  const [loginRequiredSiteKey, setLoginRequiredSiteKey] = useState<
    string | null
  >(null);
  /** True while the inline login area is expanded. */
  const [loginPanelOpen, setLoginPanelOpen] = useState(false);
  /** Site the browser method targets; the cookie method works without one. */
  const [loginTargetSiteKey, setLoginTargetSiteKey] = useState<string | null>(
    null,
  );
  /** Re-parse automatically once the login succeeds. */
  const [parseAfterLogin, setParseAfterLogin] = useState(false);

  // Every opening starts from the host's draft (the failed attempt's URL and
  // reason) and forgets the previous parse result: it belongs to a different
  // address.
  useEffect(() => {
    if (!open) return;
    setUrl(initialUrl);
    setError(initialError);
    setProbing(false);
    setProbe(null);
    setSelectedFormatId(null);
    setLoginRequiredSiteKey(null);
    setLoginPanelOpen(false);
    setLoginTargetSiteKey(null);
    setParseAfterLogin(false);
  }, [open, initialUrl, initialError]);

  const matchedSiteKey = siteKeyForUrl(siteSnapshot.data?.sites, url);
  /** The listed site the address belongs to, once the catalog has loaded. */
  const matchedSite =
    siteSnapshot.data?.sites.find((site) => site.key === matchedSiteKey) ??
    null;

  /** Loads the site catalog once; capsules show saved-login status from it. */
  useEffect(() => {
    if (open && siteSnapshot.data === null) void refreshSites();
  }, [open, refreshSites, siteSnapshot.data]);

  const handleParse = async () => {
    const pageUrl = url.trim();
    if (pageUrl === "") {
      setError(t("请输入链接"));
      return;
    }
    if (!isHttpUrl(pageUrl)) {
      setError(t("请输入以 http:// 或 https:// 开头的链接"));
      return;
    }

    setError(null);
    setProbing(true);
    setProbe(null);
    setSelectedFormatId(null);
    setLoginRequiredSiteKey(null);
    try {
      const result = await probeMediaSource({ url: pageUrl, kind });
      setProbe(result);
      // Default to the best tier the site returned; a tier the server marked
      // unusable is never preselected.
      const firstUsable = result.qualities.find(
        (quality) => qualityDisabledReason(quality) === null,
      );
      setSelectedFormatId(
        firstUsable?.formatId ?? result.qualities[0]?.formatId ?? null,
      );
    } catch (cause) {
      const failure = mediaImportFailure(cause);
      setError(failure.message);
      if (
        failure.code === "login_required" ||
        failure.code === "login_expired"
      ) {
        // Point the reply at the one action that can fix it: open the inline
        // login area on the matching site, or on the site the server named
        // when it is not in the URL.
        setLoginRequiredSiteKey(matchedSiteKey);
        setLoginTargetSiteKey(matchedSiteKey);
        setLoginPanelOpen(true);
      }
    } finally {
      setProbing(false);
    }
  };

  const openLogin = (siteKey: string | null) => {
    setLoginTargetSiteKey(siteKey);
    setLoginPanelOpen(true);
  };

  const handleConnected = async (
    siteKeys: string[],
    method: "browser" | "cookies",
  ) => {
    await refreshSites();
    if (parseAfterLogin) {
      setParseAfterLogin(false);
      setLoginPanelOpen(false);
      void handleParse();
      return;
    }
    // A browser connection is one site and the capsule underneath already shows
    // the result, so the login area can collapse. A cookie import reports
    // connected and failed sites that the user should read before dismissing
    // it, so it stays open.
    if (method === "browser") setLoginPanelOpen(false);
    // A login only matters here when a site was highlighted; keep the mark off
    // once the matching capsule is connected.
    if (
      loginRequiredSiteKey !== null &&
      siteKeys.includes(loginRequiredSiteKey)
    ) {
      setLoginRequiredSiteKey(null);
    }
  };

  const handleImport = () => {
    if (!probe) return;
    onOpenChange(false);
    onSubmit({
      kind,
      url: url.trim(),
      probeId: probe.probeId,
      formatId: selectedFormatId ?? undefined,
    });
  };

  const loginRequiredSite = loginRequiredSiteKey
    ? (siteSnapshot.data?.sites.find(
        (site) => site.key === loginRequiredSiteKey,
      ) ?? null)
    : null;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {kind === "video" ? t("从视频网站添加") : t("从音乐网站添加")}
            </DialogTitle>
            <DialogDescription>
              {kind === "video"
                ? t("粘贴视频页面链接，服务器会下载并转码后保存到资源库。")
                : t("粘贴音乐页面链接，服务器会下载并保存到资源库。")}
            </DialogDescription>
          </DialogHeader>

          <div className="mt-4 flex flex-col gap-3">
            <div className="grid gap-2">
              <Label htmlFor={inputId}>
                {kind === "video" ? t("视频页面链接") : t("音乐页面链接")}
              </Label>
              <div className="flex gap-2">
                <Input
                  id={inputId}
                  autoFocus
                  // `type="text"`, not `"url"`: the browser's own constraint
                  // validation would replace the inline message below with a
                  // native bubble, in the browser's language rather than the
                  // app's.
                  type="text"
                  inputMode="url"
                  maxLength={2048}
                  placeholder={
                    kind === "video"
                      ? t("粘贴视频页面地址")
                      : t("粘贴音乐页面地址")
                  }
                  value={url}
                  disabled={probing}
                  aria-invalid={error ? true : undefined}
                  onChange={(event) => {
                    setUrl(event.target.value);
                    // A new address invalidates the previous parse result and
                    // any message about it.
                    setProbe(null);
                    setSelectedFormatId(null);
                    setLoginRequiredSiteKey(null);
                    if (error) setError(null);
                  }}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter") return;
                    event.preventDefault();
                    if (!probing) void handleParse();
                  }}
                />
                <Button
                  type="button"
                  variant="secondary"
                  disabled={probing || url.trim() === ""}
                  onClick={() => void handleParse()}
                >
                  {probing ? t("正在解析…") : t("解析")}
                </Button>
              </div>
              {matchedSite && (
                // The recognition line the design asks for: which listed site
                // the address is for, and whether its saved login is on. A site
                // outside the catalog simply shows nothing here — it still
                // imports.
                <p className="text-xs text-muted-foreground">
                  {t("识别到 {value1}", { value1: t(matchedSite.name) })}
                  {matchedSite.loggedIn ? ` · ${t("已登录")}` : ""}
                </p>
              )}
              {error && (
                <p role="alert" className="text-xs text-destructive">
                  {error}
                </p>
              )}
              {loginRequiredSiteKey && loginRequiredSite && (
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <p className="text-muted-foreground">
                    {t("{value1} 需要登录后才能解析。", {
                      value1: t(loginRequiredSite.name),
                    })}
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setParseAfterLogin(true);
                      openLogin(loginRequiredSiteKey);
                    }}
                  >
                    {t("登录后解析")}
                  </Button>
                </div>
              )}
            </div>

            {siteSnapshot.data === null && siteSnapshot.error ? (
              // The catalog is what draws the capsule row; a failed load leaves
              // the dialog without it, and that must not look like "this build
              // has no login support". A missing PocketBase collection (forgot
              // to restart after the migration) lands here too.
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <p role="alert" className="text-muted-foreground">
                  {t("站点列表加载失败，请重试。")}
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void refreshSites()}
                >
                  {t("重试")}
                </Button>
              </div>
            ) : null}

            {siteSnapshot.data?.sites.length ? (
              <MediaSiteCapsules
                sites={siteSnapshot.data.sites}
                matchedSiteKey={matchedSiteKey}
                loginRequiredSiteKey={loginRequiredSiteKey}
                onSelectLoggedOut={(site) => {
                  // When the last parse failed for a login reason, connecting
                  // that site finishes the job by re-reading the link.
                  setParseAfterLogin(loginRequiredSiteKey !== null);
                  openLogin(site.key);
                }}
                onVerify={(site) => void verifySite(site.key)}
                onReplace={(site) => openLogin(site.key)}
                onDisconnect={(site) => void disconnectSite(site.key)}
              />
            ) : null}

            <MediaSiteLoginPanel
              open={loginPanelOpen}
              onOpenChange={(next) => {
                setLoginPanelOpen(next);
                // A panel closed without connecting must not make a much later
                // cookie import re-parse the address.
                if (!next) setParseAfterLogin(false);
              }}
              sites={siteSnapshot.data}
              // The clicked capsule wins; otherwise the site of the address /
              // the parse is the one the browser method can target.
              siteKey={
                loginTargetSiteKey ?? matchedSiteKey ?? probe?.siteKey ?? null
              }
              onConnected={(siteKeys, method) =>
                void handleConnected(siteKeys, method)
              }
            />

            {probe && (
              <MediaProbeCard
                probe={probe}
                selectedFormatId={selectedFormatId}
                onSelectFormat={setSelectedFormatId}
                onLoginClick={() => {
                  // A probe that already answered "login required" becomes a
                  // one-step flow: sign in, then the dialog re-reads the link.
                  if (probe.requiresLogin) setParseAfterLogin(true);
                  openLogin(probe.siteKey ?? matchedSiteKey);
                }}
              />
            )}
          </div>

          <DialogFooter className="mt-6">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              {t("取消")}
            </Button>
            <Button
              type="button"
              disabled={probing || !probe}
              onClick={handleImport}
            >
              {t("导入")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
