// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Workspace name contract.
 *
 * The create and rename dialogs and the server share one name rule, so these
 * cases pin the rule itself: trim before storing, reject a blank name, reject a
 * name over the limit, and accept a name that is exactly at the limit.
 *
 * The import is relative and explicit (`.ts`) on purpose: this file runs under
 * `node --experimental-strip-types --test`, which does not resolve the
 * `@workspace/*` aliases.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { normalizeWorkspaceName } from "./name.ts";

const MAX_LENGTH = 50;

test("the name is trimmed before it is stored", () => {
  assert.equal(normalizeWorkspaceName("  项目 A  ", MAX_LENGTH), "项目 A");
});

test("empty and blank names are rejected", () => {
  assert.throws(
    () => normalizeWorkspaceName("", MAX_LENGTH),
    /Workspace name cannot be empty/,
  );
  assert.throws(
    () => normalizeWorkspaceName("   ", MAX_LENGTH),
    /Workspace name cannot be empty/,
  );
  assert.throws(
    () => normalizeWorkspaceName("\n\t", MAX_LENGTH),
    /Workspace name cannot be empty/,
  );
});

test("a name longer than the limit is rejected", () => {
  assert.throws(
    () => normalizeWorkspaceName("a".repeat(51), MAX_LENGTH),
    /Workspace name cannot exceed 50 characters/,
  );
});

test("a 50-character name is accepted", () => {
  assert.equal(normalizeWorkspaceName("a".repeat(50), MAX_LENGTH).length, 50);
});

test("a name exactly at the limit is accepted", () => {
  assert.equal(normalizeWorkspaceName("abc", 3), "abc");
});
