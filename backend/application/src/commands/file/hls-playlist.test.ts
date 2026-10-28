// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The playlist rewrite decides how every stored recording is addressed, so the
 * cases below pin the shape a browser has to resolve: a path relative to the
 * playlist, not the root-relative path only one mount happens to serve.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { rewriteSegmentUrls } from "./hls-playlist.ts";

const artifact = (body: string) => ({
  fileName: "index.m3u8",
  contentType: "application/vnd.apple.mpegurl",
  bytes: new TextEncoder().encode(body),
});

const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

test("names each segment beside its playlist", () => {
  const playlist = artifact(
    "#EXTM3U\n#EXT-X-VERSION:6\n#EXTINF:4,\nsegment.00000.ts\n#EXT-X-ENDLIST\n",
  );
  const result = rewriteSegmentUrls(playlist, [
    {
      fileName: "segment.00000.ts",
      url: "/api/files/files/recseg/segment.00000.ts",
    },
  ]);

  assert.equal(
    text(result.bytes),
    "#EXTM3U\n#EXT-X-VERSION:6\n#EXTINF:4,\n../recseg/segment.00000.ts\n#EXT-X-ENDLIST\n",
  );
});

test("accepts the absolute address the store may return", () => {
  const playlist = artifact("#EXTM3U\n#EXTINF:1,\nsegment.00001.ts\n");
  const result = rewriteSegmentUrls(playlist, [
    {
      fileName: "segment.00001.ts",
      url: "http://127.0.0.1:8090/api/files/pbc_1/recseg/segment.00001.ts",
    },
  ]);

  assert.equal(
    text(result.bytes),
    "#EXTM3U\n#EXTINF:1,\n../recseg/segment.00001.ts\n",
  );
});

test("leaves an address the store does not shape as a stored file", () => {
  const playlist = artifact("#EXTM3U\n#EXTINF:1,\nblob-part\n");
  const result = rewriteSegmentUrls(playlist, [
    { fileName: "blob-part", url: "blob:http://127.0.0.1/9d1f" },
  ]);

  assert.equal(
    text(result.bytes),
    "#EXTM3U\n#EXTINF:1,\nblob:http://127.0.0.1/9d1f\n",
  );
});

test("passes a line the transcoder did not name through", () => {
  const playlist = artifact(
    '#EXTM3U\n#EXT-X-MAP:URI="init.mp4"\n#EXTINF:1,\nsegment.00000.ts\n',
  );
  const result = rewriteSegmentUrls(playlist, [
    {
      fileName: "segment.00000.ts",
      url: "/api/files/files/recseg/segment.00000.ts",
    },
  ]);

  assert.equal(
    text(result.bytes),
    '#EXTM3U\n#EXT-X-MAP:URI="init.mp4"\n#EXTINF:1,\n../recseg/segment.00000.ts\n',
  );
});

test("returns the artifact untouched when no segment was stored", () => {
  const playlist = artifact("#EXTM3U\n#EXT-X-ENDLIST\n");
  assert.equal(rewriteSegmentUrls(playlist, []), playlist);
});
