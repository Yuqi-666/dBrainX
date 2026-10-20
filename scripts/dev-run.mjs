// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Start the development stack from the root `.env`.
 *
 *   pnpm dev         PocketBase, Next and the API, for this machine
 *   pnpm dev:remote  the same plus the development gateway, for a browser that
 *                    reaches this machine through a development domain
 *
 * Ports come from `.env` through `scripts/lib/dev-ports.mjs`; a variable set in
 * the shell wins over the file, as elsewhere in this repository. In the remote
 * shape Next binds loopback and only the gateway is exposed, so
 * `https://p<gateway port>.<dev domain>` reaches the whole stack.
 */
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import concurrently from "concurrently";
import {
  busyPortsReport,
  busyStackPorts,
  readDevStack,
  stackEnv,
} from "./lib/dev-ports.mjs";
import { copyPdfjsAssets } from "./lib/pdfjs-assets.mjs";
import { ensureYtDlp } from "./lib/yt-dlp-download.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const envPath = fileURLToPath(new URL("../.env", import.meta.url));
try {
  process.loadEnvFile(envPath);
} catch (error) {
  if (error.code !== "ENOENT") throw error;
  console.warn(`[dev] ${envPath} not found; PocketBase will refuse to start without an operator account`);
}

const remote = process.argv.includes("--remote");
let stack;
try {
  stack = readDevStack(process.env, { remote });
} catch (error) {
  console.error(`[dev] ${error.message}`);
  process.exit(1);
}

const commands = [
  { command: "pnpm --filter=server dev:pb", name: "pb", prefixColor: "yellow" },
  ...(remote
    ? [
        {
          command: "node scripts/dev-gateway.mjs",
          name: "gateway",
          prefixColor: "magenta",
        },
      ]
    : []),
  {
    command: `pnpm --filter=web exec next dev -p ${stack.webPort}${remote ? " -H 127.0.0.1" : ""}`,
    name: "web",
    prefixColor: "blue",
  },
  {
    command: "pnpm --filter=server dev",
    name: "server",
    prefixColor: "green",
  },
];

if (remote) {
  const host = stack.domain ? `p${stack.gatewayPort}.${stack.domain}` : `p${stack.gatewayPort}.<dev-domain>`;
  console.log(`[dev] remote: https://${host}`);
  console.log(
    `[dev] the proxy rule must forward p<port>.<dev-domain> to 127.0.0.1:<port>; see docs/development.md`,
  );
  // The wildcard proxy forwards to whichever port the host names, so the web
  // port is reachable too. Next serves the pages but owns neither /trpc nor
  // /pb, which reads as "the login page opens and signing in does nothing".
  console.log(
    `[dev] sign in through that address; p${stack.webPort} reaches Next only, without /trpc or /pb`,
  );
} else {
  console.log(`[dev] local: http://localhost:${stack.webPort}`);
}
console.log(
  `[dev] web ${stack.webPort}, server ${stack.serverPort}, pocketbase ${stack.pbHttp}${
    remote ? `, gateway ${stack.gatewayPort}` : ""
  }`,
);

// One taken port kills the whole stack from three levels down: a child dies on
// EADDRINUSE, `concurrently` then kills the rest, and the browser only shows a
// 502 from the reverse proxy. Name the port and the variable instead.
const busy = await busyStackPorts(stack);
if (busy.length > 0) {
  for (const line of busyPortsReport(busy)) console.error(`[dev] ${line}`);
  process.exit(1);
}

/**
 * Fetch the two repository-owned binaries on first use.
 *
 * A container image installs PocketBase and yt-dlp at build time; development
 * does the same here, on demand, so a fresh clone needs only `pnpm install`, an
 * `.env`, and `pnpm dev`. Both steps are skipped when the binary already exists,
 * and `YT_DLP_PATH` replaces the download with the developer's own install.
 *
 * PocketBase is required for the stack and a failed download aborts. yt-dlp is
 * only needed by the video-link import, so a failed download is reported and the
 * stack still starts: every other feature works, and the import reports the
 * missing binary itself if the developer tries it.
 */
async function ensureDevelopmentBinaries() {
  const pocketbase = join(
    root,
    "pb",
    process.platform === "win32" ? "pocketbase.exe" : "pocketbase",
  );
  if (!existsSync(pocketbase)) {
    console.log("[dev] PocketBase is missing; downloading the pinned binary …");
    // The release script owns the pinned version and checksum; calling it here
    // keeps one download implementation for development, CI and desktop.
    try {
      execFileSync(
        process.execPath,
        [join(root, "scripts/release/download-pocketbase.mjs")],
        { cwd: root, stdio: "inherit" },
      );
    } catch {
      console.error(
        "[dev] PocketBase could not be downloaded. Run " +
          "`node scripts/release/download-pocketbase.mjs` to retry.",
      );
      process.exit(1);
    }
  }

  try {
    const ytDlp = await ensureYtDlp({ root });
    if (!process.env.YT_DLP_PATH) process.env.YT_DLP_PATH = ytDlp;
  } catch (error) {
    console.warn(
      `[dev] yt-dlp is not available (${error.message}). The video-link import ` +
        `will fail until it is installed or YT_DLP_PATH names one.`,
    );
  }
}

await ensureDevelopmentBinaries();

// concurrently v9 has no top level `env` option, so the children inherit this
// process. Publish the resolved values here, before spawning.
for (const [name, value] of Object.entries(stackEnv(stack, process.env))) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = String(value);
}

// The viewer fetches its CMap and standard-font data from the web app's
// `public/` tree, and this script starts Next directly (`exec next dev`), so it
// never runs the app's own `dev` script — which is what does the copy.
await copyPdfjsAssets("web");

const { result } = concurrently(commands, {
  cwd: root,
  killOthersOn: ["failure", "success"],
  prefix: "[{name}]",
});

result.then(
  () => process.exit(0),
  () => process.exit(1),
);
