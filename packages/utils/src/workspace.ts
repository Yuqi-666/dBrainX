// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The workspace name contract.
 *
 * This lives beside the other framework-free helpers because both the client
 * dialogs and the backend domain entity enforce the same limit: a name that a
 * dialog accepts can never be rejected later by a different limit. It is a
 * file subpath (`@workspace/utils/workspace`) rather than a barrel export so a
 * bare-Node test can resolve it without pulling in react-querybuilder.
 */
export const WORKSPACE_NAME_MAX_LENGTH = 50;

/**
 * The canonical name the server gives the workspace it provisions on first
 * login, and the canonical name of the global view it creates with a workspace.
 *
 * The names are stored as-is so older records keep working, but the client
 * compares the stored name with these values: while a default instance still
 * carries its canonical name, the UI shows the localized catalog entry
 * instead. After the user renames the instance, the stored custom name wins.
 * The values must match the literals in `WorkspaceCommandService` and the
 * local engine.
 */
export const DEFAULT_WORKSPACE_NAME = "默认工作区";
export const DEFAULT_VIEW_NAME = "全部";
