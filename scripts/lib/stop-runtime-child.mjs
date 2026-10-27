// SPDX-License-Identifier: AGPL-3.0-only

import { once } from "node:events";

/** Stop this exact process, and retire its deadline before a restart. */
export async function stopRuntimeChild(child, graceMs = 5000) {
  if (child.exitCode !== null || child.signalCode !== null)
    return [child.exitCode, child.signalCode];
  const exited = once(child, "exit");
  const deadline = setTimeout(() => child.kill("SIGKILL"), graceMs);
  try {
    child.stdin.end("shutdown\n");
    return await exited;
  } finally {
    clearTimeout(deadline);
  }
}
