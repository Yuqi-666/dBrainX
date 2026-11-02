// SPDX-License-Identifier: AGPL-3.0-only

import { useWorkspaceStore } from "@workspace/store";

/**
 * The workspace this browser session is working in.
 *
 * `useWorkspaceStore` is the one source the client already keeps
 * (`packages/store/src/workspaceStore.ts`), so the WebSocket handshake and the
 * upload requests cannot disagree about which workspace is active.
 */
export function activeWorkspaceId(): string | undefined {
  const id = useWorkspaceStore.getState().currentWorkspaceId;
  const trimmed = id?.trim();
  return trimmed ? trimmed : undefined;
}
