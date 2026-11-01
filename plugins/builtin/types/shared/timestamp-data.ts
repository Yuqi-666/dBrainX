// SPDX-License-Identifier: AGPL-3.0-only

/**
 * One timestamped item on an audio/video timeline.
 *
 * This module is the builtin plugin's shared copy of the timeline contract:
 * `video` and `audio` both embed it, so it lives here rather than in either
 * type folder. The declaration still exists in `@workspace/interfaces` while
 * the packages and apps read it from there; plan todo 20 retires that copy.
 *
 * A media node's timeline holds exactly one kind of thing: an item anchored at
 * a millisecond. Two of them exist — a **note** the user wrote, and a
 * **subtitle cue** that came with the media — discriminated by
 * {@link TimestampData}['type'].
 *
 * **The time base is the media the node actually plays**, not the original
 * file. Every duration or position that crosses a boundary is an **integer
 * millisecond**, never the float seconds of `HTMLMediaElement.currentTime`.
 */

import type { JsonSchema } from "@workspace/plugin-sdk";
import type { NodeId } from "@workspace/interfaces/models/node/base";

export type TimestampKind = "note" | "subtitle";

/**
 * A note the user wrote at a point on the timeline.
 *
 * `id` is the note's persisted identity: it is the sidebar card's key, and it
 * is what a tick's click reports so the sidebar can focus the matching card.
 * A subtitle has no such identity, which is why `id` lives on this variant
 * rather than on the union.
 *
 * A note is one type with two card shapes, discriminated by {@link nodeId}:
 * without one it is a rich-text note; with one it renders the referenced graph
 * node instead of the body.
 */
export interface TimestampNoteData {
  /** Stable identity — `note_<uuid>` for a note written by the app. */
  id: string;
  /** The discriminator; see {@link TimestampData}. */
  type: "note";
  /** Milliseconds from the start of the played media. */
  timeMs: number;
  /** The card's title; absent means the card prints a placeholder. */
  title?: string;
  /** The node this note refers to — present exactly on the reference card. */
  nodeId?: NodeId;
  /**
   * The note's body as a Tiptap document — the same single-paragraph JSON
   * `SingleBlockEditor` produces. Opaque here: `packages/interfaces`
   * deliberately does not depend on Tiptap.
   */
  content: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

/**
 * One subtitle cue of the timeline.
 *
 * A cue is a span of speech, so it may carry an `endMs`; a note is a point and
 * never does. `endMs` is optional because a cue written without one is still a
 * perfectly seekable cue.
 */
export interface TimestampSubtitleData {
  /** The discriminator; see {@link TimestampData}. */
  type: "subtitle";
  /** Milliseconds from the start of the played media. */
  timeMs: number;
  /** The cue's end; absent means "this cue has no span to show". */
  endMs?: number;
  /** The transcribed line, exactly as it was stored. Plain text, not a document. */
  content: string;
}

/** A note or a subtitle cue — see the variants for the per-kind keys. */
export type TimestampData = TimestampNoteData | TimestampSubtitleData;

/**
 * The timeline item JSON Schema.
 *
 * `oneOf` is safe here because the two variants disagree on the `type` const,
 * so exactly one branch can match. Item keys stay open in the same spirit as
 * the annotation layer: the timeline editor owns the internal shape.
 */
export const timestampDataSchema: JsonSchema = {
  type: "object",
  oneOf: [
    {
      type: "object",
      required: ["id", "type", "timeMs", "content", "createdAt", "updatedAt"],
      properties: {
        id: { type: "string" },
        type: { const: "note" },
        timeMs: { type: "number", minimum: 0 },
        title: { type: "string" },
        nodeId: { type: "string" },
        content: { type: "object" },
        createdAt: { type: "string" },
        updatedAt: { type: "string" },
      },
    },
    {
      type: "object",
      required: ["type", "timeMs", "content"],
      properties: {
        type: { const: "subtitle" },
        timeMs: { type: "number", minimum: 0 },
        endMs: { type: "number", minimum: 0 },
        content: { type: "string" },
      },
    },
  ],
};
