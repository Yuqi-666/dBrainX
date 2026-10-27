// SPDX-License-Identifier: AGPL-3.0-only

"use client";
import { translate } from "@workspace/ui/lib/i18n/runtime";

import { useI18n } from "@workspace/ui/lib/i18n";

/**
 * The 笔记 tab: the toolbar's 加笔记, and one card per note below it.
 *
 * This is the **only writer** of the node's timeline. Add / patch / delete each
 * build a complete next array and hand it to `onTimestampsChange`, which the host
 * persists through `patchContent` — one gesture, one write. Notes and cues are
 * **one stored array**, so a write here rewrites the whole timeline and carries
 * the transcript along untouched.
 *
 * Two rules keep that safe when several cards can write at once:
 *
 * 1. **`write(updater)` composes over a ref of the newest array**, not over
 *    `props.timestamps`. Two debounced body edits from two cards (or a title and
 *    a body in the same card) would otherwise each rebuild the array from the
 *    render they were scheduled in, and the second would erase the first. The ref
 *    is advanced optimistically on every write, so back-to-back gestures compose
 *    even before the store echoes back.
 * 2. **`sortTimestamps` runs on every write**, so what reaches the store is
 *    already in reading order and no reader has to re-sort what it just wrote.
 *
 * **加笔记 opens an unpersisted draft, and an empty draft cancels itself.** The
 * card is an editor, so there is no composer to submit and no Enter to press;
 * the note is therefore held locally until it has something in it. Three edges
 * settle it, and none of them is a timer of its own:
 *
 * - **First real content commits it.** A patch that leaves a non-blank title or
 *   body (`isBlankNote`) turns the draft into a stored note in the same gesture,
 *   through the same `write` path every other edit uses.
 * - **Leaving the card without content discards it** — clicking another note, the
 *   player, or anywhere else unmounts it; it was never in the store, so there is
 *   nothing to clean up.
 * - **Leaving the card *with* content commits it**, because the editors below
 *   flush their debounce on blur before this list ever sees the blur
 *   (`note-body-editor.tsx`). So the draft never survives an abandoned gesture
 *   and never loses a typed line.
 *
 * The draft is a real {@link TimestampNoteData} rendered by the same card at its
 * sorted position, so it is never a second, parallel card shape — it only loses
 * its 更多 menu, which would be 转化为节点 on a note that does not exist yet.
 *
 * **Focus is the tick → card edge.** `focusRequest` (from a progress-bar tick,
 * see `media-player/note-marks.tsx`) scrolls the matching card into view and rings
 * it for a moment; `block: "nearest"` means a card already on screen is not
 * re-centred. Cards are held in a ref map keyed by note id rather than looked up
 * with a selector, because note ids come from stored JSON and a `querySelector`
 * would have to escape whatever they contain.
 *
 * **Deleting is "do, then confirm".** 删除 (and 取消引用, which is the same
 * destructive act on a reference card) removes the note and offers an undo strip
 * for {@link UNDO_WINDOW_MS} — one level deep and time-boxed, an undo rather than
 * a trash can. A modal would be the alternative, and the row being deleted is the
 * only copy, so a way back matters more than a second click.
 */
import * as React from "react";
import { NotebookPen, Plus, Undo2 } from "lucide-react";
import type {
  NodeId,
  TimestampData,
  TimestampNoteData,
} from "@workspace/interfaces";

import { Button } from "@workspace/ui/components/ui/button";
import { cn } from "@workspace/ui/lib/utils";

import {
  createTimestampNote,
  formatTimeMs,
  isBlankNote,
  noteDocFromText,
  notesOf,
  sortTimestamps,
} from "../media-player/types";
import type {
  MediaController,
  TimestampAddRequest,
  TimestampFocusRequest,
} from "../media-player/types";

import { MediaSidebarEmpty } from "./media-sidebar-empty";
import { NoteCard } from "./note-card";
import type { Playhead } from "./use-playhead";

/** How long a focused card stays ringed after a tick is clicked. */
const FOCUS_HIGHLIGHT_MS = 1_800;

/** How long a deletion can be taken back. */
const UNDO_WINDOW_MS = 8_000;

export interface NoteCardsProps {
  /**
   * The node's whole timeline; this list filters it to the notes itself.
   *
   * The whole array rather than just the notes, because this is the tab that
   * writes: a note gesture has to hand back a timeline that still holds the
   * transcript.
   */
  timestamps: readonly TimestampData[];
  /** `null` until the player reports one; 加笔记 and 定位 disable then. */
  controller: MediaController | null;
  /** The complete next timeline — the host persists it verbatim. */
  onTimestampsChange: (timestamps: TimestampData[]) => void;
  /** The external capture request (`Mod-Enter`, or the player's 加笔记 button). */
  addRequest?: TimestampAddRequest | null;
  /** "Bring this note into view" — set by a progress-bar tick's click. */
  focusRequest?: TimestampFocusRequest | null;
  /** The live playhead, for the toolbar's readout. */
  playhead: Playhead;
  /** 「转化为节点」 — the host creates the rich-text node and answers its id. */
  onConvertNote: (note: TimestampNoteData) => Promise<NodeId | null>;
  /** 「打开节点」 on a 节点引用 card. */
  onOpenNode: (nodeId: NodeId) => void;
  className?: string;
}

export function NoteCards({
  timestamps,
  controller,
  onTimestampsChange,
  addRequest,
  focusRequest,
  playhead,
  onConvertNote,
  onOpenNode,
  className,
}: NoteCardsProps) {
  const { t } = useI18n();

  const notes = React.useMemo(() => notesOf(timestamps), [timestamps]);
  const sorted = React.useMemo(() => sortTimestamps(notes), [notes]);

  const [focusedIds, setFocusedIds] = React.useState<readonly string[]>([]);
  const cardRefs = React.useRef(new Map<string, HTMLDivElement>());
  const handledTokenRef = React.useRef<number | null>(null);

  // The unpersisted 加笔记 card. The ref is the source of truth and the state is
  // its render mirror, because a commit has to see the value an editor *just*
  // flushed on blur — React's inner-to-outer blur bubbling means the ref is
  // already current when this list's own blur handler runs, while the state
  // closure still holds the previous render's value.
  const [draft, setDraft] = React.useState<TimestampNoteData | null>(null);
  const draftRef = React.useRef<TimestampNoteData | null>(null);
  /**
   * The draft's write has been sent, but the store has not echoed it back yet.
   *
   * `patchContent` only *queues* its upsert (`use-node-content-writer.ts`: a
   * microtask drain), and React flushes the click that committed the draft
   * before that microtask runs. Dropping the local copy at commit time would
   * therefore render one frame in which the note exists nowhere — unmounting the
   * card and throwing away the caret the user is typing into. So the draft keeps
   * rendering until `sorted` carries its id, and this flag keeps it from being
   * written (or discarded) twice in the meantime.
   */
  const draftCommittedRef = React.useRef(false);

  // The one deletion that can still be taken back, plus a counter: deleting the
  // same note again after undoing it must restart the window, and the note object
  // alone would be the same reference twice.
  const [deleted, setDeleted] = React.useState<{
    note: TimestampNoteData;
    token: number;
  } | null>(null);
  const deleteTokenRef = React.useRef(0);

  React.useEffect(() => {
    if (!deleted) return;
    const timer = window.setTimeout(() => setDeleted(null), UNDO_WINDOW_MS);
    return () => window.clearTimeout(timer);
  }, [deleted]);

  // The newest array anyone has produced (see rule 1 in the module docs). Kept
  // in a ref as well as in props, because a debounced write fires long after the
  // render that scheduled it. `readonly` because the prop is: a writer that
  // mutated what it was handed would be editing the store's array in place.
  const latestRef = React.useRef<readonly TimestampData[]>(timestamps);
  latestRef.current = timestamps;

  const write = React.useCallback(
    (updater: (items: readonly TimestampData[]) => TimestampData[]) => {
      const next = sortTimestamps(updater(latestRef.current));
      latestRef.current = next;
      onTimestampsChange(next);
    },
    [onTimestampsChange],
  );

  const patchNote = React.useCallback(
    (id: string, patch: Partial<TimestampNoteData>) => {
      const updatedAt = new Date().toISOString();
      write((items) =>
        items.map((item) =>
          // Matching on kind as well as id: a cue carries no id, and a stored
          // note's id is the only thing that could collide with one if a
          // transcript ever gained ids of its own.
          item.type === "note" && item.id === id
            ? { ...item, ...patch, updatedAt }
            : item,
        ),
      );
    },
    [write],
  );

  /** Delete, keeping the note (not a copy: nothing here mutates it) for the undo strip. */
  const removeNote = React.useCallback(
    (note: TimestampNoteData) => {
      deleteTokenRef.current += 1;
      setDeleted({ note, token: deleteTokenRef.current });
      write((items) =>
        items.filter((item) => !(item.type === "note" && item.id === note.id)),
      );
    },
    [write],
  );

  /** Put the one deleted note back where its time says it belongs. */
  const undoDelete = React.useCallback(() => {
    if (!deleted) return;
    setDeleted(null);
    write((items) => [...items, deleted.note]);
  }, [deleted, write]);

  /**
   * Store a draft as a real note — the one moment a 加笔记 card enters the
   * timeline.
   *
   * The draft is **not** cleared here: see {@link draftCommittedRef}. The effect
   * below is what retires it, once the write has come back through the store.
   */
  const commitDraft = React.useCallback(
    (note: TimestampNoteData) => {
      if (draftCommittedRef.current) return;
      draftCommittedRef.current = true;
      write((items) => [...items, note]);
    },
    [write],
  );

  /** Abandon a still-empty draft: it was never stored, so there is nothing to undo. */
  const discardDraft = React.useCallback(() => {
    // A sent note is a note now; only a draft that never left this component can
    // be abandoned.
    if (draftCommittedRef.current) return;
    if (!draftRef.current) return;
    draftRef.current = null;
    setDraft(null);
  }, []);

  /**
   * A draft's edit. The first one that leaves something behind commits the note;
   * anything else just updates the draft in place.
   *
   * Synchronous on purpose: the body editor flushes its debounce from a blur (or
   * an unmount) handler, and that flush must be able to promote the draft before
   * the component that owns it goes away.
   */
  const patchDraft = React.useCallback(
    (patch: Partial<TimestampNoteData>) => {
      const current = draftRef.current;
      if (!current) return;
      const next = {
        ...current,
        ...patch,
        updatedAt: new Date().toISOString(),
      };
      draftRef.current = next;
      setDraft(next);

      // Already sent: keep the card's copy in step by patching the stored note.
      if (draftCommittedRef.current) {
        patchNote(next.id, patch);
        return;
      }
      if (!isBlankNote(next)) commitDraft(next);
    },
    [commitDraft, patchNote],
  );

  const addNote = React.useCallback(
    (timeMs: number) => {
      // A new capture replaces an empty draft: there is nothing in it to keep,
      // and two blank cards would be two places to type the same sentence.
      // (A draft that already has content is no longer a draft — the call is a
      // no-op and that note stays put.)
      discardDraft();
      draftCommittedRef.current = false;
      const note = createTimestampNote(timeMs, noteDocFromText(""));
      draftRef.current = note;
      setDraft(note);
    },
    [discardDraft],
  );

  // The write has come back: retire the local copy, so from here on the card is
  // an ordinary note rendered from the timeline. The key does not change, so
  // React updates the card in place — the caret and the editor survive.
  React.useEffect(() => {
    if (!draft || !notes.some((note) => note.id === draft.id)) return;
    draftCommittedRef.current = false;
    draftRef.current = null;
    setDraft(null);
  }, [draft, notes]);

  // `Mod-Enter` / the player's 加笔记 button: a changed token captures exactly
  // once. The token guard also survives StrictMode's double effect and a
  // re-render where the same request is still in props.
  React.useEffect(() => {
    if (!addRequest) return;
    if (handledTokenRef.current === addRequest.token) return;
    handledTokenRef.current = addRequest.token;
    // Before metadata there is no playhead to anchor to, and the host reports
    // `0`; a note pinned to the start of an unloaded file is not a note.
    if (!controller) return;
    addNote(addRequest.timeMs);
  }, [addRequest, controller, addNote]);

  // A tick's click focuses the card(s) at that millisecond. The effect re-runs
  // on `token`, so clicking the same tick twice re-scrolls a card the user has
  // since scrolled away from.
  React.useEffect(() => {
    if (!focusRequest) return;
    const targets = focusRequest.noteIds
      .map((id) => cardRefs.current.get(id))
      .filter((element): element is HTMLDivElement => element !== undefined);
    if (targets.length === 0) return;

    targets[0]?.scrollIntoView({ block: "nearest" });
    setFocusedIds(focusRequest.noteIds);

    const timer = window.setTimeout(
      () => setFocusedIds([]),
      FOCUS_HIGHLIGHT_MS,
    );
    return () => window.clearTimeout(timer);
  }, [focusRequest]);

  const convertNote = React.useCallback(
    async (note: TimestampNoteData) => {
      const nodeId = await onConvertNote(note);
      // A failed conversion leaves the note exactly as it was: there is nothing
      // to point at, so it stays a 文本笔记 rather than becoming a dead reference.
      if (nodeId) patchNote(note.id, { nodeId });
    },
    [onConvertNote, patchNote],
  );

  // One list of one card shape: the stored notes, with the draft spliced in at
  // the position its timestamp says it belongs. Splicing rather than rendering a
  // second branch is what lets a draft become a note **without remounting**: the
  // key is unchanged, so the caret and the editor stay where they were.
  //
  // The `some` guard covers the one render in which the write has come back but
  // the effect that retires the draft has not run yet — without it the note would
  // appear twice under one key.
  const entries = React.useMemo(() => {
    const rows: { note: TimestampNoteData; draft: boolean }[] = sorted.map(
      (note) => ({ note, draft: false }),
    );
    if (draft && !rows.some((row) => row.note.id === draft.id)) {
      const index = rows.findIndex((row) => row.note.timeMs > draft.timeMs);
      rows.splice(index === -1 ? rows.length : index, 0, {
        note: draft,
        draft: true,
      });
    }
    return rows;
  }, [sorted, draft]);

  return (
    <div className={cn("flex h-full min-h-0 flex-col gap-2", className)}>
      <div className="flex shrink-0 items-center justify-between gap-2">
        <span
          className="text-xs tabular-nums text-muted-foreground select-none"
          data-slot="playhead-readout"
        >
          {playhead.label}
          {playhead.durationLabel ? (
            <span className="text-muted-foreground/60">
              {" "}
              / {playhead.durationLabel}
            </span>
          ) : null}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          disabled={!controller}
          onClick={() => {
            if (!controller) return;
            addNote(controller.getCurrentTimeMs());
          }}
          aria-label={t("在当前时间加一条笔记")}
          title={t("在当前时间加一条笔记（⌘/Ctrl + Enter）")}
        >
          <Plus aria-hidden />
          {t("加笔记")}{" "}
        </Button>
      </div>

      {deleted ? (
        <div
          className="flex shrink-0 items-center justify-between gap-2 rounded-md bg-muted px-2 py-1 text-xs duration-150 animate-in fade-in slide-in-from-top-1"
          data-slot="note-undo"
        >
          {/* The live region is the sentence, not the strip: the 撤销 button must
              stay a button, not become part of an announcement. */}
          <span role="status" className="truncate text-muted-foreground">
            {t("已删除 {time} 的笔记", {
              time: formatTimeMs(deleted.note.timeMs),
            })}{" "}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            onClick={undoDelete}
            aria-label={translate("撤销删除 {value1} 的笔记", {
              value1: formatTimeMs(deleted.note.timeMs),
            })}
          >
            <Undo2 aria-hidden />
            {t("撤销")}{" "}
          </Button>
        </div>
      ) : null}

      <div
        className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto overscroll-contain pr-1.5 pb-1"
        data-slot="note-cards"
      >
        {sorted.length === 0 && !draft ? (
          <MediaSidebarEmpty icon={NotebookPen} title={t("无笔记")} />
        ) : null}

        {entries.map(({ note, draft: isDraft }) => (
          <NoteCard
            key={note.id}
            note={note}
            controller={controller}
            focused={focusedIds.includes(note.id)}
            draft={isDraft}
            // A brand-new card's title takes the caret; after that the card is
            // an ordinary note and `autoFocus` no longer applies (it only ever
            // acts on mount anyway).
            autoFocusTitle={isDraft}
            onLocate={() => controller?.seek(note.timeMs)}
            onPatch={(patch) =>
              isDraft ? patchDraft(patch) : patchNote(note.id, patch)
            }
            onConvert={() => {
              // Unreachable from the UI (a draft has no 更多 menu); the guard is
              // here so no future entry point can build a node out of a blank
              // note. Abandoning the draft is the honest answer.
              if (isDraft) discardDraft();
              else void convertNote(note);
            }}
            onDelete={() => {
              if (isDraft) discardDraft();
              else removeNote(note);
            }}
            // The empty draft cancels itself the moment focus leaves the card;
            // a stored note has nothing to cancel and flushes inside its own
            // editors instead.
            onFocusLeave={isDraft ? discardDraft : undefined}
            onOpenNode={onOpenNode}
            cardRef={(element) => {
              if (element) cardRefs.current.set(note.id, element);
              else cardRefs.current.delete(note.id);
            }}
          />
        ))}
      </div>
    </div>
  );
}
