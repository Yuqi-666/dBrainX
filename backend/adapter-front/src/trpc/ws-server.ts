// SPDX-License-Identifier: AGPL-3.0-only

import { applyWSSHandler } from "@trpc/server/adapters/ws";
import { WebSocketServer } from "ws";
import type { AppRouter } from "./router";
import type { Context } from "./server";

export interface WSServer {
  wss: InstanceType<typeof WebSocketServer>;
  handler: ReturnType<typeof applyWSSHandler<AppRouter>>;
}

export function createWSServer(
  port: number,
  router: AppRouter,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  createContext: (ctx: any) => Promise<Context> | Context,
  options: { host?: string; noServer?: boolean } = {},
): WSServer {
  const wss = new WebSocketServer(options.noServer ? { noServer: true } : { port, host: options.host });

  const handler = applyWSSHandler({
    wss,
    router,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    createContext: createContext as any,
  });

  return { wss, handler };
}

export function closeWSServer(server: WSServer): Promise<void> {
  return new Promise((resolve) => {
    server.wss.close(() => resolve());
  });
}