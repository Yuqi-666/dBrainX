// SPDX-License-Identifier: AGPL-3.0-only

"use client";
import { useI18n } from "@workspace/ui/lib/i18n";

import { useRouter } from "next/navigation";
import {
  trpc,
  clearAuthSession,
  reconnectTRPCClient,
} from "@workspace/api-client";
import { useAuthStore } from "@workspace/store";
import { Button } from "@workspace/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workspace/ui/components/ui/dropdown-menu";

export function UserMenu() {
  const { t } = useI18n();

  const router = useRouter();
  const { user, clearAuth } = useAuthStore();
  const logoutMutation = trpc.auth.logout.useMutation();

  function handleLogout() {
    logoutMutation.mutateAsync().catch(() => {
      // Server-side logout is best-effort; clear client state regardless.
    });
    clearAuthSession();
    reconnectTRPCClient();
    clearAuth();
    router.push("/login");
  }

  if (!user) {
    return null;
  }

  return (
    <div className="fixed right-4 top-4 z-50">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" className="h-8 w-8 rounded-full">
            {user.nickname.charAt(0).toUpperCase()}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuLabel>{user.nickname}</DropdownMenuLabel>
          {process.env.NEXT_PUBLIC_DBRAIN_PLATFORM !== "desktop" && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={handleLogout}>
                {t("Sign out")}
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
