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
      export { queuedContent, mergeNodePatches } from './packages/ui/src/components/node-content/node-content-patches.ts';
      export { rowsToEvents, eventToCells, selectionToRow, readEventReadout } from './packages/dataview/src/views/calendar/core/schema.ts';
      export { DatabaseContent, DatabaseField } from './backend/domain/src/models/node/value-objects.ts';
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
  queuedContent,
  mergeNodePatches,
  DatabaseContent,
  DatabaseField,
  rowsToEvents,
  eventToCells,
  selectionToRow,
  readEventReadout,
} = module.exports;

test("date fields retain time mode and minute precision through domain reconstruction", () => {
  const content = DatabaseContent.fromData({
    fields: [{ id: "when", name: "时间", type: "date", includeTime: true }],
    rows: [
      {
        id: "row",
        cells: { when: { type: "date", date: "2026-10-13T14:35" } },
      },
    ],
  });
  const field = content.fields[0];
  assert.equal(field.includeTime, true);
  assert.equal(field.withName("开始时间").includeTime, true);
  assert.equal(field.withOptions([]).includeTime, true);
  assert.equal(content.rows[0].cells.when.value.date, "2026-10-13T14:35");
  assert.equal(field.equals(new DatabaseField("when", "时间", "date")), false);
});

test("legacy date fields default to date-only without changing their value", () => {
  const content = DatabaseContent.fromData({
    fields: [{ id: "when", name: "日期", type: "date" }],
    rows: [
      { id: "row", cells: { when: { type: "date", date: "2026-10-13" } } },
    ],
  });
  assert.equal(content.fields[0].includeTime, false);
  assert.equal(content.rows[0].cells.when.value.date, "2026-10-13");
});

const calendarFields = [
  { id: "start", name: "开始", type: "date", includeTime: true },
  { id: "end", name: "结束", type: "date", includeTime: true },
];
const calendarConfig = { startField: "start", endField: "end" };
const startTime = new Date(2026, 9, 13, 14, 35);
const endTime = new Date(2026, 9, 13, 15, 45);

test("calendar projects minute precision as timed events for week, day and agenda", () => {
  const source = {
    kind: "database",
    fields: calendarFields,
    rows: [
      {
        id: "row",
        cells: {
          start: { type: "date", date: "2026-10-13T14:35" },
          end: { type: "date", date: "2026-10-13T15:45" },
        },
      },
    ],
  };
  const [event] = rowsToEvents(source, calendarConfig);
  assert.equal(event.allDay, false);
  assert.equal(event.start, "2026-10-13T14:35");
  assert.equal(event.end, "2026-10-13T15:45");
  const readout = readEventReadout(
    { ...event, start: startTime, end: endTime },
    "en-GB",
  );
  assert.match(readout.dateText, /14:35/);
  assert.match(readout.dateText, /15:45/);
});

test("calendar drag, resize and time-slot selection keep exact start and end times", () => {
  const writes = eventToCells(
    { rowId: "row", start: startTime, end: endTime },
    calendarConfig,
    calendarFields,
  );
  assert.equal(writes[0].cell.date, "2026-10-13T14:35");
  assert.equal(writes[1].cell.date, "2026-10-13T15:45");
  const row = selectionToRow(
    calendarFields,
    { start: startTime, end: endTime },
    calendarConfig,
  );
  assert.equal(row.cells.start.date, "2026-10-13T14:35");
  assert.equal(row.cells.end.date, "2026-10-13T15:45");
});

test("calendar date-only events retain inclusive end days and exclusive calendar boundaries", () => {
  const fields = calendarFields.map((field) => ({
    ...field,
    includeTime: false,
  }));
  const [event] = rowsToEvents(
    {
      kind: "database",
      fields,
      rows: [
        {
          id: "row",
          cells: {
            start: { type: "date", date: "2026-10-13" },
            end: { type: "date", date: "2026-10-15" },
          },
        },
      ],
    },
    calendarConfig,
  );
  assert.equal(event.allDay, true);
  assert.equal(event.end, "2026-10-16");
  const writes = eventToCells(
    { rowId: "row", start: new Date(2026, 9, 13), end: new Date(2026, 9, 16) },
    calendarConfig,
    fields,
  );
  assert.equal(writes[0].cell.date, "2026-10-13");
  assert.equal(writes[1].cell.date, "2026-10-15");
});

test("one calendar drag queues both date changes without reverting the start", () => {
  const content = {
    fields: calendarFields,
    rows: [
      {
        id: "row",
        cells: {
          start: { type: "date", date: "2026-10-12T14:35" },
          end: { type: "date", date: "2026-10-12T15:45" },
        },
      },
    ],
  };
  const pending = [];
  for (const write of eventToCells(
    { rowId: "row", start: startTime, end: endTime },
    calendarConfig,
    calendarFields,
  )) {
    const live = queuedContent(content, pending);
    const rows = live.rows.map((row) =>
      row.id === write.rowId
        ? { ...row, cells: { ...row.cells, [write.fieldId]: write.cell } }
        : row,
    );
    pending.push({ content: { rows } });
  }
  const merged = mergeNodePatches(pending);
  assert.equal(merged.content.rows[0].cells.start.date, "2026-10-13T14:35");
  assert.equal(merged.content.rows[0].cells.end.date, "2026-10-13T15:45");
  assert.equal(content.rows[0].cells.start.date, "2026-10-12T14:35");
});

test("queued node writes preserve separate content keys and top-level changes", () => {
  const rows = [{ id: "row", cells: {} }];
  const pending = [
    { content: { rows } },
    { title: "标题", content: { fields: calendarFields } },
  ];
  const merged = mergeNodePatches(pending);
  assert.deepEqual(merged.content, { rows, fields: calendarFields });
  assert.equal(merged.title, "标题");
});
