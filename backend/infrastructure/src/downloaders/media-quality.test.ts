// SPDX-License-Identifier: AGPL-3.0-only

/** The picker mapping of a site's format table. */
import assert from "node:assert/strict";
import { test } from "node:test";

import { audioQualities, videoQualities } from "./media-quality.ts";

test("lists video heights once, best first, with sizes from the site", () => {
  const qualities = videoQualities(
    [
      {
        format_id: "137",
        ext: "mp4",
        vcodec: "avc1",
        acodec: "none",
        height: 1080,
        width: 1920,
        fps: 30,
        tbr: 4000,
        filesize: 50_000_000,
      },
      {
        format_id: "136",
        ext: "mp4",
        vcodec: "avc1",
        acodec: "none",
        height: 720,
        width: 1280,
        fps: 30,
        tbr: 2000,
        filesize: 20_000_000,
      },
      {
        format_id: "137-60",
        ext: "mp4",
        vcodec: "avc1",
        acodec: "none",
        height: 1080,
        width: 1920,
        fps: 60,
        tbr: 6000,
        filesize: 70_000_000,
      },
    ],
    { duration: 100 },
  );

  assert.deepEqual(
    qualities.map((quality) => quality.id),
    ["best", "1080p", "720p"],
  );
  // The 60 fps format wins the 1080p slot.
  assert.equal(qualities[1]?.formatId, "137-60");
  assert.equal(qualities[1]?.estimatedBytes, 70_000_000);
  assert.equal(qualities[0]?.formatId, "bv*");
});

test("estimates a video size from the declared bitrate and duration", () => {
  const qualities = videoQualities(
    [
      {
        format_id: "22",
        ext: "mp4",
        vcodec: "avc1",
        acodec: "mp4a.40.2",
        height: 720,
        width: 1280,
        tbr: 2000,
        fps: 30,
      },
    ],
    { duration: 60 },
  );

  // No video-only format exists, so only the best selector remains.
  assert.deepEqual(
    qualities.map((quality) => quality.id),
    ["best"],
  );
  assert.equal(qualities[0]?.estimatedBytes, 15_000_000);
});

test("keeps only the best selector when the site offers combined streams", () => {
  const qualities = videoQualities([
    {
      format_id: "18",
      ext: "mp4",
      vcodec: "avc1",
      acodec: "mp4a",
      height: 360,
      width: 640,
      fps: 30,
      filesize: 1_000,
    },
  ]);

  assert.equal(qualities.length, 1);
  assert.equal(qualities[0]?.id, "best");
  assert.equal(qualities[0]?.height, 360);
});

test("maps audio formats to tiers, best tier first", () => {
  const qualities = audioQualities([
    { format_id: "mp3-128", ext: "mp3", acodec: "mp3", abr: 128 },
    { format_id: "m4a-256", ext: "m4a", acodec: "aac", abr: 256 },
    { format_id: "flac", ext: "flac", acodec: "flac", abr: 900 },
  ]);

  assert.deepEqual(
    qualities.map((quality) => quality.id),
    ["lossless", "exhigh", "standard"],
  );
  assert.equal(qualities[0]?.formatId, "flac");
  assert.equal(qualities[1]?.formatId, "m4a-256");
  assert.equal(qualities[2]?.formatId, "mp3-128");
});

test("prefers flac over m4a over mp3 inside one tier", () => {
  const qualities = audioQualities([
    { format_id: "mp3", ext: "mp3", acodec: "mp3", abr: 320 },
    { format_id: "m4a", ext: "m4a", acodec: "aac", abr: 256 },
    { format_id: "flac", ext: "flac", acodec: "flac", abr: 256 },
  ]);

  assert.deepEqual(
    qualities.map((quality) => quality.id),
    ["lossless", "exhigh"],
  );
  assert.equal(qualities[0]?.formatId, "flac");
  assert.equal(qualities[1]?.formatId, "m4a");
});

test("estimates an audio size from the bitrate when none is stated", () => {
  const [quality] = audioQualities(
    [{ format_id: "standard", ext: "mp3", acodec: "mp3", abr: 128 }],
    { duration: 200 },
  );

  // 128 kbps / 8 * 1000 * 200 seconds.
  assert.equal(quality?.estimatedBytes, 3_200_000);
});

test("ignores unusable format entries", () => {
  const qualities = audioQualities([
    null,
    "not a format",
    { ext: "mp3", acodec: "mp3", abr: 128 },
    { format_id: "ok", ext: "mp3", acodec: "mp3", abr: 128 },
  ]);

  assert.equal(qualities.length, 1);
  assert.equal(qualities[0]?.formatId, "ok");
});
