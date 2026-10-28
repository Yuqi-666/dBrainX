// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Netscape `cookies.txt` handling.
 *
 * A login import must keep only the cookies of the listed media sites and must
 * be able to cut one exported file into one file per site. The cases below pin
 * the parser's tolerance (comments, `#HttpOnly_`, short lines), the host
 * matching (exact and subdomain), the round trip through serialization, and the
 * list of dropped domains the UI reports.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import type { MediaSiteDefinition } from "@workspace/domain";
import {
  cookieMatchesSite,
  cookiesForSite,
  ignoredCookieDomains,
  parseCookieFile,
  serializeCookieFile,
} from "./cookie-file.ts";

/** A site definition with just the fields the cookie helpers read. */
function site(
  key: string,
  hosts: string[],
  kinds: MediaSiteDefinition["kinds"] = ["video"],
): MediaSiteDefinition {
  return {
    key,
    name: key,
    kinds,
    hosts,
    loginHint: "",
    probeUrl: `https://${hosts[0]}/`,
  };
}

const BILIBILI = site("bilibili", ["bilibili.com", "b23.tv"]);
const YOUTUBE = site("youtube", ["youtube.com", "youtu.be"]);
const NETEASE = site("netease", ["music.163.com"], ["audio"]);

const COOKIE_FILE = [
  "# Netscape HTTP Cookie File",
  "# https://curl.se/docs/http-cookies.html",
  "",
  ".bilibili.com\tTRUE\t/\tFALSE\t1900000000\tSESSDATA\tsecret-bili",
  "#HttpOnly_.youtube.com\tTRUE\t/\tTRUE\t1900000000\tSID\tsecret-yt",
  "music.163.com\tFALSE\t/\tFALSE\t1900000000\tMUSIC_U\tsecret-163",
  "example.com\tFALSE\t/\tFALSE\t1900000000\tTRACKER\tignored",
  "this line is not a cookie",
  "",
].join("\r\n");

test("parses cookies, comments, HttpOnly lines and skips malformed rows", () => {
  const cookies = parseCookieFile(COOKIE_FILE);

  assert.equal(cookies.length, 4);
  assert.deepEqual(cookies[0], {
    domain: ".bilibili.com",
    includeSubdomains: true,
    path: "/",
    secure: false,
    expires: 1900000000,
    name: "SESSDATA",
    value: "secret-bili",
    httpOnly: false,
  });
  assert.equal(cookies[1]?.httpOnly, true);
  assert.equal(cookies[1]?.domain, ".youtube.com");
  assert.equal(cookies[1]?.secure, true);
  assert.equal(cookies[2]?.domain, "music.163.com");
  assert.equal(cookies[2]?.includeSubdomains, false);
});

test("matches a cookie to a site by exact or subdomain host", () => {
  const cookies = parseCookieFile(COOKIE_FILE);
  const biliCookie = cookies[0]!;
  const b23Cookie = {
    ...biliCookie,
    domain: "www.bilibili.com",
    httpOnly: false,
  };

  assert.equal(cookieMatchesSite(biliCookie, BILIBILI), true);
  assert.equal(cookieMatchesSite(b23Cookie, BILIBILI), true);
  assert.equal(
    cookieMatchesSite({ ...biliCookie, domain: "evilbilibili.com" }, BILIBILI),
    false,
  );
  assert.equal(cookieMatchesSite(biliCookie, YOUTUBE), false);
});

test("filters the exported file down to one site", () => {
  const cookies = parseCookieFile(COOKIE_FILE);

  assert.deepEqual(
    cookiesForSite(cookies, YOUTUBE).map((cookie) => cookie.name),
    ["SID"],
  );
  assert.deepEqual(
    cookiesForSite(cookies, NETEASE).map((cookie) => cookie.name),
    ["MUSIC_U"],
  );
  assert.deepEqual(
    cookiesForSite(cookies, BILIBILI).map((cookie) => cookie.name),
    ["SESSDATA"],
  );
});

test("serializes a per-site file that parses back to the same cookies", () => {
  const cookies = parseCookieFile(COOKIE_FILE);
  const biliCookies = cookiesForSite(cookies, BILIBILI);
  const text = serializeCookieFile(biliCookies);

  assert.match(text, /^# Netscape HTTP Cookie File/);
  assert.equal(text.includes("secret-yt"), false, "other sites are dropped");
  assert.deepEqual(parseCookieFile(text), biliCookies);
});

test("reports the domains outside the catalog, sorted and de-duplicated", () => {
  const cookies = parseCookieFile(
    [
      "example.com\tFALSE\t/\tFALSE\t0\tA\t1",
      "static.example.com\tFALSE\t/\tFALSE\t0\tB\t2",
      "example.com\tFALSE\t/\tFALSE\t0\tC\t3",
      ".bilibili.com\tTRUE\t/\tFALSE\t0\tD\t4",
    ].join("\n"),
  );

  assert.deepEqual(
    ignoredCookieDomains(cookies, [BILIBILI, YOUTUBE, NETEASE]),
    ["example.com", "static.example.com"],
  );
});

test("an empty file yields no cookies and no ignored domains", () => {
  assert.deepEqual(parseCookieFile(""), []);
  assert.deepEqual(ignoredCookieDomains([], [BILIBILI]), []);
});
