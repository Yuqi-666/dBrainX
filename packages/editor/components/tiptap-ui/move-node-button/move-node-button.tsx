// SPDX-License-Identifier: AGPL-3.0-only

"use client";
import { useI18n } from "@workspace/ui/lib/i18n";

import { forwardRef, useCallback } from "react";

// --- Lib ---
import { parseShortcutKeys } from "@workspace/editor/lib/tiptap-utils";

// --- Hooks ---
import { useTiptapEditor } from "@workspace/editor/hooks/use-tiptap-editor";

// --- Tiptap UI ---
import type { UseMoveNodeConfig } from "@workspace/editor/components/tiptap-ui/move-node-button";
import { useMoveNode } from "@workspace/editor/components/tiptap-ui/move-node-button";

// --- UI Primitives ---
import type { ButtonProps } from "@workspace/editor/components/tiptap-ui-primitive/button";
import { Button } from "@workspace/editor/components/tiptap-ui-primitive/button";
import { Badge } from "@workspace/editor/components/tiptap-ui-primitive/badge";

export interface MoveNodeButtonProps
  extends Omit<ButtonProps, "type">, UseMoveNodeConfig {
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

export function MoveNodeShortcutBadge({
  shortcutKeys,
}: {
  shortcutKeys: string;
}) {
  useI18n();

  return <Badge>{parseShortcutKeys({ shortcutKeys })}</Badge>;
}

/**
 * Button component for moving a node up or down in a Tiptap editor.
 */
export const MoveNodeButton = forwardRef<
  HTMLButtonElement,
  MoveNodeButtonProps
>(
  (
    {
      editor: providedEditor,
      text,
      direction,
      hideWhenUnavailable = false,
      onMoved,
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
      handleMoveNode,
      canMoveNode,
      label,
      shortcutKeys,
      Icon,
    } = useMoveNode({
      editor,
      direction,
      hideWhenUnavailable,
      onMoved,
    });

    const handleClick = useCallback(
      (event: React.MouseEvent<HTMLButtonElement>) => {
        onClick?.(event);
        if (event.defaultPrevented) return;
        handleMoveNode();
      },
      [handleMoveNode, onClick],
    );

    if (!isVisible) {
      return null;
    }

    const tooltip = direction === "up" ? t("Move Up") : t("Move Down");

    return (
      <Button
        type="button"
        variant="ghost"
        role="button"
        tabIndex={-1}
        aria-label={label}
        tooltip={tooltip}
        disabled={!canMoveNode}
        onClick={handleClick}
        {...buttonProps}
        ref={ref}
      >
        {children ?? (
          <>
            <Icon className="tiptap-button-icon" />
            {text && <span className="tiptap-button-text">{text}</span>}
            {showShortcut && (
              <MoveNodeShortcutBadge shortcutKeys={shortcutKeys} />
            )}
          </>
        )}
      </Button>
    );
  },
);

MoveNodeButton.displayName = "MoveNodeButton";
