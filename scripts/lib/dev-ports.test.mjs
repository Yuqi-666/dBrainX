// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Tests for the development stack's port resolution.
 *
 * The two root commands share these rules, and the failure they prevent is
 * boring but real: two services on one port, or a `.env` typo that only shows
 * up as "PocketBase did not become ready". The pre-flight check covers the
 * other common failure: a leftover process still holding a port, which kills
 * the whole stack and reaches the browser as a 502 from the reverse proxy.
 */
import assert from "node:assert/strict";
import { createServer } from "node:net";
import { test } from "node:test";
import {
  busyPortsReport,
  busyStackPorts,
  readDevStack,
  stackEnv,
  stackPorts,
} from "./dev-ports.mjs";

test("defaults match the documented ports", () => {
  assert.deepEqual(readDevStack({}), {
    remote: false,
    webPort: 3000,
    serverPort: 3001,
    gatewayPort: 8080,
    pbHttp: "127.0.0.1:8090",
    pbPort: 8090,
    pbUrl: "http://127.0.0.1:8090",
    domain: "",
  });
  assert.equal(readDevStack({}, { remote: true }).remote, true);
});

test("reads every port from the environment", () => {
  const stack = readDevStack(
    {
      DBRAINX_WEB_PORT: "4000",
      DBRAINX_SERVER_PORT: "4001",
      DBRAINX_GATEWAY_PORT: "18080",
      DBRAINX_PB_HTTP: "127.0.0.1:8091",
      DBRAINX_DEV_DOMAIN: "dev.example.com",
    },
    { remote: true },
  );
  assert.equal(stack.webPort, 4000);
  assert.equal(stack.serverPort, 4001);
  assert.equal(stack.gatewayPort, 18080);
  assert.equal(stack.pbHttp, "127.0.0.1:8091");
  assert.equal(stack.pbPort, 8091);
  assert.equal(stack.pbUrl, "http://127.0.0.1:8091");
  assert.equal(stack.domain, "dev.example.com");
});

test("falls back to PORT for the API and treats blanks as unset", () => {
  assert.equal(readDevStack({ PORT: "4100" }).serverPort, 4100);
  assert.equal(
    readDevStack({ PORT: "4100", DBRAINX_SERVER_PORT: "4101" }).serverPort,
    4101,
  );
  assert.equal(
    readDevStack({ PORT: "4100", DBRAINX_SERVER_PORT: "  " }).serverPort,
    4100,
  );
  assert.equal(readDevStack({ DBRAINX_WEB_PORT: "" }).webPort, 3000);
});

test("an explicit PocketBase URL wins over the derived one", () => {
  assert.equal(
    readDevStack({
      DBRAINX_PB_HTTP: "127.0.0.1:8091",
      DBRAINX_PB_URL: "http://127.0.0.1:9999",
    }).pbUrl,
    "http://127.0.0.1:9999",
  );
});

test("rejects values that are not ports", () => {
  assert.throws(() => readDevStack({ DBRAINX_WEB_PORT: "0" }), /DBRAINX_WEB_PORT/);
  assert.throws(() => readDevStack({ DBRAINX_WEB_PORT: "abc" }), /DBRAINX_WEB_PORT/);
  assert.throws(
    () => readDevStack({ DBRAINX_GATEWAY_PORT: "70000" }),
    /DBRAINX_GATEWAY_PORT/,
  );
  assert.throws(() => readDevStack({ DBRAINX_PB_HTTP: "8090" }), /DBRAINX_PB_HTTP/);
  assert.throws(
    () => readDevStack({ DBRAINX_PB_HTTP: "127.0.0.1:0" }),
    /DBRAINX_PB_HTTP/,
  );
});

test("refuses two services on one port", () => {
  assert.throws(() => readDevStack({ DBRAINX_WEB_PORT: "3001" }), /used by both/);
  assert.throws(
    () => readDevStack({ DBRAINX_GATEWAY_PORT: "3000" }, { remote: true }),
    /used by both/,
  );
  // The gateway port only takes part in the remote shape.
  assert.doesNotThrow(() => readDevStack({ DBRAINX_GATEWAY_PORT: "3000" }));
});

test("the child environment follows the resolved ports", () => {
  const stack = readDevStack(
    {
      DBRAINX_WEB_PORT: "4000",
      DBRAINX_SERVER_PORT: "4001",
      DBRAINX_PB_HTTP: "127.0.0.1:8091",
      DBRAINX_GATEWAY_PORT: "18080",
    },
    { remote: true },
  );
  const env = stackEnv(stack, { PATH: "/bin", DBRAINX_DEV_DOMAIN: "dev.example.com" });
  assert.equal(env.PORT, "4001");
  assert.equal(env.DBRAINX_PB_HTTP, "127.0.0.1:8091");
  assert.equal(env.PB_URL, "http://127.0.0.1:8091");
  assert.equal(env.DBRAINX_PB_URL, "http://127.0.0.1:8091");
  assert.equal(env.DBRAINX_WEB_URL, "http://127.0.0.1:4000");
  assert.equal(env.DBRAINX_SERVER_URL, "http://127.0.0.1:4001");
  assert.equal(env.DBRAINX_GATEWAY_PORT, "18080");
  assert.equal(env.PATH, "/bin");
  assert.equal(env.DBRAINX_DEV_DOMAIN, "dev.example.com");
});

test("lists the ports the stack listens on", () => {
  assert.deepEqual(stackPorts(readDevStack({}, { remote: true })), [
    { name: "DBRAINX_WEB_PORT", host: "127.0.0.1", port: 3000 },
    { name: "DBRAINX_SERVER_PORT", host: "127.0.0.1", port: 3001 },
    { name: "DBRAINX_PB_HTTP", host: "127.0.0.1", port: 8090 },
    { name: "DBRAINX_GATEWAY_PORT", host: "127.0.0.1", port: 8080 },
  ]);
  // The gateway port only takes part in the remote shape.
  assert.deepEqual(
    stackPorts(readDevStack({})).map((entry) => entry.name),
    ["DBRAINX_WEB_PORT", "DBRAINX_SERVER_PORT", "DBRAINX_PB_HTTP"],
  );
  // A wildcard listen address is probed on loopback.
  assert.equal(
    stackPorts(readDevStack({ DBRAINX_PB_HTTP: "0.0.0.0:8092" }))[2].host,
    "127.0.0.1",
  );
});

test("reports the ports that already answer", async () => {
  const stack = readDevStack({}, { remote: true });
  const busy = await busyStackPorts(stack, {
    isBusy: async (_host, port) => port === 8080 || port === 3001,
  });
  // Sorted by port, so the message reads the same on every run.
  assert.deepEqual(
    busy.map((entry) => entry.port),
    [3001, 8080],
  );
  assert.deepEqual(busyPortsReport(busy), [
    "port already in use: 3001 (DBRAINX_SERVER_PORT), 8080 (DBRAINX_GATEWAY_PORT)",
    "a previous run may still be alive; list its listeners with: ss -ltnp | grep LISTEN",
    "stop that process, or move this stack to another port in .env",
  ]);
  assert.deepEqual(
    await busyStackPorts(stack, { isBusy: async () => false }),
    [],
  );
});

test("a live listener on loopback counts as busy", async () => {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  const stack = readDevStack({ DBRAINX_WEB_PORT: String(port) });
  const busy = await busyStackPorts(stack);
  assert.deepEqual(
    busy.filter((entry) => entry.port === port).map((entry) => entry.name),
    ["DBRAINX_WEB_PORT"],
  );
  await new Promise((resolve) => server.close(resolve));
  const after = await busyStackPorts(stack);
  assert.deepEqual(
    after.filter((entry) => entry.port === port),
    [],
  );
});
