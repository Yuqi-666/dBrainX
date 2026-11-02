// SPDX-License-Identifier: AGPL-3.0-only

import test from 'node:test';
import assert from 'node:assert/strict';
import { selectSignedTargets } from './signing-targets.mjs';
import { isWindowsSignableFile } from '../lib/windows-signing.mjs';

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

test('Windows signing covers MXC executables, its DLLs, and addons', () => {
  for (const name of [
    'wxc-exec.exe',
    'wxc-windows-sandbox-daemon.exe',
    'wslcsdk.dll',
    'mxc_ffi.dll',
    'koffi.node',
  ])
    assert.equal(isWindowsSignableFile(name), true, name);
  // Foreign-format helpers are pruned before this pass, and text never signs.
  for (const name of ['mxc-exec-mac', 'lxc-exec', 'unix-test-proxy', 'package.json'])
    assert.equal(isWindowsSignableFile(name), false, name);
});
