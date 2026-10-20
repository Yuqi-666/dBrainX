// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Port resolution for the development stack.
 *
 * The root commands read the same root `.env`, so every port lives in one
 * place:
 *
 *   pnpm dev         PocketBase, Next and the API, for a browser on this machine
 *   pnpm dev:remote  the same plus `scripts/dev-gateway.mjs`, for a browser that
 *                    reaches this machine through a development domain
 *
 * The gateway port is also the subdomain label of the wildcard proxy rule
 * (`p<port>.example.com -> 127.0.0.1:<port>`), so it is configurable rather than
 * fixed at 3000. That is what keeps the shared reverse proxy project-agnostic.
 */
import { createConnection } from "node:net";

/**
 * @typedef {object} DevStack
 * @property {boolean} remote
 * @property {number} webPort Next dev server.
 * @property {number} serverPort tRPC and file gateway listener.
 * @property {number} gatewayPort Development gateway, remote shape only.
 * @property {string} pbHttp PocketBase listen address, `host:port`.
 * @property {number} pbPort PocketBase port, split out of `pbHttp`.
 * @property {string} pbUrl PocketBase base URL used by the API and the gateway.
 * @property {string} domain Development domain for the startup hint, or "".
 */

/** Treat a blank value as unset, so an empty line in .env cannot break startup. */
function text(value) {
  return (value ?? "").trim() || undefined;
}

/**
 * @param {string | undefined} value
 * @param {number} fallback
 * @param {string} name
 */
function readPort(value, fallback, name) {
  const raw = text(value) ?? String(fallback);
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error(`Invalid ${name}: ${raw}`);
  return port;
}

/** @param {string | undefined} value */
function readPbListen(value) {
  const raw = text(value) ?? "127.0.0.1:8090";
  const match = /^(?<host>[^:\s]+):(?<port>\d{1,5})$/.exec(raw);
  const port = match ? Number(match.groups.port) : NaN;
  if (!match || port < 1 || port > 65535)
    throw new Error(`Invalid DBRAIN_PB_HTTP (expected host:port): ${raw}`);
  return { pbHttp: `${match.groups.host}:${port}`, pbPort: port };
}

/**
 * @param {Record<string, string | undefined>} [env]
 * @param {{remote?: boolean}} [options]
 * @returns {DevStack}
 */
export function readDevStack(env = {}, options = {}) {
  const remote = options.remote === true;
  const webPort = readPort(env.DBRAIN_WEB_PORT, 3000, "DBRAIN_WEB_PORT");
  const serverPort = readPort(
    text(env.DBRAIN_SERVER_PORT) ?? env.PORT,
    3001,
    "DBRAIN_SERVER_PORT",
  );
  const gatewayPort = readPort(
    env.DBRAIN_GATEWAY_PORT,
    8080,
    "DBRAIN_GATEWAY_PORT",
  );
  const { pbHttp, pbPort } = readPbListen(env.DBRAIN_PB_HTTP);
  const pbUrl = text(env.DBRAIN_PB_URL) ?? `http://${pbHttp}`;

  const owners = [
    ["DBRAIN_WEB_PORT", webPort],
    ["DBRAIN_SERVER_PORT", serverPort],
    ["DBRAIN_PB_HTTP", pbPort],
    ...(remote ? [["DBRAIN_GATEWAY_PORT", gatewayPort]] : []),
  ];
  for (const [name, port] of owners) {
    const clash = owners.find(
      ([otherName, otherPort]) => otherPort === port && otherName !== name,
    );
    if (clash)
      throw new Error(
        `Port ${port} is used by both ${name} and ${clash[0]}; set one of them in .env`,
      );
  }

  return {
    remote,
    webPort,
    serverPort,
    gatewayPort,
    pbHttp,
    pbPort,
    pbUrl,
    domain: text(env.DBRAIN_DEV_DOMAIN) ?? "",
  };
}

/**
 * Environment for every child process: the API and the gateway follow the same
 * PocketBase address, and PORT belongs to the API alone. Next receives its port
 * as a command line argument instead, so the two can never disagree.
 *
 * @param {DevStack} stack
 * @param {Record<string, string | undefined>} [env]
 */
export function stackEnv(stack, env = {}) {
  return {
    ...env,
    DBRAIN_WEB_PORT: String(stack.webPort),
    DBRAIN_SERVER_PORT: String(stack.serverPort),
    DBRAIN_GATEWAY_PORT: String(stack.gatewayPort),
    DBRAIN_PB_HTTP: stack.pbHttp,
    PB_URL: stack.pbUrl,
    DBRAIN_PB_URL: stack.pbUrl,
    DBRAIN_WEB_URL: `http://127.0.0.1:${stack.webPort}`,
    DBRAIN_SERVER_URL: `http://127.0.0.1:${stack.serverPort}`,
    PORT: String(stack.serverPort),
  };
}

/**
 * Probe address for one listen address: a wildcard bind also answers on
 * loopback, which is the machine the stack is started from.
 *
 * @param {string} host
 */
function probeHost(host) {
  return host === "0.0.0.0" || host === "::" ? "127.0.0.1" : host;
}

/**
 * The ports the stack wants to listen on, with the `.env` variable that owns
 * each one. The gateway only listens in the remote shape.
 *
 * @param {DevStack} stack
 * @returns {Array<{name: string, host: string, port: number}>}
 */
export function stackPorts(stack) {
  const entries = [
    { name: "DBRAIN_WEB_PORT", host: "127.0.0.1", port: stack.webPort },
    { name: "DBRAIN_SERVER_PORT", host: "127.0.0.1", port: stack.serverPort },
    {
      name: "DBRAIN_PB_HTTP",
      host: probeHost(stack.pbHttp.slice(0, stack.pbHttp.lastIndexOf(":"))),
      port: stack.pbPort,
    },
  ];
  if (stack.remote)
    entries.push({
      name: "DBRAIN_GATEWAY_PORT",
      host: "127.0.0.1",
      port: stack.gatewayPort,
    });
  return entries;
}

/**
 * Does something already answer on this address? A refused connection means
 * the port is free, which is the normal case.
 *
 * @param {string} host
 * @param {number} port
 * @param {number} [timeoutMs]
 */
async function tcpBusy(host, port, timeoutMs = 700) {
  return await new Promise((resolve) => {
    const socket = createConnection({ host, port });
    const settle = (busy) => {
      socket.destroy();
      resolve(busy);
    };
    socket.setTimeout(timeoutMs, () => settle(false));
    socket.once("connect", () => settle(true));
    socket.once("error", () => settle(false));
  });
}

/**
 * The ports that are already taken, checked before anything is spawned.
 *
 * Without this check the failure is hard to read: the other children start,
 * one dies on EADDRINUSE, `concurrently` kills the rest, and the browser only
 * shows a 502 from the reverse proxy.
 *
 * @param {DevStack} stack
 * @param {{isBusy?: (host: string, port: number) => Promise<boolean>}} [options]
 * @returns {Promise<Array<{name: string, host: string, port: number}>>}
 */
export async function busyStackPorts(stack, options = {}) {
  const isBusy = options.isBusy ?? tcpBusy;
  const results = await Promise.all(
    stackPorts(stack).map(async (entry) =>
      (await isBusy(entry.host, entry.port)) ? entry : undefined,
    ),
  );
  return results
    .filter((entry) => entry !== undefined)
    .sort((left, right) => left.port - right.port);
}

/**
 * One line per message, without a log prefix. The port list comes first so a
 * glance at the terminal names the variable to change.
 *
 * @param {Array<{name: string, port: number}>} busy
 * @returns {string[]}
 */
export function busyPortsReport(busy) {
  const list = busy.map((entry) => entry.port + " (" + entry.name + ")").join(", ");
  return [
    "port already in use: " + list,
    "a previous run may still be alive; list its listeners with: ss -ltnp | grep LISTEN",
    "stop that process, or move this stack to another port in .env",
  ];
}
