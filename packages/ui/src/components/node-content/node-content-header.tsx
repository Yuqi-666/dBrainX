// SPDX-License-Identifier: AGPL-3.0-only

"use client";
import { useI18n } from "@workspace/ui/lib/i18n";

import { useDataStore } from "@workspace/store";
import type { NodeCover, NodeData, NodeIcon } from "@workspace/interfaces";
import { Input } from "@workspace/ui/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@workspace/ui/components/ui/dropdown-menu";
import { NodeSemanticSelector } from "@workspace/ui/components/selector/node-semantic-selector";
import { NODE_TYPE_LABELS } from "@workspace/ui/components/selector/node-data-type-selector";
import { IconView } from "@workspace/ui/components/icon/icon-view";
import { NODE_TYPE_ICONS } from "@workspace/ui/components/icon/node-type-icons";
import { cn } from "@workspace/ui/lib/utils";
import {
  useCallback,
  useRef,
  useState,
  type ChangeEvent,
  type ReactNode,
} from "react";

/**
 * The box a node's icon draws in — the icon trigger's plate in
 * `rich-text-node-content.tsx` and the `fallback` plate below must be the same
 * box, so both ask these constants instead of spelling classes twice.
 *
 * **One size for every icon kind** (G3 追加交付 二 r1): the page-header plate is
 * the reference page's, and the reference draws its icon at one size whatever it
 * is. An emoji is text (`text-5xl` = 48px in an 80px plate) and an image fills
 * the box, so the Lucide branch is the only one that needs telling — it gets
 * {@link NODE_ICON_GLYPH} through `NodeIconView`'s `glyphClassName`, which is a
 * share of the box rather than that component's 16px small-box default.
 * `bg-background` is the point of the plate: it is the page colour showing
 * through the cover, which is what lifts the icon off it.
 */
export const NODE_ICON_PLATE = "size-20 rounded-lg bg-background text-5xl";

/** A Lucide glyph's share of {@link NODE_ICON_PLATE} (48px of the 80px plate). */
export const NODE_ICON_GLYPH = "size-3/5";

/** The node-type glyph that stands in for a missing icon, sized to the plate. */
export const NODE_ICON_FALLBACK = "size-12";

/**
 * The semantic capsule: one shape for the read-only pill and the trigger, and
 * **no size of its own** — the reference's "Page • Tag" draws both halves of the
 * meta line at one size, so the pill takes the line's `text-sm`. It used to
 * carry `text-[11px]` inside a `text-xs` line; once that line is 14px, a hard
 * 11px would make the semantic the smallest text in the row.
 */
const SEMANTIC_PILL =
  "inline-flex w-fit items-center rounded-full px-2 py-0.5 font-medium";

/**
 * The capsule's own colours — a tint of the category colour with the colour as
 * the text (`preview-header.tsx:43-60`'s rule), or nothing at all when the
 * category has none. Radix merges its trigger props into the same element, so
 * the two states have to come from one function.
 */
function pillStyle(color?: string) {
  return {
    backgroundColor: color ? `${color}20` : undefined,
    color: color || undefined,
  };
}

/**
 * A controlled text field that cannot lose its caret to its own echo.
 *
 * `patchNode` is **not** a synchronous store write: the host's writer queues the
 * patch and drains it in a microtask (`use-node-content-writer.ts:127-138`), so at
 * the end of a keystroke's event the `node` prop still carries the *previous*
 * text. React's controlled-input bookkeeping runs right after that event, sees
 * the DOM disagree with the prop and writes the old text back — which parks the
 * caret at the end of the line. Typing in the middle of the title therefore
 * jumped to the tail on every keystroke (adding a character looked like it was
 * appended, and the next one landed there too).
 *
 * Holding a draft updated in the same tick as the keystroke makes the rendered
 * value agree with the DOM value when React checks them, so nothing is written
 * back and the caret stays where the user put it. Store writes caused by this
 * field itself are expected — they are matched against the queue below and leave
 * the draft alone; a value it never emitted is an outside edit (the attributes
 * sidebar, a remote sync) and **is** adopted, which is what keeps the header and
 * the sidebar showing the same `title` / `abstract` in both directions
 * (`docs/plan/node-content-ui.md` 第 5 条).
 *
 * @param value  the live store value, i.e. this render's `node.title` / `node.abstract`
 * @param commit the host's patch entry point, called on every keystroke
 */
function useEchoSafeText(value: string, commit: (next: string) => void) {
  useI18n();

  const [draft, setDraft] = useState(value);
  /** Values emitted here that the store has not echoed back yet, oldest first. */
  const pending = useRef<string[]>([]);
  /** The last store value this field has looked at. */
  const seen = useRef(value);

  if (value !== seen.current) {
    seen.current = value;
    // One drain can merge several keystrokes and jump straight to the newest
    // value, so the echo is matched anywhere in the queue, not just at its head.
    const echo = pending.current.lastIndexOf(value);
    if (echo === -1) {
      pending.current.length = 0;
      setDraft(value);
    } else {
      pending.current.splice(0, echo + 1);
    }
  }

  const onChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const next = event.target.value;
      pending.current.push(next);
      setDraft(next);
      commit(next);
    },
    [commit],
  );

  return [draft, onChange] as const;
}

export interface NodeContentHeaderProps {
  /** The live node; the host re-renders it from the store. */
  node: NodeData;
  /**
   * Write top-level fields through the host's shared drain. `null` is the explicit
   * 「清空」 sentinel for `icon` / `cover` (R29-定).
   */
  patchNode: (
    patch: Partial<
      Pick<NodeData, "title" | "abstract" | "semanticId" | "icon" | "cover">
    >,
  ) => void;
  /** The cover entry point; it receives the pick callback it must call. */
  renderCoverSelector?: (props: {
    node: NodeData;
    onPick: (cover: NodeCover | null) => void;
  }) => ReactNode;
  /** The icon entry point; it receives the pick callback it must call. */
  renderIconSelector?: (props: {
    node: NodeData;
    onPick: (icon: NodeIcon | null) => void;
  }) => ReactNode;
  /** Renders static text instead of inputs and drops both selector entries. */
  readOnly?: boolean;
  className?: string;
}

export function NodeContentHeader({
  node,
  patchNode,
  renderCoverSelector,
  renderIconSelector,
  readOnly = false,
  className,
}: NodeContentHeaderProps) {
  const { t } = useI18n();

  const nodeSemantics = useDataStore((state) => state.nodeSemantics);
  const semantic = nodeSemantics.get(node.semanticId);
  const TypeIcon = NODE_TYPE_ICONS[node.nodeType];
  const typeLabel = NODE_TYPE_LABELS[node.nodeType] ?? node.nodeType;
  const hasCover = node.cover != null;

  // The two fields the user types into directly. Both keep a local draft so the
  // store's echo cannot move the caret (`useEchoSafeText` above).
  const [title, onTitleChange] = useEchoSafeText(node.title, (next) =>
    patchNode({ title: next }),
  );
  const [summary, onSummaryChange] = useEchoSafeText(
    node.abstract ?? "",
    (next) => patchNode({ abstract: next }),
  );

  const iconEntry = readOnly
    ? undefined
    : renderIconSelector?.({
        node,
        onPick: (next) => patchNode({ icon: next }),
      });

  const coverEntry = readOnly
    ? undefined
    : renderCoverSelector?.({
        node,
        onPick: (next) => patchNode({ cover: next }),
      });

  return (
    // `min-h-full` / scrolling belong to the host; this is only the page's two
    // bands: the full-bleed cover, then the centred text column.
    <div className={cn("flex flex-col", className)}>
      {/* 1 — cover. The one element outside the column, and the reason this
          component is not wrapped in one. An empty cover draws no block (nc §2):
          the host's entry is then the compact 「添加封面」 button, aligned to the
          right of the title row. */}
      {hasCover && coverEntry}

      {/* The text column: 708px centred with 3rem of padding — the numbers the
          body's own grid produces (`notion-like-editor.scss:66-67`, `:103`), so
          the title below lines up with the first paragraph. Without a cover the
          column needs the pane's top padding itself; with one, the cover is
          already the top. */}
      <div
        className={cn(
          "mx-auto w-full max-w-[708px] px-12",
          !hasCover && "pt-6",
        )}
      >
        <div className="flex flex-col">
          {/* 2 — icon. Its own row, bottom-aligned inside a 40px band that is
              pulled 24px up, so the plate's bottom edge lands 16px below the
              cover's: `items-end` keeps that edge put whatever the plate's
              height is, and the negative margin only has to place the band's
              **bottom**, not the plate's. The plate therefore overflows the
              band's top into the cover — 64px of an 80px plate for an emoji,
              exactly the reference's "icon sits in the cover's lower quarter".
              Nothing clips (the host's scroller is the only `overflow` box, and
              it ends far below). */}
          <div className={cn("flex", hasCover && "-mt-6 h-10 items-end")}>
            {iconEntry ?? (
              <span
                className={cn(
                  "flex items-center justify-center text-muted-foreground",
                  NODE_ICON_PLATE,
                )}
              >
                <IconView
                  icon={node.icon ?? undefined}
                  fallback={<TypeIcon className={NODE_ICON_FALLBACK} />}
                  className={NODE_ICON_PLATE}
                  glyphClassName={NODE_ICON_GLYPH}
                />
              </span>
            )}
          </div>

          {/* 3 — title, with the empty-cover entry pinned to its right end. */}
          <div className="mt-6 flex items-center gap-2">
            {readOnly ? (
              <h1 className="min-w-0 flex-1 truncate text-4xl font-semibold">
                {node.title}
              </h1>
            ) : (
              <Input
                value={title}
                onChange={onTitleChange}
                placeholder={t("未命名页面")}
                aria-label={t("节点标题")}
                // `text-4xl` alone loses to the `Input` base's `md:text-sm` (a
                // media-query rule of the same specificity, emitted later), so
                // the page title rendered at 14px from `md` up — the one class
                // pair that must stay in step is `text-4xl md:text-4xl`
                // (tailwind-merge then drops the base's `md:text-sm`). `py-0` /
                // `dark:bg-transparent` strip the rest of the field chrome: this
                // is a page title, not a form control.
                className="h-auto min-w-0 flex-1 border-none bg-transparent px-0 py-0 text-4xl font-semibold shadow-none focus-visible:ring-0 md:text-4xl dark:bg-transparent"
              />
            )}
            {!hasCover && coverEntry}
          </div>

          {/* 4 — summary. One step under the title (`text-lg`, the reference's
              ~0.5 × title), not the input default: the reference's summary is
              plainly larger than the meta line below it. */}
          {readOnly ? (
            node.abstract ? (
              <p className="mt-1.5 text-lg text-muted-foreground">
                {node.abstract}
              </p>
            ) : null
          ) : (
            <Input
              value={summary}
              onChange={onSummaryChange}
              placeholder={t("添加摘要…")}
              aria-label={t("节点摘要")}
              // Same `md:` pair rule as the title: the `Input` base's
              // `md:text-sm` would otherwise beat `text-lg`.
              className="mt-1.5 h-auto border-none bg-transparent px-0 py-0 text-lg text-muted-foreground shadow-none focus-visible:ring-0 md:text-lg dark:bg-transparent"
            />
          )}

          {/* 5 — meta: the node's type and its semantic on one muted line, the
              reference page's "Page • Tag". The type label is the shared
              `NODE_TYPE_LABELS` table (a second copy would drift the way the
              icon table once did, §M2.2-3); the semantic half keeps
              `preview-header.tsx:43-60`'s coloured pill — the colour is the
              category's own (sel §4), not decoration this line may drop — and is
              now the **switch** for it (G3 追加交付 二 r2): a dropdown trigger that
              writes `semanticId`. Its body is the shared `NodeSemanticSelector` (search +
              catalogue + 「Add new type」), the same menu the attributes sidebar
              opens, so the two entries can never disagree about what a semantic
              is; the write still goes through the host's `patchNode` drain. */}
          <div className="mt-1.5 flex items-center gap-2 text-sm text-muted-foreground">
            <span>{typeLabel}</span>
            {semantic && <span aria-hidden>•</span>}
            {readOnly ? (
              semantic ? (
                <span
                  className={SEMANTIC_PILL}
                  style={pillStyle(semantic.color)}
                >
                  {semantic.name}
                </span>
              ) : null
            ) : (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className={cn(
                      SEMANTIC_PILL,
                      "cursor-pointer transition-opacity hover:opacity-80 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                    )}
                    style={pillStyle(semantic?.color)}
                    aria-label={semantic ? t("切换语义") : t("选择语义")}
                  >
                    {semantic ? (
                      semantic.name
                    ) : (
                      <span className="text-muted-foreground">
                        {t("选择语义")}
                      </span>
                    )}
                  </button>
                </DropdownMenuTrigger>
                {/* `min-w-64`: the menu's own default is
                    `w-(--radix-dropdown-menu-trigger-width)`, and a semantic
                    capsule is ~90-190px wide — the shared list is `w-64`
                    (256px), so it would overflow the menu's own
                    `overflow-x-hidden` box and its rows would be clipped *and*
                    unclickable (the probe caught exactly that: the row's box was
                    240px inside a 128px menu, so the click landed on the Dialog
                    overlay). `min-w-*` is a different property from `w-*`, so it
                    cannot lose to the Radix width on stylesheet order — `w-64`
                    could. */}
                <DropdownMenuContent align="start" className="min-w-64">
                  <NodeSemanticSelector
                    onSelect={(semanticId) => patchNode({ semanticId })}
                  />
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
