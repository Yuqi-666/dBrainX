// SPDX-License-Identifier: AGPL-3.0-only

import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const requireServer = createRequire(
  new URL("../../apps/server/package.json", import.meta.url),
);
const { build } = requireServer("esbuild");
const root = fileURLToPath(new URL("../../", import.meta.url));
const result = await build({
  stdin: {
    contents: `
      export * from './packages/ui/src/lib/color-palette.ts';
      export { VisualConfig } from './backend/domain/src/models/view/value-objects.ts';
      export { ViewMapper } from './backend/infrastructure/src/database/mappers/view.mapper.ts';
      export { ViewCommandService } from './backend/application/src/commands/view/view-command.service.ts';
      export { ViewQueryService } from './backend/application/src/queries/view/view-query.service.ts';
    `,
    resolveDir: root,
    loader: "ts",
  },
  tsconfig: `${root}apps/server/tsconfig.json`,
  bundle: true,
  platform: "node",
  format: "cjs",
  write: false,
});
const module = { exports: {} };
new Function("module", "exports", "require", result.outputFiles[0].text)(
  module,
  module.exports,
  requireServer,
);
const {
  COLOR_PICKER_GROUPS,
  resolveThemeColor,
  resolveGridThemeColor,
  resolveViewColors,
  VisualConfig,
  ViewMapper,
  ViewCommandService,
  ViewQueryService,
} = module.exports;

test("all nine color families mirror 1↔6, 2↔5, 3↔4 and retain shades in the current theme", () => {
  for (const group of COLOR_PICKER_GROUPS) {
    assert.equal(group.colors.length, 6);
    for (let index = 0; index < 3; index++) {
      const light = group.colors[index].value;
      const dark = group.colors[5 - index].value;
      assert.equal(resolveThemeColor(light, "dark"), dark);
      assert.equal(resolveThemeColor(dark, "light"), light);
      assert.equal(resolveThemeColor(light, "light"), light);
      assert.equal(resolveThemeColor(dark, "dark"), dark);
      assert.equal(resolveThemeColor(light.toUpperCase(), "dark"), dark);
      assert.equal(resolveGridThemeColor(light, "light"), dark);
      assert.equal(resolveGridThemeColor(dark, "dark"), light);
      assert.equal(resolveGridThemeColor(dark, "light"), dark);
      assert.equal(resolveGridThemeColor(light, "dark"), light);
    }
  }
});

test("one shared preference syncs background and grid in opposite directions", () => {
  const config = {
    backgroundColor: "#93c5fd",
    gridColor: "#dc2626",
    colorsSyncTheme: true,
  };
  const dark = resolveViewColors(config, "dark");
  assert.deepEqual(dark, { backgroundColor: "#2563eb", gridColor: "#fca5a5" });
  assert.deepEqual(resolveViewColors(config, "light"), {
    backgroundColor: "#93c5fd",
    gridColor: "#dc2626",
  });
  assert.equal(config.backgroundColor, "#93c5fd");
  assert.equal(config.gridColor, "#dc2626");
  assert.deepEqual(
    resolveViewColors({ ...config, ...dark, colorsSyncTheme: false }, "light"),
    dark,
  );
});

test("legacy defaults remain unchanged without sync; synced defaults and custom colors resolve safely", () => {
  assert.deepEqual(resolveViewColors({}, "dark"), {
    backgroundColor: "#ffffff",
    gridColor: "#e5e7eb",
  });
  assert.deepEqual(
    resolveViewColors({ colorsSyncTheme: true }, "dark"),
    { backgroundColor: "#000000", gridColor: "#e2e8f0" },
  );
  assert.equal(resolveThemeColor("#123456", "dark"), "#123456");
  assert.equal(
    resolveThemeColor("var(--background)", "light"),
    "var(--background)",
  );
});

test("domain copies preserve the shared sync preference and equality distinguishes it", () => {
  const config = VisualConfig.create({
    colorsSyncTheme: true,
  });
  for (const copy of [
    config.withBackgroundColor("#93c5fd"),
    config.withBackgroundStyle("dots"),
    config.withGridColor("#fca5a5"),
    config.withGridSpacing(30),
    config.withSnapToGrid(true),
    config.withShowMinimap(true),
  ]) {
    assert.equal(copy.colorsSyncTheme, true);
  }
  assert.equal(
    config.equals(VisualConfig.create({ ...config, colorsSyncTheme: false })),
    false,
  );
});

test("theme preferences round-trip through storage, command patches and query responses", async () => {
  const initial = ViewMapper.toDomain({
    id: "test-view",
    name: "Test",
    viewType: "Force",
    visualConfig: {
      backgroundColor: "#93c5fd",
      gridColor: "#fca5a5",
      colorsSyncTheme: true,
    },
    filterConfig: {},
    isPinned: false,
  });
  const record = ViewMapper.toRecord(initial);
  let stored = ViewMapper.toDomain(record);
  const repository = {
    findById: async () => stored,
    findAll: async () => [stored],
    save: async (view) =>
      (stored = ViewMapper.toDomain(ViewMapper.toRecord(view))),
  };
  const command = new ViewCommandService(repository, { publish() {} });
  const updated = await command.updateView({
    id: initial.id.value,
    userId: "test-user",
    visualConfig: { backgroundStyle: "dots" },
  });
  const [read] = await new ViewQueryService(repository).list({});
  for (const dto of [updated, read]) {
    assert.equal(dto.visualConfig.colorsSyncTheme, true);
    assert.equal(dto.visualConfig.backgroundColor, "#93c5fd");
    assert.equal(dto.visualConfig.gridColor, "#fca5a5");
    assert.equal(dto.visualConfig.backgroundStyle, "dots");
  }
  await command.updateView({
    id: initial.id.value,
    userId: "test-user",
    visualConfig: { colorsSyncTheme: false },
  });
  const disabled = await new ViewQueryService(repository).getById({
    id: initial.id.value,
  });
  assert.equal(disabled.visualConfig.colorsSyncTheme, false);
});
