// SPDX-License-Identifier: AGPL-3.0-only

"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function Home() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/graph");
  }, [router]);
  return (
    <div className="flex min-h-screen items-center justify-center text-muted-foreground">
      打开本地工作空间…
    </div>
  );
}
