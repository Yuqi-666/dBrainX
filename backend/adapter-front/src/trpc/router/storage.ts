// SPDX-License-Identifier: AGPL-3.0-only

import type { StorageLimits } from "@workspace/utils/storage-limits";
import { container } from "../../di/container";
import { protectedProcedure, router } from "../server";

/**
 * Deployment storage policy.
 *
 * The values are resolved once by the composition root from the operator's
 * `.env` (see `resolveStorageLimits` in `@workspace/utils/storage-limits`), so the
 * library page displays the quota and the per-category ceilings that the upload
 * paths actually enforce — not a copy that a client bundle would have frozen at
 * build time.
 *
 * Protected on purpose: policy belongs to the authenticated application, and an
 * anonymous caller has no resources to manage.
 */
export const storageRouter = router({
  /**
   * The effective limits: `{ userQuotaBytes, maxFileBytes }`.
   *
   * `userQuotaBytes: 0` means the total quota is disabled; every per-category
   * ceiling is always a positive byte count.
   */
  limits: protectedProcedure.query((): StorageLimits => {
    return container().storageLimits;
  }),
});
