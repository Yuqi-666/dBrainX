// SPDX-License-Identifier: AGPL-3.0-only

"use client";

/**
 * Document-wide search behind `Ctrl/Cmd+F`.
 *
 * The scan walks **every** page, not just the rendered ones: the page strip is
 * virtualised, so a match on a page that has never been painted still has to be
 * counted and reachable. Text content is shared with the text layer through the
 * document hook's cache, so scanning does not fetch anything twice.
 *
 * Matching itself is `findTextMatches` (see `pdf-text.ts`); this hook owns the
 * parts around it — debounce, cancellation across query edits, incremental
 * results while a long document is still being scanned, and the current hit.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { findTextMatches } from "./pdf-text";
import type { PdfSearchMatch } from "./types";
import type { PdfTextSnapshot } from "./use-pdf-document";

/** Referentially stable empty bucket, so pages without hits do not re-render. */
const NO_MATCHES: readonly PdfSearchMatch[] = [];

/** Commit partial results this often, so the counter moves on a long document. */
const COMMIT_EVERY = 8;

const DEBOUNCE_MS = 180;

export interface PdfSearchApi {
  open: boolean;
  setOpen: (open: boolean) => void;
  query: string;
  setQuery: (query: string) => void;
  caseSensitive: boolean;
  setCaseSensitive: (value: boolean) => void;
  wholeWord: boolean;
  setWholeWord: (value: boolean) => void;
  /** True while pages are still being scanned. */
  pending: boolean;
  matches: readonly PdfSearchMatch[];
  /** 1-based position of the current hit, `0` when there is none. */
  activePosition: number;
  activeMatch: PdfSearchMatch | null;
  next: () => void;
  prev: () => void;
  matchesForPage: (page: number) => readonly PdfSearchMatch[];
}

export interface UsePdfSearchOptions {
  getTextContent: (page: number) => Promise<PdfTextSnapshot | null>;
  pageCount: number;
  /** Search only runs against a loaded document. */
  enabled: boolean;
}

export function usePdfSearch({
  getTextContent,
  pageCount,
  enabled,
}: UsePdfSearchOptions): PdfSearchApi {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [pending, setPending] = useState(false);
  const [matches, setMatches] = useState<readonly PdfSearchMatch[]>(NO_MATCHES);
  const [activeIndex, setActiveIndex] = useState(-1);

  /** Bumped on every query/option edit so a running scan can be abandoned. */
  const generation = useRef(0);

  const armed = enabled && open && query.trim().length > 0;

  useEffect(() => {
    const token = ++generation.current;

    if (!armed) {
      setMatches(NO_MATCHES);
      setActiveIndex(-1);
      setPending(false);
      return;
    }

    let cancelled = false;
    setPending(true);

    const scan = async () => {
      const found: PdfSearchMatch[] = [];
      let committed = 0;

      for (let page = 1; page <= pageCount; page++) {
        if (cancelled || generation.current !== token) return;

        const snapshot = await getTextContent(page);
        if (cancelled || generation.current !== token) return;

        if (snapshot) {
          for (const hit of findTextMatches(snapshot.map.text, query, {
            caseSensitive,
            wholeWord,
          })) {
            found.push({ page, index: hit.index, length: hit.length });
          }
        }

        if (found.length - committed >= COMMIT_EVERY || page === pageCount) {
          committed = found.length;
          setMatches([...found]);
        }
      }

      if (cancelled || generation.current !== token) return;
      setMatches([...found]);
      setActiveIndex(found.length > 0 ? 0 : -1);
      setPending(false);
    };

    const timer = setTimeout(() => {
      void scan();
    }, DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [armed, query, caseSensitive, wholeWord, pageCount, getTextContent]);

  const byPage = useMemo(() => {
    const buckets = new Map<number, PdfSearchMatch[]>();
    for (const match of matches) {
      const bucket = buckets.get(match.page);
      if (bucket) bucket.push(match);
      else buckets.set(match.page, [match]);
    }
    return buckets;
  }, [matches]);

  const matchesForPage = useCallback(
    (page: number): readonly PdfSearchMatch[] => byPage.get(page) ?? NO_MATCHES,
    [byPage],
  );

  const next = useCallback(() => {
    if (!matches.length) return;
    setActiveIndex((current) =>
      current < 0 ? 0 : (current + 1) % matches.length,
    );
  }, [matches.length]);

  const prev = useCallback(() => {
    if (!matches.length) return;
    setActiveIndex((current) =>
      current < 0
        ? matches.length - 1
        : (current - 1 + matches.length) % matches.length,
    );
  }, [matches.length]);

  const activeMatch =
    activeIndex >= 0 && activeIndex < matches.length
      ? (matches[activeIndex] ?? null)
      : null;

  return {
    open,
    setOpen,
    query,
    setQuery,
    caseSensitive,
    setCaseSensitive,
    wholeWord,
    setWholeWord,
    pending,
    matches,
    activePosition: activeMatch ? activeIndex + 1 : 0,
    activeMatch,
    next,
    prev,
    matchesForPage,
  };
}
