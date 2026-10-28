// SPDX-License-Identifier: AGPL-3.0-only

import type { IStorageUsageReader } from "@workspace/domain";
import type { PocketBaseClient } from "../database/pocketbase-client";

/**
 * Per-user storage occupation, read from the file store.
 *
 * Every blob is one record in the `files` collection, and the record carries the
 * byte length the PocketBase hook wrote when it accepted the upload — so the
 * quota can be answered with a projection of `size` only, without downloading a
 * blob or stat-ing the storage directory. Records written before that field
 * existed are backfilled by the migration that adds it.
 *
 * The query is scoped to the owner, not the workspace: the quota is one budget
 * per user across every workspace, exactly like the total the management page
 * shows.
 */
export class PocketBaseStorageUsage implements IStorageUsageReader {
  constructor(private readonly pb: PocketBaseClient) {}

  async usageFor(ownerId: string): Promise<number> {
    if (!ownerId) return 0;

    const records = await this.pb.collection("files").getFullList({
      filter: this.pb.client.filter("ownerId = {:owner}", { owner: ownerId }),
      fields: "id,size",
    });

    let total = 0;
    for (const record of records) {
      const size = Number((record as { size?: unknown }).size);
      if (Number.isFinite(size) && size > 0) total += size;
    }
    return total;
  }
}
