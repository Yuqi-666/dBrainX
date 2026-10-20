// SPDX-License-Identifier: AGPL-3.0-only

/** The listed-site catalog and its host matching. */
import assert from "node:assert/strict";
import { test } from "node:test";

import { MEDIA_SITES, StaticMediaSiteCatalog } from "./media-sites.ts";

test("lists five video sites and three audio sites", () => {
  const catalog = new StaticMediaSiteCatalog();

  assert.equal(catalog.list().length, 8);
  assert.equal(catalog.list("video").length, 5);
  assert.equal(catalog.list("audio").length, 3);
  assert.deepEqual(
    catalog.list("audio").map((site) => site.key),
    ["netease", "qqmusic", "ximalaya"],
  );
  assert.equal(MEDIA_SITES.length, 8);
});

test("matches hosts and their subdomains, including short links", () => {
  const catalog = new StaticMediaSiteCatalog();
  const cases: [string, string][] = [
    ["https://www.bilibili.com/video/BV1", "bilibili"],
    ["https://b23.tv/abc", "bilibili"],
    ["https://www.douyin.com/video/1", "douyin"],
    ["https://www.iesdouyin.com/share/video/1", "douyin"],
    ["https://www.xiaohongshu.com/explore/1", "xiaohongshu"],
    ["https://xhslink.com/abc", "xiaohongshu"],
    ["https://youtu.be/abc", "youtube"],
    ["https://music.youtube.com/watch?v=1", "youtube"],
    ["https://www.tiktok.com/@user/video/1", "tiktok"],
    ["https://music.163.com/song?id=1", "netease"],
    ["https://163cn.tv/abc", "netease"],
    ["https://y.qq.com/n/ryqq/songDetail/1", "qqmusic"],
    ["https://i.y.qq.com/v8/playsong.html?songid=1", "qqmusic"],
    ["https://www.ximalaya.com/sound/1", "ximalaya"],
    ["https://xima.tv/abc", "ximalaya"],
  ];

  for (const [url, key] of cases) {
    assert.equal(catalog.match(url)?.key, key, url);
  }
});

test("does not match a look-alike host", () => {
  const catalog = new StaticMediaSiteCatalog();

  assert.equal(catalog.match("https://notbilibili.com/video/1"), null);
  assert.equal(catalog.match("https://bilibili.com.evil.test/video/1"), null);
  assert.equal(catalog.match("https://vimeo.com/1"), null);
});

test("returns null for an unparsable or non-http address", () => {
  const catalog = new StaticMediaSiteCatalog();

  assert.equal(catalog.match("not a url"), null);
  assert.equal(catalog.match(""), null);
  assert.equal(catalog.match("file:///etc/passwd"), null);
});

test("finds a site by its stable key", () => {
  const catalog = new StaticMediaSiteCatalog();

  assert.equal(catalog.find("youtube")?.name, "YouTube");
  assert.equal(catalog.find("missing"), null);
});
