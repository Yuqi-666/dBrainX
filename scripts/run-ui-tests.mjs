// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Runs the UI test files of the client packages under `node --test`.
 *
 * `node --experimental-strip-types` erases type annotations but cannot transform
 * JSX, so a `.test.tsx` cannot run directly. This runner compiles the test
 * module graph with esbuild's transform API into a temporary directory as `.mjs`
 * and hands the compiled test files to `node --test`.
 *
 * Each package's temporary directory sits inside that package so bare imports
 * (`react`, `react-dom/server`, workspace packages) still resolve through the
 * package's own `node_modules`, which is where pnpm links them.
 *
 * A package with no test file exits 0 after printing that it had none, so the
 * runner never needs esbuild for a package that declares no test.
 *
 * Usage: `node scripts/run-ui-tests.mjs [packages/ui packages/hooks ...]`
 */
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));

const requested = process.argv.slice(2);
const packages =
  requested.length > 0
    ? requested
    : ["packages/ui", "packages/hooks", "packages/services", "packages/api-client"];

const testFile = /\.test\.tsx?$/;
const sourceFile = /\.tsx?$/;
const relativeImport = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(["'])(\.{1,2}\/[^"'\n]+)\1/g;

const ignoredDirs = new Set(["node_modules", "dist", "build", ".next", ".turbo"]);

/** Returns the absolute paths of every `*.test.ts(x)` under `dir`. */
function findTests(dir, found = []) {
  if (!existsSync(dir)) return found;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (ignoredDirs.has(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) findTests(path, found);
    else if (entry.isFile() && testFile.test(entry.name)) found.push(path);
  }
  return found;
}

/**
 * Resolves one relative import specifier to a source file. The sources use
 * explicit `.ts` extensions; `.js` is accepted for NodeNext-style imports.
 */
function resolveSpecifier(from, specifier) {
  const base = resolve(dirname(from), specifier);
  const candidates = [base];
  if (base.endsWith(".js")) {
    candidates.push(base.replace(/\.js$/, ".ts"), base.replace(/\.js$/, ".tsx"));
  }
  candidates.push(`${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx"));
  return candidates.find((candidate) => sourceFile.test(candidate) && existsSync(candidate));
}

/** Compiles one package's test graph into a temporary sibling directory. */
async function compilePackage(pkgDir, esbuild, tests) {
  const outDir = mkdtempSync(join(pkgDir, ".test-run-"));
  const outFile = (source) =>
    join(outDir, relative(pkgDir, source).replace(/\.tsx?$/, ".mjs"));
  const outputs = new Map();
  const compiled = [];

  const insidePackage = (source, from) => {
    const inside = relative(pkgDir, source);
    const outside = inside.startsWith("..") || inside.startsWith(sep);
    if (outside) {
      throw new Error(
        `${relative(root, from)} imports a module outside ${relative(root, pkgDir)}; ` +
          "run each package separately or move the shared module into a package that can be tested",
      );
    }
    return inside;
  };

  const pending = [...tests];
  while (pending.length > 0) {
    const source = pending.pop();
    insidePackage(source, source);
    const output = outFile(source);
    outputs.set(source, output);
    const { code } = await esbuild.transform(readFileSync(source, "utf8"), {
      loader: source.endsWith(".tsx") ? "tsx" : "ts",
      jsx: "automatic",
      format: "esm",
      target: "node24",
      sourcefile: relative(root, source),
    });
    for (const match of code.matchAll(relativeImport)) {
      const child = resolveSpecifier(source, match[2]);
      if (!child) continue;
      insidePackage(child, source);
      if (!outputs.has(child)) pending.push(child);
    }
    compiled.push({ source, output, code });
  }

  for (const { source, output, code } of compiled) {
    const rewritten = code.replace(relativeImport, (match, quote, specifier) => {
      const child = resolveSpecifier(source, specifier);
      const childOutput = child && outputs.get(child);
      if (!childOutput) return match;
      const path = relative(dirname(output), childOutput).split(sep).join("/");
      const specifierPath = path.startsWith(".") ? path : `./${path}`;
      return match.replace(`${quote}${specifier}${quote}`, `${quote}${specifierPath}${quote}`);
    });
    mkdirSync(dirname(output), { recursive: true });
    writeFileSync(output, rewritten);
  }

  return {
    outDir,
    tests: tests.map((source) => outputs.get(source)),
    modules: outputs.size,
  };
}

let exitCode = 0;

for (const pkg of packages) {
  const pkgDir = join(root, pkg);
  const manifest = join(pkgDir, "package.json");
  if (!existsSync(manifest)) {
    console.error(`ui-tests: ${pkg} is not a package (no package.json)`);
    exitCode = 1;
    continue;
  }

  const testSources = findTests(join(pkgDir, "src"));
  if (testSources.length === 0) {
    console.log(`ui-tests: ${pkg} has no test files`);
    continue;
  }

  const esbuild = createRequire(manifest)("esbuild");
  console.log(`ui-tests: esbuild ${esbuild.version} compiling ${pkg}`);

  let compiled;
  try {
    compiled = await compilePackage(pkgDir, esbuild, testSources);
  } catch (error) {
    console.error(`ui-tests: ${pkg} failed to compile: ${error.message}`);
    exitCode = 1;
    continue;
  }

  try {
    console.log(
      `ui-tests: ${pkg} transformed ${compiled.tests.length} test files (${compiled.modules} modules) into ${relative(root, compiled.outDir)}`,
    );
    const run = spawnSync(process.execPath, ["--test", ...compiled.tests], {
      cwd: pkgDir,
      stdio: "inherit",
    });
    if (run.status !== 0) exitCode = run.status ?? 1;
  } finally {
    rmSync(compiled.outDir, { recursive: true, force: true });
  }
}

process.exit(exitCode);
