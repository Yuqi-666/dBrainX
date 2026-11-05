// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The plugin kit's export set is a contract, so it is asserted, not assumed.
 *
 * `@workspace/ui/plugin-kit` is the one `@workspace/ui` subpath an out-of-repo
 * plugin may import (§4.10.2). Three properties therefore have to hold, and each
 * one fails here rather than in a plugin author's build:
 *
 * 1. Every documented name is exported, with the runtime values actually
 *    resolvable — the module is bundled and imported, not just parsed.
 * 2. The export set is exactly the documented set. An extra name added "while
 *    we are there" is a new public contract, so an unlisted export fails.
 * 3. The module graph the entry pulls in imports no `next/*` module and no Node
 *    builtin. A UI module a plugin bundles runs in the browser.
 *
 * `packages/ui` test files run under `node --test` with type stripping, whose
 * resolver rejects the workspace packages' extensionless imports, so the entry
 * is bundled with esbuild first — the same recipe
 * `components/node-content/use-node-content-writer.test.ts` uses.
 */
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { build } from "esbuild";
import ts from "typescript";

const DIR = fileURLToPath(new URL("./", import.meta.url));
const ENTRY = join(DIR, "index.ts");
/** The repository root: `packages/ui/src/plugin-kit/` up four levels. */
const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const TSCONFIG = join(ROOT, "tsconfig.workspace.json");

/**
 * The names the builtin editors import, and the reason this file exists
 * (plan `review-gap-remediation` todo 8). Every one of them lives in a
 * `components/*` module that `packages/ui` treats as internal.
 */
const BUILTIN_EDITOR_EXPORTS = [
  "MediaNodeLayout",
  "useMediaTimestamps",
  "getNodeContentDescriptor",
  "NodeContentHeader",
  "NODE_ICON_PLATE",
  "NODE_ICON_GLYPH",
  "NODE_ICON_FALLBACK",
  "Button",
  "Input",
  "toast",
  "AudioPlayer",
  "VideoPlayer",
  "NativeVideoPlayer",
  "NodePreviewCover",
  "NodeCoverContribution",
  "CollectionFilterDialog",
  "CoverSelectorPopover",
  "IconSelectorPopover",
  "IconView",
  "ImageViewer",
  "PdfViewer",
  "PdfLoadFailure",
  "CodeEditor",
  "languageFromFilename",
] as const;

/** The names the entry exported before the editors' vocabulary was added. */
const EARLIER_EXPORTS = [
  "FileDropZone",
  "useNodeContentWriter",
  "createContentWriteQueue",
  "OPERATION_NOT_DECLARED",
  "ContentInvocation",
  "ContentWriteFailure",
  "ContentWriteOutcome",
  "ContentWriteQueue",
  "NodeContentWriter",
  "coalesceIntents",
  "intentPreview",
  "isMergeableOperation",
  "isReplayableOperation",
  "queuedContent",
  "ContentWriteIntent",
  "OperationWriteIntent",
  "MediaController",
  "MediaControllerCallback",
  "NoteCluster",
  "NoteDoc",
  "TimestampAddRequest",
  "TimestampFocusRequest",
  "TimestampNoteActivation",
  "TooltipAlignment",
  "MediaKind",
  "TimestampData",
  "TimestampKind",
  "TimestampNoteData",
  "TimestampSubtitleData",
] as const;

/**
 * The names that survive type erasure. The two type-only exports of the
 * editor vocabulary (`NodeCoverContribution`, `PdfLoadFailure`) and the earlier
 * type exports are absent from a runtime namespace by design, so they are
 * asserted against the parsed export list below.
 */
const TYPE_ONLY_EXPORTS = [
  "NodeCoverContribution",
  "PdfLoadFailure",
  "ContentInvocation",
  "ContentWriteFailure",
  "ContentWriteOutcome",
  "ContentWriteQueue",
  "NodeContentWriter",
  "ContentWriteIntent",
  "OperationWriteIntent",
  "MediaController",
  "MediaControllerCallback",
  "NoteCluster",
  "NoteDoc",
  "TimestampAddRequest",
  "TimestampFocusRequest",
  "TimestampNoteActivation",
  "TooltipAlignment",
  "MediaKind",
  "TimestampData",
  "TimestampKind",
  "TimestampNoteData",
  "TimestampSubtitleData",
] as const;

const DOCUMENTED_EXPORTS = new Set<string>([
  ...BUILTIN_EDITOR_EXPORTS,
  ...EARLIER_EXPORTS,
]);

const DOCUMENTED_VALUES = [...DOCUMENTED_EXPORTS]
  .filter((name) => !(TYPE_ONLY_EXPORTS as readonly string[]).includes(name))
  .sort();

/**
 * The one Node builtin reachable under Node's export conditions, and where it
 * comes from. `@workspace/store`'s id stores use `ulid`, whose package exports
 * map hands Node a `dist/node` build that imports `node:crypto`; the browser
 * condition resolves `dist/browser`, which imports nothing. It predates this
 * file (the writer re-export already reaches the store), so it is recorded
 * rather than hidden: a *second* entry here fails the test.
 */
const NODE_CONDITION_BUILTINS = ["node:crypto"];

/** Node's module names, checked as bare specifiers as well as with the prefix. */
const NODE_BUILTINS = new Set([
  "assert",
  "async_hooks",
  "buffer",
  "child_process",
  "cluster",
  "console",
  "constants",
  "crypto",
  "dgram",
  "diagnostics_channel",
  "dns",
  "domain",
  "events",
  "fs",
  "http",
  "http2",
  "https",
  "inspector",
  "module",
  "net",
  "os",
  "path",
  "perf_hooks",
  "process",
  "punycode",
  "querystring",
  "readline",
  "repl",
  "stream",
  "string_decoder",
  "sys",
  "timers",
  "tls",
  "trace_events",
  "tty",
  "url",
  "util",
  "v8",
  "vm",
  "worker_threads",
  "zlib",
]);

interface BundledGraph {
  readonly inputs: readonly string[];
  readonly imports: readonly { readonly file: string; readonly path: string; readonly external: boolean }[];
}

interface BuildResult {
  readonly graph: BundledGraph;
  readonly outfile: string;
}

async function bundle(options: {
  platform: "browser" | "node";
  outfile: string;
  jsx: "automatic" | "transform";
}): Promise<BuildResult> {
  const result = await build({
    entryPoints: [ENTRY],
    absWorkingDir: ROOT,
    tsconfig: TSCONFIG,
    bundle: true,
    platform: options.platform,
    format: "esm",
    target: "esnext",
    jsx: options.jsx,
    outfile: options.outfile,
    metafile: true,
    logLevel: "silent",
    // Stylesheets are not part of the module graph a plugin resolves; the
    // components ship them for the app's Tailwind pass.
    loader: { ".css": "empty", ".scss": "empty" },
  });
  const inputs = Object.keys(result.metafile.inputs);
  const imports: { file: string; path: string; external: boolean }[] = [];
  for (const [file, info] of Object.entries(result.metafile.inputs)) {
    for (const imported of info.imports) {
      imports.push({ file, path: imported.path, external: imported.external === true });
    }
  }
  return { graph: { inputs, imports }, outfile: options.outfile };
}

let outDir = "";
let browser: BuildResult;
let node: BuildResult;
let runtime: Record<string, unknown>;

before(async () => {
  outDir = await mkdtemp(join(tmpdir(), "plugin-kit-exports-"));
  [browser, node] = await Promise.all([
    bundle({ platform: "browser", outfile: join(outDir, "kit.browser.mjs"), jsx: "automatic" }),
    bundle({ platform: "node", outfile: join(outDir, "kit.node.mjs"), jsx: "automatic" }),
  ]);
  // The Node bundle is the one this process can import, so it is what proves
  // each value exists and evaluates.
  runtime = (await import(pathToFileURL(node.outfile).href)) as Record<string, unknown>;
});

after(async () => {
  await rm(outDir, { recursive: true, force: true });
});

test("the entry exports exactly the documented names, and nothing else", async () => {
  const source = ts.createSourceFile(
    ENTRY,
    await readFile(ENTRY, "utf8"),
    ts.ScriptTarget.ESNext,
    true,
  );
  const parsed: string[] = [];
  for (const statement of source.statements) {
    if (!ts.isExportDeclaration(statement)) continue;
    const clause = statement.exportClause;
    // A wildcard re-export would make the set unknowable from this file, which
    // is exactly what the plugin surface must not do.
    assert.ok(
      clause !== undefined && ts.isNamedExports(clause),
      `plugin-kit/index.ts must export named symbols only (found ${statement.getText(source)})`,
    );
    for (const element of clause.elements) parsed.push(element.name.text);
  }

  assert.deepEqual(
    [...parsed].sort(),
    [...DOCUMENTED_EXPORTS].sort(),
    "the plugin kit's export set changed; update the documented list with the contract",
  );
});

test("every builtin editor symbol is exported from the plugin kit", async () => {
  const keys = new Set(Object.keys(runtime));
  const parsed = new Set(
    (await readFile(ENTRY, "utf8")).match(/\b[A-Za-z_][A-Za-z0-9_]*\b/g) ?? [],
  );

  for (const name of BUILTIN_EDITOR_EXPORTS) {
    assert.ok(DOCUMENTED_EXPORTS.has(name), `${name} is missing from the documented export list`);
    const isTypeOnly = (TYPE_ONLY_EXPORTS as readonly string[]).includes(name);
    if (isTypeOnly) {
      // Type-only: asserted by the export-list test above; a value with that
      // name would be a second, unintended contract.
      assert.ok(parsed.has(name), `${name} is not mentioned in plugin-kit/index.ts`);
      assert.equal(
        Object.hasOwn(runtime, name),
        false,
        `${name} is documented as a type but exported as a runtime value`,
      );
    } else {
      assert.ok(keys.has(name), `${name} is not a runtime export of @workspace/ui/plugin-kit`);
    }
  }
});

test("the runtime namespace is exactly the documented value exports", () => {
  assert.deepEqual(
    Object.keys(runtime).sort(),
    DOCUMENTED_VALUES,
    "a runtime export is missing or was added without being documented",
  );
});

test("no module reachable from the entry imports next/* or a Node builtin", async () => {
  const offenders: string[] = [];
  for (const imported of browser.graph.imports) {
    if (/^next(\/|$)/.test(imported.path)) {
      offenders.push(`${imported.file} -> ${imported.path}`);
      continue;
    }
    if (imported.path.startsWith("node:") || NODE_BUILTINS.has(imported.path)) {
      offenders.push(`${imported.file} -> ${imported.path}`);
    }
  }
  // Type-only imports are erased from the bundle, so they are read from the
  // reachable sources as well: a `next/*` type import is still a plugin's
  // dependency on the app framework.
  for (const input of browser.graph.inputs) {
    if (!input.startsWith("packages/")) continue;
    const text = await readFile(join(ROOT, input), "utf8");
    for (const match of text.matchAll(/\bfrom\s*["'](next(?:\/[^"']*)?)["']/g)) {
      offenders.push(`${input} -> ${match[1]} (type-only or erased import)`);
    }
  }
  assert.deepEqual(offenders, [], "the plugin kit reaches a framework or runtime module");
});

test("the only Node-condition builtin is the documented ulid path", () => {
  const builtins = [
    ...new Set(
      node.graph.imports
        .filter(
          (imported) =>
            imported.external &&
            (imported.path.startsWith("node:") || NODE_BUILTINS.has(imported.path)),
        )
        .map((imported) => imported.path),
    ),
  ].sort();
  assert.deepEqual(
    builtins,
    NODE_CONDITION_BUILTINS,
    "the Node-condition module graph gained or lost a Node builtin; re-read the allowlist above",
  );
});
