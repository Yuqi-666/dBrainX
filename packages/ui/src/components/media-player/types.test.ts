// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The media layer's pure half, pinned. Run with:
 *
 * ```sh
 * pnpm --filter=@workspace/ui test
 * ```
 *
 * Three families live here, all of them silent when wrong:
 *
 * - **Milliseconds ↔ display.** A note stored as an integer millisecond and
 *   shown as `mm:ss` — a note that reads `1:29` when the playhead says `1:30`,
 *   or two notes captured in one millisecond swapping places on every reload.
 * - **The stored-shape readers.** `normalizeTimestamps` is where a note written
 *   before the two kinds were unified (an M6 `text`, or a separate `doc`) becomes
 *   a `content` document, and where a cue's inverted span is discarded. It reads
 *   a JSON column nothing validates on the way in.
 * - **The tick layer's geometry.** A mark off by a factor of 1000 is still a
 *   mark in a screenshot.
 *
 * `createMediaController` / `createVideoJsMediaController` are covered
 * separately (`media-controller.test.ts`, and the browser probe for the
 * element-backed one, which `node --test` has no DOM for).
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import type { TimestampData, TimestampNoteData } from "@workspace/interfaces";

import {
  activeCueIndex,
  createTimestampNote,
  docToPlainText,
  formatTimeMs,
  groupNotesByTime,
  isBlankNote,
  normalizeTimestamps,
  noteTitle,
  notesOf,
  playheadRowIndex,
  positionPercent,
  sortTimestamps,
  subtitlesOf,
  tooltipAlignment,
  UNTITLED_NOTE,
} from "./types.ts";
import type { NoteDoc } from "./types.ts";

/** One paragraph holding `text`, the document shape a note body stores. */
function paragraph(text: string): NoteDoc {
  return {
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text }] }],
  };
}

/** A complete stored note, so a test only spells out what it is about. */
function note(
  id: string,
  timeMs: number,
  body: NoteDoc,
  createdAt = "2026-01-01T00:00:01Z",
): TimestampNoteData {
  return { id, type: "note", timeMs, content: body, createdAt, updatedAt: "" };
}

test("formatTimeMs: minutes below an hour, seconds floored", () => {
  assert.equal(formatTimeMs(0), "0:00");
  assert.equal(formatTimeMs(1), "0:00");
  assert.equal(formatTimeMs(9_999), "0:09");
  assert.equal(formatTimeMs(90_000), "1:30");
  assert.equal(formatTimeMs(89_999), "1:29");
  assert.equal(formatTimeMs(3_599_000), "59:59");
});

test("formatTimeMs: hours appear past 3600s and the minutes get padded", () => {
  assert.equal(formatTimeMs(3_600_000), "1:00:00");
  assert.equal(formatTimeMs(7_265_000), "2:01:05");
});

test("formatTimeMs: unusable input reads 0:00 instead of NaN", () => {
  assert.equal(formatTimeMs(Number.NaN), "0:00");
  assert.equal(formatTimeMs(Number.POSITIVE_INFINITY), "0:00");
  assert.equal(formatTimeMs(-5_000), "0:00");
});

/* ------------------------------------------------------------- ordering --- */

test("sortTimestamps: notes by time, then createdAt, then id — input untouched", () => {
  const source = [
    note("b", 2_000, paragraph("b"), "2026-01-01T00:00:02Z"),
    note("c", 1_000, paragraph("c"), "2026-01-01T00:00:02Z"),
    note("a", 1_000, paragraph("a"), "2026-01-01T00:00:01Z"),
    note("a2", 1_000, paragraph("a2"), "2026-01-01T00:00:01Z"),
  ];
  const snapshot = source.map((item) => item.id);

  const sorted = sortTimestamps(source);

  assert.deepEqual(
    sorted.map((item) => item.id),
    ["a", "a2", "c", "b"],
  );
  assert.deepEqual(
    source.map((item) => item.id),
    snapshot,
    "the caller's array must not be reordered in place",
  );
  assert.notEqual(sorted, source);
});

test("sortTimestamps: cues by time, then end, then text — input untouched", () => {
  const source: TimestampData[] = [
    { type: "subtitle", timeMs: 5_000, endMs: 6_000, content: "b" },
    { type: "subtitle", timeMs: 1_000, endMs: 2_000, content: "z" },
    { type: "subtitle", timeMs: 1_000, endMs: 2_000, content: "a" },
    { type: "subtitle", timeMs: 1_000, endMs: 1_500, content: "m" },
  ];
  const snapshot = source.map((item) => item.type);

  const sorted = sortTimestamps(source);

  assert.deepEqual(
    sorted.map((item) => (item.type === "subtitle" ? item.content : "")),
    ["m", "a", "z", "b"],
  );
  assert.deepEqual(
    source.map((item) => item.type),
    snapshot,
    "the caller's array must not be reordered in place",
  );
});

test("sortTimestamps: a note and a cue at one millisecond put the note first", () => {
  // The tie has to be broken by kind or the note list's order would depend on
  // whatever cues happen to share its timestamps.
  const cue: TimestampData = {
    type: "subtitle",
    timeMs: 1_000,
    endMs: 2_000,
    content: "台词",
  };
  const sorted = sortTimestamps([cue, note("a", 1_000, paragraph("笔记"))]);

  assert.deepEqual(
    sorted.map((item) => item.type),
    ["note", "subtitle"],
  );
});

/* -------------------------------------------------------------- minting --- */

test("createTimestampNote: note_ id, note type, rounded ms, ISO stamps, body verbatim", () => {
  const now = new Date("2026-10-07T12:00:00.000Z");
  const body = paragraph("台词");
  const created = createTimestampNote(1_234.6, body, now);

  assert.match(created.id, /^note_/);
  assert.equal(created.type, "note");
  assert.equal(created.timeMs, 1_235);
  assert.equal(created.content, body, "the document is stored, not copied");
  assert.equal(created.createdAt, "2026-10-07T12:00:00.000Z");
  assert.equal(created.updatedAt, created.createdAt);

  const blank = createTimestampNote(-10, paragraph(""), now);
  assert.equal(blank.timeMs, 0);
  assert.notEqual(blank.id, created.id);
});

/* ----------------------------------------------------------- doc <-> text --- */

test("docToPlainText: inline siblings concatenate, blocks become lines", () => {
  assert.equal(docToPlainText(paragraph("一句话")), "一句话");
  assert.equal(
    docToPlainText({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "第一段" }] },
        { type: "paragraph", content: [{ type: "text", text: "第二段" }] },
      ],
    }),
    "第一段\n第二段",
  );
});

test("docToPlainText: marks and inline atoms keep the text, not the wrapper", () => {
  assert.equal(
    docToPlainText({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "加", marks: [{ type: "bold" }] },
            { type: "text", text: "粗" },
            // An inline formula has no text of its own (`latexInline`).
            { type: "latexInline", attrs: { text: "x^2" } },
          ],
        },
      ],
    }),
    "加粗",
  );
});

test("docToPlainText: an empty paragraph, a bare string and junk all read safely", () => {
  assert.equal(docToPlainText(paragraph("")), "");
  assert.equal(docToPlainText({ type: "doc", content: [] }), "");
  // A plain-string body: the migration lifts an M6 `text` into `content` as a
  // string, and the reader accepts it before the first edit upgrades it.
  assert.equal(docToPlainText("旧笔记"), "旧笔记");
  assert.equal(docToPlainText(null), "");
  assert.equal(docToPlainText(42), "");
});

/* ------------------------------------------------------------- readers --- */

test("normalizeTimestamps: keeps a unified note and its identity", () => {
  const items = normalizeTimestamps([
    {
      id: "n1",
      type: "note",
      timeMs: 1_000,
      content: paragraph("正文"),
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-02T00:00:00Z",
    },
  ]);

  assert.equal(items.length, 1);
  const [item] = notesOf(items);
  assert.equal(item?.id, "n1");
  assert.equal(item?.timeMs, 1_000);
  assert.equal(docToPlainText(item?.content), "正文");
  assert.equal(item?.createdAt, "2026-01-01T00:00:00Z");
});

test("normalizeTimestamps: carries a note's title and nodeId only when stored", () => {
  const items = normalizeTimestamps([
    {
      id: "n1",
      type: "note",
      timeMs: 1_000,
      title: "开场白",
      nodeId: "node-1",
      content: paragraph("正文"),
    },
    // No title / nodeId: the keys must stay absent rather than become `""` /
    // `undefined`, or every legacy note would rewrite itself on first read.
    { id: "n2", type: "note", timeMs: 2_000, content: paragraph("正文") },
  ]);

  const [titled, plain] = notesOf(items);
  assert.equal(titled?.title, "开场白");
  assert.equal(titled?.nodeId, "node-1");
  assert.equal("title" in (plain ?? {}), false);
  assert.equal("nodeId" in (plain ?? {}), false);
});

test("normalizeTimestamps: an empty nodeId reads as no reference", () => {
  const items = normalizeTimestamps([
    { id: "n1", type: "note", timeMs: 1_000, nodeId: "", content: paragraph("") },
  ]);

  assert.equal("nodeId" in (notesOf(items)[0] ?? {}), false);
});

test("noteTitle: the stored title wins, the body is the fallback, empty is named", () => {
  assert.equal(noteTitle(note("n1", 0, paragraph("正文"), "x")), "正文");

  const titled: TimestampNoteData = {
    ...note("n2", 0, paragraph("正文")),
    title: "  我的标题  ",
  };
  assert.equal(noteTitle(titled), "我的标题");

  // A body long enough to be a paragraph is quoted, clipped and marked as such.
  const long = "字".repeat(60);
  const clipped = noteTitle(note("n3", 0, paragraph(long)));
  assert.equal(clipped.length, 41);
  assert.ok(clipped.endsWith("…"));
  assert.ok(long.startsWith(clipped.slice(0, 40)));

  assert.equal(noteTitle(note("n4", 0, paragraph(""))), UNTITLED_NOTE);
});

test("isBlankNote: an untouched 加笔记 card is blank, any real content is not", () => {
  // What 加笔记 mints: no title, one empty paragraph.
  assert.equal(isBlankNote(note("n1", 0, paragraph(""))), true);
  assert.equal(isBlankNote(note("n2", 0, { type: "doc", content: [] })), true);
  // Whitespace is not content, in either half.
  assert.equal(
    isBlankNote({ ...note("n3", 0, paragraph("   ")), title: "   " }),
    true,
  );

  assert.equal(isBlankNote({ ...note("n4", 0, paragraph("")), title: "标题" }), false);
  assert.equal(isBlankNote(note("n5", 0, paragraph("正文"))), false);
  assert.equal(
    isBlankNote({ ...note("n6", 0, paragraph("正文")), title: " 标题 " }),
    false,
  );
});

test("normalizeTimestamps: a pre-unification M6 note (`text`) upgrades to a paragraph", () => {
  // The two shapes that predate the union: a body under `text` and no `type`.
  const items = normalizeTimestamps([{ id: "n1", timeMs: 5, text: "旧" }]);

  assert.equal(items[0]?.type, "note");
  assert.deepEqual(notesOf(items)[0]?.content, {
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text: "旧" }] }],
  });
});

test("normalizeTimestamps: a pre-unification note's `doc` becomes `content`", () => {
  const items = normalizeTimestamps([
    { id: "n1", timeMs: 5, doc: paragraph("文档"), createdAt: "x" },
  ]);

  const [item] = notesOf(items);
  assert.equal(item?.id, "n1");
  assert.equal(docToPlainText(item?.content), "文档");
  assert.equal(item?.createdAt, "x");
});

test("normalizeTimestamps: a string `content` (the migration's M6 lift) upgrades", () => {
  // The timestamps fold (now `1700000000_initial_schema.js`) moves an M6 body
  // into `content` verbatim, so
  // the reader has to accept a string there and turn it into the document.
  const items = normalizeTimestamps([
    { id: "n1", type: "note", timeMs: 5, content: "迁移过来的旧正文" },
  ]);

  assert.equal(docToPlainText(notesOf(items)[0]?.content), "迁移过来的旧正文");
});

test("normalizeTimestamps: an empty body has no text node (ProseMirror rejects one)", () => {
  const items = normalizeTimestamps([{ id: "n1", timeMs: 5, text: "" }]);

  assert.deepEqual(notesOf(items)[0]?.content, {
    type: "doc",
    content: [{ type: "paragraph" }],
  });
});

test("normalizeTimestamps: drops junk, substitutes missing stamps, keeps order", () => {
  const items = normalizeTimestamps([
    "not a note",
    { timeMs: "1000" },
    { id: "b", timeMs: 2 },
    { id: "a", timeMs: 1 },
  ]);

  // The two unusable entries are dropped; the rest keep their stored order
  // (this validates, it does not reorder).
  assert.deepEqual(
    notesOf(items).map((item) => item.id),
    ["b", "a"],
  );
  for (const item of notesOf(items)) {
    assert.equal(item.type, "note");
    assert.equal(typeof item.createdAt, "string");
    assert.equal(typeof item.updatedAt, "string");
    assert.equal(typeof item.content, "object");
  }
});

test("normalizeTimestamps: a non-array reads as no items, an unknown kind is dropped", () => {
  assert.deepEqual(normalizeTimestamps(undefined), []);
  assert.deepEqual(normalizeTimestamps({ id: "n" }), []);
  // An item whose kind cannot be told cannot be rendered or edited — a note
  // needs a body, a cue needs a line — so a future `type` reads as no item at
  // all rather than as a malformed one of the two we know.
  assert.deepEqual(
    normalizeTimestamps([{ type: "bookmark", timeMs: 1_000, content: "x" }]),
    [],
  );
});

test("normalizeTimestamps: keeps well-formed cues and fills a missing line", () => {
  const items = normalizeTimestamps([
    { type: "subtitle", timeMs: 0, endMs: 1_500, content: "第一句" },
    { type: "subtitle", timeMs: 2_000, endMs: 3_000 },
  ]);

  assert.deepEqual(subtitlesOf(items), [
    { type: "subtitle", timeMs: 0, endMs: 1_500, content: "第一句" },
    { type: "subtitle", timeMs: 2_000, endMs: 3_000, content: "" },
  ]);
});

test("normalizeTimestamps: a pre-unification cue's startMs becomes its timeMs", () => {
  const items = normalizeTimestamps([
    { startMs: 1_000, endMs: 2_000, text: "老字幕" },
  ]);

  assert.deepEqual(subtitlesOf(items), [
    { type: "subtitle", timeMs: 1_000, endMs: 2_000, content: "老字幕" },
  ]);
});

test("normalizeTimestamps: an inverted span loses the span, not the cue", () => {
  // `endMs` is optional, so discarding a span that is not after the start
  // leaves a perfectly seekable cue; dropping the cue would lose a line of the
  // transcript, which is the one thing the reader must not do.
  const items = normalizeTimestamps([
    { type: "subtitle", timeMs: 5_000, endMs: 4_000, content: "倒" },
    { type: "subtitle", timeMs: 5_000, endMs: 5_000, content: "零长" },
    { startMs: 6_000, endMs: 5_000, text: "老形状倒" },
  ]);

  assert.deepEqual(subtitlesOf(items), [
    { type: "subtitle", timeMs: 5_000, content: "倒" },
    { type: "subtitle", timeMs: 5_000, content: "零长" },
    { type: "subtitle", timeMs: 6_000, content: "老形状倒" },
  ]);
});

test("normalizeTimestamps: a cue with no numeric time is dropped, one without a span is kept", () => {
  assert.deepEqual(
    normalizeTimestamps([
      null,
      { type: "subtitle", content: "没有时间" },
      { type: "subtitle", timeMs: 0, content: "没有区间" },
    ]),
    [{ type: "subtitle", timeMs: 0, content: "没有区间" }],
  );
});

test("notesOf / subtitlesOf: one stored list, two filters", () => {
  const items = normalizeTimestamps([
    { id: "n1", type: "note", timeMs: 500, content: paragraph("笔记") },
    { type: "subtitle", timeMs: 1_000, endMs: 2_000, content: "字幕" },
  ]);

  assert.deepEqual(
    notesOf(items).map((item) => item.id),
    ["n1"],
  );
  assert.deepEqual(
    subtitlesOf(items).map((item) => item.content),
    ["字幕"],
  );
  // Both halves of the same array: neither filter may invent or drop an item.
  assert.equal(notesOf(items).length + subtitlesOf(items).length, items.length);
});

/* -------------------------------------------------------- tick geometry --- */

test("positionPercent: milliseconds against the media element's seconds", () => {
  // 2:00 of media; the element (and the v10 store) reports `120`.
  assert.equal(positionPercent(0, 120), 0);
  assert.equal(positionPercent(60_000, 120), 50);
  assert.equal(positionPercent(120_000, 120), 100);
  // A note past the end (a stale duration) pins to the end rather than 100%+.
  assert.equal(positionPercent(180_000, 120), 100);
});

test("positionPercent: no duration means no position, never NaN", () => {
  for (const duration of [0, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(positionPercent(60_000, duration), 0);
  }
  // A negative position (impossible, but cheap to survive) reads as the start.
  assert.equal(positionPercent(-5_000, 120), 0);
});

test("groupNotesByTime: one tick per position, ascending, input untouched", () => {
  const input = [
    note("b", 40_000, paragraph("b")),
    note("a", 10_000, paragraph("a")),
    note("c", 40_000, paragraph("c"), "2026-01-01T00:00:02Z"),
  ];
  const snapshot = input.map((item) => item.id);

  const clusters = groupNotesByTime(input);

  assert.deepEqual(
    clusters.map((cluster) => cluster.timeMs),
    [10_000, 40_000],
  );
  // One millisecond, two notes: both survive, ordered by `createdAt` — which is
  // also the order a tick's click reports to the sidebar.
  assert.deepEqual(
    clusters[1]?.notes.map((item) => item.id),
    ["b", "c"],
  );
  assert.deepEqual(
    input.map((item) => item.id),
    snapshot,
    "the caller's array must not be reordered in place",
  );
});

test("groupNotesByTime: empty in, empty out — and a cue never becomes a tick", () => {
  assert.deepEqual(groupNotesByTime([]), []);

  // The ticks mark notes only: a transcript's hundreds of cues must not bury
  // the bar. `notesOf` is the caller's split; this is the runtime backstop.
  const mixed = normalizeTimestamps([
    { id: "n1", type: "note", timeMs: 1_000, content: paragraph("笔记") },
    { type: "subtitle", timeMs: 2_000, endMs: 3_000, content: "字幕" },
  ]);
  assert.deepEqual(
    groupNotesByTime(mixed as TimestampNoteData[]).map(
      (cluster) => cluster.timeMs,
    ),
    [1_000],
  );
});

test("tooltipAlignment: centred in the middle, inward at the edges", () => {
  assert.equal(tooltipAlignment(0), "start");
  assert.equal(tooltipAlignment(11.9), "start");
  assert.equal(tooltipAlignment(12), "center");
  assert.equal(tooltipAlignment(50), "center");
  assert.equal(tooltipAlignment(88), "center");
  assert.equal(tooltipAlignment(88.1), "end");
  assert.equal(tooltipAlignment(100), "end");
});

/* ---------------------------------------------------- playhead queries --- */

/** Three cues both spanning their line and leaving one real gap. */
const SPANNED = subtitlesOf(
  normalizeTimestamps([
    { type: "subtitle", timeMs: 1_000, endMs: 2_000, content: "一" },
    { type: "subtitle", timeMs: 4_000, endMs: 5_000, content: "二" },
    { type: "subtitle", timeMs: 6_000, endMs: 7_000, content: "三" },
  ]),
);

test("activeCueIndex: inside a span, and -1 in a real gap", () => {
  assert.equal(activeCueIndex(SPANNED, 0), -1, "before the first line");
  assert.equal(
    activeCueIndex(SPANNED, 1_000),
    0,
    "the start belongs to the cue",
  );
  assert.equal(activeCueIndex(SPANNED, 1_999), 0);
  assert.equal(activeCueIndex(SPANNED, 2_000), -1, "end is exclusive");
  assert.equal(activeCueIndex(SPANNED, 3_999), -1, "silence between two cues");
  assert.equal(activeCueIndex(SPANNED, 4_000), 1);
  assert.equal(activeCueIndex(SPANNED, 7_000), -1, "after the last end");
  assert.equal(activeCueIndex([], 5_000), -1);
});

test("activeCueIndex: a cue with no endMs runs until the next one starts", () => {
  const cues = subtitlesOf(
    normalizeTimestamps([
      { type: "subtitle", timeMs: 0, content: "没有区间" },
      { type: "subtitle", timeMs: 3_000, endMs: 4_000, content: "有区间" },
    ]),
  );
  assert.equal(activeCueIndex(cues, 0), 0);
  assert.equal(
    activeCueIndex(cues, 2_999),
    0,
    "the missing span absorbs the gap",
  );
  assert.equal(activeCueIndex(cues, 3_000), 1);
  assert.equal(activeCueIndex(cues, 4_000), -1);

  const last = subtitlesOf(
    normalizeTimestamps([{ type: "subtitle", timeMs: 2_000 }]),
  );
  assert.equal(
    activeCueIndex(last, 3_600_000),
    0,
    "the last line never expires",
  );
});

test("playheadRowIndex: the insertion point, never -1", () => {
  const items = normalizeTimestamps([
    { type: "subtitle", timeMs: 0, endMs: 1_000, content: "字幕" },
    { id: "n1", type: "note", timeMs: 2_000, content: paragraph("笔记") },
    { id: "n2", type: "note", timeMs: 2_000, content: paragraph("同刻") },
    { type: "subtitle", timeMs: 5_000, endMs: 6_000, content: "尾" },
  ]);

  assert.equal(playheadRowIndex([], 1_000), 0);
  assert.equal(playheadRowIndex(items, 0), 1, "at a time counts as past it");
  assert.equal(playheadRowIndex(items, 1_500), 1);
  assert.equal(playheadRowIndex(items, 2_000), 3, "both notes at 2s");
  assert.equal(playheadRowIndex(items, 2_001), 3);
  assert.equal(
    playheadRowIndex(items, 9_999_999),
    4,
    "past the end is the end",
  );
});
