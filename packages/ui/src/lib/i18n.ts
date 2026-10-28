// SPDX-License-Identifier: AGPL-3.0-only

"use client";

import {
  useEffect,
  useMemo,
  useSyncExternalStore,
  type DependencyList,
} from "react";
import {
  DEFAULT_LOCALE,
  getLocale,
  initializeLocale,
  subscribeLocale,
  translate,
} from "./i18n/runtime";

const translators = {
  "zh-CN": (key: string, values?: Record<string, string | number>) =>
    translate(key, values, "zh-CN"),
  en: (key: string, values?: Record<string, string | number>) =>
    translate(key, values, "en"),
};

export { getLocale, setLocale, translate } from "./i18n/runtime";
export type { Locale } from "./i18n/runtime";

/** Subscribe without remounting editors or discarding unsaved component state. */
export function useI18n() {
  const locale = useSyncExternalStore(
    subscribeLocale,
    getLocale,
    () => DEFAULT_LOCALE,
  );
  return { locale, t: translators[locale] };
}

export function LocaleInitializer() {
  useEffect(initializeLocale, []);
  return null;
}

/** Rebuild derived interface labels when the language changes. */
export function useLocaleMemo<T>(
  factory: () => T,
  dependencies: DependencyList,
): T {
  const { locale } = useI18n();
  // The caller supplies the factory dependencies, as for React.useMemo.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(factory, [locale, ...dependencies]);
}
