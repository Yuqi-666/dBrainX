// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Address validation shared by the downloader and the probe.
 *
 * A pasted address is turned into argv for a child process that the server
 * runs, so it is validated before any process starts. The server must not be
 * usable as a proxy into its own network, which makes three rules necessary:
 *
 * - only `http` and `https` are media-page schemes;
 * - the address must not embed credentials, which would be copied into the
 *   stored source address as well as into argv;
 * - the host must not resolve to a loopback, private, link-local, multicast,
 *   or reserved address.
 *
 * Literal addresses are checked as written. Host names are looked up because a
 * name that resolves to `127.0.0.1` is as dangerous as the literal. The failure
 * is classified as `unsupported_url`: the user can correct the address, and it
 * is not a network failure of the site.
 */

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

import { MediaImportFailure } from "@workspace/utils/media-import";

/** Validates one pasted address and returns it parsed. */
export async function assertDownloadableUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new MediaImportFailure(
      "unsupported_url",
      "The media address is not a valid URL",
    );
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new MediaImportFailure(
      "unsupported_url",
      "Only http and https media addresses can be imported",
    );
  }
  if (url.username !== "" || url.password !== "") {
    throw new MediaImportFailure(
      "unsupported_url",
      "A media address must not embed credentials",
    );
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (hostname === "") {
    throw new MediaImportFailure(
      "unsupported_url",
      "The media address has no host",
    );
  }

  let addresses: string[];
  if (isIP(hostname) !== 0) {
    addresses = [hostname];
  } else {
    try {
      addresses = (await lookup(hostname, { all: true })).map(
        (entry) => entry.address,
      );
    } catch {
      throw new MediaImportFailure(
        "unsupported_url",
        `Could not resolve the host of ${url.hostname}`,
      );
    }
  }

  if (addresses.length === 0) {
    throw new MediaImportFailure(
      "unsupported_url",
      `Could not resolve the host of ${url.hostname}`,
    );
  }
  for (const address of addresses) {
    if (isNonPublicAddress(address)) {
      throw new MediaImportFailure(
        "unsupported_url",
        `The media address resolves to the private address ${address} and cannot be imported`,
      );
    }
  }

  return url;
}

/** True for loopback, private, link-local, multicast, and reserved addresses. */
export function isNonPublicAddress(address: string): boolean {
  switch (isIP(address)) {
    case 4:
      return isNonPublicIPv4(address);
    case 6:
      return isNonPublicIPv6(address);
    default:
      // An address family this adapter cannot classify is not trusted.
      return true;
  }
}

function isNonPublicIPv4(address: string): boolean {
  const octets = address.split(".").map(Number);
  if (
    octets.length !== 4 ||
    octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)
  ) {
    return true;
  }

  const first = octets[0]!;
  const second = octets[1]!;

  return (
    first === 0 || // "this network"
    first === 10 || // RFC 1918
    first === 127 || // loopback
    (first === 169 && second === 254) || // link-local
    (first === 172 && second >= 16 && second <= 31) || // RFC 1918
    (first === 192 && second === 168) || // RFC 1918
    (first === 100 && second >= 64 && second <= 127) || // carrier-grade NAT
    (first === 198 && (second === 18 || second === 19)) || // benchmarking
    first >= 224 // multicast and reserved
  );
}

function isNonPublicIPv6(address: string): boolean {
  const lower = address.toLowerCase();
  if (lower === "::" || lower === "::1") return true;

  // IPv4-mapped (`::ffff:192.168.0.1`, or `::ffff:c0a8:1` in hex form):
  // classify an embedded dotted IPv4, and refuse a form this adapter cannot
  // read rather than trusting it.
  if (lower.startsWith("::ffff:")) {
    const embedded = lower.slice("::ffff:".length);
    return isIP(embedded) === 4 ? isNonPublicAddress(embedded) : true;
  }
  // IPv4-compatible (`::192.168.0.1`), also deprecated but still routable.
  if (lower.startsWith("::")) {
    const embedded = lower.slice(2);
    return isIP(embedded) === 4 ? isNonPublicAddress(embedded) : true;
  }

  const firstGroup = Number.parseInt(lower.split(":")[0] ?? "", 16);
  if (!Number.isInteger(firstGroup)) return true;

  return (
    (firstGroup & 0xfe00) === 0xfe00 || // link-local fe80::/10
    (firstGroup & 0xfc00) === 0xfc00 || // unique local fc00::/7
    (firstGroup & 0xff00) === 0xff00 // multicast ff00::/8
  );
}
