// SPDX-License-Identifier: AGPL-3.0-only

"use client";
import { useI18n } from "@workspace/ui/lib/i18n";

/**
 * A `text` node's content: one centered, large-type rich-text block — the 禅意
 * block of `docs/node-content/README.md` §1.1 (plan `docs/plan/node-content-ui.md`
 * M3).
 *
 * Three things are worth knowing here:
 *
 * 1. **The editor owns the document, the store is only the sink.** The block is
 *    seeded once **per mount** from `normalizeDoc(node.content.docs)` — lazy
 *    upgrade, never a migration: an old `{ content: "字符串" }` record is
 *    translated on read and the first edit persists the
 *    `{ type:"doc", content:[…] }` shape (`doc-normalize.ts`).
 * 2. **Writes are debounced, but never dropped.** The shared writer serializes
 *    them (`patchContent`), and a trailing debounce keeps one write per pause
 *    instead of one per keystroke; the unmount flush is what makes the last
 *    keystrokes survive an immediate `Esc`. The trailing debounce has a second
 *    effect worth keeping: the write lands *after* a click that follows typing,
 *    so a header edit made in that window travels in the same payload instead of
 *    racing an in-flight body write.
 * 3. **Only the `docs` half is written** — `patchContent` merges onto the live
 *    content, so nothing else on the node is at risk.
 * 4. **A node switch is a remount.** The dialog is *not* keyed by node id, so the
 *    关系 tab of the attributes sidebar can retarget it in place; the editor is
 *    therefore keyed **here** (`key={node.id}`) and the debounce carries the
 *    writer it was armed with, so neither the document nor a pending write can
 *    cross over to the node the dialog was pointed at next.
 * 5. **A store-side clear is a remount too.** `useUIStore().nodeContentReset`
 *    counts external replacements of this node's content (the disposition
 *    dialog's 清空, a deleted file stripping an embedded block). The token joins
 *    the key, so the uncontrolled editor reseeds from the cleared document —
 *    ordinary typing only writes the store and never bumps it.
 */
import { useCallback, useEffect, useRef } from "react";
import type { TextNodeData } from "@workspace/interfaces";
import { SingleBlockEditor } from "@workspace/editor/components/tiptap-templates/single-block/single-block-editor";
import { useUIStore } from "@workspace/store";
import { cn } from "@workspace/ui/lib/utils";
import { normalizeDoc } from "./doc-normalize";
import { useNodeContentWriter } from "./use-node-content-writer";

/**
 * The content half of a text node. Read off the node type rather than imported:
 * `packages/interfaces`' barrel exports `TextNodeData` but not `TextContent`, and
 * M3 does not touch that package's exports.
 */
type TextContent = TextNodeData["content"];

/** How long typing has to pause before the document is written. */
const TEXT_WRITE_DEBOUNCE_MS = 400;

interface TextNodeContentProps {
  node: TextNodeData;
  className?: string;
}

export function TextNodeContent({ node, className }: TextNodeContentProps) {
  const { t } = useI18n();

  // Bumped only when the store content is replaced from outside (清空节点, a
  // deleted file). It is part of the editor key below, so such a replacement
  // remounts the uncontrolled editor; typing never touches it.
  const contentReset = useUIStore(
    (state) => state.nodeContentReset[node.id] ?? 0,
  );

  const writer = useNodeContentWriter<TextContent>(
    node.id,
    "text",
    node.content,
  );

  // The document the editor is about to persist, **together with the writer that
  // owns it**, and the timer that will send it.
  //
  // Carrying the writer is what makes a node switch safe: the attributes sidebar
  // can point the *same* dialog at another node (`attributes-sidebar.tsx`, the
  // 关系 tab calls `setCurrentEditingNodeId`) without remounting this component,
  // so a debounce armed for the old node would otherwise fire through the *new*
  // node's writer and copy one node's text into another. The captured function is
  // bound to the node that was being typed in.
  const pending = useRef<{
    patchContent: (patch: Partial<TextContent>) => void;
    docs: TextContent["docs"];
  } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // `patchContent` changes identity whenever the store does (its live-content
  // reader depends on this render's node), so hold it in a ref instead of
  // rebuilding the flush callback — the unmount cleanup has to stay stable.
  const patchRef = useRef(writer.patchContent);
  useEffect(() => {
    patchRef.current = writer.patchContent;
  }, [writer.patchContent]);

  const flush = useCallback(() => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    const queued = pending.current;
    if (queued === null) return;
    pending.current = null;
    queued.patchContent({ docs: queued.docs });
  }, []);

  const handleChange = useCallback(
    (doc: unknown) => {
      pending.current = {
        patchContent: patchRef.current,
        docs: doc as TextContent["docs"],
      };
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = setTimeout(flush, TEXT_WRITE_DEBOUNCE_MS);
    },
    [flush],
  );

  // Unmount (closing the dialog) persists whatever the debounce still holds.
  useEffect(() => flush, [flush]);

  // An external replacement wins over whatever the debounce still holds: drop
  // the queued document so a timer armed a moment ago cannot write the old
  // content back after the clear.
  useEffect(() => {
    pending.current = null;
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, [contentReset]);

  return (
    <div className={cn("flex h-full min-h-0 flex-col", className)}>
      <div className="flex-1 overflow-y-auto">
        {/* The 禅意 box: the type scale, the whitespace and the line length are
            the consumer's (plan §M3.2-3 — `packages/editor` is not scanned by
            Tailwind), the editor only fills it. No viewport units: node-content
            is mounted both in a dialog and in `absolute inset-0` (plan §M3.2-12). */}
        <div className="mx-auto flex min-h-full w-full max-w-[42rem] flex-col px-8 py-16 text-center text-2xl leading-relaxed">
          {/* Keyed by node id **and** the external-reset token: the editor is
              **uncontrolled** and seeds itself once per mount (that is the whole
              point — `SingleBlockEditor` reads `initialContent` in a lazy
              `useState`), so pointing the same dialog at another node — or
              replacing the document from the store (清空节点) — has to remount it.
              Without the node id, a text → text switch through the sidebar kept
              the first node's document while the writer moved to the second —
              and a keystroke then persisted one node's text into the other.
              Without the reset token, a store-side clear left the old document
              on screen. The seed is recomputed per render on purpose: the key
              makes the editor read the value it mounts with, and a re-render of
              this component (every store change) must not reset a live editor. */}
          <SingleBlockEditor
            key={`${node.id}:${contentReset}`}
            initialContent={normalizeDoc(node.content?.docs)}
            onContentChange={handleChange}
            placeholder={t("写下这句话…")}
            className="flex-1"
          />
        </div>
      </div>
    </div>
  );
}
