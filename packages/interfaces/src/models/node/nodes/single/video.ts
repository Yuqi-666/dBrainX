// SPDX-License-Identifier: AGPL-3.0-only

import type { NodeBase } from "../../base";
import type { NodeType } from "../../types";
import type { TimestampData } from "./timestamp-data";

export type VideoSource = "local" | "online";

export interface VideoNodeData extends NodeBase, NodeType<"video"> {
  duration: number;
  source: VideoSource;
  sourceUrl?: string;
  fileSize?: number;
  location?: string;
  shootingTime?: string;

  content: VideoContent;
}

export interface VideoContent {
  /** The uploaded/remote file itself, played when no HLS rendition exists. */
  url: string;
  coverUrl: string;
  /**
   * HLS playlist (`.m3u8`) the backend packaged the video into, when it has
   * been transcoded. Browsers cannot decode every codec a recording device
   * writes (HEVC being the common one), so a node that has this plays the
   * playlist and only falls back to {@link url} when it does not.
   */
  hlsUrl?: string;
  /**
   * The node's timeline: its notes (`type: "note"`) and its transcript
   * (`type: "subtitle"`), in **one** array.
   *
   * Absent / empty means "no timestamps" — old records stay readable
   * (media.md §4.1). It used to be two keys (`timestampNotes` + `subtitles`)
   * and two `nodes` columns; one key and one column now, so the two halves
   * cannot drift apart and the sidebar's two tabs are two filters over the same
   * list rather than two readers of the same JSON record.
   *
   * The media import writes downloaded subtitles here as `type: "subtitle"`
   * cues; the backend still has no transcription step, so a video uploaded from
   * a local file has none. The data path is wired end to end, so a transcript
   * is a data problem, not a UI one.
   */
  timestamps?: TimestampData[];
}
