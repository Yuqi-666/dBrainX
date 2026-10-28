// SPDX-License-Identifier: AGPL-3.0-only

"use client";
import { useI18n } from "@workspace/ui/lib/i18n";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@workspace/store";
import { trpc, clearAuthSession } from "@workspace/api-client";
import { DynamicIslandHost } from "@/components/dynamic-island-host";
import { WorkspaceShell } from "@/components/workspace-shell";

/**
 * The authenticated shell of the app.
 *
 * `WorkspaceShell` is rendered here, not in a page, because this layout survives
 * a soft navigation between `/graph` and `/dashboard` while a page component does
 * not — so the workspace is loaded once and both surfaces stay alive across a
 * switch (`components/workspace-shell.tsx` explains the design). The pages of the
 * group are URL entry points only: the island flips the surface through the
 * store, and this shell derives it from the pathname when a link, a refresh or
 * the back button is what moved it.
 */
export default function MainLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { t } = useI18n();

  const router = useRouter();
  const { setUser } = useAuthStore();

  // Always verify the session against the server. `me` is protected → its
  // context is server-verified from the WS token, so this is the source of
  // truth even when zustand was rehydrated from localStorage.
  const { data: currentUser, isError } = trpc.auth.me.useQuery(undefined, {
    retry: false,
  });

  useEffect(() => {
    if (currentUser) {
      setUser(currentUser);
    }
  }, [currentUser, setUser]);

  useEffect(() => {
    if (isError) {
      // Server rejected the token (user deleted, expired, revoked, or absent):
      // clear client state AND the `pb_token` cookie. Clearing the cookie is
      // essential — the edge middleware only checks JWT expiry, so an uncleared
      // cookie keeps bouncing /login back to /graph, leaving this layout stuck
      // on a blank screen.
      useAuthStore.getState().clearAuth();
      clearAuthSession();
      router.push("/login");
    }
  }, [isError, router]);

  // Gate on the server-confirmed user, never on the persisted `isAuthenticated`
  // (which can read stale `true` after the DB user was deleted). While the
  // server is still verifying, show a loading state instead of a blank screen.
  if (!currentUser) {
    if (isError) {
      // The redirect effect above navigates to /login; render nothing to avoid
      // a flash of the authenticated shell.
      return null;
    }
    return (
      <div className="flex min-h-dvh items-center justify-center text-muted-foreground">
        {t("Loading…")}{" "}
      </div>
    );
  }
  // The island is mounted **inside** the authenticated branch: an unauthenticated
  // visitor must never see the capsule, and the confirmation must not flash it
  // (docs/plan/dynamic-island.md §M4.2-1). The shell shares that branch for the
  // same reason — it needs a verified token before it loads anything.
  return (
    <>
      <WorkspaceShell />
      {children}
      <DynamicIslandHost />
    </>
  );
}
