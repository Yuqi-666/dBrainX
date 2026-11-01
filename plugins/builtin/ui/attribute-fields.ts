// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The builtin types' attribute-panel contributions (§3.5.4.6, §4.9.2).
 *
 * `packages/ui` renders the shared attribute panel from these declarations
 * alone: no host code knows that a video has a cover or that a website has a
 * favicon. The table is a plain `.ts` module on purpose — the builtin node-type
 * test can import it under `node --test` without a JSX transform, so the
 * per-type field table is asserted where the declaration lives.
 *
 * A field only names an operation the catalog already defines (§4.3.4). Media
 * uploads replace a file through `*.attachFile`, and a hand-typed media address
 * has no operation yet, so those fields carry no `operationId`; the panel keeps
 * their edits local until Todo 39 wires the mapping.
 */
import type { NodeAttributeField } from "@workspace/plugin-sdk/ui";
import { translate } from "@workspace/ui/lib/i18n/runtime";

function contentUrl(
  placeholder: string,
  operationId?: string,
): NodeAttributeField {
  return {
    field: "url",
    label: translate("内容链接"),
    kind: "url",
    placeholder,
    ...(operationId ? { operationId } : {}),
  };
}

export type BuiltinAttributeTypeId =
  | "text"
  | "rich-text"
  | "image"
  | "pdf"
  | "video"
  | "audio"
  | "webpage"
  | "website"
  | "collection"
  | "database";

/**
 * The fields each builtin type contributes to the shared panel.
 *
 * `text`, `rich-text` and `database` contribute none: their content is edited
 * in the node editor, and the panel showed no content field for them before
 * either. An empty list is not a failure — it is the panel saying the type has
 * nothing for it to draw.
 */
export const builtinAttributeFields: Readonly<
  Record<BuiltinAttributeTypeId, readonly NodeAttributeField[]>
> = {
  text: [],
  "rich-text": [],
  image: [contentUrl(translate("输入内容URL..."))],
  pdf: [contentUrl(translate("输入内容URL..."))],
  video: [
    contentUrl(translate("输入内容URL...")),
    {
      field: "coverUrl",
      label: translate("封面"),
      kind: "cover",
      placeholder: translate("输入封面URL..."),
      optional: true,
      operationId: "video.setCover",
    },
    {
      field: "timestamps",
      label: translate("时间轴"),
      kind: "timeline",
      optional: true,
      operationId: "video.timeline.add",
    },
  ],
  audio: [contentUrl(translate("输入内容URL..."))],
  webpage: [
    contentUrl(translate("输入内容URL..."), "webpage.replaceDocument"),
  ],
  website: [
    contentUrl(translate("输入网站地址...")),
    {
      field: "faviconUrl",
      label: translate("网站图标"),
      kind: "cover",
      placeholder: translate("输入网站图标URL..."),
      optional: true,
      operationId: "website.setFavicon",
    },
  ],
  collection: [
    {
      field: "filterConfig.collectionType",
      label: translate("集合类型"),
      kind: "select",
      placeholder: translate("选择集合类型"),
      optional: true,
      operationId: "collection.setFilter",
      options: [
        { value: "ordered", label: translate("有序") },
        { value: "unordered", label: translate("无序") },
        { value: "cards", label: translate("卡片") },
      ],
    },
  ],
  database: [],
};
