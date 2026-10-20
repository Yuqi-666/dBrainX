// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Picks the one subtitle or lyric track the download will store.
 *
 * A site can offer many tracks, but `TimestampSubtitleData` has no language
 * dimension: one import stores exactly one track. The choice therefore has to
 * be automatic and predictable. The order used here is:
 *
 * 1. the language the site says the media is in (a Chinese video gets its
 *    Chinese subtitles even when the interface language is unknown);
 * 2. English;
 * 3. the first subtitle a person made;
 * 4. the first machine-generated caption.
 *
 * An audio import asks the site for its lyric track first, so the same order
 * applies with "lyrics" in front.
 *
 * The one thing this adapter cannot consider is the interface language: the
 * domain request carries no locale, and guessing it from the server process
 * would be wrong for every other user. The order above still gives the native
 * track the best chance, which is what the interface-language rule was for.
 *
 * A missing or unreadable track is never an error. The import succeeds, the
 * result carries no subtitle, and the client shows the media without one.
 */

import { open, readdir, stat } from "node:fs/promises";
import { join } from "node:path";

import type { MediaKind } from "@workspace/interfaces";
import type { MediaSubtitleTrack } from "@workspace/domain";

import type { YtDlpMetadata, YtDlpSubtitleTrack } from "./yt-dlp-metadata.ts";
import { parseVtt } from "./vtt-parser.ts";

/**
 * A subtitle file larger than this is read only in part. A real caption file
 * is far below it; the cap protects the process from a hostile file while the
 * cue-level caps protect the stored node.
 */
const MAX_SUBTITLE_FILE_BYTES = 16 * 1024 * 1024;

/** Language tag used when a file carries no language, as in `source.vtt`. */
const UNKNOWN_LANGUAGE = "und";

/** One candidate track, before the file behind it is checked. */
interface TrackCandidate {
  language: string;
  label: string;
  automatic: boolean;
}

/**
 * Reads the selected track from the work directory, or `null` when there is
 * no usable subtitle.
 *
 * Candidates come from the metadata, and each candidate is matched to a file
 * yt-dlp wrote. If no candidate has a file, any `.vtt` yt-dlp wrote is used:
 * a track without metadata is still better than no subtitles at all.
 */
export async function selectSubtitleTrack(
  metadata: YtDlpMetadata,
  workDir: string,
  kind: MediaKind,
): Promise<MediaSubtitleTrack | null> {
  const files = await listSubtitleFiles(workDir);
  if (files.size === 0) return null;

  const candidates = rankedCandidates(metadata, kind);
  const used = new Set<string>();

  for (const candidate of candidates) {
    const path =
      files.get(candidate.language.toLowerCase()) ??
      files.get(candidate.language);
    if (!path || used.has(path)) continue;
    used.add(path);

    const track = await readTrack(path, candidate);
    if (track) return track;
  }

  for (const [language, path] of files) {
    if (used.has(path)) continue;
    const track = await readTrack(path, {
      language: language || UNKNOWN_LANGUAGE,
      label: language || UNKNOWN_LANGUAGE,
      // A file with no metadata entry cannot be called automatic with
      // confidence; showing it as manual is the safer label.
      automatic: false,
    });
    if (track) return track;
  }

  return null;
}

/**
 * Lists the subtitle and lyric tracks a probe result shows.
 *
 * A language that has both a manual and an automatic track appears once, as
 * manual, because that is the track a download would pick.
 */
export function subtitleLanguages(
  metadata: YtDlpMetadata,
  kind: MediaKind,
): { language: string; label: string; automatic: boolean }[] {
  const seen = new Set<string>();
  const result: { language: string; label: string; automatic: boolean }[] = [];

  for (const track of rankedCandidates(metadata, kind)) {
    const key = track.language.toLowerCase();
    if (key === "live_chat" || seen.has(key)) continue;
    seen.add(key);
    result.push(track);
  }
  return result;
}

/**
 * Orders every track the site reported by the selection priority.
 *
 * The same list serves the actual download and the probe's language list, so
 * the UI shows the tracks the downloader can really choose.
 */
function rankedCandidates(
  metadata: YtDlpMetadata,
  kind: MediaKind,
): TrackCandidate[] {
  const manual = asCandidates(metadata.manualSubtitles, false);
  const automatic = asCandidates(metadata.automaticCaptions, true);
  const all = [...manual, ...automatic];
  const ordered: TrackCandidate[] = [];

  const add = (track: TrackCandidate | undefined): void => {
    if (track) ordered.push(track);
  };
  const firstWhere = (predicate: (track: TrackCandidate) => boolean) =>
    all.find(predicate);

  if (kind === "audio") {
    add(
      firstWhere((track) => isLyricsTrack(track) && !track.automatic) ??
        firstWhere((track) => isLyricsTrack(track)),
    );
  }

  const language = metadata.language.trim();
  if (language !== "") {
    add(firstWhere((track) => sameLanguage(track.language, language)));
    const base = baseLanguage(language);
    if (base !== "") {
      add(firstWhere((track) => baseLanguage(track.language) === base));
    }
  }

  add(firstWhere((track) => baseLanguage(track.language) === "en"));
  add(manual[0]);
  add(automatic[0]);

  return ordered;
}

/** Turns one metadata list into candidates, keeping the site's order. */
function asCandidates(
  tracks: readonly YtDlpSubtitleTrack[],
  automatic: boolean,
): TrackCandidate[] {
  return tracks.map((track) => ({
    language: track.language,
    label: track.label,
    automatic,
  }));
}

/** True when a track is the site's lyric track. */
function isLyricsTrack(track: TrackCandidate): boolean {
  const label = `${track.language} ${track.label}`.toLowerCase();
  return label.includes("lyric") || label.includes("歌词");
}

/** True when two language tags name the same language. */
function sameLanguage(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

/** The part of a language tag before its region, e.g. `zh` from `zh-Hans`. */
function baseLanguage(language: string): string {
  return language.toLowerCase().split(/[-_]/)[0] ?? "";
}

/** Maps lowercased language tags to the VTT file yt-dlp wrote for them. */
async function listSubtitleFiles(
  workDir: string,
): Promise<Map<string, string>> {
  let names: string[];
  try {
    names = await readdir(workDir);
  } catch {
    return new Map();
  }

  const files = new Map<string, string>();
  for (const name of names.sort()) {
    if (!name.startsWith("source.") || !name.endsWith(".vtt")) continue;
    const language = name.slice("source.".length, -".vtt".length);
    if (language === "") continue;
    files.set(language.toLowerCase(), join(workDir, name));
  }
  return files;
}

/** Reads and parses one file; `null` when it holds no usable cue. */
async function readTrack(
  path: string,
  candidate: TrackCandidate,
): Promise<MediaSubtitleTrack | null> {
  const text = await readSubtitleText(path);
  if (text === null) return null;

  const parsed = parseVtt(text.text);
  if (parsed.cues.length === 0) return null;

  return {
    language: candidate.language,
    label: candidate.label,
    automatic: candidate.automatic,
    truncated: parsed.truncated || text.truncated,
    cues: parsed.cues,
  };
}

/**
 * Reads a subtitle file, capped at {@link MAX_SUBTITLE_FILE_BYTES}.
 *
 * Reading only the prefix of an oversized file is intentional: the cue parser
 * stops at its own caps anyway, and the result is marked truncated.
 */
async function readSubtitleText(
  path: string,
): Promise<{ text: string; truncated: boolean } | null> {
  try {
    const info = await stat(path);
    if (!info.isFile() || info.size === 0) return null;

    const length = Math.min(info.size, MAX_SUBTITLE_FILE_BYTES);
    const buffer = Buffer.alloc(length);
    const handle = await open(path, "r");
    try {
      await handle.read(buffer, 0, length, 0);
    } finally {
      await handle.close();
    }
    return {
      text: buffer.toString("utf8"),
      truncated: info.size > MAX_SUBTITLE_FILE_BYTES,
    };
  } catch {
    return null;
  }
}
