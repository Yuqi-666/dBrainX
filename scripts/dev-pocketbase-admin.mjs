// SPDX-License-Identifier: AGPL-3.0-only

/**
 * `pnpm pb:admin`
 *
 * Applies the operator account configured in `.env` to the local PocketBase
 * database (`pb/pb_data`, or `DBRAIN_PB_DATA_DIR`) without restarting the stack —
 * `pnpm dev` already does this on every start, so this is only for "I changed
 * `.env` and PocketBase is already running".
 *
 * Exits 1 with a readable message when `.env` is missing or incomplete: the
 * account is required configuration, not an optional nicety.
 */
import { applyAdminConfig } from "./lib/pocketbase-admin.mjs";

process.exitCode = applyAdminConfig();
