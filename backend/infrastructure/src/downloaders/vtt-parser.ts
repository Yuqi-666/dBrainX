// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Turns a WebVTT subtitle track into plain timed cues.
 *
 * Both import kinds need this. A video import stores the site's subtitles, and
 * an audio import stores the site's lyrics; yt-dlp converts an LRC lyric file
 * to VTT before it writes it, so one parser serves both. The timestamp-data
 * model that receives the cues has no language dimension, no tags and no
 * styling, which fixes the output shape:
 *
 * - two time-code spellings are accepted: `HH:MM:SS.mmm` and `MM:SS.mmm`.
 *   NetEase lyric files use the short form, so an hour-only parser would drop
 *   every lyric;
 * - tags and inline timestamps are removed, because the player renders plain
 *   text and never interprets markup;
 * - several lines of one cue become one `\n`-joined string, so a two-line
 *   lyric stays one clickable row;
 * - an inverted interval keeps the cue but loses its `endMs`: the text is
 *   still useful, while a negative duration is not;
 * - cues are sorted by start time, because the sidebar assumes ascending order;
 * - the result is capped, because a hostile or broken track must not grow the
 *   stored node without bound. Truncation is reported, never silent.
 */

import type { MediaSubtitleCue } from "@workspace/domain";

/** Largest number of cues one track may keep. */
export const MAX_VTT_CUES = 30_000;

/** Largest serialized size, in bytes, one track may keep. */
export const MAX_VTT_BYTES = 8 * 1024 * 1024;

/** What one WebVTT document produced. */
export interface ParsedVtt {
  /** Cues with text, ascending by start time. */
  cues: MediaSubtitleCue[];
  /** True when a cap dropped at least one cue; the stored track is incomplete. */
  truncated: boolean;
}

/** Matches a cue timing line and reads both sides of the arrow. */
const TIMING_PATTERN =
  /^(?:(\d+):)?(\d{1,2}):(\d{2})(?:[.,](\d{1,3}))?\s*-->\s*(?:(\d+):)?(\d{1,2}):(\d{2})(?:[.,](\d{1,3}))?/;

/** Matches one markup tag, including `<c.class>`, `<v Name>` and `<00:00:01.000>`. */
const TAG_PATTERN = /<[^>]*>/g;

/** Matches one ASS-style override block some converters leave behind. */
const ASS_OVERRIDE_PATTERN = /\{\\[^}]*\}/g;

/** Entities a converted lyric or subtitle file can carry. */
const ENTITIES: ReadonlyArray<[RegExp, string]> = [
  [/&lt;/g, "<"],
  [/&gt;/g, ">"],
  [/&quot;/g, '"'],
  [/&#39;/g, "'"],
  [/&apos;/g, "'"],
  [/&nbsp;/g, " "],
  [/&lrm;/g, ""],
  [/&rlm;/g, ""],
  [/&amp;/g, "&"],
];

/** Characters that should not reach a stored cue: NUL and the BOM. */
// The NUL byte is the point of this pattern.
// eslint-disable-next-line no-control-regex
const UNWANTED_CHARS = /[\u0000\ufeff]/g;

/**
 * Parses one WebVTT document.
 *
 * Never throws: a broken document simply yields the cues that could be read.
 * A subtitle is a bonus, never a reason to fail a successful download.
 */
export function parseVtt(text: string): ParsedVtt {
  const normalized = text
    .replace(UNWANTED_CHARS, "")
    .replace(/\r\n?/g, "\n")
    .replace(/^\n+/, "");

  const cues: MediaSubtitleCue[] = [];
  // A cue payload cannot contain a blank line in WebVTT, so a blank line is
  // the one reliable block boundary.
  for (const block of normalized.split(/\n[ \t]*\n/)) {
    const cue = parseBlock(block);
    if (cue) cues.push(cue);
  }

  cues.sort((left, right) => left.timeMs - right.timeMs);
  return limitCues(cues);
}

/** Parses one block; `null` for a header, note, style, or malformed cue. */
function parseBlock(block: string): MediaSubtitleCue | null {
  const lines = block.split("\n");
  const first = (lines[0] ?? "").trim();
  if (first === "" || first.startsWith("WEBVTT")) return null;
  if (/^(NOTE|STYLE|REGION)(\s|$)/.test(first)) return null;

  // A cue may start with an identifier line before the timing line.
  const timingIndex = lines.findIndex((line) => line.includes("-->"));
  if (timingIndex === -1) return null;

  const timing = TIMING_PATTERN.exec((lines[timingIndex] ?? "").trim());
  if (!timing) return null;

  const timeMs = toMilliseconds(
    timing[1],
    timing[2] ?? "",
    timing[3] ?? "",
    timing[4],
  );
  const rawEnd = toMilliseconds(
    timing[5],
    timing[6] ?? "",
    timing[7] ?? "",
    timing[8],
  );
  if (timeMs < 0) return null;

  const content = cleanText(lines.slice(timingIndex + 1));
  if (content === "") return null;

  // An inverted interval is a broken duration, not broken text: keep the cue
  // and omit `endMs` so a player can still seek to the line.
  const endMs = rawEnd >= timeMs ? rawEnd : undefined;

  return endMs === undefined ? { timeMs, content } : { timeMs, endMs, content };
}

/**
 * Reads one time code as integer milliseconds.
 *
 * The hour group is optional, which is what accepts both spellings. The
 * fraction is decimal seconds: `.5`, `.50` and `.500` all mean 500 ms.
 */
function toMilliseconds(
  hours: string | undefined,
  minutes: string,
  seconds: string,
  fraction: string | undefined,
): number {
  const hoursPart = hours === undefined ? 0 : Number(hours);
  const minutesPart = Number(minutes);
  const secondsPart = Number(seconds);
  const milliseconds =
    fraction === undefined ? 0 : Number(fraction.padEnd(3, "0"));

  if (
    !Number.isInteger(hoursPart) ||
    !Number.isInteger(minutesPart) ||
    !Number.isInteger(secondsPart) ||
    !Number.isInteger(milliseconds)
  ) {
    return -1;
  }

  return (
    hoursPart * 3_600_000 +
    minutesPart * 60_000 +
    secondsPart * 1_000 +
    milliseconds
  );
}

/** Removes markup, decodes entities, and joins the remaining lines. */
function cleanText(lines: string[]): string {
  const cleaned: string[] = [];
  for (const line of lines) {
    let text = line.replace(TAG_PATTERN, "").replace(ASS_OVERRIDE_PATTERN, "");
    for (const [pattern, replacement] of ENTITIES) {
      text = text.replace(pattern, replacement);
    }
    text = text.replace(/\s+$/, "").replace(/^\s+/, "");
    if (text !== "") cleaned.push(text);
  }
  return cleaned.join("\n");
}

/** Applies the cue count and serialized byte caps, reporting what was cut. */
function limitCues(cues: MediaSubtitleCue[]): ParsedVtt {
  const kept: MediaSubtitleCue[] = [];
  // The brackets of the serialized array itself.
  let bytes = 2;

  for (const cue of cues) {
    if (kept.length >= MAX_VTT_CUES) {
      return { cues: kept, truncated: true };
    }

    // The separator is one comma per pair of cues.
    const cost =
      new TextEncoder().encode(JSON.stringify(cue)).length +
      (kept.length > 0 ? 1 : 0);
    if (bytes + cost > MAX_VTT_BYTES) {
      return { cues: kept, truncated: true };
    }

    bytes += cost;
    kept.push(cue);
  }

  return { cues: kept, truncated: false };
}
