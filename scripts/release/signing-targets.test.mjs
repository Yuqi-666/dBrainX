// SPDX-License-Identifier: AGPL-3.0-only

import test from 'node:test';
import assert from 'node:assert/strict';
import { selectSignedTargets } from './signing-targets.mjs';

const targets = ['linux-x64', 'win32-x64', 'darwin-x64', 'darwin-arm64'];

test('desktop targets are skipped according to their own missing signing secrets', () => {
  assert.deepEqual(selectSignedTargets(targets, {}), { selected: [], skipped: targets });
  assert.deepEqual(selectSignedTargets(targets, { TAURI_SIGNING_PRIVATE_KEY: 'key', TAURI_SIGNING_PRIVATE_KEY_PASSWORD: 'password' }), {
    selected: ['linux-x64'], skipped: targets.slice(1),
  });
  const secrets = {
    TAURI_SIGNING_PRIVATE_KEY: 'key',
    TAURI_SIGNING_PRIVATE_KEY_PASSWORD: 'password',
    WINDOWS_CERTIFICATE: 'cert', WINDOWS_CERTIFICATE_PASSWORD: 'password',
    APPLE_CERTIFICATE: 'cert', APPLE_CERTIFICATE_PASSWORD: 'password',
    APPLE_SIGNING_IDENTITY: 'identity', APPLE_API_PRIVATE_KEY: 'key',
    APPLE_API_KEY: 'key', APPLE_API_ISSUER: 'issuer',
  };
  assert.deepEqual(selectSignedTargets(targets, secrets), { selected: targets, skipped: [] });
  delete secrets.WINDOWS_CERTIFICATE;
  assert.deepEqual(selectSignedTargets(targets, secrets), {
    selected: ['linux-x64', 'darwin-x64', 'darwin-arm64'], skipped: ['win32-x64'],
  });
});
