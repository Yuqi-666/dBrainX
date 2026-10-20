// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The pdf viewer's pure half, pinned. Run with:
 *
 * ```sh
 * pnpm --filter=@workspace/ui test
 * ```
 *
 * Two families live here, and both fail *silently* in the browser:
 *
 * - **The index map.** Search reports offsets into a page's joined text, and the
 *   page turns those offsets back into `<span>` slices to measure. If the join
 *   and the lookup ever disagree — by one item, or by one character — the
 *   highlight lands on the wrong word (or nowhere) and nothing throws.
 * - **The matcher.** Case folding, whitespace runs and word boundaries are
 *   choices, not accidents: a phrase has to survive the line break the pdf
 *   inserted, and 全字匹配 has to reject a hit inside a longer word.
 *
 * The invariant the whole module exists for: `PageTextMap.items[i]` must line up
 * with `TextLayer.textDivs[i]`, which is why marked-content entries are skipped.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildPageText,
  findTextMatches,
  runsForRange,
  type PdfTextItemLike,
} from "./pdf-text.ts";

/** Two items on one line, a line break, then a third — the usual pdf shape. */
const SAMPLE: PdfTextItemLike[] = [
  { str: "Hello " },
  { str: "world", hasEOL: true },
  { str: "Again" },
];

test("buildPageText: joins items, breaks the line, and records offsets", () => {
  const map = buildPageText(SAMPLE);
  assert.equal(map.text, "Hello world\nAgain");
  assert.deepEqual(map.items, [
    { start: 0, length: 6 },
    { start: 6, length: 5 },
    { start: 12, length: 5 },
  ]);
  assert.deepEqual(map.breaks, [11]);
});

test("buildPageText: marked content consumes no index — textDivs stay aligned", () => {
  const map = buildPageText([
    { str: "A" },
    { type: "beginMarkedContent", str: undefined },
    { str: "B", hasEOL: false },
    { type: "endMarkedContent", str: undefined },
  ]);
  assert.equal(map.text, "AB");
  assert.deepEqual(map.items, [
    { start: 0, length: 1 },
    { start: 1, length: 1 },
  ]);
});

test("buildPageText: an empty item keeps its slot, because the layer renders it", () => {
  const map = buildPageText([{ str: "A" }, { str: "" }, { str: "B" }]);
  assert.equal(map.items.length, 3);
  assert.deepEqual(map.items[1], { start: 1, length: 0 });
});

test("runsForRange: a match inside one item is one run", () => {
  const map = buildPageText(SAMPLE);
  assert.deepEqual(runsForRange(map, 0, 5), [{ item: 0, start: 0, end: 5 }]);
});

test("runsForRange: a match across two items is clamped on both sides", () => {
  const map = buildPageText(SAMPLE);
  // "lo wo" — starts inside item 0, ends inside item 1.
  assert.deepEqual(runsForRange(map, 3, 5), [
    { item: 0, start: 3, end: 6 },
    { item: 1, start: 0, end: 2 },
  ]);
});

test("runsForRange: a match over a line break paints both sides and skips the \\n", () => {
  const map = buildPageText(SAMPLE);
  // "world\nAgain" — the newline has no span, so it cannot be painted.
  assert.deepEqual(runsForRange(map, 6, 11), [
    { item: 1, start: 0, end: 5 },
    { item: 2, start: 0, end: 5 },
  ]);
});

test("findTextMatches: case folds unless asked not to", () => {
  const map = buildPageText(SAMPLE);
  assert.deepEqual(findTextMatches(map.text, "hello"), [
    { index: 0, length: 5 },
  ]);
  assert.deepEqual(
    findTextMatches(map.text, "hello", { caseSensitive: true }),
    [],
  );
  assert.deepEqual(
    findTextMatches(map.text, "Hello", { caseSensitive: true }),
    [{ index: 0, length: 5 }],
  );
});

test("findTextMatches: a phrase matches across the inserted line break", () => {
  const map = buildPageText(SAMPLE);
  // The whitespace run is wider than the query's, so the *matched* length is
  // reported — that is the length the painter has to cover.
  assert.deepEqual(findTextMatches(map.text, "world again"), [
    { index: 6, length: 11 },
  ]);
});

test("findTextMatches: 全字匹配 rejects a hit inside a longer word", () => {
  const map = buildPageText(SAMPLE);
  assert.deepEqual(findTextMatches(map.text, "gain"), [
    { index: 13, length: 4 },
  ]);
  assert.deepEqual(findTextMatches(map.text, "gain", { wholeWord: true }), []);
  assert.deepEqual(findTextMatches(map.text, "Again", { wholeWord: true }), [
    { index: 12, length: 5 },
  ]);
});

test("findTextMatches: an empty query matches nothing, not everything", () => {
  const map = buildPageText(SAMPLE);
  assert.deepEqual(findTextMatches(map.text, ""), []);
  assert.deepEqual(findTextMatches(map.text, "   "), []);
  assert.deepEqual(findTextMatches("", "hello"), []);
});

test("findTextMatches: the query is literal, never a pattern", () => {
  const text = "a+b (1) [x]";
  assert.deepEqual(findTextMatches(text, "a+b (1)"), [{ index: 0, length: 7 }]);
  assert.deepEqual(findTextMatches(text, "[x]"), [{ index: 8, length: 3 }]);
  assert.deepEqual(findTextMatches(text, ".*"), []);
});
