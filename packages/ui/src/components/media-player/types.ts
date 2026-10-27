// SPDX-License-Identifier: AGPL-3.0-only

import { translate } from "@workspace/ui/lib/i18n/runtime";
/**
 * The media layer's contract — what `<VideoPlayer>`, `<AudioPlayer>`, the
 * progress-bar note ticks and the timestamp sidebar all agree on.
 *
 * Everything the media players and the notes/subtitles layer share lives here,
 * so the two players cannot invent a second vocabulary. Four rules keep this
 * file cheap to depend on:
 *
 * 1. **No React runtime, no video.js.** The only React import is
 *    `type { ReactNode }`-free: this module is loadable from `node --test`, and
 *    the video.js v10 store is reached through the structural
 *    `VideoJsPlayerStore` in `media-controller.ts` instead.
 * 2. **One time unit.** Every duration/position crossing a boundary is an
 *    **integer millisecond** (`timeMs`), never the float seconds of
 *    `HTMLMediaElement.currentTime` (design `node-content/README.md` §0.3-10).
 *    The two crossings are `positionPercent` (ms → percent of a seconds-long
 *    duration) and `formatTimeMs` (ms → text).
 * 3. **One timeline item, two kinds.** A note and a subtitle cue are one stored
 *    type (`TimestampData`, discriminated by `type`) in one `nodes` column, so
 *    the readers here are one `normalizeTimestamps` and one `sortTimestamps`,
 *    and the sidebar's two tabs are two filters (`notesOf` / `subtitlesOf`)
 *    over the same list.
 * 4. **Normalizers only validate.** `normalizeTimestamps` turns stored JSON
 *    into usable values and never reconciles or reorders what it reads;
 *    ordering is a separate, explicit `sortTimestamps` call. The two playhead
 *    queries (`activeCueIndex` / `playheadRowIndex`) are the same kind of
 *    read-only helper: they answer a question about an already-sorted timeline
 *    and write nothing.
 */
import type {
  TimestampData,
  TimestampKind,
  TimestampNoteData,
  TimestampSubtitleData,
} from "@workspace/interfaces";

/**
 * The transport surface a media host exposes to its notes layer.
 *
 * The owning component (the audio player, or `<VideoPlayer>` on the video side)
 * creates one over its own media element with {@link createMediaController} and
 * hands it out through `onMediaController`. Consumers (the marks layer, the
 * sidebar, the node-content host) only ever call these seven methods, so the
 * audio and video sides stay interchangeable.
 *
 * The **same** interface is what the players use internally for their own
 * controls: v10's `AddNoteButton` reads the playhead through it and the ticks
 * seek through it, so there is exactly one transport vocabulary inside and
 * outside the player.
 */
export interface MediaController {
  /**
   * The playhead in integer milliseconds.
   *
   * `0` before metadata is known; never `NaN` (a media element reports `NaN`
   * for `currentTime` until then, and a note anchored to `NaN` is unreadable).
   */
  getCurrentTimeMs(): number;
  /**
   * The total duration in integer milliseconds, or `0` while metadata has not
   * loaded (and for a live stream, whose `duration` is `Infinity`).
   */
  getDurationMs(): number;
  /** Whether the element is paused (`true` before the first play, too). */
  isPaused(): boolean;
  /**
   * Start playback. A rejected `play()` (autoplay policy, source not ready) is
   * swallowed: the transport button is a user gesture in practice, and an
   * unhandled rejection in the console is not worth the fidelity.
   */
  play(): void;
  /** Pause playback. */
  pause(): void;
  /**
   * Seek to `timeMs`, **clamped to `[0, duration]`** once the duration is
   * known. Before metadata loads it clamps to `>= 0` only, because the browser
   * would drop an out-of-range assignment on the floor anyway.
   */
  seek(timeMs: number): void;
  /**
   * Subscribe to playhead changes.
   *
   * The listener is called with {@link MediaController.getCurrentTimeMs} on
   * every transport event (`loadedmetadata` / `durationchange` / `timeupdate` /
   * `play` / `pause` / `ended` / `seeking` / `seeked`) and, while playing,
   * once per animation frame, so a progress bar follows the audio instead of
   * stepping 4 times a second. Returns the unsubscribe function.
   *
   * A subscription must be released on unmount: {@link createMediaController}
   * stops its animation-frame loop when the last listener is gone, and a leaked
   * listener keeps a rAF loop alive for the life of the element.
   */
  subscribe(listener: (timeMs: number) => void): () => void;
}

/** What a media-owning component reports upwards (and `null` on unmount). */
export type MediaControllerCallback = (
  controller: MediaController | null,
) => void;

/** Round to an integer millisecond and squeeze `NaN` / `Infinity` to `0`. */
function toMs(seconds: number): number {
  return Number.isFinite(seconds) ? Math.max(0, Math.round(seconds * 1000)) : 0;
}

/**
 * Bind a {@link MediaController} to a media element.
 *
 * Only the hover preview uses this now (`native-video-player.tsx`): the node
 * editor's players are video.js v10 stores, bound by
 * `createVideoJsMediaController`. It stays here because it is the element half
 * of the same contract.
 *
 * Self-cleaning: it attaches its transport listeners to the element once (a
 * listener on a removed element is collected with it), and its animation-frame
 * loop runs only while the element is playing **and** at least one listener is
 * subscribed. There is deliberately no `dispose()` — releasing every
 * subscription is enough, which keeps the contract at the seven methods above.
 */
export function createMediaController(
  element: HTMLMediaElement,
): MediaController {
  const listeners = new Set<(timeMs: number) => void>();
  let frame: number | null = null;

  const currentTimeMs = (): number => toMs(element.currentTime);

  const notify = (): void => {
    const ms = currentTimeMs();
    for (const listener of listeners) listener(ms);
  };

  const stopFrames = (): void => {
    if (frame !== null) {
      cancelAnimationFrame(frame);
      frame = null;
    }
  };

  const tick = (): void => {
    frame = null;
    if (element.paused || listeners.size === 0) return;
    notify();
    frame = requestAnimationFrame(tick);
  };

  const ensureFrames = (): void => {
    if (element.paused || listeners.size === 0 || frame !== null) return;
    frame = requestAnimationFrame(tick);
  };

  const onTransportEvent = (): void => {
    notify();
    ensureFrames();
  };

  const events = [
    "loadedmetadata",
    "durationchange",
    "timeupdate",
    "play",
    "playing",
    "pause",
    "ended",
    "seeking",
    "seeked",
  ] as const;

  for (const event of events) {
    element.addEventListener(event, onTransportEvent);
  }

  return {
    getCurrentTimeMs: currentTimeMs,
    getDurationMs: () => toMs(element.duration),
    isPaused: () => element.paused,
    play: () => {
      void element.play()?.catch(() => {});
      ensureFrames();
    },
    pause: () => {
      element.pause();
      stopFrames();
    },
    seek: (timeMs: number) => {
      const durationMs = toMs(element.duration);
      const target = Math.min(
        Math.max(timeMs, 0),
        durationMs > 0 ? durationMs : Infinity,
      );
      if (!Number.isFinite(target)) return;
      element.currentTime = target / 1000;
      notify();
    },
    subscribe: (listener: (timeMs: number) => void) => {
      listeners.add(listener);
      ensureFrames();
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) stopFrames();
      };
    },
  };
}

/**
 * Format a millisecond position as `mm:ss`, or `h:mm:ss` past an hour.
 *
 * The display half of design §0.3-10: `timeMs` is the storage format, this is
 * the only place that turns it into text. Seconds are floored (never rounded
 * up: a note captured at 89 999 ms reads `1:29`, matching the playhead the user
 * saw). `0`, a negative value and `NaN` all read `0:00`.
 */
export function formatTimeMs(ms: number): string {
  const totalSeconds = Number.isFinite(ms)
    ? Math.max(0, Math.floor(ms / 1000))
    : 0;
  const seconds = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3600);
  const pad = (value: number) => value.toString().padStart(2, "0");
  return hours > 0
    ? `${hours}:${pad(minutes)}:${pad(seconds)}`
    : `${minutes}:${pad(seconds)}`;
}

/**
 * Order a timeline the way every consumer displays it: by `timeMs` ascending,
 * then by a kind-specific tiebreaker so the order is **total** (`Array.sort`
 * stability is not relied on).
 *
 * - Two **notes** at one millisecond keep the order they were made in
 *   (`createdAt`), then their `id` — the ordering the notes-only sorter always
 *   had, so unifying the two lists did not reshuffle a single note.
 * - Two **cues** at one millisecond order by end, then by text — the ordering
 *   the cues-only sorter always had.
 * - A note and a cue at the same millisecond put the note first, so the 笔记
 *   tab's content is unaffected by whatever subtitles happen to share its
 *   timestamps.
 *
 * Always returns a new array, so callers can hand the result to a render or a
 * write without aliasing their input. The element type is preserved, so sorting
 * the notes of a timeline (`sortTimestamps(notesOf(items))`) stays
 * `TimestampNoteData[]` instead of widening back to the union.
 */
export function sortTimestamps<T extends TimestampData>(
  items: readonly T[],
): T[] {
  return [...items].sort((a, b) => {
    if (a.timeMs !== b.timeMs) return a.timeMs - b.timeMs;

    if (a.type === "note" && b.type === "note") {
      if (a.createdAt !== b.createdAt)
        return a.createdAt < b.createdAt ? -1 : 1;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    }

    if (a.type === "subtitle" && b.type === "subtitle") {
      const aEnd = a.endMs ?? a.timeMs;
      const bEnd = b.endMs ?? b.timeMs;
      if (aEnd !== bEnd) return aEnd - bEnd;
      return a.content < b.content ? -1 : a.content > b.content ? 1 : 0;
    }

    return a.type === "note" ? -1 : 1;
  });
}

/**
 * The notes of a timeline, in stored order.
 *
 * The sidebar's 笔记 tab and the progress-bar ticks both want "just the notes"
 * while the node stores one list of two kinds, so this is that split — a
 * filter, not a reader: hand it the output of {@link normalizeTimestamps} and
 * sort the result with {@link sortTimestamps} if order matters.
 */
export function notesOf(items: readonly TimestampData[]): TimestampNoteData[] {
  return items.filter(
    (item): item is TimestampNoteData => item.type === "note",
  );
}

/** The subtitle cues of a timeline — see {@link notesOf}. */
export function subtitlesOf(
  items: readonly TimestampData[],
): TimestampSubtitleData[] {
  return items.filter(
    (item): item is TimestampSubtitleData => item.type === "subtitle",
  );
}

/**
 * Which cue is being spoken at `timeMs`, or `-1` when the playhead is in a gap.
 *
 * Both arguments assume {@link sortTimestamps} order — the sidebar sorts before
 * it asks, and a linear scan over a transcript is cheaper than re-sorting on
 * every playhead step.
 *
 * A cue with **no `endMs`** runs until the next cue starts (and to the end of
 * the media if it is last): the optional span means "we know when this line
 * begins", and ending a line at the next one's start is the only reading that
 * keeps a transcript's highlight continuous. A cue *with* an `endMs` stops
 * there, so a real gap in the transcript is a gap here too (`-1`), rather than
 * the previous line being highlighted over silence.
 */
export function activeCueIndex(
  cues: readonly TimestampSubtitleData[],
  timeMs: number,
): number {
  for (let index = 0; index < cues.length; index += 1) {
    const cue = cues[index];
    if (!cue) break;
    // Sorted: the first cue that starts after the playhead ends the search.
    if (cue.timeMs > timeMs) return -1;
    const end =
      cue.endMs ?? cues[index + 1]?.timeMs ?? Number.POSITIVE_INFINITY;
    if (timeMs < end) return index;
  }
  return -1;
}

/**
 * Where the playhead sits **in a list**: the index a new item would be inserted
 * at (`0`..`items.length`), i.e. how many items start at or before `timeMs`.
 *
 * The notes tab draws its playhead line there and inserts the composer there,
 * so "where am I" and "where would this note land" are the same answer by
 * construction rather than by two similar-looking searches. It never returns
 * `-1`: a playhead before the first item is position `0`, which is a place in a
 * list, unlike {@link activeCueIndex}'s "no cue is being spoken".
 *
 * Assumes {@link sortTimestamps} order, like `activeCueIndex`.
 */
export function playheadRowIndex(
  items: readonly TimestampData[],
  timeMs: number,
): number {
  let index = 0;
  while (index < items.length) {
    const item = items[index];
    if (!item || item.timeMs > timeMs) break;
    index += 1;
  }
  return index;
}

/**
 * One tick on a timeline bar: a position, and every note captured there.
 *
 * Pausing and capturing twice mints two notes with the *same* `timeMs` (nothing
 * rounds it to the second), so the ungrouped form would draw two ticks at the
 * same pixel with only the last one reachable.
 */
export interface NoteCluster {
  /** Integer milliseconds — the persisted unit. */
  timeMs: number;
  /** Notes at exactly this millisecond, in {@link sortTimestamps} order. */
  notes: TimestampNoteData[];
}

/**
 * Group notes that share a position into one tick each, ascending by time.
 *
 * Grouping keeps one tick per position and lets its tooltip list every note
 * there — and lets a tick's click focus *every* card at that millisecond.
 *
 * Takes notes, not a whole timeline: the ticks mark **notes only**. A real
 * transcript is hundreds or thousands of cues, and a tick per cue would bury the
 * bar it is drawn on — so the caller splits with {@link notesOf} first, and a
 * cue is reached from the 字幕 tab instead.
 *
 * Ordering is delegated to {@link sortTimestamps}, so a tick's order and the
 * sidebar's order cannot disagree about two notes made in the same millisecond.
 */
export function groupNotesByTime(
  notes: readonly TimestampNoteData[],
): NoteCluster[] {
  const clusters: NoteCluster[] = [];

  for (const note of sortTimestamps(notes)) {
    if (note.type !== "note") continue;
    const last = clusters.at(-1);
    if (last && last.timeMs === note.timeMs) last.notes.push(note);
    else clusters.push({ timeMs: note.timeMs, notes: [note] });
  }

  return clusters;
}

/**
 * Where a note's tick sits along a bar, as a `0`–`100` percentage.
 *
 * `durationSeconds` is deliberately in **seconds**, because that is the unit the
 * media element and the video.js v10 store report (`currentTime` / `duration`),
 * while `timeMs` is the persisted unit. This is the one crossing between them:
 * a marker off by a factor of 1000 has exactly one place to look.
 *
 * A duration that is `0` / `NaN` / `Infinity` means "metadata is not here yet"
 * (or a live stream, whose duration never resolves): the position reads `0`
 * rather than `NaN%`, which would drop the tick's `left` and stack every marker
 * at the bar's start.
 */
export function positionPercent(
  timeMs: number,
  durationSeconds: number,
): number {
  const durationMs = durationSeconds * 1000;
  if (!Number.isFinite(durationMs) || durationMs <= 0) return 0;
  const percent = (Math.max(0, timeMs) / durationMs) * 100;
  return Math.min(100, Math.max(0, percent));
}

/** How a tick's tooltip hangs off it so it cannot leave the player's box. */
export type TooltipAlignment = "start" | "center" | "end";

/**
 * Align a tooltip away from the nearest edge.
 *
 * The v10 video container clips its overflow (`.media-container`), so a centred
 * tooltip on a tick at 1% would lose its left half. Ticks near an edge hang the
 * tooltip inward instead. (The audio preset sets `overflow: visible` on
 * `.audio-skin`, so this is merely harmless there.)
 */
export function tooltipAlignment(percent: number): TooltipAlignment {
  if (percent < 12) return "start";
  if (percent > 88) return "end";
  return "center";
}

/**
 * A note body: a **Tiptap document**.
 *
 * The shape is opaque to this layer — it is produced by
 * `packages/editor`'s single-block template and rendered back by its
 * `SingleBlockRenderer`, and `packages/ui` does not depend on Tiptap. It is
 * taken from the interface's own note variant, so a stored note and a freshly
 * minted one are the same type and the one `any` lives where it was dictated
 * (`TimestampNoteData.content`), not here.
 */
export type NoteDoc = TimestampNoteData["content"];

/**
 * Wrap plain text in the one-paragraph Tiptap document a note body is stored
 * as (the schema `SingleBlockEditor` / `SingleBlockRenderer` declare).
 *
 * An empty string produces a paragraph with **no** text node: ProseMirror
 * throws `Empty text nodes are not allowed` on `schema.text("")`, so the empty
 * case has to be a childless paragraph.
 */
export function noteDocFromText(text: string): NoteDoc {
  return {
    type: "doc",
    content: [
      text.length > 0
        ? { type: "paragraph", content: [{ type: "text", text }] }
        : { type: "paragraph" },
    ],
  };
}

/**
 * The plain text of a note body, for surfaces that cannot render rich text —
 * today the progress bar's tick tooltip, which lives inside the player's own
 * DOM and must not pull the editor's schema in.
 *
 * Inline siblings concatenate; every block node's text is its own line. A
 * legacy string body (an M6 `text`) is returned as-is, so this doubles as the
 * reader for a record that predates the document shape.
 */
export function docToPlainText(doc: unknown): string {
  if (typeof doc === "string") return doc;
  const parts: string[] = [];
  collectText(doc, parts);
  // The last block pushed a trailing newline of its own.
  return parts.join("").replace(/\n+$/, "");
}

/**
 * Gather a document's text into `out`, one entry per block.
 *
 * A node that has children is a block **unless** it is the `doc` root (which
 * only groups its blocks) — so the separator lands between paragraphs, never
 * between two inline siblings of the same paragraph.
 */
function collectText(node: unknown, out: string[]): void {
  if (Array.isArray(node)) {
    for (const child of node) collectText(child, out);
    return;
  }
  if (node === null || typeof node !== "object") return;

  const record = node as { type?: unknown; text?: unknown; content?: unknown };
  if (record.type === "text") {
    if (typeof record.text === "string") out.push(record.text);
    return;
  }
  if (!Array.isArray(record.content)) return;

  const nested: string[] = [];
  for (const child of record.content) collectText(child, nested);
  const text = nested.join("");
  if (text.length === 0) return;

  out.push(text);
  if (record.type !== "doc") out.push("\n");
}

/**
 * The title a card prints when the note has neither a stored title nor a body
 * to fall back to (and the title the node created from such a note gets).
 */
export const UNTITLED_NOTE = "未命名笔记";

/** How much of a body a fallback title may quote before it is clipped. */
const TITLE_FALLBACK_CHARS = 40;

/**
 * The note's title, or a stand-in derived from its body.
 *
 * A note's title is optional (see `TimestampNoteData.title`), but three
 * surfaces cannot show "nothing": the 节点引用 card, the node that 「转化为节点」
 * creates, and the progress-bar tick's tooltip name the note. In all three a
 * body's first line is a better answer than an empty string — and a note with
 * neither reads as {@link UNTITLED_NOTE} rather than as blank space.
 *
 * The stored title is never *rewritten* by this: a note without one keeps
 * having none until the user types one, so the title input still opens empty.
 */
export function noteTitle(note: TimestampNoteData): string {
  const stored = (note.title ?? "").trim();
  if (stored.length > 0) return stored;

  const body = docToPlainText(note.content).replace(/\s+/g, " ").trim();
  if (body.length === 0) return translate(UNTITLED_NOTE);
  return body.length > TITLE_FALLBACK_CHARS
    ? `${body.slice(0, TITLE_FALLBACK_CHARS)}…`
    : body;
}

/**
 * Whether a note has nothing in it yet.
 *
 * The one reader the 加笔记 draft consults before it decides to become a stored
 * note: a card the user opened and left is a title of `""` over a body holding
 * one empty paragraph, and storing that would put a blank row on the timeline
 * that nothing can be read from.
 *
 * Whitespace does not count, in either half — a title of `"   "` says as little
 * as no title, and a body of spaces renders as an empty card. `content` may
 * still be a legacy string (see {@link normalizeTimestamps}), which
 * {@link docToPlainText} handles.
 */
export function isBlankNote(note: TimestampNoteData): boolean {
  const title = (note.title ?? "").trim();
  const body = docToPlainText(note.content).trim();
  return title.length === 0 && body.length === 0;
}

/**
 * Normalize a persisted `timestamps` value into usable timeline items.
 *
 * One reader for the one stored list, tolerant of everything the column has ever
 * held:
 *
 * - **The unified shape** — `{ type: "note" | "subtitle", timeMs, content, … }`.
 * - **A pre-unification note** (`{ id, timeMs, doc | text, … }`, no `type`) —
 *   `doc` is the body, `text` the M6 one. Either is lifted into `content`; a
 *   string body becomes the equivalent one-paragraph document
 *   ({@link noteDocFromText}), which is the lazy upgrade the first edit then
 *   persists. Reading never writes.
 * - **A pre-unification cue** (`{ startMs, endMs, text }`, no `type`, no
 *   `timeMs`) — `startMs` becomes the one `timeMs`.
 *
 * A non-array is warned about (unless `undefined`, which is the normal "no
 * timeline" shape) and reads as `[]`. An item that is not an object, has no
 * numeric time, or carries an unknown `type` is dropped with a warning — the
 * backend stays permissive, so this tolerance is front-end only. A cue whose
 * `endMs` is not after its `timeMs` keeps its cue and **loses only the span**:
 * `endMs` is optional, so dropping it leaves a perfectly seekable line, whereas
 * dropping the cue would lose a line of the transcript.
 *
 * `id` / `createdAt` / `updatedAt` on a note get stable substitutes, so every
 * returned note is complete. Order is preserved and duplicates are kept: this
 * validates, it does not reconcile — call {@link sortTimestamps} for display
 * order.
 */
export function normalizeTimestamps(value: unknown): TimestampData[] {
  if (!Array.isArray(value)) {
    if (value !== undefined) {
      console.warn(
        "[media] normalizeTimestamps expected an array, got:",
        value,
      );
    }
    return [];
  }

  const items: TimestampData[] = [];

  for (const item of value) {
    if (typeof item !== "object" || item === null) {
      console.warn(
        "[media] Dropping a timestamp item that is not an object:",
        item,
      );
      continue;
    }

    const record = item as Record<string, unknown>;
    const kind = timestampKind(record);

    if (kind === "subtitle") {
      const cue = normalizeSubtitle(record);
      if (cue) items.push(cue);
      continue;
    }

    if (kind === "note") {
      const note = normalizeNote(record);
      if (note) items.push(note);
      continue;
    }

    console.warn("[media] Dropping a timestamp item of an unknown kind:", item);
  }

  return items;
}

/**
 * Which kind a stored item is — from its `type`, or from the shape that stood in
 * for one before the two were unified.
 *
 * A pre-unification cue anchored on `startMs` and a pre-unification note on
 * `timeMs`, so the presence of `timeMs` is the discriminator for the records
 * that have no `type`. `null` means "neither", and the caller drops it: a
 * timeline item whose kind cannot be told cannot be rendered or edited.
 */
function timestampKind(record: Record<string, unknown>): TimestampKind | null {
  if (record.type === "note" || record.type === "subtitle") return record.type;
  if (record.type !== undefined) return null;
  if (typeof record.timeMs === "number") return "note";
  if (typeof record.startMs === "number") return "subtitle";
  return null;
}

/** One note, complete and upgraded — see {@link normalizeTimestamps}. */
function normalizeNote(
  record: Record<string, unknown>,
): TimestampNoteData | null {
  if (typeof record.timeMs !== "number") {
    console.warn(
      "[media] Dropping a timestamp note without a numeric timeMs:",
      record,
    );
    return null;
  }

  const timeMs = record.timeMs;
  const now = new Date().toISOString();

  const note: TimestampNoteData = {
    id: typeof record.id === "string" ? record.id : `note-${timeMs}`,
    type: "note",
    timeMs,
    content: noteBody(record),
    createdAt: typeof record.createdAt === "string" ? record.createdAt : now,
    updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : now,
  };

  // The two card-shape keys are **added only when stored**, never defaulted:
  // `title: undefined` and an absent title mean the same thing to every reader,
  // and keeping the key absent is what lets a legacy note round-trip byte-for-
  // byte through `normalizeTimestamps` until the first edit.
  if (typeof record.title === "string") note.title = record.title;
  if (typeof record.nodeId === "string" && record.nodeId.length > 0) {
    note.nodeId = record.nodeId;
  }

  return note;
}

/**
 * The note's body as a document, whichever generation of the shape stored it:
 * the unified `content` (an object, or a string for a note the migration lifted
 * out of an M6 `text`), a pre-unification `doc`, or an M6 `text`. A record with
 * none of them reads as an empty note rather than being dropped.
 */
function noteBody(record: Record<string, unknown>): NoteDoc {
  for (const key of ["content", "doc", "text"] as const) {
    const value = record[key];
    if (typeof value === "object" && value !== null) return value as NoteDoc;
    if (typeof value === "string") return noteDocFromText(value);
  }
  return noteDocFromText("");
}

/** One cue, complete — see {@link normalizeTimestamps} for the span rule. */
function normalizeSubtitle(
  record: Record<string, unknown>,
): TimestampSubtitleData | null {
  const timeMs =
    typeof record.timeMs === "number"
      ? record.timeMs
      : typeof record.startMs === "number"
        ? record.startMs
        : null;

  if (timeMs === null) {
    console.warn(
      "[media] Dropping a subtitle cue without a numeric startMs / timeMs:",
      record,
    );
    return null;
  }

  const cue: TimestampSubtitleData = {
    type: "subtitle",
    timeMs,
    content:
      typeof record.content === "string"
        ? record.content
        : typeof record.text === "string"
          ? record.text
          : "",
  };

  const endMs = typeof record.endMs === "number" ? record.endMs : undefined;
  if (endMs === undefined) return cue;
  if (endMs > timeMs) {
    cue.endMs = endMs;
    return cue;
  }

  console.warn(
    "[media] Dropping a subtitle cue's inverted span (keeping the cue):",
    record,
  );
  return cue;
}

/**
 * Mint a note whose body is `content` (design §M6.2-⑦: `note_<uuid>`, with the
 * dataview-style timestamp+random fallback where `crypto.randomUUID` is absent).
 *
 * `now` is injectable so a test can pin `createdAt` / `updatedAt`.
 */
export function createTimestampNote(
  timeMs: number,
  content: NoteDoc,
  now: Date = new Date(),
): TimestampNoteData {
  const globalCrypto = globalThis.crypto;
  const id =
    globalCrypto && typeof globalCrypto.randomUUID === "function"
      ? `note_${globalCrypto.randomUUID()}`
      : `note_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  const stamp = now.toISOString();
  return {
    id,
    type: "note",
    timeMs: Math.max(0, Math.round(timeMs)),
    content,
    createdAt: stamp,
    updatedAt: stamp,
  };
}

/**
 * A host's request for "start a note here" (the `Mod-Enter` path, and the
 * player's control-bar 「加笔记」 button).
 *
 * `token` makes repeats work: pressing `Mod-Enter` twice at the same position
 * produces the same `timeMs`, and only a changed `token` tells the sidebar that
 * this is a second request. The host owns the counter.
 */
export interface TimestampAddRequest {
  /** The position captured from the controller when the key was pressed. */
  timeMs: number;
  /** Monotonically increasing; a new value means "run the request again". */
  token: number;
}

/**
 * What clicking a note tick reports: where the click landed, and which notes
 * live there.
 *
 * `noteIds` is a cluster's whole membership (`groupNotesByTime`), not one id,
 * because two notes captured in the same millisecond share one tick — focusing
 * only the first would hide the other behind a tick the user just clicked.
 */
export interface TimestampNoteActivation {
  timeMs: number;
  /** Every note at `timeMs`, in display order; never empty. */
  noteIds: string[];
}

/**
 * A host's request for "bring this note into view" — the tick → sidebar edge.
 *
 * Structurally an activation plus the same `token` trick, so clicking the same
 * tick twice focuses the card twice (the second click re-scrolls it after the
 * user has scrolled away) without the sidebar re-focusing on every re-render.
 */
export interface TimestampFocusRequest extends TimestampNoteActivation {
  /** Monotonically increasing; a new value means "focus it again". */
  token: number;
}
