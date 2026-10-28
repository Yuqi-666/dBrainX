// SPDX-License-Identifier: AGPL-3.0-only

import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { messages } from "./messages.ts";
import {
  DEFAULT_LOCALE,
  LOCALE_STORAGE_KEY,
  getLocale,
  initializeLocale,
  resolveLocale,
  setLocale,
  subscribeLocale,
  translate,
} from "./runtime.ts";

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
const originalDocument = Object.getOwnPropertyDescriptor(
  globalThis,
  "document",
);

afterEach(() => {
  for (const [name, descriptor] of [
    ["window", originalWindow],
    ["document", originalDocument],
  ] as const) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else Reflect.deleteProperty(globalThis, name);
  }
  setLocale(DEFAULT_LOCALE, false);
});

function browser(saved: string | null = null, blocked = false) {
  const storage = new Map<string, string>();
  if (saved) storage.set(LOCALE_STORAGE_KEY, saved);
  const events = new Map<string, (event: StorageEvent) => void>();
  const document = { documentElement: { lang: "zh-CN" } };
  const window = {
    localStorage: {
      getItem: (key: string) => {
        if (blocked) throw new Error("Storage blocked");
        return storage.get(key) ?? null;
      },
      setItem: (key: string, value: string) => {
        if (blocked) throw new Error("Storage blocked");
        storage.set(key, value);
      },
    },
    addEventListener: (type: string, handler: (event: StorageEvent) => void) =>
      events.set(type, handler),
    removeEventListener: (type: string) => events.delete(type),
  };
  Object.defineProperty(globalThis, "window", {
    value: window,
    configurable: true,
  });
  Object.defineProperty(globalThis, "document", {
    value: document,
    configurable: true,
  });
  return { storage, events, document };
}

test("defaults to Chinese and supports both catalogs with source fallback", () => {
  assert.equal(getLocale(), "zh-CN");
  assert.equal(translate("Sign In"), "登录");
  assert.equal(translate("节点", undefined, "en"), "Nodes");
  assert.equal(translate("missing.key", undefined, "en"), "missing.key");
  assert.equal(resolveLocale("fr"), "zh-CN");
  assert.equal(resolveLocale(null), "zh-CN");
  assert.equal(resolveLocale("en"), "en");
});

test("interpolation preserves user content and substitutes complete sentences", () => {
  assert.equal(
    translate("打开节点 {value1}", { value1: "节点" }, "en"),
    "Open node 节点",
  );
  assert.equal(
    translate("已删除 {time} 的笔记", { time: "1:20" }, "en"),
    "Deleted note at 1:20",
  );
  assert.equal(
    translate("{count} 个隐藏字段", { count: 0 }, "en"),
    "0 hidden fields",
  );
});

test("all messages have both languages and matching interpolation fields", () => {
  const fields = (value: string) =>
    [...value.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
  for (const [key, entry] of Object.entries(messages)) {
    assert.ok(entry.en.trim(), `${key}: missing English`);
    assert.ok(entry["zh-CN"].trim(), `${key}: missing Chinese`);
    assert.deepEqual(
      fields(entry.en),
      fields(entry["zh-CN"]),
      `${key}: interpolation mismatch`,
    );
  }
});

test("initialization restores the choice, updates html lang, and cleans up storage listeners", () => {
  const fixture = browser("en");
  const cleanup = initializeLocale();
  assert.equal(getLocale(), "en");
  assert.equal(fixture.document.documentElement.lang, "en");
  assert.ok(fixture.events.has("storage"));
  cleanup();
  assert.equal(fixture.events.size, 0);
});

test("switching persists the choice and notifies subscribers without duplicate notifications", () => {
  const fixture = browser();
  let notifications = 0;
  const unsubscribe = subscribeLocale(() => notifications++);
  try {
    setLocale("en");
    setLocale("en");
    assert.equal(notifications, 1);
    assert.equal(fixture.storage.get(LOCALE_STORAGE_KEY), "en");
    assert.equal(translate("保存"), "Save");
    setLocale("zh-CN");
    assert.equal(notifications, 2);
    assert.equal(fixture.document.documentElement.lang, "zh-CN");
  } finally {
    unsubscribe();
  }
});

test("storage events synchronize other tabs and reset to Chinese when cleared", () => {
  const fixture = browser("en");
  const cleanup = initializeLocale();
  try {
    fixture.events.get("storage")?.({
      key: "unrelated",
      newValue: "zh-CN",
    } as StorageEvent);
    assert.equal(getLocale(), "en");
    fixture.events.get("storage")?.({
      key: LOCALE_STORAGE_KEY,
      newValue: "zh-CN",
    } as StorageEvent);
    assert.equal(getLocale(), "zh-CN");
    setLocale("en");
    fixture.events.get("storage")?.({
      key: null,
      newValue: null,
    } as StorageEvent);
    assert.equal(getLocale(), "zh-CN");
  } finally {
    cleanup();
  }
});

test("switching works when storage is blocked and initialization is safe without a browser", () => {
  browser(null, true);
  const cleanup = initializeLocale();
  try {
    assert.doesNotThrow(() => setLocale("en"));
    assert.equal(getLocale(), "en");
  } finally {
    cleanup();
  }
  Reflect.deleteProperty(globalThis, "window");
  Reflect.deleteProperty(globalThis, "document");
  assert.doesNotThrow(() => initializeLocale()());
});
