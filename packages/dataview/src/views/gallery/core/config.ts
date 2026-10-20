// SPDX-License-Identifier: AGPL-3.0-only

import { translate } from "@workspace/ui/lib/i18n/runtime";
/**
 * Gallery geometry config — the self-healing layer over the wall's own two keys
 * (排列方式 / 卡片尺寸).
 *
 * Everything about a **card** (title / cover / fields / 展示模式) is shared with
 * the kanban — `shared/card-ops.ts` resolves it and `shared/card-config.tsx`
 * configures it — so what is left here is how the wall arranges those cards.
 *
 * A view config outlives the schema it was written against, and a persisted enum
 * can hold a value a later build no longer knows, so the resolvers here answer
 * "what does this value mean *now*" and degrade to a sane default instead of
 * throwing (README §5.1).
 *
 * Pure module: no React, no third-party library.
 */
import type { GalleryViewConfig } from "@workspace/interfaces";

/** The three card-wall shapes, in toolbar order. */
export const GALLERY_LAYOUT_OPTIONS = [
  {
    value: "grid",
    get label() {
      return translate("网格");
    },
  },
  {
    value: "masonry",
    get label() {
      return translate("瀑布流");
    },
  },
  {
    value: "list",
    get label() {
      return translate("列表");
    },
  },
] as const;

/** Card sizes; they drive the tile height and the responsive column width. */
export const GALLERY_CARD_SIZE_OPTIONS = [
  {
    value: "small",
    get label() {
      return translate("小");
    },
  },
  {
    value: "medium",
    get label() {
      return translate("中");
    },
  },
  {
    value: "large",
    get label() {
      return translate("大");
    },
  },
] as const;

function isLayoutOption(value: unknown): value is GalleryViewConfig["layout"] {
  return GALLERY_LAYOUT_OPTIONS.some((option) => option.value === value);
}

function isCardSizeOption(
  value: unknown,
): value is GalleryViewConfig["cardSize"] {
  return GALLERY_CARD_SIZE_OPTIONS.some((option) => option.value === value);
}

/** The layout to draw: the persisted one when known, else 网格. */
export function resolveLayout(
  layout: string | undefined,
): GalleryViewConfig["layout"] {
  return isLayoutOption(layout) ? layout : "grid";
}

/** The card size to draw: the persisted one when known, else 中. */
export function resolveCardSize(
  cardSize: string | undefined,
): GalleryViewConfig["cardSize"] {
  return isCardSizeOption(cardSize) ? cardSize : "medium";
}
