// SPDX-License-Identifier: AGPL-3.0-only

"use client";
import { useI18n } from "@workspace/ui/lib/i18n";

import { forwardRef, useCallback } from "react";

// --- Lib ---
import { parseShortcutKeys } from "@workspace/editor/lib/tiptap-utils";

// --- Hooks ---
import { useTiptapEditor } from "@workspace/editor/hooks/use-tiptap-editor";

// --- Tiptap UI ---
import type { UseDeleteNodeConfig } from "@workspace/editor/components/tiptap-ui/delete-node-button";
import {
  DELETE_NODE_SHORTCUT_KEY,
  useDeleteNode,
} from "@workspace/editor/components/tiptap-ui/delete-node-button";

// --- UI Primitives ---
import type { ButtonProps } from "@workspace/editor/components/tiptap-ui-primitive/button";
import { Button } from "@workspace/editor/components/tiptap-ui-primitive/button";
import { Badge } from "@workspace/editor/components/tiptap-ui-primitive/badge";

export interface DeleteNodeButtonProps
  extends Omit<ButtonProps, "type">, UseDeleteNodeConfig {
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

export function DeleteNodeShortcutBadge({
  shortcutKeys = DELETE_NODE_SHORTCUT_KEY,
}: {
  shortcutKeys?: string;
}) {
  useI18n();

  return <Badge>{parseShortcutKeys({ shortcutKeys })}</Badge>;
}

/**
 * Button component for deleting a node in a Tiptap editor.
 *
 * For custom button implementations, use the `useDeleteNode` hook instead.
 */
export const DeleteNodeButton = forwardRef<
  HTMLButtonElement,
  DeleteNodeButtonProps
>(
  (
    {
      editor: providedEditor,
      text,
      hideWhenUnavailable = false,
      onDeleted,
      showShortcut = false,
      onClick,
      children,
      ...buttonProps
    },
    ref,
  ) => {
    const { t } = useI18n();

    const { editor } = useTiptapEditor(providedEditor);
    const { isVisible, handleDeleteNode, label, shortcutKeys, Icon } =
      useDeleteNode({
        editor,
        hideWhenUnavailable,
        onDeleted,
      });

    const handleClick = useCallback(
      (event: React.MouseEvent<HTMLButtonElement>) => {
        onClick?.(event);
        if (event.defaultPrevented) return;
        handleDeleteNode();
      },
      [handleDeleteNode, onClick],
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
        aria-label={label}
        tooltip={t("Delete")}
        onClick={handleClick}
        {...buttonProps}
        ref={ref}
      >
        {children ?? (
          <>
            <Icon className="tiptap-button-icon" />
            {text && <span className="tiptap-button-text">{text}</span>}
            {showShortcut && (
              <DeleteNodeShortcutBadge shortcutKeys={shortcutKeys} />
            )}
          </>
        )}
      </Button>
    );
  },
);

DeleteNodeButton.displayName = "DeleteNodeButton";
