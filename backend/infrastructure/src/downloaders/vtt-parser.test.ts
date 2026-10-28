// SPDX-License-Identifier: AGPL-3.0-only

/** The VTT contract shared by video subtitles and audio lyrics. */
import assert from "node:assert/strict";
import { test } from "node:test";

import { MAX_VTT_CUES, parseVtt } from "./vtt-parser.ts";

test("reads both time-code spellings and milliseconds", () => {
  const parsed = parseVtt(
    [
      "WEBVTT",
      "",
      "00:00.500 --> 00:02.250",
      "short form",
      "",
      "01:02:03.004 --> 01:02:04.000",
      "long form",
    ].join("\n"),
  );

  assert.deepEqual(parsed.cues, [
    { timeMs: 500, endMs: 2250, content: "short form" },
    { timeMs: 3_723_004, endMs: 3_724_000, content: "long form" },
  ]);
  assert.equal(parsed.truncated, false);
});

test("treats a short fraction as decimal seconds", () => {
  const parsed = parseVtt("WEBVTT\n\n00:01.5 --> 00:01.50\nline");
  assert.equal(parsed.cues[0]?.timeMs, 1500);
  assert.equal(parsed.cues[0]?.endMs, 1500);
});

test("removes tags, inline timestamps, and decodes entities", () => {
  const parsed = parseVtt(
    [
      "WEBVTT",
      "",
      "00:01.000 --> 00:02.000",
      "<c.yellow>Hello</c> <00:01.500>world &amp; <i>friends</i>",
    ].join("\n"),
  );

  assert.equal(parsed.cues[0]?.content, "Hello world & friends");
});

test("joins the lines of one cue with a newline", () => {
  const parsed = parseVtt(
    ["WEBVTT", "", "00:01.000 --> 00:02.000", "first", "second", "third"].join(
      "\n",
    ),
  );

  assert.equal(parsed.cues[0]?.content, "first\nsecond\nthird");
});

test("keeps the text of an inverted interval and drops its end", () => {
  const parsed = parseVtt(
    ["WEBVTT", "", "00:05.000 --> 00:04.000", "still readable"].join("\n"),
  );

  assert.deepEqual(parsed.cues, [{ timeMs: 5000, content: "still readable" }]);
});

test("sorts cues by start time", () => {
  const parsed = parseVtt(
    [
      "WEBVTT",
      "",
      "00:09.000 --> 00:10.000",
      "third",
      "",
      "00:01.000 --> 00:02.000",
      "first",
      "",
      "00:05.000 --> 00:06.000",
      "second",
    ].join("\n"),
  );

  assert.deepEqual(
    parsed.cues.map((cue) => cue.content),
    ["first", "second", "third"],
  );
});

test("skips the header, notes, styles, and empty cues", () => {
  const parsed = parseVtt(
    [
      "WEBVTT",
      "Kind: captions",
      "",
      "NOTE a comment",
      "",
      "STYLE",
      "::cue { color: yellow }",
      "",
      "00:01.000 --> 00:02.000",
      "<i></i>",
      "",
      "00:03.000 --> 00:04.000",
      "real cue",
    ].join("\n"),
  );

  assert.deepEqual(parsed.cues, [
    { timeMs: 3000, endMs: 4000, content: "real cue" },
  ]);
});

test("accepts a cue identifier before the timing line", () => {
  const parsed = parseVtt(
    ["WEBVTT", "", "cue-1", "00:01.000 --> 00:02.000", "text"].join("\n"),
  );

  assert.equal(parsed.cues[0]?.content, "text");
});

test("handles CRLF line endings and a byte order mark", () => {
  const parsed = parseVtt(
    "\ufeffWEBVTT\r\n\r\n00:00.100 --> 00:00.200\r\nline\r\n",
  );

  assert.equal(parsed.cues[0]?.timeMs, 100);
  assert.equal(parsed.cues[0]?.content, "line");
});

test("truncates more than the cue limit and says so", () => {
  const blocks = ["WEBVTT", ""];
  for (let index = 0; index <= MAX_VTT_CUES; index += 1) {
    blocks.push("00:00.000 --> 00:00.001", `cue ${index}`, "");
  }

  const parsed = parseVtt(blocks.join("\n"));
  assert.equal(parsed.cues.length, MAX_VTT_CUES);
  assert.equal(parsed.truncated, true);
});

test("truncates a track that exceeds the serialized byte cap", () => {
  const huge = "x".repeat(5 * 1024 * 1024);
  const parsed = parseVtt(
    [
      "WEBVTT",
      "",
      "00:01.000 --> 00:02.000",
      huge,
      "",
      "00:03.000 --> 00:04.000",
      huge,
    ].join("\n"),
  );

  assert.equal(parsed.cues.length, 1);
  assert.equal(parsed.truncated, true);
});
