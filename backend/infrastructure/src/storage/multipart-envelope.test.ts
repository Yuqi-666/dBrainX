// SPDX-License-Identifier: AGPL-3.0-only

import assert from "node:assert/strict";
import test from "node:test";

import { multipartEnvelope } from "./pocketbase-file-store.ts";

/**
 * The envelope helper is the only place that computes the `Content-Length` of a
 * streamed upload request. If that number is one byte short of the body the
 * request hangs or is rejected, and if it is long PocketBase waits forever, so
 * the arithmetic is asserted against the bytes the helper itself produces.
 */

test("the envelope declares exactly the length of the body it describes", () => {
  for (const fileBytes of [0, 1, 255, 1024, 5 * 1024 ** 2]) {
    const envelope = multipartEnvelope(
      "----dbrainxboundary",
      "file",
      "clip.mp4",
      "video/mp4",
      fileBytes,
    );

    assert.equal(
      envelope.contentLength,
      envelope.head.length + fileBytes + envelope.tail.length,
    );
    assert.ok(envelope.head.length > 0);
    assert.ok(envelope.tail.length > 0);
  }
});

test("the head opens the file part and the tail closes the boundary", () => {
  const envelope = multipartEnvelope(
    "----dbrainxboundary",
    "file",
    "clip.mp4",
    "video/mp4",
    7,
  );

  const head = envelope.head.toString("utf8");
  assert.equal(
    head,
    '------dbrainxboundary\r\nContent-Disposition: form-data; name="file"; filename="clip.mp4"\r\nContent-Type: video/mp4\r\n\r\n',
  );
  assert.equal(envelope.tail.toString("utf8"), "\r\n------dbrainxboundary--\r\n");
});

test("a file name with a quote or a line break cannot break the header", () => {
  const fileName = 'evil"; name="other" \r\nX-Injected: 1.mp4';
  const envelope = multipartEnvelope(
    "----dbrainxboundary",
    "file",
    fileName,
    "application/octet-stream",
    3,
  );

  const head = envelope.head.toString("utf8");
  // Three header lines plus the blank line that ends the part header, and no
  // more: a name that emitted a CRLF would show up as extra lines.
  assert.equal(head.split("\r\n").length, 5);
  // The quote is neutralised, so the name cannot be closed early and the rest
  // of it cannot be read as another parameter.
  assert.equal(/filename="[^"]*"; name="other"/.test(head), false);
  assert.equal(head.includes('filename="evil_'), true);
  // The CRLF in the name is neutralised too, so the injected header name never
  // starts a line of its own.
  assert.equal(head.includes("\r\nX-Injected"), false);
  assert.equal(head.includes("_X-Injected"), true);
  // No bare CR or LF survives anywhere in the part header.
  for (const line of head.split("\r\n")) {
    assert.equal(line.includes("\r"), false);
    assert.equal(line.includes("\n"), false);
  }
});

test("the file name keeps a slash out of the disposition header", () => {
  // PocketBase owns the stored name, but the request must not be misread as a
  // path either, so a separator in the user's name is not special-cased.
  const envelope = multipartEnvelope(
    "----dbrainxboundary",
    "file",
    "dir/sub/file.bin",
    "application/octet-stream",
    1,
  );
  assert.equal(
    envelope.head.toString("utf8").includes('filename="dir/sub/file.bin"'),
    true,
  );
});
