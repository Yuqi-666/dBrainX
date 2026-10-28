// SPDX-License-Identifier: AGPL-3.0-only

import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

/**
 * The TOC highlight decides its section from geometry: the heading whose top
 * last crossed the reading line is the section the reader is in.
 *
 * The sidebar used to rely on `@tiptap/extension-table-of-contents`' `isActive`,
 * which compares `window.scrollY` with each heading's `offsetTop`. The
 * rich-text node editor scrolls an inner `overflow-y-auto` element, so that
 * value never changed and the highlight stayed on the first heading. The
 * sidebar now measures headings against the real scroll container and defers
 * the choice to this function.
 */

const HELPER = fileURLToPath(
  new URL(
    "../../packages/editor/components/tiptap-node/toc-node/context/toc-scroll.ts",
    import.meta.url,
  ),
);
const { resolveScrollActiveHeadingId } = await import(
  pathToFileURL(HELPER).href
);

const headings = [
  { id: "intro", top: 120 },
  { id: "setup", top: 420 },
  { id: "usage", top: 760 },
];

test("before the first heading reaches the line the answer is null", () => {
  assert.equal(resolveScrollActiveHeadingId(headings, 64), null);
});

test("a heading at or above the reading line becomes active", () => {
  assert.equal(resolveScrollActiveHeadingId(headings, 420), "setup");
  assert.equal(resolveScrollActiveHeadingId(headings, 421), "setup");
  assert.equal(resolveScrollActiveHeadingId(headings, 759), "setup");
});

test("the last crossed heading wins, not the first", () => {
  assert.equal(resolveScrollActiveHeadingId(headings, 800), "usage");
  assert.equal(resolveScrollActiveHeadingId(headings, 1000), "usage");
});

test("no headings means no active heading", () => {
  assert.equal(resolveScrollActiveHeadingId([], 64), null);
});
