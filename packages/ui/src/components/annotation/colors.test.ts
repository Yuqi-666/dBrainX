// SPDX-License-Identifier: AGPL-3.0-only

import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  annotationColorFromHex,
  annotationPaletteHex,
  annotationPickerValue,
  isAnnotationColor,
} from "./colors.ts";

test("full-palette colors survive brush preference and stroke token round trips", () => {
  for (const hex of [
    "#ffffff",
    "#000000",
    "#fdba74",
    "#115e59",
    "#6366f1",
    "#9d174d",
  ]) {
    const token = annotationColorFromHex(hex);
    assert.ok(token);
    assert.equal(isAnnotationColor(JSON.parse(JSON.stringify(token))), true);
    assert.equal(annotationPaletteHex(token), hex);
    assert.equal(annotationPickerValue(token), hex);
  }
  assert.equal(annotationColorFromHex("#ABCDEF"), "palette:abcdef");
});

test("legacy annotation tokens remain valid and keep using theme colors", () => {
  for (const key of [
    "red",
    "yellow",
    "green",
    "blue",
    "purple",
    "ink",
  ] as const) {
    assert.equal(isAnnotationColor(key), true);
    assert.equal(annotationPaletteHex(key), undefined);
    assert.match(annotationPickerValue(key), /^#[0-9a-f]{6}$/);
  }
});

test("invalid preference tokens and non-palette CSS values are rejected", () => {
  for (const value of [
    null,
    42,
    {},
    "",
    "orange",
    "palette:fff",
    "palette:gg0000",
    "palette:1234567",
    "var(--color)",
  ]) {
    assert.equal(isAnnotationColor(value), false);
  }
  for (const value of [
    "red",
    "#fff",
    "#gg0000",
    "rgba(0,0,0,1)",
    "palette:123456",
  ]) {
    assert.equal(annotationColorFromHex(value), undefined);
  }
});
