// SPDX-License-Identifier: AGPL-3.0-only

import type { JSONContent } from "@tiptap/core";

/**
 * Normalisation for Markdown pasted through `editor.markdown.parse`.
 *
 * Two upstream behaviours break a paste of ordinary prose, and both are fixed
 * here rather than by changing the upstream parser:
 *
 * 1. **A single `~` is a strikethrough.** `marked`'s GFM `del` tokenizer
 *    accepts one *or* two tildes, so a range such as `0~9 … 10~15` parses into
 *    a `<del>` that runs between the two tildes. GFM defines strikethrough as
 *    `~~text~~`; a lone `~` is content. The tilde is therefore hidden behind a
 *    sentinel before parsing and put back afterwards, which keeps every use of
 *    a lone tilde (ranges, file names, code spans, link targets) literal while
 *    `~~text~~` still becomes a strike mark.
 * 2. **Full-width punctuation hides a bold delimiter.** `marked` follows
 *    CommonMark's flanking rules, and a closing `**` that follows a full-width
 *    punctuation mark (`）`, `。`, `、`) and is followed by a word character is
 *    not a valid closer. `**（Decimal）**和**（Hexadecimal）**` therefore comes
 *    out as one outer `<strong>` wrapping the two runs (with a nested second
 *    `<strong>` around `和`): `和` is bold when it must stay plain, and Tiptap
 *    maps the duplicate marks to a node ProseMirror rejects with
 *    `RangeError: Invalid collection of marks for node text: bold,bold`.
 *    {@link repairEmphasisBoundaries} pairs the runs in reading order, pads only
 *    the delimiters that flanking would reject, and the padding is removed again
 *    after parsing. This is the case that matters for Chinese prose: full-width
 *    punctuation sits against every bold run.
 */

/**
 * Sentinel that stands in for a lone tilde while `marked` parses.
 *
 * NUL-wrapped so it cannot collide with anything a user would paste, and
 * restored before the JSON reaches ProseMirror, so it never reaches the DOM.
 */
const LONE_TILDE_SENTINEL = "\u0000dsh-lone-tilde\u0000";

/**
 * Replaces every tilde that is not part of a `~~` pair with the sentinel.
 *
 * Only *runs* of one tilde are replaced; a longer run (`~~~` fence) is left to
 * Markdown, which is also why the pattern is anchored between non-tilde
 * characters rather than counting the run.
 */
export function protectLoneTildes(markdown: string): string {
  return markdown.replace(/(?<!~)~(?!~)/g, LONE_TILDE_SENTINEL);
}

/**
 * Sentinels around the spaces {@link repairEmphasisBoundaries} inserts.
 *
 * The space itself has to be a real space while `marked` parses — it is what
 * makes the padded delimiter flanking-valid — so the sentinel sits next to it
 * and the whole pair is removed once the document has been parsed.
 */
const EMPHASIS_PRE_SENTINEL = "\u0000dsh-emphasis-pre\u0000";
const EMPHASIS_POST_SENTINEL = "\u0000dsh-emphasis-post\u0000";

/** Unicode-aware character classes; `marked` tests these same properties. */
const WHITESPACE = /\s/u;
const PUNCTUATION = /[\p{P}\p{S}]/u;

function isWhitespace(char: string | undefined): boolean {
  return char === undefined || WHITESPACE.test(char);
}

function isPunctuation(char: string | undefined): boolean {
  return char !== undefined && PUNCTUATION.test(char);
}

function isLeftFlanking(previous: string | undefined, next: string | undefined) {
  return (
    !isWhitespace(next) &&
    (!isPunctuation(next) || isWhitespace(previous) || isPunctuation(previous))
  );
}

function isRightFlanking(
  previous: string | undefined,
  next: string | undefined,
) {
  return (
    !isWhitespace(previous) &&
    (!isPunctuation(previous) || isWhitespace(next) || isPunctuation(next))
  );
}

/**
 * Pairs `**…**` runs in reading order and pads the delimiters that CommonMark's
 * flanking rules would reject.
 *
 * The padding is a space, so it can only make a delimiter *less* ambiguous: an
 * opener is preceded by a space and can no longer close, a closer is followed by
 * one and can no longer open. Runs inside code spans are skipped, a run of three
 * or more characters is left to Markdown (a fence or a nested mark), and a
 * document whose runs are not a sequence of open/close pairs is returned
 * untouched so literal `**` in prose is never promoted to emphasis. Strings that
 * `marked` already handles are byte-for-byte unchanged.
 *
 * `__` is treated like `**`; an intraword run such as `foo__bar__baz` is left
 * alone because both of its flanking tests already pass.
 */
export function repairEmphasisBoundaries(markdown: string): string {
  interface Run {
    at: number;
    previous: string | undefined;
    next: string | undefined;
  }
  const runs: Run[] = [];
  let index = 0;
  let codeSpan = 0;

  while (index < markdown.length) {
    const character = markdown[index];
    if (character === "`") {
      let length = 1;
      while (markdown[index + length] === "`") length += 1;
      codeSpan = codeSpan === 0 ? length : length === codeSpan ? 0 : codeSpan;
      index += length;
      continue;
    }
    if (
      codeSpan === 0 &&
      (character === "*" || character === "_") &&
      markdown[index + 1] === character &&
      markdown[index + 2] !== character &&
      markdown[index - 1] !== character
    ) {
      runs.push({
        at: index,
        previous: markdown[index - 1],
        next: markdown[index + 2],
      });
      index += 2;
      continue;
    }
    index += 1;
  }

  if (runs.length === 0 || runs.length % 2 !== 0) return markdown;
  // Alternate open/close and require the text to touch each inner delimiter; a
  // whitespace-padded run is prose or arithmetic (`2 ** 3 ** 4`), not emphasis.
  for (let run = 0; run < runs.length; run += 2) {
    const opener = runs[run];
    const closer = runs[run + 1];
    if (!opener || !closer) return markdown;
    if (isWhitespace(opener.next) || isWhitespace(closer.previous)) {
      return markdown;
    }
  }

  const insertions: { at: number; padding: string }[] = [];
  runs.forEach((run, position) => {
    if (position % 2 === 0) {
      if (!isLeftFlanking(run.previous, run.next) && !isWhitespace(run.previous)) {
        insertions.push({
          at: run.at,
          padding: `${EMPHASIS_PRE_SENTINEL} `,
        });
      }
      return;
    }
    if (!isRightFlanking(run.previous, run.next) && !isWhitespace(run.next)) {
      insertions.push({
        at: run.at + 2,
        padding: ` ${EMPHASIS_POST_SENTINEL}`,
      });
    }
  });

  if (insertions.length === 0) return markdown;
  let repaired = "";
  let cursor = 0;
  for (const insertion of insertions) {
    repaired += markdown.slice(cursor, insertion.at) + insertion.padding;
    cursor = insertion.at;
  }
  return repaired + markdown.slice(cursor);
}

/** Restores the sentinels in any string the parsed document carries. */
function restoreInValue(value: unknown): unknown {
  if (typeof value === "string") {
    return value
      .split(`${EMPHASIS_PRE_SENTINEL} `)
      .join("")
      .split(` ${EMPHASIS_POST_SENTINEL}`)
      .join("")
      .split(LONE_TILDE_SENTINEL)
      .join("~");
  }
  if (Array.isArray(value)) {
    return value.map(restoreInValue);
  }
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      record[key] = restoreInValue(record[key]);
    }
    return record;
  }
  return value;
}

/**
 * Collapses marks that repeat a type on one node.
 *
 * ProseMirror's mark set is a `Mark[]` with one entry per type; a second `bold`
 * makes `insertContent` reject the whole document.
 */
function dedupeMarks(node: JSONContent): void {
  if (Array.isArray(node.marks) && node.marks.length > 1) {
    const seen = new Set<string>();
    node.marks = node.marks.filter((mark) => {
      const type = mark.type;
      if (!type || seen.has(type)) return false;
      seen.add(type);
      return true;
    });
  }
  node.content?.forEach(dedupeMarks);
}

/**
 * Makes a freshly parsed Markdown document safe to `insertContent`.
 *
 * Mutates the document in place — the manager hands back a fresh value, so a
 * copy would buy nothing.
 */
export function normalizePastedMarkdown(doc: JSONContent): JSONContent {
  restoreInValue(doc);
  dedupeMarks(doc);
  return doc;
}
