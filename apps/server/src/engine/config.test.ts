// SPDX-License-Identifier: AGPL-3.0-only

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  describeEngineConfig,
  engineRuntimeOptions,
  loadEngineConfig,
} from "./config.ts";

describe("the engine settings reach the composition root", () => {
  it("passes the configured job width on to the scheduler runtime", () => {
    const config = loadEngineConfig({ DBRAINX_ENGINE_CONCURRENCY: "5" });
    assert.equal(config.scheduler.concurrency, 5);

    const options = engineRuntimeOptions(config);
    assert.equal(
      options.schedulerConcurrency,
      5,
      "adapter-front builds the scheduler from this field",
    );
    assert.equal(options.dispatchConcurrency, 5);
  });

  it("falls back to the documented width of two", () => {
    const options = engineRuntimeOptions(loadEngineConfig({}));
    assert.equal(options.schedulerConcurrency, 2);
    assert.equal(options.dispatchConcurrency, 2);
    assert.equal(options.schedulerLimit, 10);
    assert.equal(options.dispatchMaxAttempts, 5);
  });

  it("prints the width it passes on", () => {
    const config = loadEngineConfig({ DBRAINX_ENGINE_CONCURRENCY: "5" });
    assert.match(describeEngineConfig(config), /jobs=10\/5 /);
  });
});
