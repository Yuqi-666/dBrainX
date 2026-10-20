// SPDX-License-Identifier: AGPL-3.0-only

/**
 * One timestamped item on an audio/video timeline.
 *
 * A media node's timeline holds exactly one kind of thing: an item anchored at
 * a millisecond. Two of them exist — a **note** the user wrote, and a
 * **subtitle cue** that came with the media — and they used to be two types in
 * two `nodes` columns (`TimestampNote` + `SubtitleCue`, `timestampNotes` +
 * `subtitles`). They are one type in one column now, discriminated by
 * {@link TimestampData}['type'], because every consumer already treated them
 * the same way: an item at a millisecond that the timeline can seek to and the
 * sidebar can draw as a card.
 *
 * The three keys every variant carries are the reason for the union — **类型 /
 * 时间戳 / 内容**. Everything else is variant metadata:
 *
 * | key                   | note     | subtitle   |
 * | --------------------- | -------- | ---------- |
 * | `type`                | `note`   | `subtitle` |
 * | `timeMs`              | required | required   |
 * | `content`             | Tiptap doc | plain line |
 * | `title` / `nodeId`    | optional | —          |
 * | `endMs`               | —        | optional   |
 * | `id` / stamps         | required | —          |
 *
 * **The time base is the media the node actually plays** (the HLS rendition
 * when one exists), not the original file — `media.md` §0.3-10. Every duration
 * or position that crosses a boundary is an **integer millisecond**, never the
 * float seconds of `HTMLMediaElement.currentTime`.
 *
 * Subtitle cues have a writer now: the media import downloads a video's
 * subtitles or a music site's lyrics and the client writes them into
 * `content.timestamps`. The backend still does not transcribe anything, so a
 * locally uploaded file has no cues until an import adds them.
 */
import type { NodeId } from "../../base";

export type TimestampKind = "note" | "subtitle";

/**
 * A note the user wrote at a point on the timeline.
 *
 * `id` is the note's persisted identity: it is the sidebar card's key, and it
 * is what a tick's click reports so the sidebar can focus the matching card.
 * A subtitle has no such identity — nothing edits or deletes one, and a cue
 * from a VTT file has no id to keep — which is why `id` lives on this variant
 * rather than on the union.
 *
 * A note is one type with **two card shapes**, and the discriminator between
 * them is {@link nodeId}:
 *
 * - no `nodeId` → a **文本笔记**: a title over a rich-text body.
 * - `nodeId` set → a **节点引用**: the note points at a graph node, and the
 *   card draws that node's icon and name instead of the body. The body and
 *   title stay on the record (they are what the reference was made from), so
 *   the shape is one type rather than a second union member — which is also
 *   what lets the backend's one `timestampDataSchema` keep accepting it without
 *   a migration (`content` is opaque JSON there).
 */
export interface TimestampNoteData {
  /** Stable identity — `note_<uuid>` for a note written by the app. */
  id: string;
  /** The discriminator; see {@link TimestampData}. */
  type: "note";
  /** Milliseconds from the start of the played media. */
  timeMs: number;
  /**
   * The card's title — the top row of a 文本笔记.
   *
   * Optional because every note written before the note card grew a title has
   * none, and a card with no title prints a placeholder instead of inventing
   * one. It is deliberately **not** derived from the body: the title is what
   * the user named the moment, and a body's first line is not a title.
   */
  title?: string;
  /**
   * The node this note refers to — present exactly on the 节点引用 card.
   *
   * Set when a 文本笔记 is turned into a node (「更多 → 转化为节点」), and
   * cleared by 「取消引用」. Absent on every note that is its own content.
   */
  nodeId?: NodeId;
  /**
   * The note's body as a **Tiptap document** — the same single-paragraph JSON
   * `SingleBlockEditor` produces and `SingleBlockRenderer` renders
   * (`packages/editor/components/tiptap-templates/single-block`).
   *
   * The field used to be `text: string` (M6) and then `doc` on a separate
   * `TimestampNote` type. It is one representation now, under the union's one
   * `content` key: `normalizeTimestamps` translates a legacy `{ text }` — or a
   * legacy `{ doc }` — record into this document on read (lazy upgrade; reading
   * never writes), and the first edit persists the document.
   *
   * Typed `Record<string, any>` like `RichTextContent.docs` / `TextContent.docs`
   * — `packages/interfaces` deliberately does not depend on Tiptap, so the shape
   * is opaque here and narrowed by the editor package.
   */
  content: Record<string, any>;
  createdAt: string;
  updatedAt: string;
}

/**
 * One subtitle cue of the timeline.
 *
 * A cue is a span of speech, so it may carry an `endMs`; a note is a point and
 * never does. `endMs` is **optional** rather than required because the two
 * useful degradations are "no span" and "span unknown": a record written
 * without one is still a perfectly seekable cue, and the reader drops a span
 * that is not after `timeMs` instead of dropping the cue (see
 * `normalizeTimestamps`).
 */
export interface TimestampSubtitleData {
  /** The discriminator; see {@link TimestampData}. */
  type: "subtitle";
  /** Milliseconds from the start of the played media. */
  timeMs: number;
  /**
   * The cue's end, in milliseconds from the start of the played media.
   *
   * Absent means "this cue has no span to show" — either the transcript never
   * carried one or it was inverted and the reader discarded just the end.
   */
  endMs?: number;
  /**
   * The transcribed line, exactly as it was stored.
   *
   * Plain text, not a document: a cue is a transcription line, not something
   * the user formats, and a VTT/SRT line has no rich-text counterpart to lose.
   */
  content: string;
}

/** A note or a subtitle cue — see the variants for the per-kind keys. */
export type TimestampData = TimestampNoteData | TimestampSubtitleData;
