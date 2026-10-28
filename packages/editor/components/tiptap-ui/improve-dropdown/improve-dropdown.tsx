// SPDX-License-Identifier: AGPL-3.0-only

"use client";
import { useI18n } from "@workspace/ui/lib/i18n";

import { type Editor } from "@tiptap/react";

// --- Hooks ---
import { useImproveDropdown } from "@workspace/editor/components/tiptap-ui/improve-dropdown";

// --- Lib ---
import { AI_UNAVAILABLE_NOTICE } from "@workspace/editor/lib/ai";

// --- Icons ---
import { AiSparklesIcon } from "@workspace/editor/components/tiptap-icons/ai-sparkles-icon";

// --- UI Primitives ---
import type { ButtonProps } from "@workspace/editor/components/tiptap-ui-primitive/button";
import { Button } from "@workspace/editor/components/tiptap-ui-primitive/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
} from "@workspace/editor/components/tiptap-ui-primitive/dropdown-menu";

import "@workspace/editor/components/tiptap-ui/ai-menu/ai-notice.scss";

export interface ImproveDropdownProps extends Omit<ButtonProps, "type"> {
  /**
   * Optional editor instance. If not provided, will use editor from context
   */
  editor?: Editor;
  /**
   * Whether to hide the dropdown when AI features are not available
   * @default false
   */
  hideWhenUnavailable?: boolean;
  /**
   * Whether the dropdown should use a modal
   */
  modal?: boolean;
}

/**
 * The AI entry point that sits in the toolbars. It keeps its place, icon and
 * label, and opens onto a single line stating that AI is unavailable — the
 * release has no AI backend, so the action list it used to render could only
 * ever insert placeholder text.
 */
export function ImproveDropdown({
  editor: providedEditor,
  hideWhenUnavailable = false,
  modal = true,
  ...props
}: ImproveDropdownProps) {
  const { t } = useI18n();

  const { isVisible, isDisabled, isOpen, handleOpenChange } =
    useImproveDropdown({
      editor: providedEditor,
      hideWhenUnavailable,
    });

  if (!isVisible) {
    return null;
  }

  return (
    <DropdownMenu modal={modal} open={isOpen} onOpenChange={handleOpenChange}>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          disabled={isDisabled}
          data-disabled={isDisabled}
          role="button"
          tabIndex={-1}
          aria-label={t("Improve")}
          tooltip={t("Improve")}
          {...props}
        >
          <AiSparklesIcon className="tiptap-button-icon" />
          <span className="tiptap-button-text">{t("Improve")}</span>
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start">
        <div className="tiptap-ai-unavailable" role="status">
          <AiSparklesIcon className="tiptap-button-icon" />
          <span className="tiptap-button-text">{AI_UNAVAILABLE_NOTICE}</span>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default ImproveDropdown;
