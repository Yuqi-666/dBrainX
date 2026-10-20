// SPDX-License-Identifier: AGPL-3.0-only

import { execFileSync } from "node:child_process";
import { rm } from "node:fs/promises";
if (process.env.DBRAIN_SIGNING_KEYCHAIN && process.platform === "darwin") {
  try {
    execFileSync(
      "security",
      ["delete-keychain", process.env.DBRAIN_SIGNING_KEYCHAIN],
      { stdio: "ignore" },
    );
  } catch {
    /* ephemeral CI runner */
  }
}
if (process.env.DBRAIN_SIGNING_TEMP)
  await rm(process.env.DBRAIN_SIGNING_TEMP, { recursive: true, force: true });
