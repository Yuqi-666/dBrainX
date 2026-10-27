// SPDX-License-Identifier: AGPL-3.0-only

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createTRPCReact } from "@trpc/react-query";
import type { AppRouter } from "@workspace/adapter-front";
import { trpcClient } from "./client";
import { useState } from "react";

export const trpc = createTRPCReact<AppRouter>();

export function TRPCReactProvider({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  const [client] = useState(() => trpcClient);

  return (
    <trpc.Provider client={client} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </trpc.Provider>
  );
}
