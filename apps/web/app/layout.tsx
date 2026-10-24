// SPDX-License-Identifier: AGPL-3.0-only

import { Geist_Mono, Manrope, Noto_Serif } from "next/font/google";
import type { Metadata } from "next";

import "@workspace/ui/globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { cn } from "@workspace/ui/lib/utils";
import ContextMenuInterceptor from "@/components/ContextMenuInterceptor";
import type { ReactNode } from "react";
import { Providers } from "./providers";
import { LocaleInitializer } from "@workspace/ui/lib/i18n";
const notoSerifHeading = Noto_Serif({
  subsets: ["latin"],
  variable: "--font-heading",
});

export const metadata: Metadata = {
  title: "dBrainX",
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

const manrope = Manrope({ subsets: ["latin"], variable: "--font-sans" });

const fontMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
});

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>): ReactNode {
  return (
    <html
      lang="zh-CN"
      suppressHydrationWarning
      className={cn(
        "antialiased",
        fontMono.variable,
        "font-sans",
        manrope.variable,
        notoSerifHeading.variable,
      )}
    >
      <body>
        <LocaleInitializer />
        <ContextMenuInterceptor />
        <ThemeProvider>
          <Providers>
            <main>{children}</main>
          </Providers>
        </ThemeProvider>
      </body>
    </html>
  );
}
