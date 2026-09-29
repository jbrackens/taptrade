/**
 * Next.js API Route - Backoffice two-factor code step
 * Exchanges the challenge from /api/auth/login plus an authenticator code
 * for the session, then sets the same cookies as a password-only sign-in.
 */

import { NextRequest, NextResponse } from "next/server";
import { setSessionCookies } from "../../../../lib/session-cookies";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const mfaToken = typeof body?.mfaToken === "string" ? body.mfaToken : "";
    const code = typeof body?.code === "string" ? body.code : "";
    const apiUrl = process.env.NEXT_PUBLIC_AUTH_URL || "http://localhost:18081";

    if (!mfaToken || !code) {
      return NextResponse.json(
        { message: "mfaToken and code are required" },
        { status: 400 },
      );
    }

    const response = await fetch(`${apiUrl}/api/v1/auth/login/mfa`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ mfaToken, code }),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      return NextResponse.json(data, { status: response.status });
    }

    const res = NextResponse.json(data);
    setSessionCookies(res, data);
    return res;
  } catch (error) {
    console.error("[API] Two-factor sign-in error:", error);
    return NextResponse.json(
      { message: "Internal server error" },
      { status: 500 },
    );
  }
}
