// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Turns the format list a site reports into the quality picker's options.
 *
 * The picker shows a short list of stable choices, never yt-dlp's raw format
 * table. The user picks one option, the option carries one `formatId`, and the
 * download asks yt-dlp for exactly that format. Two rules follow from that:
 *
 * - A site may report the same quality several times (different codecs,
 *   different containers). One picker entry per quality is enough, so the
 *   entries are deduplicated and a codec the HLS packager can copy wins over
 *   one it would have to re-encode; see {@link isCopyableVideoCodec}.
 * - The entry id is stable (`1080p`, `lossless`) while the `formatId` is
 *   site-specific. A cached probe result is therefore still meaningful, and
 *   the UI never has to understand a container or a codec.
 *
 * The estimate is a guide, not a limit: `--max-filesize` and the real file size
 * are enforced by the downloader. Prefer the size the site states, then the
 * declared bitrate and duration.
 */

import type { MediaQualityOption } from "@workspace/domain";

/** Everything both mappers need besides the site's own format table. */
export interface MediaQualityOptions {
  /** Duration in seconds, used to estimate a size when the site states none. */
  duration?: number;
}

/** A quality tier of an audio stream. */
type AudioTier = "lossless" | "exhigh" | "higher" | "standard";

/** Display order and label of the audio tiers, best first. */
const AUDIO_TIERS: ReadonlyArray<{ id: AudioTier; label: string }> = [
  { id: "lossless", label: "无损" },
  { id: "exhigh", label: "极高" },
  { id: "higher", label: "较高" },
  { id: "standard", label: "标准" },
];

/** The known video heights, only used to keep the picker free of odd values. */
const MIN_VIDEO_HEIGHT = 144;

/** One format of the site's table, read defensively; any field may be absent. */
interface FormatFacts {
  formatId: string;
  ext: string;
  vcodec: string;
  acodec: string;
  height: number;
  width: number;
  fps: number;
  abr: number;
  tbr: number;
  fileSize: number;
  approximateSize: number;
  /** Duration of the media in seconds, `0` when the site stated none. */
  duration: number;
}

/**
 * Lists the video qualities of a format table, best first.
 *
 * The first entry is always `best`, a selector rather than one concrete
 * format: it must keep working on a site that only offers combined streams,
 * where appending the separate audio format (the downloader always asks for
 * `<formatId>+ba/b`) would otherwise falter. The concrete `NNNp` entries are
 * built from video-only formats, because the same `+ba` merge is what makes
 * them usable and a combined format would then carry its audio twice.
 */
export function videoQualities(
  formats: readonly unknown[],
  options: MediaQualityOptions = {},
): MediaQualityOption[] {
  const facts = formats
    .map((format) => readFormat(format, options.duration))
    .filter((format): format is FormatFacts => format !== null);

  // A video-only format: it has a picture and no sound, which is exactly what
  // the downloader pairs with a separate audio format.
  const videoOnly = facts
    .filter((format) => format.height >= MIN_VIDEO_HEIGHT)
    .filter((format) => !isNone(format.vcodec) && isNone(format.acodec))
    .sort(compareVideoFormats);

  const best =
    videoOnly[0] ??
    facts
      .filter((format) => format.height > 0 && !isNone(format.vcodec))
      .sort(compareVideoFormats)[0] ??
    null;

  const qualities: MediaQualityOption[] = [];
  if (best) {
    qualities.push(
      toVideoQuality(best, {
        id: "best",
        label: "最佳",
        // The selector, not an id: it stays valid when a site offers no
        // separate audio stream and the merge falls back to `b`.
        formatId: "bv*",
      }),
    );
  }

  const seenHeights = new Set<number>();
  for (const format of videoOnly) {
    if (seenHeights.has(format.height)) continue;
    seenHeights.add(format.height);
    qualities.push(
      toVideoQuality(format, {
        id: `${format.height}p`,
        label: `${format.height}p`,
        formatId: format.formatId,
      }),
    );
  }

  return qualities;
}

/**
 * Lists the audio qualities of a format table, best tier first.
 *
 * A tier exists only when the site reported a format in it: a site that offers
 * nothing better than 128 kbps gets one `standard` entry, not three greyed-out
 * claims. When the same tier is reported by several codecs, `flac` wins over
 * `m4a`/`aac`, which win over `mp3`, because that is the order of audible
 * quality and of the player's ability to play the result directly.
 */
export function audioQualities(
  formats: readonly unknown[],
  options: MediaQualityOptions = {},
): MediaQualityOption[] {
  const facts = formats
    .map((format) => readFormat(format, options.duration))
    .filter((format): format is FormatFacts => format !== null)
    .filter((format) => !isNone(format.acodec));

  // A music site normally reports audio-only formats, but a video site can
  // answer an audio address with combined ones. Keep the audio-only formats
  // when there are any, so a chosen format does not download a picture.
  const audioOnly = facts.filter((format) => isNone(format.vcodec));
  const candidates = (audioOnly.length > 0 ? audioOnly : facts).sort(
    compareAudioFormats,
  );

  const byTier = new Map<AudioTier, FormatFacts>();
  for (const format of candidates) {
    const tier = audioTier(format);
    if (!byTier.has(tier)) byTier.set(tier, format);
  }

  return AUDIO_TIERS.flatMap(({ id, label }) => {
    const format = byTier.get(id);
    return format ? [toAudioQuality(format, id, label)] : [];
  });
}

/** Reads one entry of the site's format table, or `null` when it is unusable. */
function readFormat(value: unknown, duration = 0): FormatFacts | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;

  const formatId = stringField(record.format_id);
  // A format without an id cannot be requested again, so it is no option.
  if (!formatId) return null;

  return {
    formatId,
    ext: stringField(record.ext).toLowerCase(),
    vcodec: stringField(record.vcodec),
    acodec: stringField(record.acodec),
    height: numberField(record.height),
    width: numberField(record.width),
    fps: numberField(record.fps),
    // `abr` (audio) and `tbr` (total) are both in kbps; a video format often
    // states only the total, which the size estimate below falls back to.
    abr: numberField(record.abr),
    tbr: numberField(record.tbr),
    fileSize: numberField(record.filesize),
    approximateSize: numberField(record.filesize_approx),
    duration,
  };
}

/** `none` is yt-dlp's word for "this format has no such stream". */
function isNone(codec: string): boolean {
  return codec === "" || codec.toLowerCase() === "none";
}

/**
 * Whether the HLS packager can copy this video stream instead of re-encoding it.
 *
 * The packager writes MPEG-TS segments, whose one universally decodable video
 * codec is H.264 (see `COPYABLE_VIDEO_CODECS` in
 * `ffmpeg-video-transcoder.ts`). When a site offers the same picture in several
 * codecs, the import should therefore be given the H.264 stream: copying it
 * costs seconds, while re-encoding an AV1 or HEVC stream costs minutes for a
 * full-length video and loses a generation of quality. yt-dlp reports H.264 as
 * `avc1.<profile>` in its format table (and `h264` in the merged file), so the
 * prefix is what is matched.
 */
function isCopyableVideoCodec(codec: string): boolean {
  const name = codec.toLowerCase();
  return name.startsWith("avc1") || name.startsWith("h264");
}

/**
 * Higher picture first, then smoother motion, then a copyable codec, then more
 * bits.
 *
 * The frame rate comes before the codec on purpose: a 60 fps HEVC stream is
 * still the better version of that quality, and just because the packager would
 * have to re-encode it is no reason to hand the user a 30 fps file instead.
 */
function compareVideoFormats(a: FormatFacts, b: FormatFacts): number {
  return (
    b.height - a.height ||
    b.fps - a.fps ||
    Number(isCopyableVideoCodec(b.vcodec)) -
      Number(isCopyableVideoCodec(a.vcodec)) ||
    b.tbr - a.tbr ||
    estimateBytes(b) - estimateBytes(a)
  );
}

/** Preferred codec first, then more bits, then a larger stated size. */
function compareAudioFormats(a: FormatFacts, b: FormatFacts): number {
  return (
    codecPreference(a) - codecPreference(b) ||
    bitrate(a) - bitrate(b) ||
    estimateBytes(b) - estimateBytes(a)
  );
}

/** Orders codecs by audible quality: flac/alac, then m4a/aac, then mp3. */
function codecPreference(format: FormatFacts): number {
  const label = `${format.ext} ${format.acodec}`.toLowerCase();
  if (label.includes("flac") || label.includes("alac")) return 0;
  if (
    label.includes("m4a") ||
    label.includes("aac") ||
    label.includes("mp4a")
  ) {
    return 1;
  }
  if (label.includes("mp3") || label.includes("mpeg")) return 2;
  return 3;
}

/** Bitrate of an audio format in kbps, using the total when `abr` is absent. */
function bitrate(format: FormatFacts): number {
  return format.abr || format.tbr;
}

/** The tier a format belongs to, from its codec and its bitrate. */
function audioTier(format: FormatFacts): AudioTier {
  const codec = `${format.ext} ${format.acodec}`.toLowerCase();
  if (codec.includes("flac") || codec.includes("alac")) return "lossless";

  const kbps = bitrate(format);
  if (kbps >= 900) return "lossless";
  if (kbps >= 256) return "exhigh";
  if (kbps >= 160) return "higher";
  return "standard";
}

/** Estimated file size in bytes; `0` when neither the site nor duration helps. */
function estimateBytes(format: FormatFacts): number {
  if (format.fileSize > 0) return format.fileSize;
  if (format.approximateSize > 0) return Math.round(format.approximateSize);

  const kbps = format.tbr || format.abr;
  if (kbps > 0 && format.duration > 0) {
    return Math.round((kbps * 1000 * format.duration) / 8);
  }
  return 0;
}

/** Builds one picker entry for a video format. */
function toVideoQuality(
  format: FormatFacts,
  identity: { id: string; label: string; formatId: string },
): MediaQualityOption {
  return {
    id: identity.id,
    formatId: identity.formatId,
    label: identity.label,
    ext: format.ext,
    codec: format.vcodec,
    height: format.height,
    width: format.width,
    fps: format.fps,
    abr: 0,
    estimatedBytes: estimateBytes(format),
  };
}

/** Builds one picker entry for an audio format. */
function toAudioQuality(
  format: FormatFacts,
  id: AudioTier,
  label: string,
): MediaQualityOption {
  return {
    id,
    formatId: format.formatId,
    label,
    ext: format.ext,
    codec: format.acodec,
    height: 0,
    width: 0,
    fps: 0,
    abr: Math.round(bitrate(format)),
    estimatedBytes: estimateBytes(format),
  };
}

/** A trimmed string field, or `""`. */
function stringField(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** A finite positive number field, or `0`. */
function numberField(value: unknown): number {
  const number = typeof value === "string" ? Number(value) : value;
  return typeof number === "number" && Number.isFinite(number) && number > 0
    ? number
    : 0;
}
