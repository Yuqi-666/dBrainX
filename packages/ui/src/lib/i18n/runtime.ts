// SPDX-License-Identifier: AGPL-3.0-only

import { messages } from "./messages.ts";

export type Locale = "zh-CN" | "en";
export const DEFAULT_LOCALE: Locale = "zh-CN";
export const LOCALE_STORAGE_KEY = "dbrainx.locale";
let locale: Locale = DEFAULT_LOCALE;
const listeners = new Set<() => void>();

export function resolveLocale(value: string | null): Locale {
  return value === "en" ? "en" : DEFAULT_LOCALE;
}

export function getLocale(): Locale {
  return locale;
}

export function subscribeLocale(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function setLocale(next: Locale, persist = true): void {
  if (typeof document !== "undefined") document.documentElement.lang = next;
  if (persist && typeof window !== "undefined") {
    try {
      window.localStorage.setItem(LOCALE_STORAGE_KEY, next);
    } catch {
      // Language switching also works when browser storage is unavailable.
    }
  }
  if (locale === next) return;
  locale = next;
  listeners.forEach((listener) => listener());
}

export function initializeLocale(): () => void {
  if (typeof window === "undefined") return () => {};
  let saved: string | null = null;
  try {
    saved = window.localStorage.getItem(LOCALE_STORAGE_KEY);
  } catch {
    // Use the same default as server rendering.
  }
  setLocale(resolveLocale(saved), false);
  const onStorage = (event: StorageEvent) => {
    if (event.key === LOCALE_STORAGE_KEY || event.key === null) {
      setLocale(resolveLocale(event.newValue), false);
    }
  };
  window.addEventListener("storage", onStorage);
  return () => window.removeEventListener("storage", onStorage);
}

/** Translate interface copy. Missing entries retain their source text. */
export function translate(
  key: string,
  values?: Record<string, string | number>,
  language: Locale = locale,
): string {
  const text = messages[key]?.[language] ?? key;
  return text.replace(/\{(\w+)\}/g, (match, name: string) =>
    values?.[name] === undefined ? match : String(values[name]),
  );
}
