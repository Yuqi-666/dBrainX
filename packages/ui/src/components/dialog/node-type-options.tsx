// SPDX-License-Identifier: AGPL-3.0-only

"use client";
import type { NodeTypeId } from "@workspace/interfaces";
import { Button } from "../ui/button";
import { resolveNodeTypeLabel } from "@workspace/ui/lib/node-type-display";

export interface NodeTypeOptionsProps {
  nodeTypes: readonly NodeTypeId[];
  emptyLabel: string;
  onSelect: (nodeType: NodeTypeId) => void;
}

/**
 * The add-node dialog's type list, split out of the dialog so it renders without
 * a store, an i18n provider or the dialog shell: one row per registered type,
 * and a visible message where a list would be when no plugin registered one.
 */
export function NodeTypeOptions({
  nodeTypes,
  emptyLabel,
  onSelect,
}: NodeTypeOptionsProps) {
  if (nodeTypes.length === 0) {
    return (
      <p
        data-node-type-options-empty=""
        className="px-2 py-1.5 text-xs text-muted-foreground"
      >
        {emptyLabel}
      </p>
    );
  }

  return (
    <>
      {nodeTypes.map((type) => (
        <Button
          key={type}
          variant="ghost"
          className="w-full justify-start"
          onClick={() => onSelect(type)}
        >
          {resolveNodeTypeLabel(type)}
        </Button>
      ))}
    </>
  );
}
