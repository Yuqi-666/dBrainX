// SPDX-License-Identifier: AGPL-3.0-only

import { readdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
export async function signWindowsRuntime(directory) {
  if (process.platform !== "win32" || !process.env.DBRAINX_WINDOWS_THUMBPRINT)
    return;
  const sdk = join(
    process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)",
    "Windows Kits",
    "10",
    "bin",
  );
  const versions = (await readdir(sdk))
    .filter((name) => /^10\./.test(name))
    .sort()
    .reverse();
  if (!versions.length) throw new Error("Windows SDK signtool is required");
  const signtool = join(sdk, versions[0], "x64", "signtool.exe");
  async function sign(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await sign(path);
      else if (/\.(exe|dll|node)$/i.test(entry.name)) {
        execFileSync(
          signtool,
          [
            "sign",
            "/sha1",
            process.env.DBRAINX_WINDOWS_THUMBPRINT,
            "/fd",
            "SHA256",
            "/tr",
            "http://timestamp.digicert.com",
            "/td",
            "SHA256",
            path,
          ],
          { stdio: "inherit" },
        );
        execFileSync(signtool, ["verify", "/pa", path], { stdio: "inherit" });
      }
    }
  }
  await sign(directory);
}
