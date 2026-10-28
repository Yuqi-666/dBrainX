// SPDX-License-Identifier: AGPL-3.0-only

import { mergeAttributes } from "@tiptap/react";
import TiptapHorizontalRule from "@tiptap/extension-horizontal-rule";

export const HorizontalRule = TiptapHorizontalRule.extend({
  renderHTML() {
    return [
      "div",
      mergeAttributes(this.options.HTMLAttributes, { "data-type": this.name }),
      ["hr"],
    ];
  },
});

export default HorizontalRule;
