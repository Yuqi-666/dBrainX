// SPDX-License-Identifier: AGPL-3.0-only

/**
 * How a stored recording's playlist names its segments.
 *
 * Kept out of `file-command.service.ts` so this pure rule can be tested
 * directly: the service uses constructor parameter properties, which the
 * `node --test` type-stripping loader rejects, and a rule that decides how every
 * recording is addressed deserves its own test.
 */
import type { TranscodedArtifact } from "@workspace/domain";

/**
 * Rewrites a playlist's bare segment file names into the addresses the store
 * handed back, so each `#EXTINF` line points at the blob that was just written.
 *
 * The address is written relative to the playlist itself (`../<record>/<name>`),
 * not as the root-relative `/api/files/…` path the store returns. A playlist is
 * served through a different mount in each shape — PocketBase itself in local
 * development, `/pb` behind the container and remote-development gateways,
 * `/session/<secret>` in the desktop — and a relative URI is resolved against
 * the playlist's own URL, so it reaches the segment in all of them, including a
 * native HLS player and any proxy nobody has written yet. Segments and their
 * playlist share one collection (the file store port's `upload` contract), so
 * the single `..` step leaves the playlist's record directory and enters the
 * segment's.
 *
 * An address that is not `<anything>/api/files/<collection>/<record>/<name>`
 * keeps the root-relative form: another store may address blobs differently, and
 * the gateways still rewrite playlists stored before this, so old and new
 * recordings both play.
 *
 * Unmapped lines are left untouched: a stray URI in the playlist (an fMP4 init
 * map, say) is passed through rather than silently dropped.
 *
 * @param playlist The transcoder's artifact, whose lines name bare file names.
 * @param segments One entry per stored segment, in the transcoder's order.
 */
export function rewriteSegmentUrls(
  playlist: TranscodedArtifact,
  segments: { fileName: string; url: string }[],
): TranscodedArtifact {
  if (segments.length === 0) return playlist;

  const pathsByName = new Map(
    segments.map((segment) => [segment.fileName, toSegmentUrl(segment.url)]),
  );

  const decoded = new TextDecoder().decode(playlist.bytes);
  const lines = decoded.split("\n").map((line) => {
    const uri = line.trim();
    return pathsByName.get(uri) ?? line;
  });

  return {
    ...playlist,
    bytes: new TextEncoder().encode(lines.join("\n")),
  };
}

/** The stored address shape of this project's file store. */
const STORED_FILE_PATH = /\/api\/files\/[^/]+\/([^/]+)\/([^/]+)$/;

/**
 * Turns a stored address into the URI a playlist should carry.
 *
 * `..` steps out of the playlist's own record directory, and the segment's
 * record id plus file name select the blob beside it. Anything the file store
 * does not address in its stored shape keeps the root-relative path.
 */
function toSegmentUrl(url: string): string {
  const path = toStorePath(url);
  const stored = STORED_FILE_PATH.exec(path);
  return stored ? `../${stored[1]}/${stored[2]}` : path;
}

/** Turns an absolute store URL into a root-relative path, leaving others alone. */
function toStorePath(url: string): string {
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) return url;

  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}
