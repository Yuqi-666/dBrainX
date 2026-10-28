// SPDX-License-Identifier: AGPL-3.0-only

// Select signed desktop targets without logging or exporting secret values.
import { appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const common = ['TAURI_SIGNING_PRIVATE_KEY', 'TAURI_SIGNING_PRIVATE_KEY_PASSWORD'];
const required = {
  'linux-x64': common,
  'win32-x64': [...common, 'WINDOWS_CERTIFICATE', 'WINDOWS_CERTIFICATE_PASSWORD'],
  'darwin-x64': [...common, 'APPLE_CERTIFICATE', 'APPLE_CERTIFICATE_PASSWORD', 'APPLE_SIGNING_IDENTITY', 'APPLE_API_PRIVATE_KEY', 'APPLE_API_KEY', 'APPLE_API_ISSUER'],
  'darwin-arm64': [...common, 'APPLE_CERTIFICATE', 'APPLE_CERTIFICATE_PASSWORD', 'APPLE_SIGNING_IDENTITY', 'APPLE_API_PRIVATE_KEY', 'APPLE_API_KEY', 'APPLE_API_ISSUER'],
};

export function selectSignedTargets(targets, secrets) {
  const selected = [];
  const skipped = [];
  for (const target of targets) {
    if (!required[target]) throw new Error(`Unknown desktop target: ${target}`);
    if (required[target].every(name => Boolean(secrets[name]))) selected.push(target);
    else skipped.push(target);
  }
  return { selected, skipped };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const targets = process.env.DESKTOP_TARGETS?.split(/\s+/).filter(Boolean) ?? [];
  const result = process.env.SIGNED === 'false'
    ? { selected: targets, skipped: [] }
    : selectSignedTargets(targets, process.env);
  if (!result.selected.length && !process.env.CONTAINER_PLATFORMS?.trim()) {
    throw new Error('No candidate products remain after signing-secret checks.');
  }
  appendFileSync(process.env.GITHUB_OUTPUT, `desktop_targets=${result.selected.join(' ')}\n`);
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `Signed desktop targets: ${result.selected.join(', ') || 'none'}\nSkipped for missing signing secrets: ${result.skipped.join(', ') || 'none'}\n`);
}
