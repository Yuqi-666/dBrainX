// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The Dynamic Island's form set — the single declaration of its literal union.
 *
 * It lives here, and not in either consumer, because the two sides of this
 * contract may not depend on each other: `@workspace/store` owns the state
 * (`islandPanel`), `@workspace/ui` renders it, and a shared component library
 * must not reach into a state container. Both already depend on this package,
 * so this is the only place that can be the source of truth.
 */

/** One form of the island. `"idle"` is the collapsed pill. */
export type IslandPanel = "idle" | "preview" | "search" | "agent";

/** The forms that carry a body. `"idle"` is the pill and has none. */
export type IslandExpandedPanel = Exclude<IslandPanel, "idle">;
