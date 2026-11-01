// SPDX-License-Identifier: AGPL-3.0-only

"use client";

import { useCallback, useRef, useState } from "react";

export interface AttributeDraftField {
  value: string;
  change: (next: string) => void;
}

/**
 * A text control whose displayed value is the store's, with a local draft while
 * its edit is in flight.
 *
 * The draft is dropped as soon as the sent edit settles, so a refused operation
 * leaves the control showing what the store still holds instead of a value that
 * never reached the server. Only the newest edit may settle the field: an older
 * reply arriving late cannot revert text the user has typed since.
 */
export function useAttributeDraft(
  stored: string,
  submit: (value: string) => Promise<unknown>,
): AttributeDraftField {
  const [draft, setDraft] = useState<string | null>(null);
  const latest = useRef(0);

  const change = useCallback(
    (next: string) => {
      const request = latest.current + 1;
      latest.current = request;
      setDraft(next);
      const settle = () => {
        if (latest.current === request) setDraft(null);
      };
      void submit(next).then(settle, settle);
    },
    [submit],
  );

  return { value: draft ?? stored, change };
}
