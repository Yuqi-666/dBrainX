// SPDX-License-Identifier: AGPL-3.0-only

"use client";

import { useEffect, useRef, useState } from "react";

/** Restore after hydration; unavailable or malformed storage keeps the default. */
export function useToolbarPreference<T>(
  name: string,
  initial: T,
  validate: (value: unknown) => value is T,
  persist = true,
) {
  const key = `dbrain:annotation:toolbar:v1:${name}`;
  const [value, setValue] = useState<T>(initial);
  const [ready, setReady] = useState(false);
  const validateRef = useRef(validate);
  validateRef.current = validate;

  useEffect(() => {
    try {
      const stored = localStorage.getItem(key);
      if (stored !== null) {
        const parsed: unknown = JSON.parse(stored);
        if (validateRef.current(parsed)) setValue(parsed);
      }
    } catch {
      // Private browsing, storage quota and invalid JSON must not disable ink.
    }
    setReady(true);
  }, [key]);

  useEffect(() => {
    if (!ready || !persist) return;
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Preferences are optional; drawing remains available without storage.
    }
  }, [key, persist, ready, value]);

  return [value, setValue] as const;
}
