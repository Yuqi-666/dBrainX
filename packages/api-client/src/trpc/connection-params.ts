// SPDX-License-Identifier: AGPL-3.0-only

/**
 * What the one WebSocket connection tells the server at handshake time.
 *
 * These parameters are the only place a write names its workspace: the server
 * refuses `operation.invoke` on a connection without `x-workspace-id`
 * (`operationCallContextOf` in `backend/adapter-front/src/trpc/router/`), and
 * never reads a workspace from a request body. The key is the one
 * `backend/adapter-front/src/trpc/workspace-context.ts` reads
 * (`WORKSPACE_HEADER`) from the connection parameters, and the value must be a
 * workspace the caller belongs to: membership is checked when the connection
 * is created.
 */
export const WORKSPACE_HEADER = "x-workspace-id";

export interface TRPCConnectionParams {
  [key: string]: string | undefined;
  token?: string;
  sourceId: string;
  "x-workspace-id"?: string;
}

/** The handshake object; an inactive workspace leaves the key out entirely. */
export function connectionParamsOf(input: {
  token?: string;
  sourceId: string;
  workspaceId?: string | null;
}): TRPCConnectionParams {
  const params: TRPCConnectionParams = { sourceId: input.sourceId };
  if (input.token) {
    params.token = input.token;
  }
  const workspaceId = input.workspaceId?.trim();
  if (workspaceId) {
    params[WORKSPACE_HEADER] = workspaceId;
  }
  return params;
}
