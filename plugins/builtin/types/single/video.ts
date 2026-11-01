// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The `video` node type.
 *
 * This is the persisted `nodes.content` payload: the file, its HLS rendition,
 * the timeline and the playback facts the DTO flattens back onto the node.
 */

import type { JsonSchema } from "@workspace/plugin-sdk";

import { timestampDataSchema } from "../shared/timestamp-data.ts";
import type { TimestampData } from "../shared/timestamp-data.ts";

import type { VideoSource } from "@workspace/interfaces/models/node/nodes/single/video";

export type {
  VideoSource,
  VideoNodeData,
} from "@workspace/interfaces/models/node/nodes/single/video";

export interface VideoContent {
  /** The uploaded/remote file itself, played when no HLS rendition exists. */
  url: string;
  coverUrl: string;
  /** HLS playlist packaged by the backend; preferred over {@link url} when present. */
  hlsUrl?: string;
  /** Notes and transcript cues in one array; absent or empty means "no timestamps". */
  timestamps?: TimestampData[];
  duration: number;
  source: VideoSource;
  sourceUrl?: string;
  fileSize: number;
  location?: string;
  shootingTime?: string;
}

export const videoSchema: JsonSchema = {
  type: "object",
  required: ["url", "coverUrl", "duration", "source", "fileSize"],
  properties: {
    url: { type: "string" },
    coverUrl: { type: "string" },
    hlsUrl: { type: "string" },
    timestamps: { type: "array", items: timestampDataSchema },
    duration: { type: "number", minimum: 0 },
    source: { type: "string", enum: ["local", "online"] },
    sourceUrl: { type: "string" },
    fileSize: { type: "number", minimum: 0 },
    location: { type: "string" },
    shootingTime: { type: "string" },
  },
  additionalProperties: false,
};

/** A draft video node: no file, no cover, zero duration and an empty timeline. */
export function createVideoContent(): VideoContent {
  return {
    url: "",
    coverUrl: "",
    duration: 0,
    source: "local",
    fileSize: 0,
    timestamps: [],
  };
}
