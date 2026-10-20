// SPDX-License-Identifier: AGPL-3.0-only

import {
  readFile,
  writeFile,
  mkdir,
  mkdtemp,
  copyFile,
  readdir,
  rm,
} from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceDir = join(root, "packages/ui/src/img/icon");
const nativeDir = join(root, "apps/desktop/src-tauri/icons");
const requireDesktop = createRequire(join(root, "apps/desktop/package.json"));
const tauriCli = requireDesktop.resolve("@tauri-apps/cli/tauri.js");
const scratch = await mkdtemp(join(tmpdir(), "dbrain-icons-"));

// Keep the original paths; remove empty Excalidraw elements and export padding.
function artwork(source, name, dark, tile = false) {
  const [, dimensions, body] = source.match(
    /viewBox="([^"]+)"[^>]*>([\s\S]*)<\/svg>/,
  );
  const [, , width, height] = dimensions.split(" ").map(Number);
  const side = Math.max(width, height) - 14;
  const x = (width - side) / 2;
  const y = (height - side) / 2;
  const paths = body
    .replace(
      /<!--[\s\S]*?-->|<metadata>[\s\S]*?<\/metadata>|<defs>[\s\S]*?<\/defs>|<mask><\/mask>/g,
      "",
    )
    .replaceAll("#1e1e1e", dark ? "#f5f5f4" : "#1e1e1e")
    .replaceAll("#f08c00", dark ? "#ffb347" : "#f08c00");
  const background = tile
    ? `<rect x="${x}" y="${y}" width="${side}" height="${side}" rx="${side * 0.18}" fill="${dark ? "#18181b" : "#f5f5f4"}"/>`
    : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x} ${y} ${side} ${side}" width="512" height="512"><title>${name === "logo" ? "dBrain" : "Graph"}</title>${background}${paths}</svg>\n`;
}

function generate(input, output, png) {
  execFileSync(
    process.execPath,
    [
      tauriCli,
      "icon",
      input,
      "--output",
      output,
      ...(png ? ["--png", String(png)] : []),
    ],
    { cwd: root, stdio: "inherit" },
  );
}

try {
  for (const name of ["graph", "logo"]) {
    const source = await readFile(join(sourceDir, `${name}.svg`), "utf8");
    for (const theme of ["light", "dark"]) {
      const svg = artwork(source, name, theme === "dark");
      await writeFile(join(sourceDir, `${name}-${theme}.svg`), svg);
      if (name !== "logo") continue;
      for (const app of ["web", "desktop"]) {
        const publicDir = join(root, `apps/${app}/public/icons`);
        await mkdir(publicDir, { recursive: true });
        await writeFile(join(publicDir, `logo-${theme}.svg`), svg);
      }
      const tile = join(scratch, `logo-${theme}.svg`);
      await writeFile(tile, artwork(source, name, theme === "dark", true));
      const output = join(scratch, theme);
      generate(tile, output, theme === "dark" ? 256 : undefined);
      await mkdir(nativeDir, { recursive: true });
      if (theme === "light") {
        for (const name of await readdir(nativeDir)) {
          if (/\.(png|ico|icns)$/.test(name) && !name.startsWith("logo-"))
            await copyFile(join(output, name), join(nativeDir, name));
        }
        await copyFile(
          join(output, "128x128@2x.png"),
          join(nativeDir, "logo-light.png"),
        );
        for (const app of ["web", "desktop"])
          await copyFile(
            join(output, "icon.ico"),
            join(root, `apps/${app}/app/favicon.ico`),
          );
      } else {
        await copyFile(
          join(output, "256x256.png"),
          join(nativeDir, "logo-dark.png"),
        );
      }
    }
  }
} finally {
  await rm(scratch, { recursive: true, force: true });
}
