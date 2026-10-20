// SPDX-License-Identifier: AGPL-3.0-only

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as uploadContract from "../../packages/utils/src/upload.ts";

const requireClient = createRequire(new URL("../../packages/api-client/package.json", import.meta.url));
const sdk = requireClient("pocketbase");
const PocketBase = sdk.default ?? sdk;
function load(path, scope = {}, dependencies = {}) {
  const module = { exports: {} };
  const source = ts.transpileModule(readFileSync(new URL(`../../${path}`, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  runInNewContext(source, {
    module, exports: module.exports, Headers,
    require(id) { if (id in dependencies) return dependencies[id]; throw new Error(`Unexpected import ${id}`); },
    ...scope,
  });
  return module.exports;
}
function browser(platform) {
  const document = { cookie: "pb_token=alice" };
  const scope = { document, process: { env: { NEXT_PUBLIC_DBRAIN_PLATFORM: platform } } };
  const session = load("packages/api-client/src/auth/session.ts", scope);
  const client = load("packages/api-client/src/pocketbase-client.ts", scope, {
    pocketbase: { default: PocketBase, BaseAuthStore: sdk.BaseAuthStore },
    "./auth/session": session,
  });
  return { document, client };
}

test("web SDK reads refreshed cookies and discards SDK credentials after logout", () => {
  const { document, client } = browser();
  const pb = client.createPocketbaseClient({ url: "https://example.test/pb" });
  assert.ok(pb.authStore instanceof sdk.BaseAuthStore);
  pb.authStore.save("stale");
  const token = () => new Headers(pb.beforeSend("url", { headers: { Authorization: "foreign" } }).options.headers).get("Authorization");
  assert.equal(token(), "alice");
  document.cookie = "pb_token=bob";
  assert.equal(token(), "bob");
  document.cookie = "";
  assert.equal(token(), "");
});

test("desktop SDK uses an isolated store and backend changes replace the client", () => {
  const { client } = browser("desktop");
  const first = client.createPocketbaseClient({ url: "http://127.0.0.1:1111/session/abc" });
  first.authStore.save("device-token");
  assert.equal(first.authStore.token, "device-token");
  assert.equal(first.beforeSend, undefined);
  assert.equal(client.createPocketbaseClient({ url: first.baseUrl }), first);
  const second = client.createPocketbaseClient({ url: "http://127.0.0.1:2222/session/def" });
  assert.notEqual(second, first);
  assert.equal(second.authStore.token, "");
  client.resetPocketbaseClient();
  assert.throws(() => client.getPocketbaseClient(), /not initialized/);
});

test("loopback APIs preserve the cookie hostname; remote and container APIs use gateways", () => {
  for (const hostname of ["localhost", "127.0.0.1", "[::1]"]) {
    const window = { location: { hostname, host: `${hostname}:3000`, origin: `http://${hostname}:3000`, protocol: "http:" } };
    const config = load("packages/api-client/src/backend-urls.ts", { window, process: { env: {} } }, { "./desktop-backend": {} });
    assert.equal(config.resolveBackendUrls().pocketbase, `http://${hostname}:8090`);
    assert.equal(config.resolveBackendUrls().trpc, `ws://${hostname}:3001/trpc`);
  }
  for (const [hostname, env] of [["dbrain.example", {}], ["localhost", { NEXT_PUBLIC_DBRAIN_BACKEND_MODE: "same-origin" }]]) {
    const window = { location: { hostname, host: hostname, origin: `https://${hostname}`, protocol: "https:" } };
    const config = load("packages/api-client/src/backend-urls.ts", { window, process: { env } }, { "./desktop-backend": {} });
    assert.equal(config.resolveBackendUrls().pocketbase, `https://${hostname}/pb`);
    assert.equal(config.resolveBackendUrls().trpc, `wss://${hostname}/trpc`);
  }
});

test("stored file paths resolve once through the current web or desktop gateway", () => {
  for (const baseUrl of ["https://example.test/pb", "http://127.0.0.1:1111/session/def"]) {
    const upload = load("packages/api-client/src/upload.ts", {}, {
      "@workspace/store": {}, react: {}, "./auth/session": {},
      "@workspace/utils/upload": uploadContract,
      "./pocketbase-client": { getPocketbaseClient: () => ({ baseUrl }) },
    });
    for (const path of ["/api/files/files/id/file.png", "/pb/api/files/files/id/file.png", "/session/abc/api/files/files/id/file.png"]) {
      assert.equal(upload.resolveFileUrl(path), `${baseUrl}/api/files/files/id/file.png`);
    }
    assert.equal(upload.resolveFileUrl("https://external.test/image.png"), "https://external.test/image.png");
  }
});
