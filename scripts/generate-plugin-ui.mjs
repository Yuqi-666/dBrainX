// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Regenerates the plugin UI map from the plugin manifests.
 *
 * `node scripts/generate-plugin-ui.mjs` writes
 * `apps/web/lib/plugin-ui.generated.ts`.
 * `node scripts/generate-plugin-ui.mjs --check` renders the map in memory,
 * compares it with the file on disk, prints a diff, and exits 1 on drift. It
 * never writes, so it is safe as a gate. With no plugin manifests it reports
 * `0 plugins` and both modes succeed.
 *
 * The generated map is only data: a registry bootstrap imports each `entry`
 * lazily and calls `registerNodeContent`. `packages/ui` never imports
 * `plugins/*`. The manifest contract is documented in
 * `scripts/lib/plugin-packages.mjs`.
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  readPluginManifests,
  renderPluginUiModule,
} from "./lib/plugin-packages.mjs";

const context = 3;

export function pluginCountLabel(count) {
  return `${count} plugin${count === 1 ? "" : "s"}`;
}

/** Line operations between two texts, as a longest-common-subsequence walk. */
export function diffLines(before, after) {
  const a = before.split("\n");
  const b = after.split("\n");
  const lengths = Array.from({ length: a.length + 1 }, () =>
    new Uint32Array(b.length + 1),
  );
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      lengths[i][j] =
        a[i] === b[j]
          ? lengths[i + 1][j + 1] + 1
          : Math.max(lengths[i + 1][j], lengths[i][j + 1]);
  const ops = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      ops.push({ kind: " ", text: a[i] });
      i++;
      j++;
    } else if (lengths[i + 1][j] >= lengths[i][j + 1]) {
      ops.push({ kind: "-", text: a[i] });
      i++;
    } else {
      ops.push({ kind: "+", text: b[j] });
      j++;
    }
  }
  for (; i < a.length; i++) ops.push({ kind: "-", text: a[i] });
  for (; j < b.length; j++) ops.push({ kind: "+", text: b[j] });
  return ops;
}

/** A unified-style diff of the generated file against the one on disk. */
export function unifiedDiff(before, after, beforeName, afterName) {
  const ops = diffLines(before, after);
  const changed = ops
    .map((op, index) => (op.kind === " " ? -1 : index))
    .filter((index) => index !== -1);
  if (changed.length === 0) return "";
  const hunks = [];
  for (const index of changed) {
    const last = hunks[hunks.length - 1];
    if (last !== undefined && index - last.end <= context * 2) last.end = index;
    else hunks.push({ start: index, end: index });
  }
  const beforeLine = [1];
  const afterLine = [1];
  for (const op of ops) {
    beforeLine.push(beforeLine[beforeLine.length - 1] + (op.kind === "+" ? 0 : 1));
    afterLine.push(afterLine[afterLine.length - 1] + (op.kind === "-" ? 0 : 1));
  }
  const out = [`--- ${beforeName}`, `+++ ${afterName}`];
  for (const hunk of hunks) {
    const from = Math.max(0, hunk.start - context);
    const to = Math.min(ops.length - 1, hunk.end + context);
    const oldCount = beforeLine[to + 1] - beforeLine[from];
    const newCount = afterLine[to + 1] - afterLine[from];
    out.push(
      `@@ -${beforeLine[from]},${oldCount} +${afterLine[from]},${newCount} @@`,
    );
    for (let index = from; index <= to; index++)
      out.push(`${ops[index].kind}${ops[index].text}`);
  }
  return `${out.join("\n")}\n`;
}

/** The repo root of this checkout, independent of the working directory. */
export const root = fileURLToPath(new URL("../", import.meta.url));

export const generatedFile = "apps/web/lib/plugin-ui.generated.ts";

/** Render the map without touching the disk. */
export async function renderPluginUiMap(repository = root) {
  const plugins = await readPluginManifests(repository);
  return { plugins, content: renderPluginUiModule(plugins) };
}

/** Compare the rendered map with the file on disk; never writes. */
export async function checkPluginUiMap(repository = root) {
  const { plugins, content } = await renderPluginUiMap(repository);
  const path = join(repository, generatedFile);
  let current;
  try {
    current = await readFile(path, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    current = "";
  }
  return { plugins, path, content, current, matches: current === content };
}

/** Write the rendered map, creating its directory when missing. */
export async function writePluginUiMap(repository = root) {
  const { plugins, content } = await renderPluginUiMap(repository);
  const path = join(repository, generatedFile);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
  return { plugins, path };
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const args = process.argv.slice(2);
  const unknown = args.filter((arg) => arg !== "--check");
  if (unknown.length > 0) {
    console.error(
      `Unknown argument: ${unknown.join(" ")}\nUsage: node scripts/generate-plugin-ui.mjs [--check]`,
    );
    process.exitCode = 2;
  } else if (args.includes("--check")) {
    const { plugins, path, content, current, matches } =
      await checkPluginUiMap();
    const name = relative(process.cwd(), path).split("\\").join("/");
    if (matches) {
      console.log(
        `Plugin UI map is up to date: ${pluginCountLabel(plugins.length)} (${name})`,
      );
    } else {
      console.log(
        `Plugin UI map is stale: ${pluginCountLabel(plugins.length)}; the file on disk does not match the plugin manifests.`,
      );
      console.log(
        unifiedDiff(current, content, `${name} (on disk)`, `${name} (expected)`),
      );
      console.log("Run `node scripts/generate-plugin-ui.mjs` to regenerate it.");
      process.exitCode = 1;
    }
  } else {
    const { plugins, path } = await writePluginUiMap();
    console.log(
      `Generated ${relative(root, path).split("\\").join("/")}: ${pluginCountLabel(plugins.length)}`,
    );
  }
}
