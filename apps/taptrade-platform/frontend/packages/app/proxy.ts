/**
 * Next.js Proxy - Authentication and Route Protection
 * Protects private routes and redirects to login when necessary
 */

import { NextRequest, NextResponse } from "next/server";

// Public routes — no auth required. Must stay in sync with the Go gateway's
// publicPrefixes list in cmd/gateway/main.go so browser-side and server-side
// auth rules agree.
const PUBLIC_ROUTES = [
  // Landing + auth
  "/",
  "/auth",
  // Prediction discovery (read-only)
  "/predict",
  "/discover",
  "/market",
  "/category",
  // Informational pages
  "/contact-us",
  "/about",
  "/tos",
  "/terms",
  "/privacy-policy",
  "/privacy",
  "/terms-and-conditions",
];

const PROTECTED_ROUTES = [
  "/account",
  "/leaderboards",
  "/portfolio",
  "/profile",
  "/rewards",
  "/store",
];

const RETIRED_MONEY_ROUTE_PATTERN =
  /^\/(?:cashier|cashout|crypto|deposit|deposits|fiat|payment|payments|prize|prizes|redeem|redemption|withdraw|withdrawal|withdrawals)(?:\/|$)/i;

function isPublicRoute(pathname: string): boolean {
  return PUBLIC_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`),
  );
}

function isProtectedRoute(pathname: string): boolean {
  return PROTECTED_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`),
  );
}

function isRetiredMoneyRoute(pathname: string): boolean {
  return RETIRED_MONEY_ROUTE_PATTERN.test(pathname);
}

function getAuthToken(request: NextRequest): string | null {
  // Check HttpOnly access_token cookie (current auth) or legacy authToken cookie
  const accessToken = request.cookies.get("access_token")?.value;
  if (accessToken) {
    return accessToken;
  }

  const legacyToken = request.cookies.get("authToken")?.value;
  if (legacyToken) {
    return legacyToken;
  }

  const authHeader = request.headers.get("authorization");
  if (authHeader && authHeader.startsWith("Bearer ")) {
    return authHeader.slice(7);
  }

  return null;
}

export function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  if (isRetiredMoneyRoute(pathname)) {
    return new NextResponse("Not found", { status: 404 });
  }

  // Skip auth for static assets served from public/ — the config.matcher exclusions
  // are not applied by Next.js 16's proxy loader, so we guard here directly
  if (
    /\.(?:png|jpe?g|gif|svg|ico|webp|webm|mp4|css|js|woff2?|ttf|eot|map|html|txt|xml|json)$/.test(
      pathname,
    )
  ) {
    return NextResponse.next();
  }

  // Skip Next.js internal routes (in case matcher isn't applied)
  if (pathname.startsWith("/_next/") || pathname.startsWith("/api/")) {
    return NextResponse.next();
  }

  const token = getAuthToken(request);

  if (isPublicRoute(pathname)) {
    return NextResponse.next();
  }

  if (!token && isProtectedRoute(pathname)) {
    const loginUrl = new URL("/auth/login", request.url);
    loginUrl.searchParams.set("returnUrl", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!api|_next/static|_next/image|static|favicon.ico|robots.txt|sitemap.xml).*)",
  ],
};
