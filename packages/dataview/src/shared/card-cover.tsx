// SPDX-License-Identifier: AGPL-3.0-only

"use client";

/**
 * A card's cover — the one cover box the kanban and the gallery both draw.
 *
 * Three sources, in priority order: an image address from a cell, a graph node's
 * own preview (collection rows, and `relation` covers on a database), and the
 * title monogram placeholder. A URL that fails to load falls through to the
 * placeholder rather than leaving a broken image on the board.
 *
 * The node preview itself is `@workspace/ui`'s `NodePreviewCover` — neither view
 * knows anything about node types or how a stored file path becomes a servable
 * URL. It is imported by path, not through the `preview-block` barrel, so a
 * view's lazy chunk does not pull the hover panel (and its video player).
 *
 * **Ratio.** 网格 tiles are a fixed height, so the cover fills the box the card
 * gave it (`size-full`). 瀑布流 has no fixed height and exists to let cards
 * differ, so there the box takes the image's own ratio once it loads — bounded
 * by {@link clampCardCoverAspect} — which is what makes the layout read as a
 * masonry instead of an uneven grid. The ratio is measured, never guessed.
 */
import { useEffect, useState } from "react";
import { ImageOff } from "lucide-react";
import type { NodeData } from "@workspace/interfaces";
import { cn } from "@workspace/ui/lib/utils";
import { NodePreviewCover } from "@workspace/ui/components/preview-block/node-preview-cover";

import type { CardCover } from "./card-ops";

/**
 * 瀑布流 cover ratios.
 *
 * Grid tiles are uniform (the tile height is fixed), but 瀑布流 exists to let
 * cards differ, so there the cover box takes the image's own ratio. The bounds
 * keep an extreme panorama or a very tall strip from swallowing a column.
 */
export const CARD_COVER_FALLBACK_ASPECT = 4 / 3;
export const CARD_COVER_MIN_ASPECT = 4 / 5;
export const CARD_COVER_MAX_ASPECT = 16 / 9;

/** Keeps a loaded image's ratio inside the range a column can carry. */
export function clampCardCoverAspect(ratio: number): number {
  if (!Number.isFinite(ratio) || ratio <= 0) {
    return CARD_COVER_FALLBACK_ASPECT;
  }
  return Math.min(
    CARD_COVER_MAX_ASPECT,
    Math.max(CARD_COVER_MIN_ASPECT, ratio),
  );
}

/** The first glyph of a title, for the no-cover placeholder. */
function monogram(title: string): string {
  const trimmed = title.trim();
  return trimmed ? Array.from(trimmed)[0]!.toUpperCase() : "?";
}

export interface CardCoverBoxProps {
  cover: CardCover | null;
  title: string;
  /** 瀑布流: size the box from the image itself rather than filling a tile. */
  naturalAspect?: boolean;
  resolveNode?: (nodeId: string) => NodeData | undefined;
  className?: string;
}

/**
 * The quiet placeholder a coverless card wears: a soft wash of the theme's
 * muted surface with the title's first glyph, never a broken-image icon. The
 * icon only appears when a cover *was* configured and failed to load, which is
 * information the user needs; a row that simply has no cover gets the monogram
 * alone.
 */
function CoverPlaceholder({
  title,
  failed,
}: {
  title: string;
  failed: boolean;
}) {
  return (
    <div className="relative flex size-full items-center justify-center bg-linear-to-br from-muted/80 to-muted/30">
      <span
        aria-hidden
        className="text-2xl leading-none font-semibold text-muted-foreground/40 select-none"
      >
        {monogram(title)}
      </span>
      {failed && (
        <span className="absolute right-2 bottom-2 rounded-full bg-background/70 p-1 backdrop-blur-sm">
          <ImageOff className="size-3 text-muted-foreground" />
        </span>
      )}
    </div>
  );
}

export function CardCoverBox({
  cover,
  title,
  naturalAspect,
  resolveNode,
  className,
}: CardCoverBoxProps) {
  // A new cover source is a fresh chance to load, so both the failure flag and
  // the measured ratio reset with it (a recycled card in a virtual window reuses
  // this component).
  const sourceKey = cover
    ? cover.kind === "url"
      ? cover.url
      : `node:${cover.nodeId}`
    : "";
  const [failed, setFailed] = useState(false);
  const [measured, setMeasured] = useState<number | null>(null);
  useEffect(() => {
    setFailed(false);
    setMeasured(null);
  }, [sourceKey]);

  const node = cover?.kind === "node" ? resolveNode?.(cover.nodeId) : undefined;

  let body = null;
  if (cover?.kind === "url" && !failed) {
    body = (
      <img
        src={cover.url}
        alt={title}
        loading="lazy"
        draggable={false}
        onError={() => setFailed(true)}
        onLoad={(event) => {
          const image = event.currentTarget;
          if (image.naturalWidth > 0 && image.naturalHeight > 0) {
            setMeasured(
              clampCardCoverAspect(image.naturalWidth / image.naturalHeight),
            );
          }
        }}
        className="size-full object-cover"
      />
    );
  } else if (cover?.kind === "node" && node) {
    body = <NodePreviewCover node={node} />;
  }

  if (!body) body = <CoverPlaceholder title={title} failed={failed} />;

  const ratio =
    naturalAspect && cover ? (measured ?? CARD_COVER_FALLBACK_ASPECT) : null;

  return (
    <div
      style={ratio ? { aspectRatio: ratio } : undefined}
      className={cn(
        "overflow-hidden bg-muted/50",
        ratio ? "w-full" : "size-full",
        className,
      )}
      aria-hidden={cover ? undefined : true}
    >
      {body}
    </div>
  );
}
