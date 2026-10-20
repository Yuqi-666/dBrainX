// SPDX-License-Identifier: AGPL-3.0-only

"use client";

/**
 * A node's own preview, reduced to a **cover** — the piece a card wall needs.
 *
 * `PreviewBlock` is a hover panel: a header (title, semantic, abstract) plus the
 * type-specific body. A gallery card has its own title/badges/meta, so what it
 * borrows from the preview layer is only the *media* — the image, the video
 * poster, the PDF cover, the icon — drawn to fill a fixed box.
 *
 * That keeps the gallery from re-implementing `resolveFileUrl` (or any other
 * node-type knowledge), without importing the hover panel's chrome or the
 * video player behind it. Keep this a leaf: no store, no `PreviewHeader`.
 *
 * Since M2 it applies the node's own `cover` first and only then the type-based
 * derivation it has always done. Resolving a `{kind:"node"}` cover needs another
 * node, so the host may inject `resolveNode` — an optional **prop**, never a
 * store import, so the leaf constraint above still holds.
 */
import { FileText } from "lucide-react";
import type { NodeData } from "@workspace/interfaces";
import { resolveFileUrl } from "@workspace/api-client";
import { cn } from "@workspace/ui/lib/utils";
import { NODE_TYPE_ICONS } from "@workspace/ui/components/icon/node-type-icons";

/** How much extracted text a text-like cover shows. */

/** How many `{kind:"node"}` hops a cover may follow (`node-content-ui.md` §M2.2-5). */
const MAX_COVER_DEPTH = 1;

/** Flattens a Tiptap/ProseMirror doc to plain text (text + rich-text nodes). */
function extractDocText(docs: Record<string, unknown> | undefined): string {
  if (!docs || !("content" in docs)) return "";

  const walk = (node: unknown): string => {
    if (!node) return "";
    if (typeof node === "string") return node;
    if (typeof node !== "object") return "";
    const record = node as { text?: unknown; content?: unknown };
    if (typeof record.text === "string") return record.text;
    if (Array.isArray(record.content)) {
      return record.content.map(walk).join(" ");
    }
    return "";
  };

  return walk(docs).replace(/\s+/g, " ").trim();
}

/** The image a node can draw itself with, resolved to a servable URL. */
function nodeCoverUrl(node: NodeData): string | null {
  switch (node.nodeType) {
    case "image":
      return node.content?.url ? resolveFileUrl(node.content.url) : null;
    case "video":
      return node.content?.coverUrl
        ? resolveFileUrl(node.content.coverUrl)
        : null;
    case "audio":
      // Only an imported audio node has a cover; a local upload falls through
      // to the type glyph, exactly as it did before the import existed.
      return node.content?.coverUrl
        ? resolveFileUrl(node.content.coverUrl)
        : null;
    case "pdf":
      return node.content?.coverUrl
        ? resolveFileUrl(node.content.coverUrl)
        : null;
    case "website":
      return node.content?.faviconUrl
        ? resolveFileUrl(node.content.faviconUrl)
        : null;
    default:
      return null;
  }
}

/** A textual stand-in for a node whose content is text. */
function nodeCoverText(node: NodeData): string {
  switch (node.nodeType) {
    case "text":
      return extractDocText(node.content?.docs);
    case "rich-text":
      return extractDocText(node.content?.docs);
    default:
      // A webpage node stores its document as an object, so there is no record
      // text to draw; the type glyph stands in.
      return "";
  }
}

interface ResolvedCover {
  /** Picture URL, when the cover resolves to one. */
  url: string | null;
  /** The node whose type-derived media fills the box when there is no URL. */
  node: NodeData;
  /** A second `{kind:"node"}` hop was refused; draw the node type's glyph. */
  iconOnly: boolean;
}

/**
 * Applies `node.cover` first, then the node-type derivation this component has
 * always done.
 *
 * A `{kind:"node"}` cover is followed at most one hop. An unknown id and a
 * self-reference (`A.cover = {kind:"node", nodeId:A}`) fall back to the current
 * node, and a node whose own cover is another `{kind:"node"}` stops there — so
 * `A → B → A` can neither recurse nor overflow the stack (`§M2.2-5`).
 */
function resolveCover(
  node: NodeData,
  resolveNode?: (nodeId: string) => NodeData | undefined,
): ResolvedCover {
  let current = node;

  for (let depth = 0; ; depth += 1) {
    const cover = current.cover;

    if (cover?.kind === "image") {
      return { url: resolveFileUrl(cover.url), node: current, iconOnly: false };
    }

    if (cover?.kind !== "node" || !resolveNode) break;

    if (depth >= MAX_COVER_DEPTH) {
      return { url: null, node: current, iconOnly: true };
    }

    const target = resolveNode(cover.nodeId);
    // An unresolvable id or a self-reference must fall back, never recurse.
    if (!target || target.id === current.id) break;

    current = target;
  }

  return { url: nodeCoverUrl(current), node: current, iconOnly: false };
}

export interface NodePreviewCoverProps {
  node: NodeData;
  /** Applied to the cover box; the caller sizes it. */
  className?: string;
  /**
   * Resolves the target of a `{kind:"node"}` cover. Injected by the host — this
   * component stays a leaf and never imports the store.
   */
  resolveNode?: (nodeId: string) => NodeData | undefined;
}

/**
 * Fills its box with the node's cover: its own `cover` when set, its picture
 * when it has one, its text when that is all it holds, and its type glyph
 * otherwise.
 *
 * The caller provides the box (aspect ratio, rounding, `overflow-hidden`); this
 * component never measures or scrolls.
 */
export function NodePreviewCover({
  node,
  className,
  resolveNode,
}: NodePreviewCoverProps) {
  const cover = resolveCover(node, resolveNode);
  const source = cover.node;
  const text = cover.url || cover.iconOnly ? "" : nodeCoverText(source);
  const Icon = NODE_TYPE_ICONS[source.nodeType] ?? FileText;

  if (cover.url) {
    return (
      <div className={cn("size-full overflow-hidden bg-muted", className)}>
        <img
          src={cover.url}
          alt={source.title}
          loading="lazy"
          draggable={false}
          className="size-full object-cover"
        />
      </div>
    );
  }

  if (text) {
    return (
      <div
        className={cn(
          "size-full overflow-hidden bg-muted/60 p-2.5 text-[11px] leading-relaxed text-muted-foreground",
          className,
        )}
      >
        <p className="line-clamp-6">{text}</p>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex size-full items-center justify-center bg-muted/60 text-muted-foreground",
        className,
      )}
    >
      <Icon className="size-6 opacity-60" />
    </div>
  );
}
