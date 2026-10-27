// SPDX-License-Identifier: AGPL-3.0-only

/** Byte formatting for the resource library. */
import type { Locale } from "@workspace/ui/lib/i18n";

/** 1024-based units, the convention PocketBase and the storage contract use. */
const BYTE_UNITS = ["B", "KB", "MB", "GB", "TB", "PB"] as const;

/**
 * Formats a byte count the way the storage panel and a card show it
 * ("12.3 MB"). One decimal keeps sizes readable without restarting the number
 * as it grows; a whole value drops the trailing `.0`.
 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const exponent = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    BYTE_UNITS.length - 1,
  );
  const value = bytes / 1024 ** exponent;
  const text =
    exponent === 0
      ? String(Math.round(value))
      : value.toFixed(1).replace(/\.0$/, "");
  return `${text} ${BYTE_UNITS[exponent]}`;
}

/** Formats a stored timestamp for a card; an unreadable one renders a dash. */
export function formatCreatedAt(value: string, locale: Locale): string {
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return "—";
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(timestamp);
}
