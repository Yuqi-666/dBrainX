// SPDX-License-Identifier: AGPL-3.0-only

import { create } from "zustand";
import { devtools } from "zustand/middleware";
import { persist } from "zustand/middleware";
import type { AuthUser } from "@workspace/interfaces/models/user";

export interface AuthStore {
  user: AuthUser | null;
  isAuthenticated: boolean;
  setUser: (user: AuthUser | null) => void;
  clearAuth: () => void;
  getUserId: () => string | null;
}

export const useAuthStore = create<AuthStore>()(
  devtools(
    persist(
      (set, get) => ({
        user: null,
        isAuthenticated: false,

        setUser: (user) =>
          set({
            user,
            isAuthenticated: user !== null,
          }),

        clearAuth: () =>
          set({
            user: null,
            isAuthenticated: false,
          }),

        getUserId: () => get().user?.id ?? null,
      }),
      {
        name: "auth-storage",
        partialize: (state) => ({
          user: state.user,
          isAuthenticated: state.isAuthenticated,
        }),
      },
    ),
    { name: "auth-store" },
  ),
);
