// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The `audio` node type.
 *
 * This is the persisted `nodes.content` payload: the file, its artwork, the
 * timeline and the playback facts the DTO flattens back onto the node.
 */

import type { JsonSchema } from "@workspace/plugin-sdk";

import { timestampDataSchema } from "../shared/timestamp-data.ts";
import type { TimestampData } from "../shared/timestamp-data.ts";

export type { AudioNodeData } from "@workspace/interfaces/models/node/nodes/single/audio";

export interface AudioContent {
  url: string;
  /** The imported source's artwork; absent means "no cover". */
  coverUrl?: string;
  /** Notes and transcript cues in one array; absent or empty means "no timestamps". */
  timestamps?: TimestampData[];
  duration: number;
  /** Optional because a record written before the music-site import has no value. */
  source?: "local" | "online";
  sourceUrl?: string;
  fileSize: number;
}

export const audioSchema: JsonSchema = {
  type: "object",
  required: ["url", "duration", "fileSize"],
  properties: {
    url: { type: "string" },
    coverUrl: { type: "string" },
    timestamps: { type: "array", items: timestampDataSchema },
    duration: { type: "number", minimum: 0 },
    source: { type: "string", enum: ["local", "online"] },
    sourceUrl: { type: "string" },
    fileSize: { type: "number", minimum: 0 },
  },
  additionalProperties: false,
};

/** A draft audio node: no file, zero duration and an empty timeline. */
export function createAudioContent(): AudioContent {
  return { url: "", duration: 0, fileSize: 0, timestamps: [] };
}
