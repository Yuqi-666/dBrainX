// SPDX-License-Identifier: AGPL-3.0-only

"use client";

import type { ReactNode } from "react";
import { FileDropZone } from "@workspace/ui/components/node-content/file-drop-zone";

export interface SelectorUploadPaneProps {
  nodeId: string;
  /** Which display field the upload lands in. */
  variant: "icon" | "cover";
  /** Defaults to `image/*`. */
  accept?: string;
  onUploadStart?: () => void;
  /** Fired after a successful upload; the url is written by `FileDropZone`. */
  onUploaded?: () => void;
  /** Upload failure bubbles here — the pane must not write or clear the value. */
  onError?: (error: Error) => void;
  className?: string;
}

export function SelectorUploadPane({
  nodeId,
  variant,
  accept = "image/*",
  onUploadStart,
  onUploaded,
  onError,
  className,
}: SelectorUploadPaneProps): ReactNode {
  return (
    <FileDropZone
      nodeId={nodeId}
      variant={variant}
      accept={accept}
      onUploadStart={onUploadStart}
      onUploaded={onUploaded}
      onUploadError={onError}
      className={className}
    />
  );
}
