// SPDX-License-Identifier: AGPL-3.0-only

"use client";
import { useI18n } from "@workspace/ui/lib/i18n";

/**
 * The control bar's 「加笔记」 button — the timestamp feature's entry point.
 *
 * It replaces the "click the media, then press `Mod-Enter`" discovery problem:
 * the button *is* the gesture, so the draft opens wherever the playhead is
 * without the user knowing a shortcut exists. `Mod-Enter` stays wired in the
 * node contents as the keyboard path.
 *
 * The playhead is read from the controller **at click time**, never through a
 * subscription: subscribing would re-render this button on every `timeupdate`
 * for a value it only needs when pressed.
 */
import { PenLine } from "lucide-react";

import { cn } from "@workspace/ui/lib/utils";

import type { MediaController } from "./types";

interface AddNoteButtonProps {
  /** `null` before the player reports one; the button disables itself then. */
  controller: MediaController | null;
  /** Receives the playhead position in integer milliseconds. */
  onAddNote: (timeMs: number) => void;
  className?: string;
}

export function AddNoteButton({
  controller,
  onAddNote,
  className,
}: AddNoteButtonProps) {
  const { t } = useI18n();

  const handleClick = () => {
    if (!controller) return;
    onAddNote(controller.getCurrentTimeMs());
  };

  return (
    <button
      type="button"
      disabled={!controller}
      className={cn("media-button", "vjs-add-note-button", className)}
      aria-label={t("在当前播放位置加一条笔记")}
      title={t("在当前播放位置加一条笔记（⌘/Ctrl + Enter）")}
      onClick={handleClick}
    >
      <PenLine className="media-button-icon" aria-hidden />
    </button>
  );
}
