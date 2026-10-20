// SPDX-License-Identifier: AGPL-3.0-only

/** CI-only setup. Secrets are read from the environment, never from CLI arguments. */
import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtemp, writeFile, appendFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
function required(name) {
  if (!process.env[name]) throw new Error(`Signing requires secret ${name}`);
  return process.env[name];
}
function run(command, args, env = process.env) {
  try {
    return execFileSync(command, args, {
      encoding: "utf8",
      env,
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch {
    throw new Error(
      `${command} signing setup failed; secret arguments were suppressed`,
    );
  }
}
async function environment(name, value) {
  if (!process.env.GITHUB_ENV)
    throw new Error("Signing setup is only supported inside CI");
  await appendFile(process.env.GITHUB_ENV, `${name}=${value}\n`);
}
const temp = await mkdtemp(join(tmpdir(), "dbrain-signing-"));
await environment("DBRAIN_SIGNING_TEMP", temp);
if (process.platform === "darwin") {
  const identity = required("APPLE_SIGNING_IDENTITY");
  const pfx = join(temp, "certificate.p12");
  await writeFile(pfx, Buffer.from(required("APPLE_CERTIFICATE"), "base64"), {
    mode: 0o600,
  });
  const keychain = join(temp, "release.keychain-db"),
    password = randomBytes(32).toString("hex");
  const original = run("security", ["list-keychains", "-d", "user"]);
  const existing = [...original.matchAll(/"([^"]+)"/g)].map(
    (match) => match[1],
  );
  await environment("DBRAIN_SIGNING_KEYCHAIN", keychain);
  run("security", ["create-keychain", "-p", password, keychain]);
  run("security", ["set-keychain-settings", "-lut", "21600", keychain]);
  run("security", ["unlock-keychain", "-p", password, keychain]);
  run("security", [
    "import",
    pfx,
    "-k",
    keychain,
    "-P",
    required("APPLE_CERTIFICATE_PASSWORD"),
    "-T",
    "/usr/bin/codesign",
    "-T",
    "/usr/bin/security",
  ]);
  run("security", [
    "set-key-partition-list",
    "-S",
    "apple-tool:,apple:,codesign:",
    "-s",
    "-k",
    password,
    keychain,
  ]);
  run("security", [
    "list-keychains",
    "-d",
    "user",
    "-s",
    keychain,
    ...existing,
  ]);
  const identities = run("security", [
    "find-identity",
    "-v",
    "-p",
    "codesigning",
    keychain,
  ]);
  if (!identities.includes(identity))
    throw new Error("APPLE_SIGNING_IDENTITY is not present in certificate");
  const apiKey = join(temp, "AuthKey.p8");
  await writeFile(apiKey, required("APPLE_API_PRIVATE_KEY"), { mode: 0o600 });
  required("APPLE_API_KEY");
  required("APPLE_API_ISSUER");
  await environment("APPLE_API_KEY_PATH", apiKey);
  await environment("DBRAIN_SIGNING_TEMP", temp);
  await environment("DBRAIN_SIGNING_KEYCHAIN", keychain);
} else if (process.platform === "win32") {
  const certificate = join(temp, "certificate.pfx");
  await writeFile(
    certificate,
    Buffer.from(required("WINDOWS_CERTIFICATE"), "base64"),
  );
  required("WINDOWS_CERTIFICATE_PASSWORD");
  const thumbprint = run(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "$cert = Import-PfxCertificate -FilePath $env:DBRAIN_CERT_PATH -CertStoreLocation Cert:\\CurrentUser\\My -Password (ConvertTo-SecureString $env:WINDOWS_CERTIFICATE_PASSWORD -AsPlainText -Force); $cert.Thumbprint",
    ],
    { ...process.env, DBRAIN_CERT_PATH: certificate },
  );
  if (!/^[a-f0-9]{40}$/i.test(thumbprint))
    throw new Error("Invalid imported certificate thumbprint");
  await environment("DBRAIN_WINDOWS_THUMBPRINT", thumbprint);
  const config = join(temp, "tauri-signing.json");
  await writeFile(
    config,
    JSON.stringify({
      bundle: {
        windows: {
          certificateThumbprint: thumbprint,
          digestAlgorithm: "sha256",
          timestampUrl: "http://timestamp.digicert.com",
          tsp: true,
        },
      },
    }),
  );
  await environment("DBRAIN_TAURI_SIGNING_CONFIG", config);
  await environment("DBRAIN_SIGNING_TEMP", temp);
}
console.log(
  "Signing credentials prepared without exporting private material to artifacts",
);
