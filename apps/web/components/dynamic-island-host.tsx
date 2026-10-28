// SPDX-License-Identifier: AGPL-3.0-only

"use client";
import { useI18n, useLocaleMemo } from "@workspace/ui/lib/i18n";

import { useCallback, useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Search, Bot } from "lucide-react";
import { useDataStore, useUIStore } from "@workspace/store";
import {
  DynamicIsland,
  SearchPanel,
  AgentPanel,
  type IslandNavItem,
} from "@workspace/ui/components/dynamic-island/index";

import { IslandNodePreview } from "@workspace/ui/components/preview-block/island-node-preview";

import {
  ISLAND_ROUTES,
  stepIslandRoute,
  type IslandRoute,
} from "@/components/island-routes";

/** App adapter: routes, feature panels, global shortcuts and live island height. */
export function DynamicIslandHost() {
  const { t } = useI18n();

  const pathname = usePathname();
  const router = useRouter();
  const islandPanel = useUIStore((s) => s.islandPanel);
  const setIslandPanel = useUIStore((s) => s.setIslandPanel);
  const mainViewType = useUIStore((s) => s.mainViewType);
  const editorReturnViewType = useUIStore((s) => s.editorReturnViewType);

  // Which surface is on screen, with the fullscreen editor counting as the one it
  // was opened from — the same resolution `WorkspaceShell` performs, so the
  // capsule lights up the surface the user is actually looking at.
  const activeView =
    mainViewType === "editor" ? editorReturnViewType : mainViewType;

  const previewNodeId = useUIStore((s) => s.islandPreviewNodeId);
  const previewType = useDataStore((s) =>
    previewNodeId ? s.nodes.get(previewNodeId)?.nodeType : undefined,
  );
  const close = () => setIslandPanel("idle");

  /**
   * The one navigation path — the island's click and the sequence shortcuts both
   * go through it. The store flips first so the surface swaps in the same frame;
   * `router.push` then keeps the URL the honest address of what is on screen
   * (both routes share one persistent shell, so nothing reloads).
   */
  const navigate = useCallback(
    (route: IslandRoute) => {
      if (route.view) useUIStore.getState().setMainViewType(route.view);
      router.push(route.href, { scroll: false });
    },
    [router],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat) return;
      const state = useUIStore.getState();
      if (
        (event.ctrlKey || event.metaKey) &&
        !event.altKey &&
        !event.shiftKey
      ) {
        const key = event.key.toLowerCase();
        // Ctrl+H / Ctrl+L move one step along the app's navigation order (the
        // island's own route table), so the capsule and the keyboard agree on
        // what "left" and "right" mean.
        //
        // The browser's own bindings for these two keys are **claimed
        // unconditionally**, even from an address the table does not know: the
        // chord belongs to the app while it is on screen, and only suppressing
        // it when a step happens to exist would make the two keys fire the
        // browser's history / location bar intermittently.
        if (key === "h" || key === "l") {
          event.preventDefault();
          const next = stepIslandRoute(pathname, key === "l" ? 1 : -1);
          if (next) navigate(next);
          return;
        }
        if (key !== "k" && key !== "j") return;
        event.preventDefault();
        const target = key === "k" ? "search" : "agent";
        state.closePreviewBlock();
        state.setIslandPanel(state.islandPanel === target ? "idle" : target);
      } else if (event.key === "Escape" && state.islandPanel !== "idle") {
        state.collapseIsland();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [navigate, pathname]);

  useEffect(() => {
    setIslandPanel("idle");
  }, [pathname, setIslandPanel]);

  const capsule = useRef<HTMLDivElement | null>(null);

  const nav = useLocaleMemo<IslandNavItem[]>(
    () => [
      ...ISLAND_ROUTES.map((route): IslandNavItem => {
        const Icon = route.icon;
        return {
          key: route.key,
          label: route.label,
          icon: <Icon className="size-4" />,
          // The store answers first (it flips on click, in the same frame) and
          // the committed pathname second (a deep link or the back button moves
          // the URL before the shell re-derives the surface from it).
          active: activeView === route.key || pathname === route.href,
          enabled: route.enabled,
          disabledReason: route.disabledReason,
          // Deliberately no `shortcuts`: the page tooltip only *names* the
          // destination. Ctrl+H / Ctrl+L are ambient (they read as "left/right"
          // here), so printing both keys on every page item taught nothing.
          onSelect: () => navigate(route),
        };
      }),
      {
        key: "agent",
        label: t("Agent"),
        icon: <Bot className="size-4" />,
        active: islandPanel === "agent",
        enabled: true,
        separator: true,
        // The shortcut lives in the tooltip as a key cap, not in the label: one
        // convention for every item in the row.
        shortcuts: ["Ctrl+J"],
        onSelect: () =>
          setIslandPanel(islandPanel === "agent" ? "idle" : "agent"),
      },
      {
        key: "search",
        label: t("搜索"),
        icon: <Search className="size-4" />,
        active: islandPanel === "search",
        enabled: true,
        shortcuts: ["Ctrl+K"],
        onSelect: () =>
          setIslandPanel(islandPanel === "search" ? "idle" : "search"),
      },
    ],
    [activeView, pathname, islandPanel, navigate, setIslandPanel, t],
  );

  useEffect(() => {
    const island = capsule.current;
    if (!island) return;

    const root = document.documentElement;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      // The *painted* height, so a consumer avoids the capsule including its 1px
      // rim (an inset shadow, which costs no layout space).
      root.style.setProperty(
        "--dynamic-island-height",
        `${Math.round(entry.target.getBoundingClientRect().height)}px`,
      );
    });
    observer.observe(island);

    return () => {
      observer.disconnect();
      root.style.removeProperty("--dynamic-island-height");
    };
  }, []);

  return (
    <DynamicIsland
      ref={capsule}
      panel={islandPanel}
      onPanelChange={setIslandPanel}
      nav={nav}
      contentWidths={{
        preview: ["image", "video", "pdf", "webpage"].includes(
          previewType ?? "",
        )
          ? 400
          : 360,
      }}
      content={{
        search: <SearchPanel onClose={close} />,
        agent: <AgentPanel />,
        preview: previewNodeId ? (
          <IslandNodePreview nodeId={previewNodeId} onClose={close} />
        ) : null,
      }}
    />
  );
}
