"use client";

/**
 * The dBrain media skin — video.js v10's control bar, composed from its public
 * parts, plus the timestamp extensions and the two presets.
 *
 * **Why this file exists.** v10 ships two ways to have a player. The packaged
 * `<VideoSkin>` / `<AudioSkin>` are single components whose only extension
 * points are `renderPoster` / `renderThumbnail`, so a note tick cannot go
 * *inside* their seek bar. The other way is what video.js calls "skin source":
 * its skins are themselves built from public parts, and this file is that same
 * composition, written here so the ticks and the capture button can be
 * inserted. The class names the packaged stylesheets style (`.media-*`,
 * `.video-*`, `.audio-*`) and the `--media-*` custom properties are used
 * exactly as the shipped skins use them, and `media-player.css` maps the
 * handful of them that carry our palette.
 *
 * **One file, two presets.** `preset` selects what the two packaged skins
 * genuinely differ in — the stylesheet's preset scope (`data-preset`), the root
 * class, the control bar's anatomy (the video preset's two positioned rows with
 * the seek bar nested in the primary one, the audio preset's single row of
 * sibling groups), the seek bar's own anatomy (the video preset's chapters carry
 * per-chapter geometry; the audio preset's is a plain track), the keyboard, and
 * the video's poster / picture-in-picture / fullscreen / pointer gestures.
 * Everything else
 * — transport, time readout, speed, 加笔记, the ticks — is shared, so the two
 * players cannot drift apart.
 *
 * **What is deliberately not here.** The shipped skins also carry a settings
 * menu (speed / quality / audio track), cast, AirPlay, a title overlay and an
 * error dialog. A dBrain media node is a single HLS or progressive rendition,
 * and its node content draws its own failure screens, so those controls could
 * only ever be inert. The playback keys the shipped skins bind are kept (see
 * {@link PlaybackHotkeys}), so replacing a native control bar does not take the
 * keyboard away.
 *
 * **Subtitles are the exception.** The packaged skins' captions button toggles
 * a v10 text track; a dBrain node has none — its cues live in the stored
 * timeline — so the video preset draws the current cue in its own overlay and
 * switches it with its own button ({@link SubtitleOverlay},
 * {@link SubtitleToggleButton}). The audio preset has no overlay: its 字幕 tab
 * carries lyrics, which belong in the list, not over a progress bar.
 */
import * as React from "react";
import {
  BufferingIndicator,
  Container,
  Controls,
  FullscreenButton,
  Gesture,
  Hotkey,
  MuteButton,
  PiPButton,
  PlayButton,
  PlaybackRateButton,
  Poster,
  SeekButton,
  StatusAnnouncer,
  Time,
  TimeSlider,
  Tooltip,
} from "@videojs/react";
import {
  CaptionsOffIcon,
  CaptionsOnIcon,
  FullscreenEnterIcon,
  FullscreenExitIcon,
  PauseIcon,
  PipEnterIcon,
  PipExitIcon,
  PlayIcon,
  RestartIcon,
  SeekIcon,
  SpinnerIcon,
  VolumeHighIcon,
  VolumeLowIcon,
  VolumeOffIcon,
} from "@videojs/react/icons";
import type {
  TimestampNoteData,
  TimestampSubtitleData,
} from "@workspace/interfaces";

import { useI18n } from "@workspace/ui/lib/i18n";
import { cn } from "@workspace/ui/lib/utils";

import { AddNoteButton } from "./add-note-button";
import { NoteMarks } from "./note-marks";
import { activeCueIndex } from "./types";
import type { MediaController, TimestampNoteActivation } from "./types";

/**
 * Which packaged preset's stylesheet the host loaded (`video/skin.css` or
 * `audio/skin.css`). It also becomes the root's `data-preset`, which is how
 * those stylesheets scope most of their rules.
 */
export type MediaPreset = "video" | "audio";

export interface MediaSkinProps {
  preset: MediaPreset;
  /**
   * The media element, built by the preset's player: `<Video>` or
   * `<HlsJsVideo>` for video, `<Audio>` for audio. It is a node rather than a
   * `src` because the element type *is* the preset — and because only the
   * caller knows whether the node has an HLS playlist.
   */
  media: React.ReactNode;
  /** The transport the ticks and the 加笔记 button read; `null` before it exists. */
  controller: MediaController | null;
  /** The media duration in seconds (`0` until metadata arrives). */
  durationSeconds: number;
  className?: string;
  /** `false` renders the media with no chrome (the hover preview's shape). */
  controls?: boolean;
  /** The notes drawn as ticks on the seek bar. */
  notes?: readonly TimestampNoteData[];
  /**
   * The node's subtitle cues, ascending by start time (`useMediaTimestamps`
   * sorts them). Non-empty turns on the control bar's subtitle button; the
   * overlay draws whichever cue spans the playhead.
   */
  subtitles?: readonly TimestampSubtitleData[];
  /** The 「加笔记」 button's gesture, with the playhead in milliseconds. */
  onAddNote?: (timeMs: number) => void;
  /** A tick was clicked: the host focuses that position's cards. */
  onActivateNote?: (activation: TimestampNoteActivation) => void;
}

/** A stable empty list, so a host that passes nothing does not defeat the memo. */
const NO_NOTES: readonly TimestampNoteData[] = [];

/** The same, for a node that was imported without a subtitle track. */
const NO_SUBTITLES: readonly TimestampSubtitleData[] = [];

/**
 * One tooltip-wrapped icon button, the shape the shipped skins use.
 *
 * The label and the shortcut hint come from the button's own accessible name
 * and its registered `Hotkey`, so nothing here hardcodes a translated string.
 */
function ControlTooltip({ children }: { children: React.ReactElement }) {
  return (
    <Tooltip.Root side="top">
      <Tooltip.Trigger render={children} />
      <Tooltip.Popup className="media-popup media-popup-safe-area media-popup-transition media-popup-surface media-tooltip">
        <Tooltip.Label />
        <Tooltip.Shortcut className="media-tooltip-shortcut" />
      </Tooltip.Popup>
    </Tooltip.Root>
  );
}

/** The play/pause/restart button, with the shipped icons. */
function TransportPlayButton() {
  return (
    <PlayButton className="media-button media-play-button">
      <RestartIcon className="media-button-icon media-play-button-restart-icon" />
      <PlayIcon className="media-button-icon media-play-button-play-icon" />
      <PauseIcon className="media-button-icon media-play-button-pause-icon" />
    </PlayButton>
  );
}

/** The mute toggle, with the shipped volume icons. */
function TransportMuteButton() {
  return (
    <MuteButton className="media-button media-mute-button">
      <VolumeOffIcon className="media-button-icon media-mute-button-off-icon" />
      <VolumeLowIcon className="media-button-icon media-mute-button-low-icon" />
      <VolumeHighIcon className="media-button-icon media-mute-button-high-icon" />
    </MuteButton>
  );
}

/**
 * A ±N-second skip button, with the shipped icon + label.
 *
 * The audio preset hides the pair below a 32rem container (`@container
 * media-root`), which is the stylesheet's own rule — no prop for it here.
 */
function TransportSeekButton({ seconds }: { seconds: number }) {
  const backward = seconds < 0;
  return (
    <SeekButton
      seconds={seconds}
      className="media-button media-seek-button audio-seek-button"
    >
      <span className="media-seek-button-content">
        <SeekIcon
          className={cn(
            "media-button-icon",
            backward && "media-seek-button-backward-icon",
          )}
        />
        <span
          className={cn(
            "media-seek-button-label",
            backward
              ? "media-seek-button-backward-label"
              : "media-seek-button-forward-label",
          )}
        >
          {Math.abs(seconds)}
        </span>
      </span>
    </SeekButton>
  );
}

/**
 * The speed control.
 *
 * Rendered as a numeric label rather than the shipped icon: a dBrain media node
 * has no settings menu to hold a speed list, so this button *is* the cycle, and
 * a bare "1.5×" says what it will do next better than a glyph does. (The video
 * preset's stylesheet defines no class for a standalone rate button, so both
 * presets share `vjs-rate-button`.)
 */
function TransportRateButton() {
  return (
    <PlaybackRateButton
      render={(buttonProps, state) => (
        <button
          {...buttonProps}
          className={cn(
            "media-button",
            "vjs-rate-button",
            buttonProps.className,
          )}
        >
          {state.rate}×
        </button>
      )}
    />
  );
}

/**
 * The cue that spans the playhead, drawn over the picture.
 *
 * **Why the controller and not `usePlayer`.** The skin is shared by both
 * presets; `MediaController` is the one transport either host passes in, and
 * its `subscribe` reports once per animation frame while playing. The state
 * update is guarded by the cue index, so playing through a transcript costs one
 * render per line, not sixty per second.
 *
 * Nothing here is announced: the 字幕 tab is the accessible copy (real buttons,
 * real text), and an `aria-live` region re-reading a line every few seconds
 * would talk over the player.
 */
function SubtitleOverlay({
  controller,
  subtitles,
}: {
  controller: MediaController | null;
  subtitles: readonly TimestampSubtitleData[];
}) {
  const [activeIndex, setActiveIndex] = React.useState(-1);

  React.useEffect(() => {
    if (!controller) {
      setActiveIndex(-1);
      return;
    }
    const apply = (timeMs: number) => {
      const next = activeCueIndex(subtitles, timeMs);
      setActiveIndex((current) => (current === next ? current : next));
    };
    // A node opened mid-playback shows the line already being spoken rather
    // than waiting for the next cue boundary.
    apply(controller.getCurrentTimeMs());
    return controller.subscribe(apply);
  }, [controller, subtitles]);

  const cue = activeIndex >= 0 ? subtitles[activeIndex] : undefined;
  // A cue with no text is a real gap marker in a transcript (`（空白字幕）`);
  // printing an empty black strip over the picture would only look broken.
  if (!cue || cue.content.length === 0) return null;

  return (
    <div className="vjs-subtitle-overlay" data-slot="subtitle-overlay">
      {cue.content}
    </div>
  );
}

/**
 * The control bar's subtitle switch.
 *
 * A plain `<button>` rather than the shipped `CaptionsButton`: that one toggles
 * a v10 *text track*, and a dBrain node's cues are stored timeline data, not a
 * track the element knows about. The shipped stylesheet still does the icon
 * work — `data-active` is what swaps `media-captions-button-on-icon` for
 * `…-off-icon` — and `media-button` supplies size, focus ring and hover wash.
 *
 * `aria-disabled` rather than the native `disabled` attribute is the "this node
 * imported without a track" state: the button is where the user looks for
 * subtitles, so it stays in the bar and says why nothing happens instead of
 * vanishing — and a natively disabled button never fires the hover events that
 * would show that tooltip. The shipped `media-button` rules already key the
 * inert lookup on `aria-disabled`, so nothing else is needed.
 *
 * It builds its own tooltip instead of using {@link ControlTooltip}: that
 * helper's `<Tooltip.Label>` reads the content a v10 media button registers, and
 * this is a plain `<button>`, so the label is passed to the popup directly.
 */
function SubtitleToggleButton({
  available,
  visible,
  onToggle,
}: {
  available: boolean;
  visible: boolean;
  onToggle: () => void;
}) {
  const { t } = useI18n();
  const label = !available
    ? t("无字幕")
    : visible
      ? t("隐藏字幕")
      : t("显示字幕");

  return (
    <Tooltip.Root side="top">
      <Tooltip.Trigger
        render={
          <button
            type="button"
            className="media-button media-captions-button vjs-captions-button"
            data-active={visible && available ? "" : undefined}
            aria-label={label}
            aria-pressed={available ? visible : undefined}
            aria-disabled={!available || undefined}
            onClick={() => {
              if (available) onToggle();
            }}
          >
            <CaptionsOnIcon className="media-button-icon media-captions-button-on-icon" />
            <CaptionsOffIcon className="media-button-icon media-captions-button-off-icon" />
          </button>
        }
      />
      <Tooltip.Popup className="media-popup media-popup-safe-area media-popup-transition media-popup-surface media-tooltip">
        <span>{label}</span>
      </Tooltip.Popup>
    </Tooltip.Root>
  );
}

/** The seek bar's ticks, wired to this skin's controller and duration. */
function TrackTicks({
  notes,
  controller,
  durationSeconds,
  onActivateNote,
}: {
  notes: readonly TimestampNoteData[];
  controller: MediaController | null;
  durationSeconds: number;
  onActivateNote?: (activation: TimestampNoteActivation) => void;
}) {
  return (
    <NoteMarks
      notes={notes}
      controller={controller}
      durationSeconds={durationSeconds}
      onActivateNote={onActivateNote}
    />
  );
}

/**
 * The video preset's seek bar.
 *
 * The ticks need a track, and the video stylesheet's track rules are written
 * for the *chapter* track (`.media-time-slider-chapter-track`): v10's
 * `TimeSlider` draws its chapters only through `Chapters` (one full-range
 * chapter when there are no chapter cues). Rendering that chapter is therefore
 * the supported way into the seek bar's coordinate system — `NoteMarks` rides
 * along with the fill.
 */
function VideoTimeSlider({
  notes,
  controller,
  durationSeconds,
  onActivateNote,
}: {
  notes: readonly TimestampNoteData[];
  controller: MediaController | null;
  durationSeconds: number;
  onActivateNote?: (activation: TimestampNoteActivation) => void;
}) {
  return (
    <TimeSlider.Root className="media-slider media-time-slider">
      <TimeSlider.Chapters
        className="media-time-slider-chapters"
        renderChapter={(chapterProps) => (
          <div
            {...chapterProps}
            className={cn("media-time-slider-chapter", chapterProps.className)}
          >
            <TimeSlider.Track className="media-slider-track media-time-slider-chapter-track">
              <TimeSlider.Buffer className="media-slider-buffer media-time-slider-chapter-layer" />
              <TimeSlider.Fill className="media-slider-fill media-time-slider-chapter-layer" />
              <TrackTicks
                notes={notes}
                controller={controller}
                durationSeconds={durationSeconds}
                onActivateNote={onActivateNote}
              />
            </TimeSlider.Track>
          </div>
        )}
      />
      {/* The hover dot, in the slider's own coordinate space. The shipped one
          sits inside `Preview`, whose box is clamped to the bar, so near either
          end the clamp drags the dot inward with the box and it cannot reach
          the ends. `media-player.css` hides the shipped dot for this preset. */}
      <span aria-hidden="true" className="vjs-time-slider-dot" />
      <TimeSlider.Thumb className="media-slider-thumb media-time-slider-thumb" />
      {/* `overflow="visible"`, like the dot above: the default clamp keeps the
          preview box inside the bar, which near either end drags the time label
          inward with it, so the label stops short instead of staying under the
          pointer. This preset's preview is text only (the shipped skins put a
          thumbnail in the box, which is why they clamp), and the seek bar is
          inset by the control padding + the time readouts, so the label still
          lands inside the player at both ends. */}
      <TimeSlider.Preview className="media-slider-preview" overflow="visible">
        <span className="media-slider-preview-content media-time-slider-preview-content">
          <TimeSlider.ChapterTitle className="media-time-slider-chapter-title" />
          <TimeSlider.Value
            type="pointer"
            className="media-time-slider-value"
          />
        </span>
      </TimeSlider.Preview>
    </TimeSlider.Root>
  );
}

/**
 * The audio preset's seek bar: one plain track, no chapters.
 *
 * `overflow="visible"` is the shipped audio skin's own choice — the audio root
 * is `overflow: visible` so the pointer readout may hang outside the bar.
 */
function AudioTimeSlider({
  notes,
  controller,
  durationSeconds,
  onActivateNote,
}: {
  notes: readonly TimestampNoteData[];
  controller: MediaController | null;
  durationSeconds: number;
  onActivateNote?: (activation: TimestampNoteActivation) => void;
}) {
  return (
    <TimeSlider.Root className="media-slider audio-time-slider">
      <TimeSlider.Track className="media-slider-track">
        <TimeSlider.Buffer className="media-slider-buffer" />
        <TimeSlider.Fill className="media-slider-fill" />
        <TrackTicks
          notes={notes}
          controller={controller}
          durationSeconds={durationSeconds}
          onActivateNote={onActivateNote}
        />
      </TimeSlider.Track>
      <TimeSlider.Thumb className="media-slider-thumb audio-time-slider-thumb" />
      <TimeSlider.Preview className="media-slider-preview" overflow="visible">
        <div className="media-slider-preview-content media-popup-surface media-tooltip audio-time-slider-preview-content">
          <TimeSlider.Value
            type="pointer"
            className="audio-time-slider-value"
          />
        </div>
      </TimeSlider.Preview>
    </TimeSlider.Root>
  );
}

/**
 * The keyboard both packaged skins bind, plus what each preset adds.
 *
 * The step and volume defaults (`DEFAULT_SEEK_STEP = 10` s,
 * `DEFAULT_VOLUME_STEP = 5` points) are left to v10 rather than repeated here.
 * The video preset adds fullscreen and picture-in-picture; the audio preset has
 * neither capability, so binding those keys there would be a no-op that still
 * swallowed the key.
 */
function PlaybackHotkeys({ preset }: { preset: MediaPreset }) {
  return (
    <>
      <Hotkey keys="Space" action="togglePaused" />
      <Hotkey keys="k" action="togglePaused" />
      <Hotkey keys="m" action="toggleMuted" />
      <Hotkey keys="ArrowRight" action="seekStep" />
      <Hotkey keys="ArrowLeft" action="seekStep" />
      <Hotkey keys="l" action="seekStep" />
      <Hotkey keys="j" action="seekStep" />
      <Hotkey keys="ArrowUp" action="volumeStep" />
      <Hotkey keys="ArrowDown" action="volumeStep" />
      <Hotkey keys="0-9" action="seekToPercent" />
      <Hotkey keys="Home" action="seekToPercent" value={0} />
      <Hotkey keys="End" action="seekToPercent" value={100} />
      <Hotkey keys=">" action="speedUp" />
      <Hotkey keys="<" action="speedDown" />
      {preset === "video" ? (
        <>
          <Hotkey keys="f" action="toggleFullscreen" />
          <Hotkey keys="i" action="togglePictureInPicture" />
        </>
      ) : null}
    </>
  );
}

/** What both presets' control groups need from the skin. */
interface ControlGroupsProps {
  notes: readonly TimestampNoteData[];
  controller: MediaController | null;
  durationSeconds: number;
  onAddNote?: (timeMs: number) => void;
  onActivateNote?: (activation: TimestampNoteActivation) => void;
}

/**
 * 「加笔记」, or nothing: a host that passed no handler gets no button, because
 * an inert capture button is worse than none ({@link MediaSkinProps.onAddNote}).
 */
function CaptureButton({
  controller,
  onAddNote,
}: Pick<ControlGroupsProps, "controller" | "onAddNote">) {
  if (!onAddNote) return null;
  return <AddNoteButton controller={controller} onAddNote={onAddNote} />;
}

/**
 * The video preset's controls: two rows, transport + seek bar above, the
 * picture-in-picture pair below.
 *
 * The seek bar is **nested inside** the primary row here — that is the shipped
 * video layout, and it works because the stylesheet positions that row
 * (`inset-inline`, `bottom`) and so gives it a definite width for the group's
 * `flex: 1` to divide. The audio preset is the other way round; see
 * {@link AudioControlGroups}.
 */
function VideoControlGroups({
  notes,
  controller,
  durationSeconds,
  subtitles,
  subtitlesVisible,
  onToggleSubtitles,
  onAddNote,
  onActivateNote,
}: ControlGroupsProps & {
  subtitles: readonly TimestampSubtitleData[];
  subtitlesVisible: boolean;
  onToggleSubtitles: () => void;
}) {
  return (
    <>
      <Controls.Group className="video-controls-primary">
        <ControlTooltip>
          <TransportPlayButton />
        </ControlTooltip>

        <ControlTooltip>
          <TransportMuteButton />
        </ControlTooltip>

        <Controls.Group className="video-time-slider-group">
          <Time.Value
            type="current"
            className="media-time-value video-time-value"
          />

          <VideoTimeSlider
            notes={notes}
            controller={controller}
            durationSeconds={durationSeconds}
            onActivateNote={onActivateNote}
          />

          <Time.Value
            type="remaining"
            toggle
            className="media-time-toggle video-time-value"
          />
        </Controls.Group>

        <TransportRateButton />

        <SubtitleToggleButton
          available={subtitles.length > 0}
          visible={subtitlesVisible}
          onToggle={onToggleSubtitles}
        />

        <CaptureButton controller={controller} onAddNote={onAddNote} />
      </Controls.Group>

      <Controls.Group className="video-controls-secondary">
        <ControlTooltip>
          <PiPButton className="media-button media-pip-button">
            <PipEnterIcon className="media-button-icon media-pip-button-enter-icon" />
            <PipExitIcon className="media-button-icon media-pip-button-exit-icon" />
          </PiPButton>
        </ControlTooltip>

        <ControlTooltip>
          <FullscreenButton className="media-button media-fullscreen-button">
            <FullscreenEnterIcon className="media-button-icon media-fullscreen-button-enter-icon" />
            <FullscreenExitIcon className="media-button-icon media-fullscreen-button-exit-icon" />
          </FullscreenButton>
        </ControlTooltip>
      </Controls.Group>
    </>
  );
}

/**
 * The audio preset's controls: one row — transport, the seek bar, the
 * utilities.
 *
 * **The three groups are siblings, and that is load-bearing.** The stylesheet
 * sizes `audio-time-slider-group` with `flex: 1`, i.e. `flex: 1 1 0%`, while
 * `audio-controls-start` is a content-sized flex item. Nesting the group inside
 * it — the shape that *is* correct for the video preset — resolves its flex
 * basis against a shrink-to-fit parent and collapses the group, and with it the
 * whole seek bar, to nothing: the bar renders as a bare transport cluster with
 * no scrubbable track, no time remaining, and no room for a note tick. The
 * compiler cannot see this, so probe B asserts this exact child list.
 *
 * The utilities sit after the seek bar because they *can* only sit there once
 * the group is a sibling: rate (the shipped class for it is audio-only, so both
 * presets use our own) and 加笔记 in the shipped "end" cluster next to the mute
 * toggle.
 */
function AudioControlGroups({
  notes,
  controller,
  durationSeconds,
  onAddNote,
  onActivateNote,
}: ControlGroupsProps) {
  return (
    <>
      <Controls.Group className="audio-controls-start">
        <div className="audio-play-button">
          <BufferingIndicator className="media-buffering-indicator audio-play-button-buffering-indicator">
            <SpinnerIcon className="media-buffering-indicator-spinner-icon" />
          </BufferingIndicator>
          <ControlTooltip>
            <TransportPlayButton />
          </ControlTooltip>
        </div>

        <ControlTooltip>
          <TransportSeekButton seconds={-10} />
        </ControlTooltip>
        <ControlTooltip>
          <TransportSeekButton seconds={10} />
        </ControlTooltip>
      </Controls.Group>

      <Controls.Group className="audio-time-slider-group">
        <Time.Value type="current" className="media-time-value" />

        <AudioTimeSlider
          notes={notes}
          controller={controller}
          durationSeconds={durationSeconds}
          onActivateNote={onActivateNote}
        />

        <Time.Value
          type="remaining"
          toggle
          className="media-time-toggle audio-time-remaining-value"
        />
      </Controls.Group>

      <Controls.Group className="audio-controls-end">
        <TransportRateButton />

        <CaptureButton controller={controller} onAddNote={onAddNote} />

        <ControlTooltip>
          <TransportMuteButton />
        </ControlTooltip>
      </Controls.Group>
    </>
  );
}

export function MediaSkin(props: MediaSkinProps) {
  const {
    preset,
    media,
    controller,
    durationSeconds,
    className,
    controls = true,
    notes = NO_NOTES,
    onAddNote,
    onActivateNote,
  } = props;

  const isVideo = preset === "video";

  // `NO_SUBTITLES` rather than a fresh `[]`: the overlay subscribes on the
  // identity of this list, and a new array every render would resubscribe.
  const subtitles = props.subtitles ?? NO_SUBTITLES;
  // On when the node has cues: importing a track is the user asking to see it.
  // The switch is per mounted player — a different node mounts its own.
  const [showSubtitles, setShowSubtitles] = React.useState(true);

  return (
    <Container
      // `media-skin` + `media-container` are load-bearing: every rule in the
      // shipped stylesheets is scoped to them, and the *public* `Container`
      // primitive adds neither (the packaged skins get them from an internal
      // shim). Without both, the player renders completely unstyled — found by
      // the render probe, invisible to the compiler.
      className={cn(
        "media-skin",
        "media-container",
        isVideo ? "video-skin" : "audio-skin",
        className,
      )}
      data-theme="default"
      data-preset={preset}
    >
      {media}

      {isVideo ? (
        <Poster.Root className="media-poster">
          <Poster.Image className="media-poster-image" />
        </Poster.Root>
      ) : null}

      {/* The audio preset puts its indicator *inside* the play button instead
          (`.audio-play-button-buffering-indicator`); a container-level one
          would centre itself over the whole bar. */}
      {isVideo ? (
        <BufferingIndicator className="media-buffering-indicator">
          <SpinnerIcon className="media-buffering-indicator-spinner-icon" />
        </BufferingIndicator>
      ) : null}

      {isVideo && subtitles.length > 0 && showSubtitles ? (
        <SubtitleOverlay controller={controller} subtitles={subtitles} />
      ) : null}

      {controls ? (
        <Controls.Root visibility={isVideo ? undefined : "always"}>
          {isVideo ? (
            <Controls.Backdrop className="video-controls-backdrop" />
          ) : null}
          <Controls.Content
            className={
              isVideo
                ? "video-controls video-controls-content"
                : "audio-controls audio-controls-content"
            }
          >
            <Tooltip.Provider>
              {isVideo ? (
                <VideoControlGroups
                  notes={notes}
                  controller={controller}
                  durationSeconds={durationSeconds}
                  subtitles={subtitles}
                  subtitlesVisible={showSubtitles}
                  onToggleSubtitles={() =>
                    setShowSubtitles((visible) => !visible)
                  }
                  onAddNote={onAddNote}
                  onActivateNote={onActivateNote}
                />
              ) : (
                <AudioControlGroups
                  notes={notes}
                  controller={controller}
                  durationSeconds={durationSeconds}
                  onAddNote={onAddNote}
                  onActivateNote={onActivateNote}
                />
              )}
            </Tooltip.Provider>
          </Controls.Content>
        </Controls.Root>
      ) : null}

      {/*
        The keyboard the native `controls` attribute used to provide. The step
        and the key set follow the shipped skins, so the only difference from
        video.js's own player is that this one has ticks.
      */}
      <PlaybackHotkeys preset={preset} />

      {/* Pointer gestures are the video preset's: a tap on the picture toggles
          playback, and a double tap on a side seeks. On an audio bar they would
          fight the controls for the same pixels. */}
      {isVideo ? (
        <>
          <Gesture
            type="tap"
            action="togglePaused"
            pointer="mouse"
            region="center"
          />
          <Gesture type="tap" action="toggleControls" pointer="touch" />
          <Gesture
            type="doubletap"
            action="seekStep"
            value={-10}
            region="left"
          />
          <Gesture type="doubletap" action="toggleFullscreen" region="center" />
          <Gesture
            type="doubletap"
            action="seekStep"
            value={10}
            region="right"
          />
        </>
      ) : null}

      {/*
        The screen reader's live region ("Seeked to 56 seconds"). It is a real
        element in the flow, and the class is what makes it invisible: the
        stylesheets hide `.media-status-announcer` with `clip-path: inset(50%)`
        plus a 1×1 box, and the *public* `StatusAnnouncer` adds no class name of
        its own — the packaged skins get it from the same internal shim that adds
        `media-skin` (see the container above). Without it the announcement is
        printed under the control bar in plain text.
      */}
      <StatusAnnouncer className="media-status-announcer" />
    </Container>
  );
}
