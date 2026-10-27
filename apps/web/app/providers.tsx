// SPDX-License-Identifier: AGPL-3.0-only

"use client";

import { useEffect, useState, type ReactNode } from "react";
import { TRPCReactProvider } from "@workspace/api-client";
import { useGraphSubscriptions } from "@workspace/api-client";
import { createPocketbaseClient, resolveBackendUrls } from "@workspace/api-client";

function GraphSubscriptionProvider(): ReactNode {
  useGraphSubscriptions();
  return null;
}

function PocketbaseInitializer({ children }: { children: ReactNode }): ReactNode {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    // Loopback → http://localhost:8090; proxied origin → <origin>/pb.
    // See packages/api-client/src/backend-urls.ts.
    createPocketbaseClient({ url: resolveBackendUrls().pocketbase });
    setReady(true);
  }, []);

  return ready ? <>{children}</> : null;
}

export function Providers({ children }: { children: React.ReactNode }): ReactNode {
  return (
    <PocketbaseInitializer>
      <TRPCReactProvider>
        <GraphSubscriptionProvider />
        {children}
      </TRPCReactProvider>
    </PocketbaseInitializer>
  );
}
