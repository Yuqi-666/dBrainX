// SPDX-License-Identifier: AGPL-3.0-only

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const PROTECTED_PATHS = ["/graph", "/dashboard", "/resources", "/settings"];
const AUTH_PATHS = ["/login", "/register"];

// Edge runtime: base64 decode via Web globals only (no Node / PocketBase SDK).
function getTokenExp(token: string): number | null {
  const part = token.split(".")[1];
  if (!part) return null;
  try {
    const base64 = part.replace(/-/g, "+").replace(/_/g, "/");
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const payload = JSON.parse(new TextDecoder().decode(bytes)) as {
      exp?: unknown;
    };
    return typeof payload.exp === "number" ? payload.exp : null;
  } catch {
    return null;
  }
}

function isTokenValid(token: string): boolean {
  const exp = getTokenExp(token);
  return exp !== null && exp * 1000 > Date.now();
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const token = request.cookies.get("pb_token")?.value;
  const isAuthenticated = !!token && isTokenValid(token);

  const isProtectedPath = PROTECTED_PATHS.some((path) =>
    pathname.startsWith(path),
  );
  const isAuthPath = AUTH_PATHS.some((path) => pathname.startsWith(path));

  if (isAuthPath && isAuthenticated) {
    const url = request.nextUrl.clone();
    url.pathname = "/graph";
    return NextResponse.redirect(url);
  }

  if (isProtectedPath && !isAuthenticated) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("redirect", pathname);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/graph/:path*",
    "/dashboard/:path*",
    "/resources/:path*",
    "/settings/:path*",
    "/login",
    "/register",
  ],
};
