// SPDX-License-Identifier: AGPL-3.0-only

"use client";

/**
 * The video node's player: **video.js v10** (`@videojs/react`) with the dBrainX
 * skin and the timestamp extensions.
 *
 * It replaces the bare `<video>` + hls.js element M6 shipped. What the element
 * could not do is the reason for the dependency: a native control bar has no
 * slot for a note tick, and `controls` gives no way to add one. v10 composes
 * its controls from parts, so `media-player/media-skin.tsx` can place ticks in
 * the seek bar itself and a capture button next to the transport.
 *
 * Three boundaries this file keeps:
 *
 * - **The time outlet is unchanged.** `onMediaController` still reports a
 *   `MediaController` — now built over the v10 player store by
 *   `createVideoJsMediaController` — so the timestamp sidebar and the host's
 *   `Mod-Enter` path did not have to learn a new vocabulary.
 * - **The hover preview does not come through here.** A v10 player is a
 *   provider with a store, a media element and a control bar; a gallery hover
 *   is an autoplaying muted thumbnail. `video-preview.tsx` keeps using
 *   `<NativeVideoPlayer>` for that.
 * - **Sources may be given unresolved.** `resolveFileUrl` is idempotent, so the
 *   node content may pass either a stored path or a ready URL.
 *
 * The packed stylesheet is imported **here** rather than in the shared skin, so
 * an audio-only page never downloads the video preset's CSS (and vice versa).
 */
import * as React from "react";
import {
  Video,
  VideoPlayer as VideoPlayerProvider,
  usePlayer,
} from "@videojs/react/video";
import { HlsJsVideo } from "@videojs/react/media/hlsjs-video";
import { resolveFileUrl } from "@workspace/api-client";
import type {
  TimestampNoteData,
  TimestampSubtitleData,
} from "@workspace/interfaces";

import { MediaSkin } from "../media-skin";
import { createVideoJsMediaController } from "../media-controller";
import type {
  MediaControllerCallback,
  TimestampNoteActivation,
} from "../types";

import "@videojs/react/video/skin.css";
import "../media-player.css";

/** The decoded size of the media, reported once the element has data. */
export interface VideoMediaSize {
  videoWidth: number;
  videoHeight: number;
}

interface VideoPlayerProps {
  /** Progressive source, used when there is no playlist (or no MSE support). */
  src?: string;
  /** HLS playlist (`/api/files/…/index.m3u8`), preferred when present. */
  hlsSrc?: string;
  poster?: string;
  className?: string;
  controls?: boolean;
  autoPlay?: boolean;
  muted?: boolean;
  loop?: boolean;
  playsInline?: boolean;
  /** Fired once the element has data — including when it decodes audio only. */
  onLoadedData?: (size: VideoMediaSize) => void;
  /** Fired when neither the playlist nor the progressive source can be played. */
  onError?: () => void;
  /**
   * The time outlet: the controller bound to this player, or `null` on
   * unmount. Optional — a host with no notes layer can omit it.
   */
  onMediaController?: MediaControllerCallback;
  /** The node's persisted notes, drawn as ticks on the seek bar. */
  notes?: readonly TimestampNoteData[];
  /**
   * The node's subtitle cues, ascending by start time — drawn over the picture
   * and toggled by the control bar's subtitle button.
   */
  subtitles?: readonly TimestampSubtitleData[];
  /** The 「加笔记」 button's gesture, with the playhead in milliseconds. */
  onAddNoteRequest?: (timeMs: number) => void;
  /** A note tick was clicked: the host focuses that position's cards. */
  onActivateNote?: (activation: TimestampNoteActivation) => void;
}

/**
 * The inside of the provider: it owns the store, and therefore the controller.
 *
 * It has to be a child of the provider — `usePlayer` reads the store from
 * context, and the store is what the controller wraps. Two reads with different
 * costs:
 *
 * - `usePlayer()` (no selector) returns the store **without subscribing**, so
 *   the controller is built once per store and the component does not re-render
 *   as the video plays.
 * - `usePlayer((state) => state.duration)` subscribes to the one reactive value
 *   the ticks need (`NoteMarks` scales them by `timeMs / duration`). It changes
 *   when metadata arrives and on a source change — never per frame, which is
 *   why the ticks do not re-render while playing.
 */
function VideoSurface({
  src,
  hlsSrc,
  className,
  controls = true,
  autoPlay = false,
  muted = false,
  loop = false,
  playsInline = true,
  onLoadedData,
  onError,
  onMediaController,
  notes,
  subtitles,
  onAddNoteRequest,
  onActivateNote,
}: VideoPlayerProps) {
  const store = usePlayer();
  const controller = React.useMemo(
    () => createVideoJsMediaController(store),
    [store],
  );
  const durationSeconds = usePlayer((state) => state.duration);

  // The callback is read through a ref so a host that rebuilds its handler on
  // every render cannot tear the controller down and build a second one.
  const latest = React.useRef(onMediaController);
  latest.current = onMediaController;

  React.useEffect(() => {
    latest.current?.(controller);
    return () => {
      latest.current?.(null);
    };
  }, [controller]);

  const handleLoadedData = (event: React.SyntheticEvent<HTMLVideoElement>) => {
    const video = event.currentTarget;
    onLoadedData?.({
      videoWidth: video.videoWidth,
      videoHeight: video.videoHeight,
    });
  };

  // One element, two engines. `hlsSrc` is the packaged playlist the backend
  // wrote; hls.js drives it where MSE exists and the element plays it itself on
  // Safari. Without a playlist the original upload is played as-is, so an
  // untranscoded node and every existing record keep working.
  // Neither element takes a `className`: both shipped stylesheets size and fit
  // the media through their element selector, and define no class for it.
  const media = hlsSrc ? (
    <HlsJsVideo
      src={hlsSrc}
      autoPlay={autoPlay}
      muted={muted}
      loop={loop}
      playsInline={playsInline}
      onLoadedData={handleLoadedData}
      onError={() => onError?.()}
    />
  ) : (
    <Video
      src={src}
      autoPlay={autoPlay}
      muted={muted}
      loop={loop}
      playsInline={playsInline}
      onLoadedData={handleLoadedData}
      onError={() => onError?.()}
    />
  );

  return (
    <MediaSkin
      preset="video"
      media={media}
      controller={controller}
      durationSeconds={durationSeconds}
      className={className}
      controls={controls}
      notes={notes}
      subtitles={subtitles}
      onAddNote={onAddNoteRequest}
      onActivateNote={onActivateNote}
    />
  );
}

export function VideoPlayer(props: VideoPlayerProps) {
  const { src, hlsSrc, poster } = props;

  return (
    <VideoPlayerProvider poster={poster ? resolveFileUrl(poster) : undefined}>
      <VideoSurface
        // Resolve here as well as in the host, so the component keeps its old
        // "hand me a stored path" contract; `resolveFileUrl` passes an absolute
        // URL through untouched.
        {...props}
        src={src ? resolveFileUrl(src) : undefined}
        hlsSrc={hlsSrc ? resolveFileUrl(hlsSrc) : undefined}
      />
    </VideoPlayerProvider>
  );
}
