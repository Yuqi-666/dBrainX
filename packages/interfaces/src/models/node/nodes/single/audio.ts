// SPDX-License-Identifier: AGPL-3.0-only

import type { NodeBase } from "../../base";
import type { NodeType } from "../../types";
import type { TimestampData } from "./timestamp-data";

export interface AudioNodeData extends NodeBase, NodeType<"audio"> {
  duration: number;
  fileSize: number;
  /**
   * Where the audio bytes came from.
   *
   * Optional because a record written before the music-site import existed has
   * no column value; a missing value reads as `"local"` (`media-import-implementation.md`
   * §4). No PocketBase migration is needed — the `nodes` collection already has
   * the `source` column.
   */
  source?: "local" | "online";
  /**
   * The page an online audio node was imported from, kept so the user can go
   * back to the source. Absent on local uploads and on every old record.
   */
  sourceUrl?: string;

  content: AudioContent;
}

export interface AudioContent {
  url: string;
  /**
   * Cover image of the imported audio (the music site's artwork), as a stored
   * file address.
   *
   * Optional because a local upload and every record written before the import
   * existed have none; a missing value means "no cover". The `nodes` collection
   * already has the `coverUrl` column, so no migration is needed.
   */
  coverUrl?: string;
  /**
   * The node's timeline: its notes and its transcript, one array.
   *
   * Absent / empty means "no timestamps" — old records stay readable
   * (media.md §4.1). The reader splits the two kinds by `type`; the storage is
   * one column so a record can never hold notes without its cues (see
   * `VideoContent.timestamps`). The media import writes music lyrics here as
   * `type: "subtitle"` cues.
   */
  timestamps?: TimestampData[];
}
