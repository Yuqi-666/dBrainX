// SPDX-License-Identifier: AGPL-3.0-only

import assert from 'node:assert/strict';
import test from 'node:test';
import { assertNextVersion, compareVersions } from './assert-next-version.mjs';

test('release versions advance stable and prerelease tags', () => {
  assert.equal(compareVersions('0.2.0', '0.1.99'), 1);
  assert.equal(compareVersions('1.0.0-rc.2', '1.0.0-rc.10'), -1);
  assert.equal(compareVersions('1.0.0', '1.0.0-rc.10'), 1);
  assert.equal(compareVersions('1.0.0-beta', '1.0.0-beta.1'), -1);
  assert.doesNotThrow(() => assertNextVersion('1.0.0', ['v0.9.9', 'v1.0.0-rc.2', 'other']));
  assert.throws(() => assertNextVersion('0.9.0', ['v1.0.0']));
  assert.throws(() => assertNextVersion('1.0.0', ['v1.0.0']));
});
