// SPDX-License-Identifier: AGPL-3.0-only

// Derived media artifacts, and their lifetime.
//
// A PDF cover, a video's HLS playlist, its segments and its poster are stored
// as ordinary rows of the `files` collection: they count against the owner's
// quota exactly like the blob they were made from. Each one carries
// `derivedFrom` = the id of the resource row it belongs to.
//
// Two things follow from that provenance, and this module owns both sides:
//
//   * the resource library lists only rows without `derivedFrom`, so a video
//     does not show up as a hundred segments and a playlist;
//   * deleting the resource deletes its artifacts in the same request, so the
//     bytes a user frees in the library are the bytes the quota charged.
//
// The delete runs *after* the source row was removed. A failed delete then
// leaves the artifacts in place — hidden, but recoverable — instead of
// destroying them for a resource that still exists.

/**
 * Deletes every artifact derived from the record in one after-delete event.
 *
 * `e.app.delete` runs with the hook's privileges, so a workspace viewer who
 * may not delete the owner's artifact rows still frees them together with the
 * resource. A failure on one artifact is logged and the rest are still
 * removed: the source is already gone, so a partial cleanup must not abort the
 * request that produced it.
 */
function deleteDerived(e) {
  const sourceId = e.record.id;
  const records = e.app.findRecordsByFilter(
    "files",
    "derivedFrom = {:source}",
    "",
    0,
    0,
    { source: sourceId },
  );

  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    try {
      e.app.delete(record);
    } catch (error) {
      console.warn(
        "[media-derived] could not delete artifact " +
          record.id +
          " of " +
          sourceId +
          ": " +
          error,
      );
    }
  }
}

module.exports = {
  deleteDerived: deleteDerived,
};
