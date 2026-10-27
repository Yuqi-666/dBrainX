// SPDX-License-Identifier: AGPL-3.0-only

"use client";

import { useState, type Ref } from "react";
import type { TextareaAutosizeProps } from "react-textarea-autosize";
import ReactTextareaAutosize from "react-textarea-autosize";

// -- Hooks --
import { useIsomorphicLayoutEffect } from "@workspace/editor/hooks/use-isomorphic-layout-effect";

export function TextareaAutosize({
  ...props
}: TextareaAutosizeProps & { ref?: Ref<HTMLTextAreaElement> }) {
  const [isRerendered, setIsRerendered] = useState(false);

  useIsomorphicLayoutEffect(() => setIsRerendered(true), []);

  return isRerendered ? <ReactTextareaAutosize {...props} /> : null;
}

TextareaAutosize.displayName = "TextareaAutosize";
