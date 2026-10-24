// SPDX-License-Identifier: AGPL-3.0-only

import { createServer, request as httpRequest } from "node:http";
import {
  AppContainer,
  createWSServer,
  createContext,
  appRouter,
} from "@workspace/adapter-front";
import { verifyToken } from "@workspace/infrastructure";
import { allowedFileRequest } from "./desktop/security";
import { TRPC_PATH, sameOrigin } from "./origin";
import {
  handleUploadRequest,
  isUploadPath,
  startUploadSweeper,
} from "./upload/routes";

const PORT = Number(process.env.PORT ?? 3001);
const PB_URL = process.env.PB_URL ?? "http://127.0.0.1:8090";
const publicOrigin = process.env.DBRAINX_PUBLIC_ORIGIN;
function cookieToken(cookie = ""): string {
  try {
    return decodeURIComponent(
      cookie.match(/(?:^|;\s*)pb_token=([^;]+)/)?.[1] ?? "",
    );
  } catch {
    return "";
  }
}
async function databaseReady(): Promise<boolean> {
  try {
    return (
      await fetch(`${PB_URL}/api/health`, { signal: AbortSignal.timeout(3000) })
    ).ok;
  } catch {
    return false;
  }
}
async function main() {
  if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535)
    throw new Error("Invalid PORT");
  for (let attempt = 0; !(await databaseReady()); attempt++) {
    if (attempt >= 30) throw new Error("PocketBase did not become ready");
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  await AppContainer.initialize(PB_URL);
  // Sessions outlive the request that opened them, so something has to collect
  // the abandoned ones.
  startUploadSweeper(() => AppContainer.getInstance().uploadCommandService);
  const server = createServer((req, res) => {
    if (req.url === "/health" && req.method === "GET") {
      void databaseReady().then((ready) =>
        res
          .writeHead(ready ? 200 : 503, { "Content-Type": "application/json" })
          .end(JSON.stringify({ ready })),
      );
      return;
    }
    // Two shapes reach these routes. The container proxy (and `pnpm dev:remote`)
    // forwards the PocketBase prefix, `/pb/upload/...`; a browser in split
    // development talks to this listener directly, `/upload/...`. Only the
    // upload subtree is admitted without the prefix — the file gateway keeps its
    // `/pb/` contract, so a bare `/api/files/...` on this port still 404s.
    const raw = req.url ?? "";
    const prefixed = raw.startsWith("/pb/") ? raw.slice(3) : "";
    const path = prefixed || (isUploadPath(raw) ? raw : "");
    if (!allowedFileRequest(path, req.method) && !isUploadPath(path)) {
      res.writeHead(404).end();
      return;
    }
    if (!sameOrigin(req.headers.origin, req.headers.host, publicOrigin)) {
      res.writeHead(403).end();
      return;
    }
    if (isUploadPath(path)) {
      // The chunked upload path is served here, not proxied to PocketBase: the
      // chunks are spooled on this host and only the assembled file is stored.
      void handleUploadRequest(req, res, path, {
        service: () => AppContainer.getInstance().uploadCommandService,
        authenticate: async (request) => {
          const token =
            request.headers.authorization || cookieToken(request.headers.cookie);
          try {
            return { ownerId: await verifyToken(token), token };
          } catch {
            return null;
          }
        },
      });
      return;
    }
    const token = req.headers.authorization || cookieToken(req.headers.cookie);
    void verifyToken(token)
      .then(() => {
        // Never proxy administration, arbitrary URLs, client cookies or forwarding headers.
        const headers: Record<string, string> = { Authorization: token };
        for (const key of [
          "content-type",
          "content-length",
          "range",
          "if-none-match",
          "if-modified-since",
        ]) {
          const value = req.headers[key];
          if (typeof value === "string") headers[key] = value;
        }
        const upstream = httpRequest(
          new URL(path, PB_URL),
          { method: req.method, headers },
          (response) => {
            res.setHeader("Cache-Control", "private, no-store");
            res.setHeader("X-Content-Type-Options", "nosniff");
            for (const key of [
              "content-type",
              "content-length",
              "content-range",
              "accept-ranges",
              "etag",
              "last-modified",
            ]) {
              const value = response.headers[key];
              if (value !== undefined) res.setHeader(key, value);
            }
            res.writeHead(response.statusCode ?? 502);
            response.pipe(res);
            response.once("error", () => res.destroy());
          },
        );
        upstream.setTimeout(120000, () =>
          upstream.destroy(new Error("File gateway timeout")),
        );
        upstream.once("error", () => {
          if (!res.headersSent) res.writeHead(502);
          res.end();
        });
        req.once("aborted", () => upstream.destroy());
        req.pipe(upstream);
      })
      .catch(() => res.writeHead(401).end());
  });
  const { wss, handler } = createWSServer(0, appRouter, createContext, {
    noServer: true,
  });
  server.on("upgrade", (req, socket, head) => {
    if (
      req.url?.split("?")[0] !== TRPC_PATH ||
      !sameOrigin(req.headers.origin, req.headers.host, publicOrigin)
    ) {
      socket.end("HTTP/1.1 403 Forbidden\r\n\r\n");
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) =>
      wss.emit("connection", ws, req),
    );
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(PORT, "0.0.0.0", resolve);
  });
  console.log(`[server] ready on port ${PORT}`);
  let stopping = false;
  const shutdown = () => {
    if (stopping) return;
    stopping = true;
    handler.broadcastReconnectNotification();
    wss.clients.forEach((client) => client.close(1001));
    const deadline = setTimeout(() => {
      wss.clients.forEach((client) => client.terminate());
      process.exit(1);
    }, 5000);
    wss.close(() =>
      server.close(() => {
        clearTimeout(deadline);
        process.exit(0);
      }),
    );
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
main().catch((error) => {
  console.error("[server] startup failed", error);
  process.exit(1);
});
