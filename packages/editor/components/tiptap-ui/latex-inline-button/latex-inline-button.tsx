// SPDX-License-Identifier: AGPL-3.0-only

"use client";
import { useI18n } from "@workspace/ui/lib/i18n";

import { forwardRef, useCallback } from "react";

// --- Hooks ---
import { useTiptapEditor } from "@workspace/editor/hooks/use-tiptap-editor";

// --- Lib ---
import { parseShortcutKeys } from "@workspace/editor/lib/tiptap-utils";

// --- Tiptap UI ---
import type { UseLatexInlineConfig } from "@workspace/editor/components/tiptap-ui/latex-inline-button";
import {
  LATEX_INLINE_SHORTCUT_KEY,
  useLatexInline,
} from "@workspace/editor/components/tiptap-ui/latex-inline-button";

// --- UI Primitives ---
import type { ButtonProps } from "@workspace/editor/components/tiptap-ui-primitive/button";
import { Button } from "@workspace/editor/components/tiptap-ui-primitive/button";
import { Badge } from "@workspace/editor/components/tiptap-ui-primitive/badge";

export interface LatexInlineButtonProps
  extends Omit<ButtonProps, "type">, UseLatexInlineConfig {
  text?: string;
  showShortcut?: boolean;
}

export function LatexInlineShortcutBadge({
  shortcutKeys = LATEX_INLINE_SHORTCUT_KEY,
}: {
  shortcutKeys?: string;
}) {
  useI18n();

  return <Badge>{parseShortcutKeys({ shortcutKeys })}</Badge>;
}

/**
 * Button component for toggling latex inline in a Tiptap editor.
 */
export const LatexInlineButton = forwardRef<
  HTMLButtonElement,
  LatexInlineButtonProps
>(
  (
    {
      editor: providedEditor,
      text,
      hideWhenUnavailable = false,
      onToggled,
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
      canToggle,
      isActive,
      handleToggle,
      label,
      shortcutKeys,
      Icon,
    } = useLatexInline({
      editor,
      hideWhenUnavailable,
      onToggled,
    });

    const handleClick = useCallback(
      (event: React.MouseEvent<HTMLButtonElement>) => {
        onClick?.(event);
        if (event.defaultPrevented) return;
        handleToggle();
      },
      [handleToggle, onClick],
    );

    if (!isVisible) {
      return null;
    }

    return (
      <Button
        type="button"
        variant="ghost"
        data-active-state={isActive ? "on" : "off"}
        role="button"
        disabled={!canToggle}
        data-disabled={!canToggle}
        tabIndex={-1}
        aria-label={label}
        aria-pressed={isActive}
        tooltip={t("Inline Math")}
        onClick={handleClick}
        {...buttonProps}
        ref={ref}
      >
        {children ?? (
          <>
            <Icon className="tiptap-button-icon" />
            {text && <span className="tiptap-button-text">{text}</span>}
            {showShortcut && (
              <LatexInlineShortcutBadge shortcutKeys={shortcutKeys} />
            )}
          </>
        )}
      </Button>
    );
  },
);

LatexInlineButton.displayName = "LatexInlineButton";
