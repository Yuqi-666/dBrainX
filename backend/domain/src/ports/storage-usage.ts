// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Storage accounting port.
 *
 * The per-user quota is a fact about the file store, not about an upload: it is
 * the total byte count of every blob the owner already stored. The application
 * layer needs it before it accepts a large upload, and it cannot read the store
 * itself, so this port exposes the one number it needs.
 *
 * The category ceiling does not need a port: it is deployment configuration that
 * lives in `@workspace/utils/storage-limits`, the same module the client and the
 * PocketBase hook read.
 */
export interface IStorageUsageReader {
  /**
   * Total bytes this user currently stores across every workspace, counting
   * derived artifacts (PDF covers, HLS segments and playlists) as well as
   * originals. Resolves `0` for a user that has stored nothing.
   */
  usageFor(ownerId: string): Promise<number>;
}
