// SPDX-License-Identifier: AGPL-3.0-only

import assert from "node:assert/strict";
import { test } from "node:test";
import { TRPC_PATH, isLoopbackHostname, sameOrigin } from "./origin.ts";

test("the WebSocket path is the one nginx forwards", () => {
  // `deploy/nginx.conf` routes `location = /trpc`; the browser client builds its
  // URL with the same path. A mismatch rejects the handshake, which the ws
  // client retries silently, so the app loads forever instead of failing.
  assert.equal(TRPC_PATH, "/trpc");
});

test("split development reaches the API from the web dev server's origin", () => {
  // `pnpm dev`: the app is on :3000, the API on :3001 — the port differs by
  // construction, which is what left `/graph` on its loading screen.
  assert.equal(sameOrigin("http://localhost:3000", "localhost:3001"), true);
  assert.equal(sameOrigin("http://127.0.0.1:3000", "127.0.0.1:3001"), true);
  // Any dev port, so `next dev -p <other>` keeps working.
  assert.equal(sameOrigin("http://localhost:4321", "localhost:3001"), true);
  // The proxied shape: nginx forwards `$http_host`, so origin and host agree.
  assert.equal(sameOrigin("https://dbrainx.example", "dbrainx.example"), true);
  // Header-less clients (the release smoke script, curl) stay admitted; their
  // identity is still the verified connection token.
  assert.equal(sameOrigin(undefined, "localhost:3001"), true);
});

test("only loopback may differ in port", () => {
  assert.equal(sameOrigin("http://evil.example", "localhost:3001"), false);
  assert.equal(sameOrigin("http://localhost.evil.example", "localhost:3001"), false);
  assert.equal(sameOrigin("null", "localhost:3001"), false);
  assert.equal(sameOrigin("not a url", "localhost:3001"), false);
  // A non-loopback public host is held to an exact match, exactly as before.
  assert.equal(sameOrigin("https://app.example:9999", "app.example:3001"), false);
  assert.equal(sameOrigin("https://app.example:3001", "app.example:3001"), true);
});

test("an explicit public origin overrides everything, including loopback", () => {
  assert.equal(sameOrigin("https://dbrainx.example", "server:3001", "https://dbrainx.example"), true);
  assert.equal(sameOrigin("http://localhost:3000", "localhost:3001", "https://dbrainx.example"), false);
});

test("loopback detection accepts the spellings a browser can produce", () => {
  for (const hostname of ["localhost", "127.0.0.1", "::1", "[::1]"]) {
    assert.equal(isLoopbackHostname(hostname), true);
  }
  for (const hostname of ["0.0.0.0", "10.0.0.7", "localhost.evil.example", ""]) {
    assert.equal(isLoopbackHostname(hostname), false);
  }
});
