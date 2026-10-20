// SPDX-License-Identifier: AGPL-3.0-only

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));

function parseVersion(value) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(value);
  assert.ok(match, `Invalid version: ${value}`);
  return {
    core: match.slice(1, 4).map(Number),
    pre: match[4]?.split('.') ?? null,
  };
}

export function compareVersions(left, right) {
  const a = parseVersion(left);
  const b = parseVersion(right);
  for (let i = 0; i < 3; i += 1) {
    if (a.core[i] !== b.core[i]) return Math.sign(a.core[i] - b.core[i]);
  }
  if (a.pre === null || b.pre === null) return a.pre === b.pre ? 0 : a.pre === null ? 1 : -1;
  for (let i = 0; i < Math.max(a.pre.length, b.pre.length); i += 1) {
    if (a.pre[i] === undefined || b.pre[i] === undefined) return a.pre[i] === undefined ? -1 : 1;
    const an = /^\d+$/.test(a.pre[i]);
    const bn = /^\d+$/.test(b.pre[i]);
    if (an && bn) {
      const result = BigInt(a.pre[i]) - BigInt(b.pre[i]);
      if (result !== 0n) return result > 0n ? 1 : -1;
    } else if (an !== bn) return an ? -1 : 1;
    else if (a.pre[i] !== b.pre[i]) return a.pre[i] < b.pre[i] ? -1 : 1;
  }
  return 0;
}

export function assertNextVersion(version, tags) {
  for (const tag of tags) {
    if (!/^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(tag)) continue;
    assert.ok(compareVersions(version, tag.slice(1)) > 0, `${version} must be newer than existing ${tag}`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const version = JSON.parse(readFileSync(resolve(root, 'scripts/release/release.json'), 'utf8')).version;
  const tags = execFileSync('git', ['tag', '--list', 'v*'], { cwd: root, encoding: 'utf8' }).trim().split('\n');
  assertNextVersion(version, tags);
  console.log(`Version ${version} advances all existing version tags.`);
}
