// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Guards the plugin manifest contract and the packaging/UI-map readers: a
 * manifest that breaks the contract must fail loudly, and a valid one must
 * copy its manifest plus declared entries into the packaged tree.
 */
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync, lstatSync, realpathSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import {
  preparePlugins,
  readPluginManifests,
  renderPluginUiModule,
} from "./plugin-packages.mjs";
import { unifiedDiff } from "../generate-plugin-ui.mjs";

/** A throwaway checkout root; `files` are written below it. */
async function fixture(files) {
  const root = await mkdtemp(join(tmpdir(), "dbrainx-plugins-"));
  for (const [name, content] of Object.entries(files)) {
    const path = join(root, name);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content === null ? "" : content);
  }
  return root;
}

const manifest = (value) => JSON.stringify(value, null, 2);

describe("plugin manifests", () => {
  it("reports no plugins for a tree without manifests", async () => {
    const root = await fixture({});
    try {
      assert.deepEqual(await readPluginManifests(root), []);
      assert.match(
        renderPluginUiModule([]),
        /^export const pluginUiDescriptors: readonly PluginUiDescriptor\[\] = \[\];$/m,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("reads canonical and aliased manifests, sorted by id", async () => {
    const root = await fixture({
      "plugins/b-second/plugin.json": manifest({
        id: "example.second",
        version: "1.0.0",
        ui: "@plugin/b-second/ui",
        server: "./server/index.ts",
      }),
      "plugins/b-second/server/index.ts": "",
      "plugins/a-first/package.json": JSON.stringify({ name: "@plugin/a-first" }),
      "plugins/a-first/plugin.json": manifest({
        id: "example.first",
        version: "0.1.0",
        uiEntry: "./ui/index.ts",
        serverEntry: "./server",
        nodeTypesEntry: "./server/node-types.ts",
      }),
      "plugins/a-first/ui/index.ts": "",
      "plugins/a-first/server/index.ts": "",
      "plugins/a-first/server/node-types.ts": "",
      // A package without a manifest is not pluggable yet.
      "plugins/unpackaged/package.json": JSON.stringify({ name: "@plugin/u" }),
    });
    try {
      const manifests = await readPluginManifests(root);
      assert.deepEqual(
        manifests.map((plugin) => [plugin.id, plugin.ui, plugin.server]),
        [
          ["example.first", "@plugin/a-first/ui", "./server"],
          ["example.second", "@plugin/b-second/ui", "./server/index.ts"],
        ],
      );
      const source = renderPluginUiModule(manifests);
      assert.match(
        source,
        /^ {2}\{ pluginId: "example\.first", entry: "@plugin\/a-first\/ui" \},$/m,
      );
      assert.match(
        source,
        /^ {2}\{ pluginId: "example\.second", entry: "@plugin\/b-second\/ui" \},$/m,
      );
      assert.ok(
        source.indexOf("example.first") < source.indexOf("example.second"),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects a relative ui path that does not exist", async () => {
    const root = await fixture({
      "plugins/ghost/server/index.ts": "",
      "plugins/ghost/plugin.json": manifest({
        id: "ghost",
        version: "1.0.0",
        ui: "./ui/index.ts",
        server: "./server/index.ts",
      }),
    });
    try {
      await assert.rejects(
        readPluginManifests(root),
        /"ui" points at a missing path/,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects a server path outside the plugin directory", async () => {
    const root = await fixture({
      "outside.ts": "",
      "plugins/escape/plugin.json": manifest({
        id: "escape",
        version: "1.0.0",
        ui: "@plugin/escape/ui",
        server: "../../outside.ts",
      }),
    });
    try {
      await assert.rejects(
        readPluginManifests(root),
        /"server" must stay inside the plugin directory/,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects a server file link that resolves outside the plugin directory", async () => {
    const root = await fixture({
      "outside/secret.ts": "host secret",
      "plugins/linked/plugin.json": manifest({
        id: "linked-file",
        version: "1.0.0",
        ui: "@plugin/linked/ui",
        server: "./server.ts",
      }),
    });
    try {
      symlinkSync(
        join(root, "outside", "secret.ts"),
        join(root, "plugins", "linked", "server.ts"),
      );
      await assert.rejects(readPluginManifests(root), {
        message:
          /^plugins\/linked\/plugin\.json: "server" resolves outside the plugin directory through a link: \.\/server\.ts$/,
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects a server directory link that resolves outside the plugin directory", async () => {
    const root = await fixture({
      "outside/secret.ts": "host secret",
      "plugins/linked/plugin.json": manifest({
        id: "linked-dir",
        version: "1.0.0",
        ui: "@plugin/linked/ui",
        server: "./server",
      }),
    });
    try {
      symlinkSync(
        join(root, "outside"),
        join(root, "plugins", "linked", "server"),
      );
      await assert.rejects(readPluginManifests(root), {
        message:
          /^plugins\/linked\/plugin\.json: "server" resolves outside the plugin directory through a link: \.\/server$/,
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("accepts a server link that resolves inside the plugin directory", async () => {
    const root = await fixture({
      "plugins/inner/plugin.json": manifest({
        id: "inner-link",
        version: "1.0.0",
        ui: "./ui/index.ts",
        server: "./server/entry.ts",
      }),
      "plugins/inner/ui/index.ts": "ui",
      "plugins/inner/server/real.ts": "real server entry",
    });
    try {
      symlinkSync(
        join(root, "plugins", "inner", "server", "real.ts"),
        join(root, "plugins", "inner", "server", "entry.ts"),
      );
      const [plugin] = await readPluginManifests(root);
      assert.equal(plugin.id, "inner-link");
      assert.equal(
        realpathSync(plugin.serverPath),
        realpathSync(join(root, "plugins", "inner", "server", "real.ts")),
      );
      const destination = join(root, "out");
      await preparePlugins(root, destination);
      const packaged = join(
        destination,
        "plugins",
        "inner",
        "server",
        "entry.ts",
      );
      assert.equal(await readFile(packaged, "utf8"), "real server entry");
      assert.equal(lstatSync(packaged).isSymbolicLink(), false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects a relative ui path that escapes the plugin directory", async () => {
    const root = await fixture({
      "shared/ui/index.ts": "",
      "plugins/escaping-ui/server/index.ts": "",
      "plugins/escaping-ui/plugin.json": manifest({
        id: "escaping-ui",
        version: "1.0.0",
        ui: "../shared/ui/index.ts",
        server: "./server/index.ts",
      }),
    });
    try {
      await assert.rejects(readPluginManifests(root), {
        message:
          /^plugins\/escaping-ui\/plugin\.json: "ui" must stay inside the plugin directory: \.\.\/shared\/ui\/index\.ts$/,
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects a duplicate id and a missing required field", async () => {
    const duplicate = await fixture({
      "plugins/one/plugin.json": manifest({
        id: "same",
        version: "1.0.0",
        ui: "@plugin/one/ui",
        server: "./server",
      }),
      "plugins/one/server/index.ts": "",
      "plugins/two/plugin.json": manifest({
        id: "same",
        version: "1.0.0",
        ui: "@plugin/two/ui",
        server: "./server",
      }),
      "plugins/two/server/index.ts": "",
    });
    const missing = await fixture({
      "plugins/incomplete/plugin.json": manifest({
        id: "incomplete",
        version: "1.0.0",
        server: "./server",
      }),
    });
    try {
      await assert.rejects(readPluginManifests(duplicate), /duplicate plugin id/);
      await assert.rejects(readPluginManifests(missing), /"ui" is required/);
    } finally {
      await rm(duplicate, { recursive: true, force: true });
      await rm(missing, { recursive: true, force: true });
    }
  });
});

describe("plugin packaging", () => {
  it("copies the manifest, the server directory and declared node types", async () => {
    const root = await fixture({
      "plugins/example/package.json": JSON.stringify({ name: "@plugin/example" }),
      "plugins/example/plugin.json": manifest({
        id: "example.pack",
        version: "2.0.0",
        ui: "./ui/index.ts",
        server: "./server/index.ts",
        nodeTypes: "./server/node-types.ts",
      }),
      "plugins/example/ui/index.ts": "ui",
      "plugins/example/server/index.ts": 'import "./node-types.ts";',
      "plugins/example/server/node-types.ts": "types",
    });
    try {
      const destination = join(root, "out");
      await mkdir(destination, { recursive: true });
      const [plugin] = await preparePlugins(root, destination);
      assert.equal(plugin.ui, "@plugin/example/ui");
      const packaged = join(destination, "plugins", "example");
      assert.ok(existsSync(join(packaged, "plugin.json")));
      assert.ok(existsSync(join(packaged, "server", "index.ts")));
      assert.ok(existsSync(join(packaged, "server", "node-types.ts")));
      assert.equal(
        JSON.parse(await readFile(join(packaged, "plugin.json"), "utf8")).id,
        "example.pack",
      );
      assert.equal(
        await readFile(join(packaged, "server", "node-types.ts"), "utf8"),
        "types",
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("plugin UI map diff", () => {
  it("is empty for identical text and shows both sides otherwise", () => {
    const source = renderPluginUiModule([]);
    assert.equal(unifiedDiff(source, source, "a", "b"), "");
    const tampered = `${source}// hand edit\n`;
    const diff = unifiedDiff(tampered, source, "on disk", "expected");
    assert.match(diff, /^--- on disk$/m);
    assert.match(diff, /^\+\+\+ expected$/m);
    assert.match(diff, /^-\/\/ hand edit$/m);
    assert.match(diff, /^@@ /m);
  });
});
