// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Finds the browsers installed on the machine the backend runs on.
 *
 * The desktop app can offer the "use my browser login" method only when a
 * browser is actually there. yt-dlp then reads the cookie from that browser at
 * download time, so the server stores a browser name and never a cookie.
 *
 * Detection is a best-effort lookup of the usual installation paths, not a
 * search of the file system. A missing entry is harmless: the login panel hides
 * the browser method when the list is empty. The platform and the existence
 * check are injectable so a test can exercise every platform path without
 * owning a Mac, a Windows machine, and a Linux machine at once.
 */

import { existsSync } from "node:fs";

import type {
  IMediaBrowserDetector,
  MediaBrowserOption,
} from "@workspace/domain";

/** How to detect browsers; both fields exist for tests. */
export interface MediaBrowserDetectorOptions {
  /** Platform to report for; defaults to the running process's platform. */
  platform?: NodeJS.Platform;
  /** Existence check; defaults to `node:fs.existsSync`. */
  exists?: (path: string) => boolean;
}

/** One browser this detector can report and the paths that prove it exists. */
interface BrowserDefinition {
  /** Name yt-dlp accepts, e.g. `chrome`. */
  name: string;
  /** Label shown to the user, e.g. `Chrome`. */
  label: string;
  /** Detection paths, by platform. */
  paths: Partial<Record<NodeJS.Platform, string[]>>;
}

/**
 * The browsers the login panel offers, in display order.
 *
 * Safari exists only on macOS, Arc is macOS-only today, and the Linux paths
 * cover the package-manager and snap installs of the common browsers. Windows
 * paths are built from the environment because the install drive can differ.
 */
const BROWSERS: BrowserDefinition[] = [
  {
    name: "chrome",
    label: "Chrome",
    paths: {
      darwin: ["/Applications/Google Chrome.app"],
      win32: windowsPaths((root) => [
        `${root.localAppData}\\Google\\Chrome\\Application\\chrome.exe`,
        `${root.programFiles}\\Google\\Chrome\\Application\\chrome.exe`,
        `${root.programFilesX86}\\Google\\Chrome\\Application\\chrome.exe`,
      ]),
      linux: [
        "/usr/bin/google-chrome",
        "/usr/bin/google-chrome-stable",
        "/usr/bin/chromium",
        "/usr/bin/chromium-browser",
        "/snap/bin/chromium",
        "/opt/google/chrome/chrome",
      ],
    },
  },
  {
    name: "edge",
    label: "Edge",
    paths: {
      darwin: ["/Applications/Microsoft Edge.app"],
      win32: windowsPaths((root) => [
        `${root.localAppData}\\Microsoft\\Edge\\Application\\msedge.exe`,
        `${root.programFiles}\\Microsoft\\Edge\\Application\\msedge.exe`,
        `${root.programFilesX86}\\Microsoft\\Edge\\Application\\msedge.exe`,
      ]),
      linux: [
        "/usr/bin/microsoft-edge",
        "/usr/bin/microsoft-edge-stable",
        "/opt/microsoft/msedge/msedge",
      ],
    },
  },
  {
    name: "firefox",
    label: "Firefox",
    paths: {
      darwin: ["/Applications/Firefox.app"],
      win32: windowsPaths((root) => [
        `${root.localAppData}\\Mozilla Firefox\\firefox.exe`,
        `${root.programFiles}\\Mozilla Firefox\\firefox.exe`,
        `${root.programFilesX86}\\Mozilla Firefox\\firefox.exe`,
      ]),
      linux: ["/usr/bin/firefox", "/usr/bin/firefox-esr", "/snap/bin/firefox"],
    },
  },
  {
    name: "safari",
    label: "Safari",
    paths: {
      darwin: ["/Applications/Safari.app"],
    },
  },
  {
    name: "brave",
    label: "Brave",
    paths: {
      darwin: ["/Applications/Brave Browser.app"],
      win32: windowsPaths((root) => [
        `${root.localAppData}\\BraveSoftware\\Brave-Browser\\Application\\brave.exe`,
        `${root.programFiles}\\BraveSoftware\\Brave-Browser\\Application\\brave.exe`,
      ]),
      linux: ["/usr/bin/brave-browser", "/snap/bin/brave"],
    },
  },
  {
    name: "arc",
    label: "Arc",
    paths: {
      darwin: ["/Applications/Arc.app"],
      win32: windowsPaths((root) => [
        `${root.localAppData}\\Arc\\Arc.exe`,
        `${root.programFiles}\\Arc\\Arc.exe`,
      ]),
    },
  },
];

/** Detects installed browsers from their usual install paths. */
export class SystemMediaBrowserDetector implements IMediaBrowserDetector {
  private readonly platform: NodeJS.Platform;
  private readonly exists: (path: string) => boolean;

  constructor(options: MediaBrowserDetectorOptions = {}) {
    this.platform = options.platform ?? process.platform;
    this.exists = options.exists ?? existsSync;
  }

  list(): MediaBrowserOption[] {
    const found: MediaBrowserOption[] = [];
    for (const browser of BROWSERS) {
      const paths = browser.paths[this.platform] ?? [];
      if (paths.some((path) => this.isInstalled(path))) {
        found.push({ name: browser.name, label: browser.label });
      }
    }
    return found;
  }

  /** Runs the injected existence check; a throwing check counts as absent. */
  private isInstalled(path: string): boolean {
    try {
      return this.exists(path);
    } catch {
      return false;
    }
  }
}

/** Builds the Windows install paths from the environment that names them. */
function windowsPaths(
  build: (roots: {
    localAppData: string;
    programFiles: string;
    programFilesX86: string;
  }) => string[],
): string[] {
  // These are Windows installer variables, not server configuration; the
  // defaults cover a machine where the installer did not export them.
  const roots = {
    localAppData: process.env.LOCALAPPDATA ?? "",
    programFiles: process.env.PROGRAMFILES ?? "C:\\Program Files",
    programFilesX86:
      process.env["PROGRAMFILES(X86)"] ?? "C:\\Program Files (x86)",
  };
  return build(roots).filter((path) => !path.startsWith("\\"));
}
