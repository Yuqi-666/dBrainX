// SPDX-License-Identifier: AGPL-3.0-only

"use client";
import { ColorPicker } from "@workspace/ui/components/selector/color-picker";

import { useI18n } from "@workspace/ui/lib/i18n";

/**
 * 编辑选项 — the lane header's rename / recolour popover.
 *
 * A lane *is* an option of the group field, so editing a lane means editing that
 * option. Only `name` and `color` are offered: both are inert with respect to
 * the rows, because cells store the option **id** — so the editor can report the
 * whole field list through `onFieldsChange(fields)` without touching a single
 * cell. Deleting an option is deliberately absent: `DatabaseContent` rejects a
 * cell that references an option its field does not declare, so a delete has to
 * rewrite the affected rows, and that is a table-level operation.
 *
 * The popover is mounted per open (Radix unmounts its content), so the draft
 * state below re-seeds from the lane every time it opens. Focus is taken in an
 * effect rather than with `autoFocus`: Radix focuses the popover's own content
 * when it opens, and a child effect is the first place that wins the race.
 */
import { useEffect, useRef, useState } from "react";
import { Check } from "lucide-react";
import { Button } from "@workspace/ui/components/ui/button";
import { Input } from "@workspace/ui/components/ui/input";

export interface LaneOptionEditorProps {
  /** The option's current name. */
  name: string;
  /** The option's resolved colour (declared, or the palette fallback). */
  color: string;
  onSave: (patch: { name: string; color?: string }) => void;
}

export function LaneOptionEditor({
  name,
  color,
  onSave,
}: LaneOptionEditorProps) {
  const { t } = useI18n();

  const [draftName, setDraftName] = useState(name);
  // `null` = "no declared colour" (fall back to the palette), `undefined` =
  // "untouched by this edit".
  const [draftColor, setDraftColor] = useState<string | null | undefined>(
    undefined,
  );
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const trimmed = draftName.trim();
  const canSave =
    trimmed.length > 0 && (trimmed !== name || draftColor !== undefined);
  // `null` means "use the palette fallback again", which is what the swatch
  // ring compares against.
  const effectiveColor = draftColor ?? color;

  const save = () => {
    if (!canSave) return;
    // An explicit `undefined` colour drops the key, which is what makes the
    // palette fallback apply again; `""` would persist as a transparent swatch.
    onSave(
      draftColor !== undefined
        ? { name: trimmed, color: draftColor ?? undefined }
        : { name: trimmed },
    );
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="kanban-option-name"
          className="text-[11px] font-medium text-muted-foreground"
        >
          {t("选项名称")}{" "}
        </label>
        <Input
          id="kanban-option-name"
          ref={inputRef}
          value={draftName}
          className="h-7 text-xs"
          onChange={(event) => setDraftName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") save();
          }}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-[11px] font-medium text-muted-foreground">
          {t("颜色")}{" "}
        </span>
        <ColorPicker
          className="rounded-xl border border-border/60 p-2"
          value={draftColor === null ? undefined : effectiveColor}
          onChange={setDraftColor}
          onClear={() => setDraftColor(null)}
        />
      </div>

      <Button
        type="button"
        size="sm"
        className="h-7 gap-1 self-end px-2 text-xs"
        disabled={!canSave}
        onClick={save}
      >
        <Check className="size-3.5" />
        {t("保存")}{" "}
      </Button>
    </div>
  );
}
