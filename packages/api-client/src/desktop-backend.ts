// SPDX-License-Identifier: AGPL-3.0-only

import { createPocketbaseClient, resetPocketbaseClient } from "./pocketbase-client";

export interface DesktopBackend {
  trpc: string;
  pocketbase: string;
  token: string;
  dataDir: string;
}

let backend: DesktopBackend | undefined;
let initializing: Promise<DesktopBackend> | undefined;

export function getDesktopBackend(): DesktopBackend {
  if (!backend) throw new Error("本地后端尚未启动");
  return backend;
}

/** Gate rendering and all API calls until the native supervisor reports readiness. */
export function initializeDesktopBackend(retry = false): Promise<DesktopBackend> {
  if (retry) initializing = undefined;
  initializing ??= (async () => {
    const native = (window as unknown as {
      __TAURI__?: { core: { invoke<T>(command: string): Promise<T> } };
    }).__TAURI__;
    if (!native) throw new Error("请通过 Desktop 应用启动，本地后端需要 Tauri 运行环境。");
    // Tauri rejects a command with the plain string the native supervisor
    // returned. Keep it as an Error: the caller would otherwise fall back to the
    // generic message and hide the log path that names the actual failure.
    const result = await native.core
      .invoke<DesktopBackend>("start_local_backend")
      .catch((error: unknown) => {
        throw error instanceof Error ? error : new Error(String(error));
      });
    const session = await fetch(`${result.pocketbase}/session`, { method: "POST", signal: AbortSignal.timeout(5000) });
    if (!session.ok) throw new Error("本地身份初始化失败");
    result.token = (await session.json() as { token: string }).token;
    resetPocketbaseClient();
    const pb = createPocketbaseClient({ url: result.pocketbase });
    pb.authStore.save(result.token);
    backend = result;
    return result;
  })().catch((error) => {
    initializing = undefined;
    throw error;
  });
  return initializing;
}

/** Refresh the device-local session without requiring a cloud login. */
export async function refreshDesktopSession(): Promise<void> {
  const current = getDesktopBackend();
  const response = await fetch(`${current.pocketbase}/session`, { method: "POST", signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error("本地会话刷新失败");
  const { token } = await response.json() as { token: string };
  current.token = token;
  createPocketbaseClient({ url: current.pocketbase }).authStore.save(token);
}
