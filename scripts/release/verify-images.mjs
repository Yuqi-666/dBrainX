// SPDX-License-Identifier: AGPL-3.0-only

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
const report = JSON.parse(await readFile(process.argv[2]));
for (const image of Object.values(report.images)) {
  assert.match(
    image.reference,
    /^ghcr\.io\/[a-z0-9_.-]+\/[a-z0-9_.-]+@sha256:[a-f0-9]{64}$/,
  );
  const manifest = JSON.parse(
    execFileSync(
      "docker",
      [
        "buildx",
        "imagetools",
        "inspect",
        image.reference,
        "--format",
        "{{json .Manifest}}",
      ],
      { encoding: "utf8" },
    ),
  );
  assert.equal(manifest.digest, image.reference.split("@")[1]);
  assert.deepEqual(
    manifest.manifests
      .map((m) => `${m.platform.os}/${m.platform.architecture}`)
      .sort(),
    [...image.platforms].sort(),
  );
  console.log(`Registry digest verified: ${image.reference}`);
}
