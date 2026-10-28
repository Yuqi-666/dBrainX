// SPDX-License-Identifier: AGPL-3.0-only

"use client";

/** VTable owns cell positioning; React renders the shared shadcn controls. */
import type { ColumnDefine } from "@visactor/vtable";
import { TableDateEditor, TableInputEditor } from "./shadcn-editors";
import type { DatabaseField } from "@workspace/interfaces";

/**
 * The editor instance a field edits with, or `undefined` when the field is
 * edited by its own cell type (`checkbox`) or by the view's own dropdown
 * (单选 / 多选).
 */
export function createTableEditor(
  field: DatabaseField,
): ColumnDefine["editor"] | undefined {
  switch (field.type) {
    case "text":
    case "number":
    case "url":
      return new TableInputEditor();
    case "date":
      return new TableDateEditor(field.includeTime);
    case "select":
    case "multiSelect":
    case "checkbox":
    case "relation":
      return undefined;
  }
}
