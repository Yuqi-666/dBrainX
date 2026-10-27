// SPDX-License-Identifier: AGPL-3.0-only

import { translate } from "@workspace/ui/lib/i18n/runtime";
import type { ComponentType } from "react";
import { FolderOpen, LayoutDashboard } from "lucide-react";
import { GraphIcon } from "@workspace/ui/components/brand/brand-icons";
import type { MainViewType } from "@workspace/store";

/** A route destination that names a workspace surface (`/graph`, `/dashboard`). */
export type RouteViewType = Exclude<MainViewType, "editor">;

/**
 * One page destination of the island's navigation row (design
 * `docs/dynamic-island/README.md` §5.2 / §7.1).
 *
 * The capsule is a controlled shell: it renders `nav` exactly as the host hands
 * it over, so `enabled` / `disabledReason` are decided **here**, next to the
 * routes this app actually ships, and never inside `packages/ui`.
 */
export interface IslandRoute {
  key: string;
  label: string;
  href: string;
  icon: ComponentType<{ className?: string }>;
  enabled: boolean;
  disabledReason?: string;
  /**
   * The `mainViewType` this destination names. Both consumers read it rather
   * than re-deriving it: the island writes it optimistically on click (so the
   * surface swaps in the same frame instead of after the route commits), and
   * `WorkspaceShell` reads it off the pathname for a deep link / refresh / back.
   * Absent for a destination that is not a surface.
   */
  view?: RouteViewType;
}

/**
 * The island's page list — the **single source of truth** for it (design
 * `docs/dynamic-island/README.md` §5.1; plan `docs/plan/dynamic-island.md` §M4.1
 * 第 8 行). Three things about it are load-bearing:
 *
 * 1. **It lives in the host, not in `packages/ui`.** A route table written into
 *    the shared package would hard-code `/dashboard` into a component that
 *    renders on every page, and the shared package has no way to know which
 *    pages this app ships — the first navigation would be a 404 (design
 *    §0.3-5). The host owns `/graph`, `/dashboard` and `/resources`, so the host
 *    owns this table. It is also the app's route ↔ surface mapping, not just the
 *    island's nav list: `WorkspaceShell` resolves the visible surface through it.
 * 2. **`/dashboard` and `/resources` are enabled.** They render a workspace
 *    surface without the graph sidebar; the resource library manages the media
 *    assets the workspace nodes reference.
 * 3. **`/settings` is deliberately absent.** It is the middleware-only path the
 *    edge guard names but this app does not ship. The page destinations are the
 *    three above; `搜索` is not a route at all, it opens the `search` panel (see
 *    `dynamic-island-host.tsx`).
 *
 * Every destination shares one persistent shell (`(main)/layout.tsx`), so
 * following one switches the visible surface rather than reloading; the URL
 * stays the honest address of the surface either way.
 *
 * **Array order is the capsule's order**: the page items come first, then search.
 * The 1px separator that splits navigation from search is not inferred by the
 * island — the host marks the item it precedes with `separator` (see
 * `dynamic-island-host.tsx`).
 */
export const ISLAND_ROUTES: IslandRoute[] = [
  {
    key: "graph",
    get label() {
      return translate("图谱");
    },
    href: "/graph",
    icon: GraphIcon,
    enabled: true,
    view: "graph",
  },
  {
    key: "dashboard",
    get label() {
      return translate("仪表盘");
    },
    href: "/dashboard",
    icon: LayoutDashboard,
    enabled: true,
    view: "dashboard",
  },
  {
    key: "resources",
    get label() {
      return translate("资源库");
    },
    href: "/resources",
    icon: FolderOpen,
    enabled: true,
    view: "resources",
  },
];

/**
 * The route whose `href` owns `pathname` — the exact address, or any nested path
 * under it. Both consumers resolve through this rather than pattern-matching the
 * pathname themselves: `WorkspaceShell` derives the visible surface from it (a
 * deep link / refresh / back), and `DynamicIslandHost` walks it to find where the
 * current URL sits in the navigation sequence.
 */
export function matchIslandRoute(pathname: string): IslandRoute | undefined {
  return ISLAND_ROUTES.find(
    (route) => pathname === route.href || pathname.startsWith(`${route.href}/`),
  );
}

/**
 * The app's navigation order — the capsule's destinations, enabled ones only,
 * which is the order Ctrl+H / Ctrl+L walk and the order the tooltips key off.
 */
const NAVIGATION_SEQUENCE = ISLAND_ROUTES.filter((route) => route.enabled);

/** Where `pathname` sits in that order, or `-1` when it is not a destination. */
function sequenceIndex(pathname: string): number {
  const current = matchIslandRoute(pathname);
  return current ? NAVIGATION_SEQUENCE.indexOf(current) : -1;
}

/**
 * The neighbour of `pathname` in the app's own navigation order — the capsule's
 * order, enabled destinations only — `delta` steps away (`-1` left, `+1` right).
 *
 * Ctrl+H / Ctrl+L walk this sequence, so the order is the one the user sees in
 * the island. It **wraps**, like a carousel: the sequence has no ends to fall off,
 * so from the last destination the right step lands on the first and vice versa.
 * An address outside the table (or a disabled destination) has no neighbour, so
 * the shortcut does nothing.
 */
export function stepIslandRoute(
  pathname: string,
  delta: number,
): IslandRoute | undefined {
  const index = sequenceIndex(pathname);
  if (index === -1 || NAVIGATION_SEQUENCE.length < 2) return undefined;
  const length = NAVIGATION_SEQUENCE.length;
  // `+ length` first: a negative `delta` must not index from the end.
  return NAVIGATION_SEQUENCE[(index + delta + length) % length];
}
