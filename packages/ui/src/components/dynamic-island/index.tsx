// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The island's public surface — one declaration of it, so the folder has a
 * single place to read what it exports.
 *
 * `index.tsx` is available through the package's `./components/*` export.
 * The shell receives feature bodies from the app host; importing it directly
 * avoids importing SearchPanel and AgentPanel when only the shell is needed.
 *
 * ```tsx
 * import { DynamicIsland, SearchPanel, AgentPanel } from "@workspace/ui/components/dynamic-island/index";
 * import type { DynamicIslandProps, IslandNavItem, IslandPanel }
 *   from "@workspace/ui/components/dynamic-island/index";
 * ```
 */
export { DynamicIsland } from "./dynamic-island";
export { SearchPanel, type SearchPanelProps } from "./panels/search-panel";
export { AgentPanel } from "./panels/agent-panel";
export type {
  DynamicIslandProps,
  IslandExpandedPanel,
  IslandNavItem,
  IslandPanel,
} from "./types";
