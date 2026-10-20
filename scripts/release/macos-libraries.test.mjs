// SPDX-License-Identifier: AGPL-3.0-only

import test from "node:test";
import assert from "node:assert/strict";
import { macLibraryMetadata } from "../lib/macos-libraries.mjs";

test("canvas's original build ID is not a library dependency", () => {
  const id = "/Users/runner/work/canvas/canvas/target/aarch64-apple-darwin/release/deps/libcanvas.dylib";
  const output = `canvas.node:\n\t${id} (compatibility version 0.0.0, current version 0.0.0)\n\t/usr/lib/libSystem.B.dylib (compatibility version 1.0.0, current version 1.0.0)\n\t@rpath/librequired.dylib (compatibility version 1.0.0, current version 1.0.0)\n`;
  const commands = `Load command 0\n      cmd LC_ID_DYLIB\n  cmdsize 160\n     name ${id} (offset 24)\nLoad command 1\n          cmd LC_RPATH\n      cmdsize 40\n         path @loader_path/lib (offset 12)\n`;
  const result = macLibraryMetadata(output, commands);
  assert.deepEqual(result.dependencies, ["/usr/lib/libSystem.B.dylib", "@rpath/librequired.dylib"]);
  assert.deepEqual(result.rpaths, ["@loader_path/lib"]);
  // Executables have no LC_ID_DYLIB: keep all their real dependencies.
  assert.equal(macLibraryMetadata(output, "").dependencies.length, 3);
});
