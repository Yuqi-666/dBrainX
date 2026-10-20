// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Pure text arithmetic shared by the search scanner and the highlight painter.
 *
 * Both need the *same* answer to "which characters of which text item does this
 * match cover": search decides it, the page then draws it. Keeping the join and
 * the index arithmetic in one place is what keeps the two from drifting — a
 * highlight that is one character off is worse than no highlight at all.
 *
 * Coordinates are offsets into `PageTextMap.text`, which is built exactly like
 * pdfjs's own find controller builds its page content: every item's `str` in
 * order, plus a `"\n"` after an item that reports `hasEOL`. The pdfjs
 * `TextLayer` renders one `<span>` per item in the same order, so item index
 * maps 1:1 onto `textDivs`.
 */

/**
 * The subset of a pdfjs text item this module needs.
 *
 * `type` is only here so a `TextMarkedContent` entry is assignable: entries
 * without a `str` own no characters and are skipped, exactly as the pdfjs
 * `TextLayer` skips them — which is what keeps `items[i]` pointing at
 * `textDivs[i]`.
 */
export interface PdfTextItemLike {
  str?: string;
  hasEOL?: boolean;
  type?: string;
}

export interface PageTextMap {
  /** Every text item's string, concatenated with synthetic `"\n"` line breaks. */
  text: string;
  /** Offset and length of every item inside `text`, index-aligned with `textDivs`. */
  items: { start: number; length: number }[];
  /** Offsets of the synthetic line breaks — no DOM node owns these. */
  breaks: number[];
}

export function buildPageText(items: readonly PdfTextItemLike[]): PageTextMap {
  let text = "";
  const entries: { start: number; length: number }[] = [];
  const breaks: number[] = [];

  for (const item of items) {
    const value = item?.str;
    // Marked content has no span of its own, so it must not consume an index.
    if (value === undefined) continue;
    entries.push({ start: text.length, length: value.length });
    text += value;
    if (item?.hasEOL) {
      breaks.push(text.length);
      text += "\n";
    }
  }

  return { text, items: entries, breaks };
}

/** A slice of one text item, in the item's own character space. */
export interface PageTextRun {
  item: number;
  start: number;
  end: number;
}

/**
 * Split a `[index, index + length)` match into per-item runs, dropping the
 * synthetic line breaks (no span owns them, so they cannot be painted).
 * Empty items are skipped: pdfjs emits them (spacing, marked content) and they
 * have no text node to measure.
 */
export function runsForRange(
  map: PageTextMap,
  index: number,
  length: number,
): PageTextRun[] {
  const end = index + length;
  const runs: PageTextRun[] = [];

  for (let item = 0; item < map.items.length; item++) {
    const entry = map.items[item];
    if (!entry || !entry.length) continue;
    const start = Math.max(index, entry.start);
    const stop = Math.min(end, entry.start + entry.length);
    if (stop > start) {
      runs.push({ item, start: start - entry.start, end: stop - entry.start });
    }
  }

  return runs;
}

export interface PdfSearchOptions {
  caseSensitive?: boolean;
  wholeWord?: boolean;
}

const REGEXP_SPECIALS = /[.*+?^${}()|[\]\\]/g;
const WORD_CHAR = /[\p{L}\p{N}_]/u;

function escapeRegExp(value: string): string {
  return value.replace(REGEXP_SPECIALS, "\\$&");
}

function isWordChar(value: string | undefined): boolean {
  return value !== undefined && WORD_CHAR.test(value);
}

/**
 * A whitespace-separated query is matched against any run of whitespace, so a
 * phrase still matches when a line break sits between two of its words. The
 * reported length is always the *matched* length, never the query's.
 *
 * Diacritic folding is deliberately absent: folding changes string lengths and
 * would break the offset mapping this module exists to guarantee.
 */
export function findTextMatches(
  text: string,
  query: string,
  options: PdfSearchOptions = {},
): { index: number; length: number }[] {
  const trimmed = query.trim();
  if (!trimmed || !text) return [];

  const pattern = trimmed.split(/\s+/).map(escapeRegExp).join("\\s+");
  const flags = options.caseSensitive ? "gu" : "giu";
  const regexp = new RegExp(pattern, flags);
  const matches: { index: number; length: number }[] = [];

  let match: RegExpExecArray | null;
  while ((match = regexp.exec(text)) !== null) {
    const { index } = match;
    const length = match[0].length;
    if (length === 0) {
      regexp.lastIndex += 1;
      continue;
    }
    if (
      options.wholeWord &&
      (isWordChar(text[index - 1]) || isWordChar(text[index + length]))
    ) {
      continue;
    }
    matches.push({ index, length });
  }

  return matches;
}
