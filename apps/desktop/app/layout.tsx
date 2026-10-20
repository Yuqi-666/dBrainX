// SPDX-License-Identifier: AGPL-3.0-only

import type { Metadata } from "next";
import type { ReactNode } from "react";
import "@workspace/ui/globals.css";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import ContextMenuInterceptor from "@/components/ContextMenuInterceptor";
import { Providers } from "./providers";
import { LocaleInitializer } from "@workspace/ui/lib/i18n";

export const metadata: Metadata = {
  title: "dBrain",
  description: "本地优先的知识工作空间",
  icons: {
    icon: [
      {
        url: "/icons/logo-light.svg",
        type: "image/svg+xml",
        media: "(prefers-color-scheme: light)",
      },
      {
        url: "/icons/logo-dark.svg",
        type: "image/svg+xml",
        media: "(prefers-color-scheme: dark)",
      },
    ],
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="zh-CN"
      suppressHydrationWarning
      className="antialiased font-sans"
    >
      <body>
        <LocaleInitializer />
        <ContextMenuInterceptor />
        <ThemeProvider>
          <Providers>{children}</Providers>
        </ThemeProvider>
      </body>
    </html>
  );
}
