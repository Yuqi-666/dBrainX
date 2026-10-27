// SPDX-License-Identifier: AGPL-3.0-only

import type { Language, Tone } from "@workspace/editor/lib/ai";

export interface AiMenuPosition {
  element: HTMLElement | null;
  rect: DOMRect | null;
}

export interface AiMenuState {
  isOpen: boolean;
  tone?: Tone;
  language: Language;
  shouldShowInput: boolean;
  inputIsFocused: boolean;
  fallbackAnchor: AiMenuPosition;
}

export interface AiMenuStateContextValue {
  state: AiMenuState;
  updateState: (updates: Partial<AiMenuState>) => void;
  setFallbackAnchor: (
    element: HTMLElement | null,
    rect?: DOMRect | null,
  ) => void;
  reset: () => void;
}
