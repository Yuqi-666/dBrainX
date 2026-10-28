// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Remote media download and probe ports.
 *
 * A user can point the app at a media site instead of uploading a file. Fetching
 * such an address is an outside effect the domain cannot perform itself: it
 * needs a yt-dlp binary, a temporary directory, and a network request whose
 * address has to be validated first. The application layer owns the policy — how
 * large the result may be, where it is stored, what gets packaged afterwards —
 * while these ports own the effects: "turn a site URL into a file on this
 * machine" and "read what the site offers before downloading it".
 *
 * The contract is deliberately shaped around a *file path plus a cleanup*, not
 * around bytes: a front-page video is gigabytes and is handed straight to FFmpeg
 * and then to the file store, so it must never pass through the process heap.
 *
 * Audio and video share one port because the extractor does: the difference is
 * which formats are requested and what is done with the file afterwards, and
 * that decision belongs to the application layer's two strategies.
 */

import type { MediaKind } from "./media-sites";

/** Asks for one remote media page to be downloaded to a private file. */
export interface RemoteMediaDownloadRequest {
  /**
   * Page URL the user pasted, for example `https://www.youtube.com/watch?v=…`.
   *
   * Only `http`/`https` addresses are accepted, the address must not embed
   * credentials, and it must not resolve to a loopback, private, or link-local
   * address: the server must not be usable as a proxy into its own network.
   */
  url: string;
  /** Whether a playable video or an audio file is wanted. */
  kind: MediaKind;
  /**
   * Byte ceiling handed to the downloader. The adapter asks the site for a
   * stream within this size and rejects the result when it exceeds it, so a
   * mislabelled or unexpected stream is refused before it reaches the store.
   */
  maxBytes: number;
  /** A format id copied from a probe result; omitted means "best available". */
  formatId?: string;
  /**
   * Netscape `cookies.txt` content for the matched site, when the owner saved
   * one. The adapter writes it to `0600` inside the work directory and removes
   * it with that directory; the text is never logged.
   */
  cookies?: string;
  /**
   * Browser name for `--cookies-from-browser` (desktop local backend only).
   * The cookies are read from the browser at download time, so they never go
   * stale and are never stored.
   */
  cookiesFromBrowser?: string;
  /**
   * Directory the adapter writes into. The caller owns it and passes the same
   * directory when a resumed job retries, so yt-dlp finds its partial files and
   * continues instead of starting over.
   */
  workDir: string;
}

/** One timed line of a subtitle track / lyric, already converted to a cue. */
export interface MediaSubtitleCue {
  /** Milliseconds from the start of the media. */
  timeMs: number;
  /** Cue end in milliseconds; absent when the track carried none. */
  endMs?: number;
  /** Plain text, tags removed. */
  content: string;
}

/** One subtitle track / lyric track, selected by the adapter. */
export interface MediaSubtitleTrack {
  /** Language tag as the site reported it, e.g. `zh-Hans` or `lyrics`. */
  language: string;
  /** Human label for the track. */
  label: string;
  /** True when the track was machine-generated. */
  automatic: boolean;
  /** True when the track was longer than the cue / byte limit and was cut. */
  truncated: boolean;
  /** Cues in ascending time order. */
  cues: MediaSubtitleCue[];
}

/** A thumbnail or cover image the adapter wrote beside the media file. */
export interface DownloadedMediaThumbnail {
  /** Absolute path of the image file inside the work directory. */
  path: string;
  /** MIME type derived from the image's extension. */
  contentType: string;
}

/** A downloaded media file living in a work directory the caller owns. */
export interface DownloadedRemoteMedia {
  /** Absolute path of the downloaded file. */
  path: string;
  /** Safe name for the stored resource, with the download's real extension. */
  fileName: string;
  /** MIME type derived from the downloaded file's extension. */
  contentType: string;
  /** What was requested; a site can only answer audio for an audio request. */
  kind: MediaKind;
  /** yt-dlp extractor that answered, e.g. `BiliBili` or `netease:song`. */
  extractorKey: string;
  /** Title reported by the site, `""` when it reported none. */
  title: string;
  /** Artist / uploader / anchor name, `""` when the site reported none. */
  artist: string;
  /** Album name, `""` when the site reported none. */
  album: string;
  /** Duration in seconds from the site metadata, `0` when unknown. */
  duration: number;
  /** Byte length of the downloaded file, taken from the file system. */
  fileSize: number;
  /**
   * Canonical page address reported by the site (`webpage_url`), falling back
   * to the requested URL. Stored so a node can link back to its origin.
   */
  sourceUrl: string;
  /** Thumbnail the site named, `null` when it named none or it was unusable. */
  thumbnail: DownloadedMediaThumbnail | null;
  /** Subtitle / lyric track, `null` when the site offered none. */
  subtitle: MediaSubtitleTrack | null;
  /** Removes the temporary files this download created. Safe to call twice. */
  cleanup(): Promise<void>;
}

/**
 * Byte and time progress of one remote download.
 *
 * `totalBytes` is `0` when the site does not declare a size (yt-dlp reports `NA`
 * for a fragment-based or live stream), in which case the caller can only report
 * the stage, not a percentage. `speedBytesPerSecond` and `etaSeconds` are `0`
 * when yt-dlp did not report them.
 */
export interface MediaDownloadProgress {
  /** Bytes written to the file so far. */
  downloadedBytes: number;
  /** Declared size of the stream, `0` when the site does not declare one. */
  totalBytes: number;
  /** Current download speed in bytes per second, `0` when unknown. */
  speedBytesPerSecond: number;
  /** Estimated seconds remaining, `0` when unknown. */
  etaSeconds: number;
}

/** Receives download progress, at most a few times a second. */
export type MediaDownloadProgressListener = (
  progress: MediaDownloadProgress,
) => void;

/** One selectable quality the site offered, described for the picker. */
export interface MediaQualityOption {
  /**
   * Stable id used by the picker, e.g. `1080p` for a video or `lossless` for an
   * audio tier. Two formats of the same tier share one id, and the adapter keeps
   * the preferred one.
   */
  id: string;
  /** yt-dlp format id the download passes back; validated against a probe. */
  formatId: string;
  /** Label to show, e.g. `1080p` or `无损`. */
  label: string;
  /** Container extension, e.g. `mp4` or `mp3`. */
  ext: string;
  /** Video or audio codec name, `""` when unknown. */
  codec: string;
  /** Video height in pixels, `0` for an audio format. */
  height: number;
  /** Video width in pixels, `0` for an audio format. */
  width: number;
  /** Frames per second, `0` for an audio format. */
  fps: number;
  /** Audio bitrate in kbps, `0` when unknown. */
  abr: number;
  /** Estimated file size in bytes, `0` when it cannot be estimated. */
  estimatedBytes: number;
  /**
   * Why the picker must not offer this option, if it must not.
   *
   * The adapter answers what the site offers; this layer annotates the options
   * the current user cannot use — `login` for a tier that needs a saved login,
   * `quota` / `category-limit` for one that would exceed the storage policy —
   * so the client can show it greyed out with a reason instead of hiding it.
   */
  disabledReason?: "login" | "quota" | "category-limit" | "unavailable";
}

/**
 * What a site offers for one address, read without downloading anything.
 *
 * The picker is built from this, and the chosen `formatId` is copied back into
 * the download request, so the client never supplies a raw yt-dlp argument.
 */
export interface MediaProbeResult {
  /** What the address was asked for; a site can answer the other kind. */
  kind: MediaKind;
  /** Listed site key, or `null` for a site this product does not list. */
  siteKey: string | null;
  /** yt-dlp extractor that answered. */
  extractorKey: string;
  /** Title reported by the site, `""` when it reported none. */
  title: string;
  /** Artist / uploader / anchor name, `""` when the site reported none. */
  artist: string;
  /** Album name, `""` when the site reported none. */
  album: string;
  /** Duration in seconds, `0` when unknown. */
  duration: number;
  /**
   * Thumbnail as a data URL no larger than the adapter's cap, `null` when the
   * site wrote none. The server never fetches an arbitrary image URL, so this is
   * the only image source the picker has.
   */
  thumbnailDataUrl: string | null;
  /** True when the site refused the anonymous request and wants a login. */
  requiresLogin: boolean;
  /** Subtitle / lyric tracks the site offers; empty when it offers none. */
  subtitleLanguages: {
    language: string;
    label: string;
    automatic: boolean;
  }[];
  /** Quality options, best first. */
  qualities: MediaQualityOption[];
}

/** Asks the site what it offers for one address. */
export interface MediaProbeRequest {
  /** Page URL the user pasted; validated exactly as a download's is. */
  url: string;
  /** Whether a video or an audio answer is expected. */
  kind: MediaKind;
  /** See {@link RemoteMediaDownloadRequest.cookies}. */
  cookies?: string;
  /** See {@link RemoteMediaDownloadRequest.cookiesFromBrowser}. */
  cookiesFromBrowser?: string;
}

/** Reads a site's offer for one address, without storing anything. */
export interface IMediaProbe {
  /**
   * Resolves with the site's offer. Rejects when the address is refused, the
   * site needs a login (`login_required`), or the site offers nothing usable.
   * The adapter owns and removes its temporary directory on every path.
   */
  probe(request: MediaProbeRequest): Promise<MediaProbeResult>;
}

/** Downloads one remote media page to a file in the caller's work directory. */
export interface IMediaDownloader {
  /**
   * Resolves when the file is fully written, with its metadata and the way to
   * remove it. Rejects when the URL is refused, the site cannot be read, or the
   * download exceeds {@link RemoteMediaDownloadRequest.maxBytes}.
   *
   * `onProgress` is optional and best effort: an adapter that cannot report
   * progress simply never calls it, and the import still succeeds. It is called
   * on the download's own schedule (throttled by the adapter), so a listener
   * must be cheap and must not throw.
   *
   * The caller must call {@link DownloadedRemoteMedia.cleanup} on every path,
   * success or failure.
   */
  download(
    request: RemoteMediaDownloadRequest,
    onProgress?: MediaDownloadProgressListener,
  ): Promise<DownloadedRemoteMedia>;

  /**
   * Stops the download writing into `workDir` and removes nothing itself.
   * The application layer calls this when the user cancels; a download that is
   * not running is a no-op.
   */
  cancel(workDir: string): Promise<void>;
}
