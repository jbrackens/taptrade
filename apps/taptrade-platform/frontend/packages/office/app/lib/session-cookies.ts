/**
 * Session cookies the backoffice sets after a successful sign-in, shared by
 * the password step (app/api/auth/login) and the two-factor code step
 * (app/api/auth/login/mfa). A two-factor challenge carries no accessToken,
 * so nothing is set until the code is accepted.
 */

import { randomBytes } from "node:crypto";
import type { NextResponse } from "next/server";

export interface AuthTokens {
  accessToken?: string;
  expiresInSeconds?: number;
}

export function setSessionCookies(res: NextResponse, data: AuthTokens): void {
  if (!data.accessToken) return;

  // authToken: used by the backoffice Next.js middleware
  // access_token: used by the Go gateway auth middleware (forwarded via rewrite)
  const cookieOptions = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: data.expiresInSeconds || 3600,
  };
  res.cookies.set({
    name: "authToken",
    value: data.accessToken,
    ...cookieOptions,
  });
  res.cookies.set({
    name: "access_token",
    value: data.accessToken,
    ...cookieOptions,
  });

  // csrf_token: the gateway's httpx.CSRF enforces a double-submit pair
  // (cookie === X-CSRF-Token header, constant-time, no server-side
  // secret) on every state-changing admin call. Nothing in the stack
  // minted this cookie, so create/lifecycle/settle all 403'd. It must
  // NOT be httpOnly — the shared api-client reads it from
  // document.cookie to populate the header. Security holds because the
  // same-origin policy prevents a cross-origin attacker from reading
  // the cookie or the response to forge the header. Same value the
  // browser sends as the cookie (forwarded to :18080 via the
  // next.config rewrite in dev / Caddy in prod, both same-origin).
  res.cookies.set({
    name: "csrf_token",
    value: randomBytes(32).toString("hex"),
    httpOnly: false,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: data.expiresInSeconds || 3600,
  });
}
