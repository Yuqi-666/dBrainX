// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The workspace name rule shared by every construction path.
 *
 * This module deliberately has no imports: the co-located test runs under
 * `node --experimental-strip-types`, which does not resolve the `@workspace/*`
 * aliases. The caller passes the shared limit, so the entity and the
 * create/rename dialogs can never disagree about the longest accepted name.
 */

/**
 * Trims and validates a workspace name.
 * @throws Error if the trimmed name is empty or longer than maxLength
 */
export function normalizeWorkspaceName(
  name: string,
  maxLength: number,
): string {
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    throw new Error("Workspace name cannot be empty");
  }
  if (trimmed.length > maxLength) {
    throw new Error(`Workspace name cannot exceed ${maxLength} characters`);
  }
  return trimmed;
}
