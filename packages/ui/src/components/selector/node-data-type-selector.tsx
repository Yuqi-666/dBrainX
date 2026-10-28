// SPDX-License-Identifier: AGPL-3.0-only

"use client";
import { NODE_TYPE_LABELS } from "@workspace/ui/lib/node-type-labels";
import { useI18n } from "@workspace/ui/lib/i18n";

import type { ReactNode } from "react";
import {
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@workspace/ui/components/ui/dropdown-menu";
import type { NodeDataType } from "@workspace/interfaces";
import { NODE_DATA_TYPES } from "@workspace/interfaces";

export { NODE_TYPE_LABELS } from "@workspace/ui/lib/node-type-labels";

export interface NodeDataTypeSelectorProps {
  children: (nodeType: NodeDataType) => ReactNode;
}

/** Node data-type picker with nested selectors supplied by the host. */
export function NodeDataTypeSelector({ children }: NodeDataTypeSelectorProps) {
  useI18n();

  return (
    <DropdownMenuSubContent className="w-48" sideOffset={0} alignOffset={0}>
      {NODE_DATA_TYPES.map((type) => (
        <DropdownMenuSub key={type}>
          <DropdownMenuSubTrigger className="flex items-center gap-2 px-2 py-1.5 cursor-pointer hover:bg-accent hover:text-accent-foreground rounded-md [&>svg]:hidden">
            <span>{NODE_TYPE_LABELS[type] || type}</span>
          </DropdownMenuSubTrigger>
          {children(type)}
        </DropdownMenuSub>
      ))}
    </DropdownMenuSubContent>
  );
}
