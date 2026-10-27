// SPDX-License-Identifier: AGPL-3.0-only

"use client";
import { useI18n } from "@workspace/ui/lib/i18n";

import { useCallback, useState } from "react";

// Tiptap Core Extensions
import type { Tone } from "@workspace/editor/lib/ai";

// Icons
import { MicAiIcon } from "@workspace/editor/components/tiptap-icons/mic-ai-icon";
import { ArrowUpIcon } from "@workspace/editor/components/tiptap-icons/arrow-up-icon";
import { AiSparklesIcon } from "@workspace/editor/components/tiptap-icons/ai-sparkles-icon";

// UI Components
import { SUPPORTED_TONES } from "@workspace/editor/components/tiptap-ui/ai-menu/ai-menu-items/ai-menu-items-constants";

// UI Primitives
import { Button } from "@workspace/editor/components/tiptap-ui-primitive/button";
import { Spacer } from "@workspace/editor/components/tiptap-ui-primitive/spacer";
import {
  Toolbar,
  ToolbarGroup,
} from "@workspace/editor/components/tiptap-ui-primitive/toolbar";
import { useComboboxValueState } from "@workspace/editor/components/tiptap-ui-primitive/menu";
import { Combobox } from "@workspace/editor/components/tiptap-ui-primitive/combobox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@workspace/editor/components/tiptap-ui-primitive/dropdown-menu";
import { TextareaAutosize } from "@workspace/editor/components/tiptap-ui-primitive/textarea-autosize";

import {
  useBlurHandler,
  useKeyboardHandlers,
} from "@workspace/editor/components/tiptap-ui/ai-menu/ai-menu-input/ai-menu-input-hooks";
import type { AiMenuInputTextareaProps } from "@workspace/editor/components/tiptap-ui/ai-menu/ai-menu-input/ai-menu-input-types";

// Styles
import "@workspace/editor/components/tiptap-ui/ai-menu/ai-menu-input/ai-menu-input.scss";

export function AiMenuInputPlaceholder({
  onPlaceholderClick,
}: {
  onPlaceholderClick: () => void;
}) {
  const { t } = useI18n();

  return (
    <div
      className="tiptap-ai-prompt-input-placeholder"
      onClick={onPlaceholderClick}
    >
      <div className="tiptap-ai-prompt-input-placeholder-content">
        <AiSparklesIcon className="tiptap-ai-prompt-input-placeholder-icon" />
        <span className="tiptap-ai-prompt-input-placeholder-text">
          {t("Tell AI what else needs to be changed...")}{" "}
        </span>
      </div>
      <Button data-style="primary" disabled>
        <ArrowUpIcon className="tiptap-button-icon" />
      </Button>
    </div>
  );
}

export function ToneSelector({
  tone,
  onToneChange,
}: {
  tone: Tone | null;
  onToneChange: (tone: string) => void;
}) {
  const { t } = useI18n();

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          data-active-state={tone ? "on" : "off"}
          role="button"
          tabIndex={-1}
          aria-label={t("Tone adjustment options")}
        >
          <MicAiIcon className="tiptap-button-icon" />
          <span className="tiptap-button-text">{t("Tone")}</span>
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start">
        <DropdownMenuGroup>
          {SUPPORTED_TONES.map((supportedTone) => (
            <DropdownMenuItem key={supportedTone.value} asChild>
              <Button
                variant="ghost"
                data-active-state={tone === supportedTone.value ? "on" : "off"}
                onClick={() => onToneChange(supportedTone.value)}
              >
                <span className="tiptap-button-text">
                  {supportedTone.label}
                </span>
              </Button>
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function AiPromptInputToolbar({
  showPlaceholder,
  onInputSubmit,
  onToneChange,
  isEmpty = false,
}: {
  showPlaceholder?: boolean;
  onInputSubmit: (prompt: string) => void;
  onToneChange?: (tone: string) => void;
  isEmpty?: boolean;
}) {
  const { t } = useI18n();

  const [tone, setTone] = useState<Tone | null>(null);
  const [promptValue] = useComboboxValueState();

  const handleToneChange = useCallback(
    (newTone: string) => {
      setTone(newTone);
      onToneChange?.(newTone);
    },
    [onToneChange],
  );

  const handleSubmit = useCallback(() => {
    onInputSubmit(promptValue);
  }, [onInputSubmit, promptValue]);

  return (
    <Toolbar
      variant="floating"
      data-plain="true"
      className="tiptap-ai-prompt-input-toolbar"
      style={{ display: showPlaceholder ? "none" : "flex" }}
    >
      <ToolbarGroup>
        <ToneSelector tone={tone} onToneChange={handleToneChange} />
      </ToolbarGroup>

      <Spacer />

      <ToolbarGroup>
        <Button
          onClick={handleSubmit}
          disabled={isEmpty}
          data-style="primary"
          aria-label={t("Submit prompt")}
        >
          <ArrowUpIcon className="tiptap-button-icon" />
        </Button>
      </ToolbarGroup>
    </Toolbar>
  );
}

export function AiMenuInputTextarea({
  onInputSubmit,
  onToneChange,
  onClose,
  onInputFocus,
  onInputBlur,
  onEmptyBlur,
  onPlaceholderClick,
  showPlaceholder = false,
  placeholder = "Ask AI what you want...",
  ...props
}: AiMenuInputTextareaProps) {
  useI18n();

  const [promptValue, setPromptValue] = useComboboxValueState();
  const [isFocused, setIsFocused] = useState(false);

  const handleSubmit = useCallback(() => {
    const cleanedPrompt = promptValue?.trim();
    if (cleanedPrompt) {
      onInputSubmit(cleanedPrompt);
      setPromptValue("");
    }
  }, [onInputSubmit, promptValue, setPromptValue]);

  const handleKeyDown = useKeyboardHandlers(promptValue, onClose, handleSubmit);

  const handleBlur = useBlurHandler(
    promptValue.trim() === "",
    onInputBlur,
    onEmptyBlur,
  );

  const handleOnPlaceholderClick = useCallback(() => {
    if (onPlaceholderClick) {
      onPlaceholderClick();
    }
  }, [onPlaceholderClick]);

  const handleFocus = useCallback(() => {
    setIsFocused(true);
    if (onInputFocus) {
      onInputFocus();
    }
  }, [onInputFocus]);

  const handleTextareaBlur = useCallback(
    (e: React.FocusEvent<HTMLTextAreaElement>) => {
      setIsFocused(false);
      handleBlur(e);
    },
    [handleBlur],
  );

  return (
    <div
      className="tiptap-ai-prompt-input"
      data-focused={isFocused}
      data-active-state={showPlaceholder ? "off" : "on"}
      {...props}
    >
      {showPlaceholder ? (
        <AiMenuInputPlaceholder onPlaceholderClick={handleOnPlaceholderClick} />
      ) : (
        <>
          <Combobox
            autoSelect="always"
            autoFocus
            render={
              <TextareaAutosize
                onChange={(e) => setPromptValue(e.target.value)}
                value={promptValue}
                onKeyDown={handleKeyDown}
                onFocus={handleFocus}
                onBlur={handleTextareaBlur}
                className="tiptap-ai-prompt-input-content"
                placeholder={placeholder}
                autoFocus
                style={{
                  display: showPlaceholder ? "none" : "flex",
                }}
              />
            }
          />

          <AiPromptInputToolbar
            showPlaceholder={showPlaceholder}
            onInputSubmit={handleSubmit}
            onToneChange={onToneChange}
            isEmpty={!promptValue?.trim()}
          />
        </>
      )}
    </div>
  );
}
