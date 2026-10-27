// SPDX-License-Identifier: AGPL-3.0-only

/** The label and icon the library uses for one storage category. */
import type { LucideIcon } from "lucide-react";
import {
  FileAudioIcon,
  FileCode2Icon,
  FileIcon,
  FileTextIcon,
  FileVideoIcon,
  ImageIcon,
} from "lucide-react";
import type { StorageCategory } from "@workspace/api-client";
import { cn } from "@workspace/ui/lib/utils";

/** Source strings shared with the translation catalog. */
export const CATEGORY_LABEL_KEYS: Record<StorageCategory, string> = {
  image: "图片",
  video: "视频",
  audio: "音频",
  pdf: "PDF",
  webpage: "网页",
  other: "其他",
};

const CATEGORY_ICONS: Record<StorageCategory, LucideIcon> = {
  image: ImageIcon,
  video: FileVideoIcon,
  audio: FileAudioIcon,
  pdf: FileTextIcon,
  webpage: FileCode2Icon,
  other: FileIcon,
};

/** The translator returned by `useI18n()`; declared here to keep helpers pure. */
export type Translate = (
  key: string,
  values?: Record<string, string | number>,
) => string;

/** The translated category name, e.g. 「图片」/ "Image". */
export function categoryLabel(category: StorageCategory, t: Translate): string {
  return t(CATEGORY_LABEL_KEYS[category]);
}

/** The icon for a category, sized by the caller. */
export function CategoryIcon({
  category,
  className,
}: {
  category: StorageCategory;
  className?: string;
}) {
  const Icon = CATEGORY_ICONS[category];
  return <Icon aria-hidden="true" className={className} />;
}

/**
 * The color one category paints in the storage bar and in its legend dot.
 *
 * Six hues that stay distinguishable side by side, each lifted one step in
 * dark mode so a segment keeps its contrast on a dark card. The legend reuses
 * the same class, so a dot can never drift from the segment it explains.
 */
export const CATEGORY_COLOR_CLASSES: Record<StorageCategory, string> = {
  image: "bg-sky-500 dark:bg-sky-400",
  video: "bg-violet-500 dark:bg-violet-400",
  audio: "bg-emerald-500 dark:bg-emerald-400",
  pdf: "bg-rose-500 dark:bg-rose-400",
  webpage: "bg-cyan-500 dark:bg-cyan-400",
  other: "bg-amber-500 dark:bg-amber-400",
};

/**
 * The legend dot that explains a storage-bar segment.
 *
 * Decorative by design: the category name printed beside it is the value, so
 * the dot adds no information to a screen reader and is hidden from one.
 */
export function CategoryDot({ category }: { category: StorageCategory }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "size-2.5 shrink-0 rounded-full",
        CATEGORY_COLOR_CLASSES[category],
      )}
    />
  );
}
