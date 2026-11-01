// SPDX-License-Identifier: AGPL-3.0-only

"use client";
import { resolveNodeTypeLabel } from "@workspace/ui/lib/node-type-display";
import { useI18n } from "@workspace/ui/lib/i18n";

import type { ReactNode } from "react";
import {
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@workspace/ui/components/ui/dropdown-menu";
import type { NodeTypeId } from "@workspace/interfaces";
import { listNodeTypeIds } from "@workspace/ui/lib/node-type-options";

export interface NodeDataTypeSelectorProps {
  children: (nodeType: NodeTypeId) => ReactNode;
}

/** Node data-type picker with nested selectors supplied by the host. */
export function NodeDataTypeSelector({ children }: NodeDataTypeSelectorProps) {
  useI18n();

  return (
    <DropdownMenuSubContent className="w-48" sideOffset={0} alignOffset={0}>
      {listNodeTypeIds().map((type) => (
        <DropdownMenuSub key={type}>
          <DropdownMenuSubTrigger className="flex items-center gap-2 px-2 py-1.5 cursor-pointer hover:bg-accent hover:text-accent-foreground rounded-md [&>svg]:hidden">
            <span>{resolveNodeTypeLabel(type)}</span>
          </DropdownMenuSubTrigger>
          {children(type)}
        </DropdownMenuSub>
      ))}
    </DropdownMenuSubContent>
  );
}
