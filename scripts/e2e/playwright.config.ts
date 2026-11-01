import { defineConfig } from "@playwright/test";
import { join } from "node:path";

const baseURL = process.env.DBRAINX_E2E_BASE_URL ?? "http://localhost:3000";

// Next to this config, so a run from the repository root does not scatter output there.
const outputDir = join(__dirname, "test-results");

export default defineConfig({
  testDir: ".",
  testMatch: "*.spec.ts",
  outputDir,
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL,
    trace: "retain-on-failure",
  },
});
