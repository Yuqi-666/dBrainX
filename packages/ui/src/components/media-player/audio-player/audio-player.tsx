// SPDX-License-Identifier: AGPL-3.0-only

"use client";

/**
 * The audio node's player: **video.js v10** (`@videojs/react/audio`) with the
 * shared dBrainX skin.
 *
 * It replaces the self-drawn transport M6 shipped, and the reason is the same
 * one the video side had: a hand-rolled bar cannot put a note tick *inside* a
 * seek bar without re-implementing one. `TimeSlider` is that seek bar — the
 * progress-bar component the user asked for — and the shared skin renders the
 * ticks into its track, so audio notes and video notes land on the same kind of
 * pixel from the same code.
 *
 * What the audio preset brings on top of the shared skin: a seek-bar layout
 * with no chapters, ±10s skip buttons (hidden by the stylesheet under a 32rem
 * container), and an audio keyboard with no fullscreen / picture-in-picture.
 * The volume control is the shared mute toggle — the shipped audio skin wraps
 * it in a volume popover, whose styling the shipped stylesheet only defines for
 * a multi-part menu surface dBrainX has no other use for.
 *
 * The packed stylesheet is imported **here**, so a video-only page never
 * downloads the audio preset's CSS (and vice versa).
 */
import * as React from "react";
import {
  Audio,
  AudioPlayer as AudioPlayerProvider,
} from "@videojs/react/audio";
import { usePlayer } from "@videojs/react/audio";
import { resolveFileUrl } from "@workspace/api-client";
import type { TimestampNoteData } from "@workspace/interfaces";

import { MediaSkin } from "../media-skin";
import { createVideoJsMediaController } from "../media-controller";
import type {
  MediaControllerCallback,
  TimestampNoteActivation,
} from "../types";

import "@videojs/react/audio/skin.css";
import "../media-player.css";

interface AudioPlayerProps {
  /** A ready-to-use URL — the host runs `resolveFileUrl` before passing it. */
  src?: string;
  className?: string;
  controls?: boolean;
  autoPlay?: boolean;
  muted?: boolean;
  loop?: boolean;
  /** Fired once the element has data (the host's loading skeleton hook). */
  onLoadedData?: () => void;
  /** Fired when the source cannot be played at all. */
  onError?: () => void;
  /**
   * The time outlet: the controller bound to this player, or `null` on
   * unmount. Optional — a host with no notes layer can omit it.
   */
  onMediaController?: MediaControllerCallback;
  /** The node's persisted notes, drawn as ticks on the seek bar. */
  notes?: readonly TimestampNoteData[];
  /** The 「加笔记」 button's gesture, with the playhead in milliseconds. */
  onAddNoteRequest?: (timeMs: number) => void;
  /** A note tick was clicked: the host focuses that position's cards. */
  onActivateNote?: (activation: TimestampNoteActivation) => void;
}

/**
 * The inside of the provider — the same split as `video-player.tsx`, and for
 * the same two reasons: the store only exists under the provider, and the ticks
 * need the duration (a subscription that changes on metadata, not per frame)
 * while the controller must be built once, unsubscribed.
 */
function AudioSurface({
  src,
  className,
  controls = true,
  autoPlay = false,
  muted = false,
  loop = false,
  onLoadedData,
  onError,
  onMediaController,
  notes,
  onAddNoteRequest,
  onActivateNote,
}: AudioPlayerProps) {
  const store = usePlayer();
  const controller = React.useMemo(
    () => createVideoJsMediaController(store),
    [store],
  );
  const durationSeconds = usePlayer((state) => state.duration);

  const latest = React.useRef(onMediaController);
  latest.current = onMediaController;

  React.useEffect(() => {
    latest.current?.(controller);
    return () => {
      latest.current?.(null);
    };
  }, [controller]);

  // No `className` on the element: the shipped stylesheet sizes it through its
  // own element selector (and the audio element renders no box of its own).
  const media = (
    <Audio
      src={src}
      autoPlay={autoPlay}
      muted={muted}
      loop={loop}
      preload="metadata"
      onLoadedData={() => onLoadedData?.()}
      onError={() => onError?.()}
    />
  );

  return (
    <MediaSkin
      preset="audio"
      media={media}
      controller={controller}
      durationSeconds={durationSeconds}
      className={className}
      controls={controls}
      notes={notes}
      onAddNote={onAddNoteRequest}
      onActivateNote={onActivateNote}
    />
  );
}

export function AudioPlayer(props: AudioPlayerProps) {
  const { src } = props;

  return (
    <AudioPlayerProvider>
      <AudioSurface
        // Resolve here as well as in the host, so the component keeps the
        // "hand me a stored path" contract `video-player.tsx` has.
        {...props}
        src={src ? resolveFileUrl(src) : undefined}
      />
    </AudioPlayerProvider>
  );
}
