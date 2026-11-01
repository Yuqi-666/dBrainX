#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Print the MXC capability matrix for this host (plan item 52).
 *
 * `backend/sandbox/src/mxc-support.ts` is the data; this script is the human
 * view of it. Absence is a result, not a failure: the exit code is 0 with or
 * without a backend, and an unavailable host prints `SANDBOX_UNAVAILABLE` plus
 * the named reason (the matrix is recorded as skipped, never as a pass).
 *
 *   node scripts/sandbox-probe.mjs            # aligned table
 *   node scripts/sandbox-probe.mjs --markdown # table for the decision record
 *   node scripts/sandbox-probe.mjs --json     # the same data the code reads
 */

import {
  SANDBOX_FEATURE_IDS,
  SANDBOX_UNAVAILABLE,
  probeSandboxPlatform,
} from "../backend/sandbox/src/mxc-support.ts";

const columns = [
  ["backend", (row) => row.backend],
  ["ok", (row) => (row.available ? "yes" : "no")],
  ["root", (row) => row.profile.needsRoot],
  [
    "egress-cidr",
    (row) => cell(row.features.egressCidr),
  ],
  ["egress-port", (row) => cell(row.features.egressPort)],
  ["ingress-deny", (row) => cell(row.features.ingressDefaultDeny)],
  ["loopback-deny", (row) => cell(row.features.hostLoopbackDeny)],
  ["denied-paths", (row) => cell(row.features.deniedPaths)],
  ["readonly", (row) => cell(row.features.readonlyPaths)],
  ["timeout", (row) => cell(row.features.timeout)],
  ["output-cap", (row) => cell(row.features.outputLimit)],
  ["persistent", (row) => cell(row.features.persistentContainer)],
];

function cell(feature) {
  return feature.state === "supported" ? "yes" : "no";
}

function codes(report) {
  const seen = new Set();
  for (const id of SANDBOX_FEATURE_IDS) {
    const feature = report.features[id];
    if (feature.state === "supported") continue;
    seen.add(`${feature.code}: ${feature.detail}`);
  }
  return [...seen];
}

function printTable(report) {
  const header = columns.map(([name]) => name);
  const rows = report.backends.map((row) => columns.map(([, read]) => read(row)));
  const widths = header.map((name, index) =>
    Math.max(name.length, ...rows.map((row) => row[index].length)),
  );
  const line = (cells) =>
    cells.map((value, index) => value.padEnd(widths[index])).join("  ");
  console.log(line(header));
  console.log(widths.map((width) => "-".repeat(width)).join("  "));
  for (const row of rows) console.log(line(row));
}

function printMarkdown(report) {
  const header = columns.map(([name]) => name);
  const rows = report.backends.map((row) =>
    columns.map(([, read]) => read(row)),
  );
  console.log(`| ${header.join(" | ")} |`);
  console.log(`| ${header.map(() => "---").join(" | ")} |`);
  for (const row of rows) console.log(`| ${row.join(" | ")} |`);
}

function printFacts(report) {
  const host = report.host;
  console.log("");
  console.log(`host:      ${host.triple} (MXC assets: bin/${host.mxcArch})`);
  console.log(`node:      ${host.node}`);
  if (host.libc !== undefined) console.log(`libc:      ${host.libc}`);
  if (host.mxcBinDir !== undefined) {
    console.log(`MXC_BIN_DIR: ${host.mxcBinDir}`);
  }
  if (report.mxc.contractVersion !== undefined) {
    console.log(`contract:  ${report.mxc.contractVersion}`);
  }
  console.log(
    `status:    ${report.status} (available: ${report.availableBackends.join(", ") || "none"})`,
  );
  if (report.preferred !== undefined) {
    console.log(`preferred: ${report.preferred}`);
  }
  const notes = report.notes;
  console.log(`sdk:       isSupported=${String(notes.sdkSupported)}`);
  if (notes.sdkReason !== undefined) console.log(`sdk reason: ${notes.sdkReason}`);
  if (notes.platformProbeError !== undefined) {
    console.log(`platform probe error: ${notes.platformProbeError}`);
  }
  for (const [backend, reason] of Object.entries(notes.unavailableReasons)) {
    console.log(`unavailable: ${backend}: ${reason}`);
  }
  if (notes.bubblewrapProxyEnforcement !== undefined) {
    console.log(
      `bubblewrap networkProxy: ${notes.bubblewrapProxyEnforcement}`,
    );
  }
  for (const backend of notes.unrecognizedBackends) {
    console.log(
      `warning:   discovery reported "${backend}", which has no profile`,
    );
  }
  for (const row of report.backends) {
    for (const warning of row.warnings) {
      console.log(`warning:   ${row.backend}: ${warning}`);
    }
  }
  console.log("");
  console.log("codes:");
  for (const line of codes(report)) console.log(`  ${line}`);
}

const report = await probeSandboxPlatform();
const json = process.argv.includes("--json");
const markdown = process.argv.includes("--markdown");

if (json) {
  console.log(JSON.stringify(report, null, 2));
} else {
  if (markdown) printMarkdown(report);
  else printTable(report);
  printFacts(report);
  if (report.status === "unavailable") {
    console.log("");
    console.log(
      `${SANDBOX_UNAVAILABLE}: no sandbox backend on this host (${report.reason?.code ?? "unknown"})`,
    );
    console.log(`  ${report.reason?.detail ?? "no detail"}`);
    console.log("  recorded as skipped: neither a pass nor a failure");
  }
}

process.exitCode = 0;
