// SPDX-License-Identifier: AGPL-3.0-only

"use client";
import { useI18n } from "@workspace/ui/lib/i18n";

import { forwardRef, useCallback } from "react";

// --- Lib ---
import { parseShortcutKeys } from "@workspace/editor/lib/tiptap-utils";

// --- Hooks ---
import { useTiptapEditor } from "@workspace/editor/hooks/use-tiptap-editor";

// --- Tiptap UI ---
import type { UseEmojiTriggerConfig } from "@workspace/editor/components/tiptap-ui/emoji-trigger-button";
import {
  EMOJI_TRIGGER_SHORTCUT_KEY,
  useEmojiTrigger,
} from "@workspace/editor/components/tiptap-ui/emoji-trigger-button";

// --- UI Primitives ---
import type { ButtonProps } from "@workspace/editor/components/tiptap-ui-primitive/button";
import { Button } from "@workspace/editor/components/tiptap-ui-primitive/button";
import { Badge } from "@workspace/editor/components/tiptap-ui-primitive/badge";

export interface EmojiTriggerButtonProps
  extends Omit<ButtonProps, "type">, UseEmojiTriggerConfig {
  /**
   * Optional text to display alongside the icon.
   */
  text?: string;
  /**
   * Optional show shortcut keys in the button.
   * @default false
   */
  showShortcut?: boolean;
}

export function EmojiTriggerShortcutBadge({
  shortcutKeys = EMOJI_TRIGGER_SHORTCUT_KEY,
}: {
  shortcutKeys?: string;
}) {
  useI18n();

  return <Badge>{parseShortcutKeys({ shortcutKeys })}</Badge>;
}

/**
 * Button component for adding emoji trigger in a Tiptap editor.
 *
 * For custom button implementations, use the `useEmojiTrigger` hook instead.
 */
export const EmojiTriggerButton = forwardRef<
  HTMLButtonElement,
  EmojiTriggerButtonProps
>(
  (
    {
      editor: providedEditor,
      node,
      nodePos,
      text,
      trigger = ":",
      hideWhenUnavailable = false,
      onTriggerApplied,
      showShortcut = false,
      onClick,
      children,
      ...buttonProps
    },
    ref,
  ) => {
    const { t } = useI18n();

    const { editor } = useTiptapEditor(providedEditor);
    const {
      isVisible,
      canAddTrigger,
      handleAddTrigger,
      label,
      shortcutKeys,
      Icon,
    } = useEmojiTrigger({
      editor,
      node,
      nodePos,
      trigger,
      hideWhenUnavailable,
      onTriggerApplied,
    });

    const handleClick = useCallback(
      (event: React.MouseEvent<HTMLButtonElement>) => {
        onClick?.(event);
        if (event.defaultPrevented) return;
        handleAddTrigger();
      },
      [handleAddTrigger, onClick],
    );

    if (!isVisible) {
      return null;
    }

    return (
      <Button
        type="button"
        variant="ghost"
        role="button"
        tabIndex={-1}
        disabled={!canAddTrigger}
        data-disabled={!canAddTrigger}
        aria-label={label}
        tooltip={t("Add emoji")}
        onClick={handleClick}
        {...buttonProps}
        ref={ref}
      >
        {children ?? (
          <>
            <Icon className="tiptap-button-icon" />
            {text && <span className="tiptap-button-text">{text}</span>}
            {showShortcut && (
              <EmojiTriggerShortcutBadge shortcutKeys={shortcutKeys} />
            )}
          </>
        )}
      </Button>
    );
  },
);

EmojiTriggerButton.displayName = "EmojiTriggerButton";
