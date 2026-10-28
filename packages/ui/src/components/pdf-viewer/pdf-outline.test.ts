// SPDX-License-Identifier: AGPL-3.0-only

import assert from "node:assert/strict";
import test from "node:test";

import {
  outlineActiveKeys,
  outlinePathIsOnActiveChain,
} from "./pdf-outline.ts";
import type { PdfOutlineEntry } from "./types.ts";

const entry = (
  title: string,
  page: number | null,
  items: PdfOutlineEntry[] = [],
): PdfOutlineEntry => ({ title, page, items });

/**
 * ch1 (1) ─ ch1.1 (3) ─ ch1.2 (5)
 * ch2 (7) ─ ch2.1 (9)
 * ch3 (20, unresolvable destination)
 */
const outline: PdfOutlineEntry[] = [
  entry("ch1", 1, [entry("ch1.1", 3), entry("ch1.2", 5)]),
  entry("ch2", 7, [entry("ch2.1", 9)]),
  entry("ch3", null),
];

function keys(page: number): string[] {
  return [...outlineActiveKeys(outline, page)].sort();
}

test("a chapter stays lit across its own pages, not only on its first", () => {
  // Page 1 is inside ch1: ch1 is lit, its first child has not begun yet.
  assert.deepEqual(keys(1), ["0"]);
  // Page 4 is between ch1.1 and ch1.2: ch1.1 stays lit.
  assert.deepEqual(keys(4), ["0", "0.0"]);
  // Page 5 starts ch1.2.
  assert.deepEqual(keys(5), ["0", "0.1"]);
  // Page 6 is still ch1.2 — the next chapter has not begun.
  assert.deepEqual(keys(6), ["0", "0.1"]);
});

test("the next chapter replaces the previous one", () => {
  assert.deepEqual(keys(7), ["1"]);
  assert.deepEqual(keys(9), ["1", "1.0"]);
  // Past the last resolvable destination nothing new lights up; ch2.1 owns the
  // tail of the document.
  assert.deepEqual(keys(300), ["1", "1.0"]);
});

test("a row whose destination is ahead of the reader stays unlit", () => {
  assert.ok(!keys(2).includes("1"));
  assert.ok(!keys(6).includes("1"));
  // A null destination never lights up.
  assert.ok(!keys(300).includes("2"));
});

test("the active chain is what unfolds", () => {
  const active = outlineActiveKeys(outline, 9);
  assert.equal(outlinePathIsOnActiveChain(active, "1"), true);
  assert.equal(outlinePathIsOnActiveChain(active, "1.0"), false);
  assert.equal(outlinePathIsOnActiveChain(active, "0"), false);
});

test("an outline without pages leaves nothing lit", () => {
  assert.deepEqual([...outlineActiveKeys([entry("only", null)], 12)], []);
});
