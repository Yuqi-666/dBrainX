// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The builtin plugin's manifest id, in its own module.
 *
 * Both the type catalogue (`node-types.ts`) and the two operation catalogues
 * need it, and the type catalogue imports the self-operation ids from
 * `type-operations.ts` so a type lists exactly the operations that exist. That
 * import direction rules out keeping the id in `node-types.ts`: the id has to
 * live below both of them. `node-types.ts` re-exports it, so existing imports
 * keep working.
 */
export const builtinPluginId = "dbrainx.builtin";
