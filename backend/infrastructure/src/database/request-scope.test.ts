// SPDX-License-Identifier: AGPL-3.0-only

import test from "node:test";
import assert from "node:assert/strict";
import { requestToken, runWithToken } from "./request-scope.ts";
test("concurrent requests never share identity", async () => {
  await Promise.all(["alice", "bob", ""].map(token => runWithToken(token, async () => {
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(requestToken(), token);
  })));
  assert.equal(requestToken(), "");
});
