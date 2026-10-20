// SPDX-License-Identifier: AGPL-3.0-only

"use client";
import { useI18n } from "@workspace/ui/lib/i18n";

import { useRef } from "react";
import type { ReactNode } from "react";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@workspace/ui/components/ui/input-group";
import { LinkIcon } from "lucide-react";
import { cn } from "@workspace/ui/lib/utils";

export interface SelectorUrlInputProps {
  /** Fully controlled: the owner keeps the draft so it can clear it after a commit. */
  value: string;
  onValueChange: (value: string) => void;
  onSubmit: (url: string) => void;
  /** Defaults to the design's `Or add via URL`. */
  placeholder?: string;
  disabled?: boolean;
  /** When given, the row shows it and refuses to submit. */
  invalidReason?: string;
  className?: string;
}

export function SelectorUrlInput({
  value,
  onValueChange,
  onSubmit,
  placeholder = "Or add via URL",
  disabled,
  invalidReason,
  className,
}: SelectorUrlInputProps): ReactNode {
  const { t } = useI18n();

  /**
   * The value of the last commit. An `Enter` usually closes the popover, whose
   * unmount blurs the input — without this the blur would submit the same URL a
   * second time (sel §7: URL 只提交一次). Editing the draft re-arms it.
   */
  const submittedRef = useRef<string | null>(null);

  const url = value.trim();
  /** sel §6.3's 轻量校验: an internal space is the one malformed case P0 detects. */
  const malformed = /\s/.test(url);
  const canSubmit = !disabled && !invalidReason && url.length > 0 && !malformed;

  const submit = () => {
    if (!canSubmit || submittedRef.current === url) return;
    submittedRef.current = url;
    onSubmit(url);
  };

  return (
    <div className={cn("p-1", className)}>
      <InputGroup>
        <InputGroupAddon>
          <LinkIcon className="size-4 shrink-0 opacity-50" />
        </InputGroupAddon>
        <InputGroupInput
          value={value}
          placeholder={placeholder}
          disabled={disabled}
          spellCheck={false}
          autoComplete="off"
          aria-invalid={invalidReason || malformed ? true : undefined}
          onChange={(event) => {
            // Draft only — the owner holds the text and no request is sent until
            // the commit paths below run.
            submittedRef.current = null;
            onValueChange(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            submit();
          }}
          onBlur={(event) => {
            // Only commit when focus actually leaves the row: moving to the 添加
            // button inside the same group must not submit twice.
            if (event.currentTarget.contains(event.relatedTarget)) return;
            submit();
          }}
        />
        <InputGroupButton
          type="button"
          size="sm"
          disabled={!canSubmit}
          onClick={submit}
        >
          {t("添加")}{" "}
        </InputGroupButton>
      </InputGroup>
      {invalidReason ? (
        <p className="px-1 pt-1 text-xs text-destructive">{invalidReason}</p>
      ) : null}
    </div>
  );
}
