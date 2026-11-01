// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The F3 baseline scenarios, declared but skipped: these are placeholders until
 * wave W9 writes the real flows. They exist now so the scenario list, the
 * Playwright config, and `pnpm test:e2e -- --list` are reviewable in W0.
 *
 * Run with: `pnpm test:e2e -- --list`
 */
import { test } from "@playwright/test";

test.describe("F3 baseline", () => {
  test.skip("creation → node → title → pin → upload → delete", async () => {
    // Placeholder for W9: create a node, rename it, pin it, upload a file, delete it.
  });

  test.skip("reconnect convergence", async () => {
    // Placeholder for W9: drop the WebSocket, reconnect, and converge on server state.
  });

  test.skip("VERSION_CONFLICT prompt", async () => {
    // Placeholder for W9: a stale write surfaces the conflict prompt and reloads.
  });

  test.skip("plugin enable/deny", async () => {
    // Placeholder for W9: an enabled plugin runs; a denied capability is refused.
  });

  test.skip("sandbox escape refusal", async () => {
    // Placeholder for W9: a filesystem escape is refused by the sandbox.
  });

  test.skip("desktop with engine off", async () => {
    // Placeholder for W9: the desktop app keeps working with the engine stopped.
  });
});
