// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Reads the one JSON document yt-dlp prints.
 *
 * `--dump-single-json` prints the whole metadata of the page as one line after
 * the progress lines, so stdout is a mixture of formats. The payload is the
 * last line that starts with `{`; the JSON itself is one line because yt-dlp
 * escapes newlines inside values.
 *
 * The metadata is untrusted: a site controls its own title, uploader, album and
 * subtitle names. Every field is therefore read through a type check, an absent
 * or malformed field becomes an empty value, and nothing here is used as a
 * file name without cleaning. The two properties the import flow needs are
 * flattened out of the raw object: the manual and the automatic subtitle
 * tracks, each with its language tag and display name.
 */

import { MediaImportFailure } from "@workspace/utils/media-import";

/** One subtitle or lyric track the site reported. */
export interface YtDlpSubtitleTrack {
  /** Language tag from the metadata key, e.g. `en`, `zh-Hans`, `lyrics`. */
  language: string;
  /** Name the site gave the track, or the language tag when it gave none. */
  label: string;
}

/** The subset of the site metadata the adapters read. */
export interface YtDlpMetadata {
  /** Page title, `""` when the site reported none. */
  title: string;
  /** Track name of a music page, `""` when the site reported none. */
  track: string;
  /** Artist, creator, uploader, or channel, whichever the site reported. */
  artist: string;
  /** Album name, `""` when the site reported none. */
  album: string;
  /** Duration in seconds, `0` when the site reported none. */
  duration: number;
  /** Original language of the media, `""` when the site reported none. */
  language: string;
  /** Canonical page address, `""` when the site reported none. */
  webpageUrl: string;
  /** yt-dlp extractor that answered, e.g. `BiliBili`. */
  extractorKey: string;
  /** Raw format table, mapped by `media-quality`. */
  formats: unknown[];
  /** Subtitles a person made, in the site's order. */
  manualSubtitles: YtDlpSubtitleTrack[];
  /** Machine-generated captions, in the site's order. */
  automaticCaptions: YtDlpSubtitleTrack[];
}

/** Reads the metadata document, or fails with an unreadable-response failure. */
export function parseYtDlpMetadata(stdout: string): YtDlpMetadata {
  const payload = stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("{"))
    .pop();

  if (!payload) {
    throw new MediaImportFailure(
      "unknown",
      "yt-dlp returned an unreadable response",
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    throw new MediaImportFailure(
      "unknown",
      "yt-dlp returned an unreadable response",
    );
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new MediaImportFailure(
      "unknown",
      "yt-dlp returned an unreadable response",
    );
  }

  const record = parsed as Record<string, unknown>;
  return {
    title: textField(record.title),
    track: textField(record.track),
    artist: firstText(
      record.artist,
      record.creator,
      record.uploader,
      record.channel,
    ),
    album: textField(record.album),
    duration: numberField(record.duration),
    language: textField(record.language),
    webpageUrl: textField(record.webpage_url),
    extractorKey: firstText(record.extractor_key, record.extractor),
    formats: Array.isArray(record.formats) ? record.formats : [],
    manualSubtitles: subtitleTracks(record.subtitles),
    automaticCaptions: subtitleTracks(record.automatic_captions),
  };
}

/**
 * Flattens a subtitle map (`{ en: [{ name: "English", ext: "vtt" }] }`) into a
 * list, keeping the site's order and dropping languages with no track.
 */
function subtitleTracks(value: unknown): YtDlpSubtitleTrack[] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return [];
  }

  const tracks: YtDlpSubtitleTrack[] = [];
  for (const [language, entries] of Object.entries(
    value as Record<string, unknown>,
  )) {
    if (!Array.isArray(entries) || entries.length === 0) continue;
    const first = entries[0];
    const label =
      typeof first === "object" && first !== null
        ? textField((first as Record<string, unknown>).name)
        : "";
    tracks.push({ language, label: label || language });
  }
  return tracks;
}

/** The first non-empty string field. */
function firstText(...values: unknown[]): string {
  for (const value of values) {
    const text = textField(value);
    if (text !== "") return text;
  }
  return "";
}

/** A trimmed string field, or `""`. */
function textField(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** A finite, non-negative number field, or `0`. */
function numberField(value: unknown): number {
  const number = typeof value === "string" ? Number(value) : value;
  return typeof number === "number" && Number.isFinite(number) && number > 0
    ? number
    : 0;
}
