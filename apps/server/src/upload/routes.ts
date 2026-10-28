// SPDX-License-Identifier: AGPL-3.0-only

import type { IncomingMessage, ServerResponse } from "node:http";
import {
  UPLOAD_BASE_PATH,
  UPLOAD_CHUNK_BYTES,
  parseUploadRoute,
} from "@workspace/utils/upload";
import type { UploadCommandService } from "@workspace/application";
import { UploadError } from "@workspace/application";
import type {
  CreateUploadSessionRequest,
  UploadErrorResponse,
} from "@workspace/interfaces";
import { runWithToken } from "@workspace/infrastructure";

/**
 * HTTP routes of the resumable upload path.
 *
 * The client PUTs one chunk per request and then asks for the assembly, which
 * is why this lives on the API listener and not on tRPC: a chunk body is
 * streamed straight to disk, while the WebSocket transport would have to
 * serialise it first.
 *
 * The same handler serves both listeners:
 *
 * - `apps/server` on `/pb/upload/…` (dev: directly on `:3001`;
 *   container: nginx forwards every `/pb/` request to the API)
 * - the desktop runtime on `/session/<secret>/upload/…`
 *
 * The caller owns origin admission and identity: it must have rejected an
 * unknown origin *before* calling here (that is what makes echoing the request
 * origin in the CORS headers safe), and it must resolve the identity itself,
 * because the two listeners authenticate differently.
 */

/** One authenticated caller. */
export interface UploadIdentity {
  /** Verified user; every session is scoped to it. */
  ownerId: string;
  /** PocketBase token used for the store write, carried through the call. */
  token: string;
}

export interface UploadRouteContext {
  /** The application service, resolved lazily once the container exists. */
  service: () => UploadCommandService;
  /** Verified identity, or `null` when the request must be rejected with 401. */
  authenticate: (req: IncomingMessage) => Promise<UploadIdentity | null>;
}

/** Whether this listener owns the path (the whole `/upload` subtree is ours). */
export function isUploadPath(path: string): boolean {
  const pathname = path.split("?")[0] ?? "";
  return pathname === UPLOAD_BASE_PATH || pathname.startsWith(`${UPLOAD_BASE_PATH}/`);
}

/** Largest JSON body a session call may carry. */
const MAX_SESSION_BODY_BYTES = 64 * 1024;

export async function handleUploadRequest(
  req: IncomingMessage,
  res: ServerResponse,
  url: string,
  context: UploadRouteContext,
): Promise<void> {
  // A split development setup has the browser on the web port and this listener
  // on the API port, so an upload is a cross-origin request there. The caller
  // already admitted the origin; echoing it is what lets the browser read the
  // response and send the preflight for `PUT`.
  const origin = req.headers.origin;
  if (typeof origin === "string" && origin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
    res.setHeader("Access-Control-Max-Age", "600");
    res.writeHead(204).end();
    return;
  }

  const route = parseUploadRoute(url);

  let identity: UploadIdentity | null;
  try {
    identity = await context.authenticate(req);
  } catch {
    identity = null;
  }
  if (!identity) {
    sendJson(res, 401, { message: "Authentication required" });
    return;
  }

  const service = context.service();
  const withIdentity = <T>(work: () => T): T => runWithToken(identity.token, work);

  try {
    switch (route.kind) {
      case "sessions": {
        if (req.method !== "POST") return methodNotAllowed(res, "POST");
        const body = await readJson<CreateUploadSessionRequest>(req);
        sendJson(
          res,
          201,
          await withIdentity(() =>
            service.start({
              ownerId: identity.ownerId,
              fileName: asString(body.fileName),
              fileSize: Number(body.fileSize),
              contentType: asString(body.contentType),
              workspaceId: asString(body.workspaceId),
              fingerprint: asString(body.fingerprint),
            }),
          ),
        );
        return;
      }

      case "session": {
        const ref = { ownerId: identity.ownerId, uploadId: route.uploadId };
        if (req.method === "GET") {
          sendJson(res, 200, await withIdentity(() => service.status(ref)));
          return;
        }
        if (req.method === "DELETE") {
          await withIdentity(() => service.abort(ref));
          res.writeHead(204).end();
          return;
        }
        return methodNotAllowed(res, "GET, DELETE");
      }

      case "part": {
        if (req.method !== "PUT") return methodNotAllowed(res, "PUT");
        const declared = Number(req.headers["content-length"]);
        if (!Number.isSafeInteger(declared) || declared <= 0) {
          // A chunked-encoding body has no length to validate against the
          // position's expected size, and every client here knows the size.
          sendJson(res, 411, { message: "A chunk must declare its Content-Length" });
          return;
        }
        if (declared > UPLOAD_CHUNK_BYTES) {
          sendJson(res, 413, {
            message: `A chunk may not exceed ${UPLOAD_CHUNK_BYTES} bytes`,
          });
          return;
        }
        sendJson(
          res,
          200,
          await withIdentity(() =>
            service.writePart({
              ownerId: identity.ownerId,
              uploadId: route.uploadId,
              index: route.index,
              bytes: declared,
              // `req` is an async iterable of buffers: the part is streamed to
              // the spool, never collected here.
              data: req,
            }),
          ),
        );
        return;
      }

      case "complete": {
        if (req.method !== "POST") return methodNotAllowed(res, "POST");
        const ref = { ownerId: identity.ownerId, uploadId: route.uploadId };
        const session = await withIdentity(() => service.complete(ref));
        sendJson(res, 202, session);
        if (session.status === "assembling") {
          // Detached on purpose: assembling up to 2 GiB and storing it takes
          // longer than any proxy will wait for a response, and it must survive
          // the browser closing the tab. The identity scope is captured for the
          // whole job, because the store write still needs the caller's token.
          const job = runWithToken(identity.token, () => service.finish(ref));
          void job.catch((error) =>
            console.warn("[upload] assembly failed", error),
          );
        }
        return;
      }

      default:
        sendJson(res, 404, { message: "Unknown upload route" });
        return;
    }
  } catch (error) {
    sendUploadError(res, error);
  }
}

/**
 * Sweeps abandoned sessions now and then.
 *
 * A session outlives the request that opened it (that is the point), so nothing
 * else would ever collect an upload whose tab was closed. The timer is
 * unref'ed: it must never keep the process alive.
 */
export function startUploadSweeper(
  service: () => UploadCommandService,
  intervalMs = 60 * 60 * 1000,
): NodeJS.Timeout {
  const run = () => {
    void service()
      .sweepExpired()
      .then((count) => {
        if (count > 0) console.log(`[upload] swept ${count} expired session(s)`);
      })
      .catch((error) => console.warn("[upload] sweep failed", error));
  };
  run();
  const timer = setInterval(run, intervalMs);
  timer.unref();
  return timer;
}

function sendUploadError(res: ServerResponse, error: unknown): void {
  if (error instanceof UploadError) {
    const body: UploadErrorResponse = { message: error.message };
    // Only an incomplete `complete` carries the missing indexes; every other
    // failure would otherwise ship an empty array the client has to ignore.
    if (error.missing.length > 0) body.missing = error.missing;
    sendJson(res, statusFor(error.code), body);
    return;
  }
  console.error("[upload] request failed", error);
  const body: UploadErrorResponse = { message: "Upload failed" };
  sendJson(res, 500, body);
}

function statusFor(code: UploadError["code"]): number {
  switch (code) {
    case "invalid":
      return 400;
    case "not_found":
      return 404;
    // The quota is also a "the file does not fit" rejection, and `413` keeps the
    // client's retry rule intact: a `5xx` would be retried forever, and repeating
    // a request the account cannot accept wastes the upload twice.
    case "too_large":
    case "quota":
      return 413;
    case "incomplete":
    case "busy":
      return 409;
    default:
      return 500;
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(text),
    "Cache-Control": "no-store",
  });
  res.end(text);
}

function methodNotAllowed(res: ServerResponse, allow: string): void {
  res.setHeader("Allow", allow);
  sendJson(res, 405, { message: `Method not allowed; use ${allow}` });
}

async function readJson<T>(req: IncomingMessage): Promise<Partial<T>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_SESSION_BODY_BYTES) {
      throw new UploadError("invalid", "Request body is too large");
    }
    chunks.push(chunk as Buffer);
  }
  if (size === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Partial<T>;
  } catch {
    throw new UploadError("invalid", "Request body is not valid JSON");
  }
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}
