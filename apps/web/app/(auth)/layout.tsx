// SPDX-License-Identifier: AGPL-3.0-only

import type { ReactNode } from "react";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-dvh items-center justify-center overflow-y-auto bg-gradient-to-br from-slate-100 to-slate-200">
      {children}
    </div>
  );
}
