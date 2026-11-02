// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The WebSocket handshake, asserted at the wire (plan item 86, F3 R1).
 *
 * `backend/adapter-front/src/trpc/workspace-context.ts` reads
 * `connectionParams["x-workspace-id"]` and keeps it as
 * `Context.activeWorkspaceId`; `operationCallContextOf` then refuses every
 * invocation on a connection that named no workspace with
 * `PRECONDITION_FAILED` (covered by `operation.test.ts` in that package). The
 * object asserted here is exactly what `client.ts` hands to `wsLink`, with the
 * workspace read from `useWorkspaceStore` on every handshake.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { WORKSPACE_HEADER, connectionParamsOf } from "./connection-params.ts";

describe("tRPC connection parameters", () => {
  it("names the active workspace under the key the server reads", () => {
    const params = connectionParamsOf({
      token: "jwt",
      sourceId: "source-1",
      workspaceId: "ws_active",
    });

    assert.equal(WORKSPACE_HEADER, "x-workspace-id");
    assert.deepEqual(params, {
      token: "jwt",
      sourceId: "source-1",
      "x-workspace-id": "ws_active",
    });

    const wire = JSON.parse(JSON.stringify(params)) as Record<string, unknown>;
    assert.equal(wire["x-workspace-id"], "ws_active");
  });

  it("omits the workspace when none is active, the shape the server refuses", () => {
    for (const workspaceId of [null, undefined, "", "   "]) {
      const params = connectionParamsOf({
        token: "jwt",
        sourceId: "source-1",
        workspaceId,
      });

      assert.deepEqual(params, { token: "jwt", sourceId: "source-1" });
      assert.equal("x-workspace-id" in params, false);
    }
  });

  it("sends only the token the caller actually has", () => {
    const anonymous = connectionParamsOf({
      sourceId: "source-1",
      workspaceId: "ws_active",
    });

    assert.deepEqual(anonymous, {
      sourceId: "source-1",
      "x-workspace-id": "ws_active",
    });
  });
});
