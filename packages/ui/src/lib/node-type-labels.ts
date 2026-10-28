// SPDX-License-Identifier: AGPL-3.0-only

import { translate } from "./i18n/runtime";

export const NODE_TYPE_LABELS: Record<string, string> = {
  get text() {
    return translate("Text");
  },
  get image() {
    return translate("Image");
  },
  pdf: "PDF",
  get video() {
    return translate("Video");
  },
  get audio() {
    return translate("Audio");
  },
  get webpage() {
    return translate("Webpage");
  },
  get website() {
    return translate("Website");
  },
  get collection() {
    return translate("Collection");
  },
  get "rich-text"() {
    return translate("Rich Text");
  },
  get database() {
    return translate("Database");
  },
};
