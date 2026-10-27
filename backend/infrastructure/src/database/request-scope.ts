// SPDX-License-Identifier: AGPL-3.0-only

import { AsyncLocalStorage } from "node:async_hooks";
const tokens = new AsyncLocalStorage<string>();
export function runWithToken<T>(token: string | undefined, work: () => T): T {
  return tokens.run(token ?? "", work);
}
export function requestToken(): string {
  return tokens.getStore() ?? "";
}

const fileWorkspaces = new AsyncLocalStorage<string>();
export function runWithFileWorkspace<T>(workspaceId: string, work: () => T): T {
  return fileWorkspaces.run(workspaceId, work);
}
export function fileWorkspace(): string {
  return fileWorkspaces.getStore() ?? "";
}
