// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Ports (hexagonal boundaries) owned by the domain layer.
 *
 * See `./document-analysis` for the file-analysis contracts,
 * `./video-transcode` for the HLS packaging contract, `./media-transcode` for
 * making an imported audio file playable, `./media-download` for reading and
 * fetching a media page, `./media-sites` for the listed sites,
 * `./media-site-auth` for saved logins, `./media-import-job` for the resumable
 * import job, `./media-analysis` for the analysis cache on a stored resource and
 * `./file-upload` for the resumable upload spool. Repository ports live in
 * `../repositories`.
 */
export * from "./document-analysis";
export * from "./video-transcode";
export * from "./media-transcode";
export * from "./media-download";
export * from "./media-sites";
export * from "./media-site-auth";
export * from "./media-import-job";
export * from "./file-upload";
export * from "./media-analysis";
export * from "./storage-usage";
