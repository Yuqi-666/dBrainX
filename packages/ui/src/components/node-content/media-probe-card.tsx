"use client";
import { useI18n } from "@workspace/ui/lib/i18n";

import { FilmIcon, MusicIcon } from "lucide-react";
import type { MediaProbe } from "@workspace/api-client";
import { Button } from "@workspace/ui/components/ui/button";
import { cn } from "@workspace/ui/lib/utils";

/** One selectable quality / audio tier of a probe. */
type ProbeQuality = MediaProbe["qualities"][number];

/**
 * Why a tier is not selectable, or `null` when it is.
 *
 * The server marks a tier whose download would break a policy — `login` for one
 * that needs a saved login, `quota` / `category-limit` for one that would exceed
 * the storage policy, `unavailable` for one the site cannot serve — so the chip
 * can be greyed out with a reason instead of disappearing.
 *
 * `best` is the "let the server pick" option and stays importable even when the
 * server would mark a fixed resolution unusable: the application layer resolves
 * it to the best stream the caller is allowed to have.
 */
export function qualityDisabledReason(quality: ProbeQuality): string | null {
  if (quality.id === "best") return null;
  const reason = quality.disabledReason;
  return reason ?? null;
}

/** `95` → `1:35`; the probe reports seconds. */
function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "";
  const total = Math.round(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = total % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`
    : `${minutes}:${String(rest).padStart(2, "0")}`;
}

/** `0` → `""`; otherwise a binary-size label for the estimated size. */
function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const rounded =
    value >= 10 || unit === 0 ? Math.round(value) : value.toFixed(1);
  return `${rounded} ${units[unit]}`;
}

interface MediaProbeCardProps {
  /** The parse result the dialog is about to import. */
  probe: MediaProbe;
  /** Chosen tier's format id, `null` before the user picks one. */
  selectedFormatId: string | null;
  /** Called with the tier's yt-dlp format id. */
  onSelectFormat: (formatId: string) => void;
  /** Opens the login sheet for the matching site. */
  onLoginClick: () => void;
  className?: string;
}

/**
 * The parse result card (design §3 "解析结果" / §5).
 *
 * Shows what the site answered for the pasted address — cover, title,
 * artist/uploader, duration — and the tiers it offers, because the server
 * validates the chosen `formatId` against its probe and nothing else is trusted.
 *
 * The cover is the server's data URL (the server never hot-links a third-party
 * image), so it needs no `resolveFileUrl`. Tiers the user cannot use are shown
 * disabled with the reason, and a login hint points at the one action that
 * unlocks them; that is also the only place a `login_required` recovery starts.
 */
export function MediaProbeCard({
  probe,
  selectedFormatId,
  onSelectFormat,
  onLoginClick,
  className,
}: MediaProbeCardProps) {
  const { t } = useI18n();
  const kind = probe.kind;
  const duration = formatDuration(probe.duration);
  const subtitleHint =
    probe.subtitleLanguages.length > 0
      ? kind === "audio"
        ? t("将同时导入歌词")
        : t("将同时导入字幕")
      : null;
  // A site can hide its track list from a signed-out viewer: Bilibili only
  // returns its caption list to a logged-in request, so an anonymous probe shows
  // no track even when the media has one. Say so instead of leaving the card
  // silent, or the user reads "no subtitles" as final.
  const subtitleMissingHint =
    probe.subtitleLanguages.length === 0 &&
    !probe.loggedIn &&
    !probe.requiresLogin
      ? kind === "audio"
        ? t("未检测到歌词；部分站点需登录后才能获取歌词。")
        : t("未检测到字幕；部分站点需登录后才能获取字幕。")
      : null;
  const loginLocked =
    probe.requiresLogin ||
    probe.qualities.some(
      (quality) => qualityDisabledReason(quality) === "login",
    );

  const disabledReasonLabel = (reason: string): string => {
    switch (reason) {
      case "login":
        return t("登录后可解锁");
      case "quota":
      case "category-limit":
        return t("超出存储上限");
      default:
        return t("不可用");
    }
  };

  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-xl border border-border/70 bg-muted/20 p-3",
        className,
      )}
    >
      <div className="flex gap-3">
        {probe.thumbnailDataUrl ? (
          // A data URL already, so a plain <img> needs no loader. The alt is the
          // title, which is what the image stands for.
          <img
            src={probe.thumbnailDataUrl}
            alt={probe.title}
            className="size-20 shrink-0 rounded-lg object-cover"
          />
        ) : (
          <div className="flex size-20 shrink-0 items-center justify-center rounded-lg bg-muted">
            {kind === "audio" ? (
              <MusicIcon className="size-6 text-muted-foreground" />
            ) : (
              <FilmIcon className="size-6 text-muted-foreground" />
            )}
          </div>
        )}
        <div className="min-w-0 flex-1 space-y-1">
          <p className="truncate text-sm font-medium" title={probe.title}>
            {probe.title || t("未命名媒体")}
          </p>
          {(probe.artist || probe.album) && (
            <p className="truncate text-xs text-muted-foreground">
              {[probe.artist, kind === "audio" ? probe.album : ""]
                .filter(Boolean)
                .join(" · ")}
            </p>
          )}
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            {duration ? <span>{duration}</span> : null}
            {subtitleHint ? <span>{subtitleHint}</span> : null}
          </p>
        </div>
      </div>

      {subtitleMissingHint ? (
        <p className="text-xs text-muted-foreground">{subtitleMissingHint}</p>
      ) : null}

      {probe.qualities.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs font-medium">
            {kind === "audio" ? t("音质") : t("清晰度")}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {probe.qualities.map((quality) => {
              const reason = qualityDisabledReason(quality);
              const disabled = reason !== null;
              const selected = quality.formatId === selectedFormatId;
              const size = formatBytes(quality.estimatedBytes);
              return (
                <button
                  key={quality.formatId}
                  type="button"
                  disabled={disabled}
                  aria-pressed={selected}
                  title={disabled ? disabledReasonLabel(reason) : quality.codec}
                  onClick={() => onSelectFormat(quality.formatId)}
                  className={cn(
                    "rounded-lg border px-2.5 py-1.5 text-left text-xs transition-colors",
                    "hover:border-border hover:bg-muted/60",
                    selected
                      ? "border-primary bg-primary/5 text-foreground"
                      : "border-border/70 bg-background text-muted-foreground",
                    disabled &&
                      "cursor-not-allowed opacity-50 hover:border-border/70 hover:bg-background",
                  )}
                >
                  <span className="block font-medium text-foreground">
                    {t(quality.label)}
                  </span>
                  <span className="block">
                    {disabled
                      ? disabledReasonLabel(reason)
                      : size
                        ? t("预计大小 {value1}", { value1: size })
                        : quality.ext.toUpperCase()}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {loginLocked && (
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
          <p className="text-muted-foreground">
            {kind === "audio"
              ? t("登录后可解锁更高音质。")
              : t("登录后可解锁更多清晰度。")}
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onLoginClick}
          >
            {t("登录")}
          </Button>
        </div>
      )}

      {kind === "audio" && probe.album ? (
        <p className="text-xs text-muted-foreground">
          {t("专辑或播放列表链接只导入第一首。")}
        </p>
      ) : null}
    </div>
  );
}
