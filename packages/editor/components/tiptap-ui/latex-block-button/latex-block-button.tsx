// SPDX-License-Identifier: AGPL-3.0-only

"use client";
import { useI18n } from "@workspace/ui/lib/i18n";

import { forwardRef, useCallback } from "react";

// --- Hooks ---
import { useTiptapEditor } from "@workspace/editor/hooks/use-tiptap-editor";

// --- Lib ---
import { parseShortcutKeys } from "@workspace/editor/lib/tiptap-utils";

// --- Tiptap UI ---
import type { UseLatexBlockConfig } from "@workspace/editor/components/tiptap-ui/latex-block-button";
import {
  LATEX_BLOCK_SHORTCUT_KEY,
  useLatexBlock,
} from "@workspace/editor/components/tiptap-ui/latex-block-button";

// --- UI Primitives ---
import type { ButtonProps } from "@workspace/editor/components/tiptap-ui-primitive/button";
import { Button } from "@workspace/editor/components/tiptap-ui-primitive/button";
import { Badge } from "@workspace/editor/components/tiptap-ui-primitive/badge";

export interface LatexBlockButtonProps
  extends Omit<ButtonProps, "type">, UseLatexBlockConfig {
  text?: string;
  showShortcut?: boolean;
}

export function LatexBlockShortcutBadge({
  shortcutKeys = LATEX_BLOCK_SHORTCUT_KEY,
}: {
  shortcutKeys?: string;
}) {
  useI18n();

  return <Badge>{parseShortcutKeys({ shortcutKeys })}</Badge>;
}

/**
 * Button component for toggling latex block in a Tiptap editor.
 */
export const LatexBlockButton = forwardRef<
  HTMLButtonElement,
  LatexBlockButtonProps
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
    } = useLatexBlock({
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
        tooltip={t("Math Block")}
        onClick={handleClick}
        {...buttonProps}
        ref={ref}
      >
        {children ?? (
          <>
            <Icon className="tiptap-button-icon" />
            {text && <span className="tiptap-button-text">{text}</span>}
            {showShortcut && (
              <LatexBlockShortcutBadge shortcutKeys={shortcutKeys} />
            )}
          </>
        )}
      </Button>
    );
  },
);

LatexBlockButton.displayName = "LatexBlockButton";
