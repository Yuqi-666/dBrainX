// SPDX-License-Identifier: AGPL-3.0-only

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { readAuthSessionToken } from "../../packages/api-client/src/auth/session.ts";
import * as uploadContract from "../../packages/utils/src/upload.ts";

function uploader(platform, cookie) {
  const requests = [];
  const document = { cookie };
  const sdk = {
    authStore: { token: "stale-sdk-token" },
    buildUrl: (path) => `https://example.test/pb${path}`,
    files: { getUrl: () => "https://example.test/pb/api/files/files/record/file.txt" },
  };
  class XHR {
    status = 200;
    responseText = JSON.stringify({ id: "record", collectionId: "files", file: "file.txt" });
    headers = {};
    listeners = {};
    upload = { addEventListener() {} };
    constructor() { requests.push(this); }
    addEventListener(name, callback) { this.listeners[name] = callback; }
    open(method, url) { this.method = method; this.url = url; }
    setRequestHeader(name, value) { this.headers[name] = value; }
    send(body) { this.body = body; this.listeners.load(); }
  }
  const module = { exports: {} };
  const source = ts.transpileModule(readFileSync(new URL("../../packages/api-client/src/upload.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  runInNewContext(source, {
    module, exports: module.exports, XMLHttpRequest: XHR, FormData,
    process: { env: { NEXT_PUBLIC_DBRAIN_PLATFORM: platform } },
    require(id) {
      if (id === "@workspace/store") return { useWorkspaceStore: { getState: () => ({ currentWorkspaceId: "workspace" }) } };
      // The size limits are re-exported by `upload.ts`; none of the direct-path
      // assertions depend on them, but the module has to load.
      if (id === "@workspace/utils/upload") return uploadContract;
      if (id === "react") return {};
      if (id === "./pocketbase-client") return { getPocketbaseClient: () => sdk };
      if (id === "./auth/session") return { readAuthSessionToken: () => {
        const previous = globalThis.document;
        globalThis.document = document;
        try { return readAuthSessionToken(); }
        finally { if (previous === undefined) delete globalThis.document; else globalThis.document = previous; }
      } };
      throw new Error(`Unexpected import ${id}`);
    },
  });
  return { upload: module.exports.uploadAttachment, requests, document };
}

const file = () => new File(["hello"], "file.txt", { type: "text/plain" });

test("web upload uses the current cookie token, workspace and multipart file", async () => {
  const client = uploader(undefined, "other=1; pb_token=current%2Btoken");
  const attachment = await client.upload(file());
  const request = client.requests[0];
  assert.equal(request.headers.Authorization, "current+token");
  assert.equal(request.method, "POST");
  assert.equal(request.body.get("workspaceId"), "workspace");
  assert.equal(await request.body.get("file").text(), "hello");
  assert.equal(attachment.fileName, "file.txt");
  client.document.cookie = "pb_token=renewed-token";
  await client.upload(file());
  assert.equal(client.requests[1].headers.Authorization, "renewed-token");
  client.document.cookie = "";
  await client.upload(file());
  assert.equal(client.requests[2].headers.Authorization, undefined);
});

test("desktop upload retains its local backend SDK token", async () => {
  const client = uploader("desktop", "pb_token=web-token");
  const attachment = await client.upload(file());
  assert.equal(client.requests[0].headers.Authorization, "stale-sdk-token");
  assert.equal(attachment.url, "/api/files/files/record/file.txt");
});

test("malformed or similarly named cookies do not authenticate uploads", async () => {
  for (const cookie of ["other_pb_token=foreign", "pb_token=%zz", "pb_token="]) {
    const client = uploader(undefined, cookie);
    await client.upload(file());
    assert.equal(client.requests[0].headers.Authorization, undefined);
  }
});
