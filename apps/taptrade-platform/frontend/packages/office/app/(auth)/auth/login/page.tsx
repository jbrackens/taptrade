"use client";

import { useState, FormEvent, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { brand } from "../../../../lib/brand";

// useSearchParams() reads URL state on the client, so static prerender
// must be skipped for this route. Without this, Next.js 16 errors out
// during build with "useSearchParams() should be wrapped in a suspense
// boundary at page /auth/login". The Suspense fallback below is a
// secondary safety net for any future static-export attempt.
export const dynamic = "force-dynamic";

// Staff sign in with a password and then a code from an authenticator app
// (the auth service requires it for admins when AUTH_ADMIN_MFA_REQUIRED is
// on). Someone signing in for the first time since then gets a setup key to
// add to their app; the first code from it turns two-factor sign-in on.
type MfaChallenge = {
  mfaToken: string;
  enrollment?: { secret: string; otpauthUrl: string };
};

// Auth errors arrive as {error: {message}}; the proxy's own as {message}.
function errorMessage(data: unknown, fallback: string): string {
  if (data && typeof data === "object") {
    const record = data as Record<string, unknown>;
    if (typeof record.message === "string") return record.message;
    const nested = record.error;
    if (nested && typeof nested === "object") {
      const message = (nested as Record<string, unknown>).message;
      if (typeof message === "string") return message;
    }
  }
  return fallback;
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const searchParams = useSearchParams();
  const returnUrl = searchParams?.get("returnUrl") || "/dashboard";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [challenge, setChallenge] = useState<MfaChallenge | null>(null);
  const [code, setCode] = useState("");
  const [copied, setCopied] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await fetch("/api/auth/login/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(errorMessage(data, "Login failed"));
        setLoading(false);
        return;
      }

      if (data.mfaRequired && typeof data.mfaToken === "string") {
        setChallenge({ mfaToken: data.mfaToken, enrollment: data.enrollment });
        setPassword("");
        setCode("");
        setLoading(false);
        return;
      }

      completeSignIn(data);
    } catch {
      setError("Network error. Please try again.");
      setLoading(false);
    }
  }

  async function handleCode(e: FormEvent) {
    e.preventDefault();
    if (!challenge) return;
    setError("");
    setLoading(true);

    try {
      const res = await fetch("/api/auth/login/mfa/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mfaToken: challenge.mfaToken,
          code: code.replace(/\s/g, ""),
        }),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        const message = errorMessage(data, "Sign-in failed");
        if (message.toLowerCase().includes("sign-in expired")) {
          setChallenge(null);
          setError("Your sign-in timed out. Enter your password again.");
        } else if (message.toLowerCase().includes("incorrect code")) {
          setError(
            "That code didn't work. Enter the current code from your authenticator app.",
          );
        } else {
          setError(message);
        }
        setCode("");
        setLoading(false);
        return;
      }

      completeSignIn(data);
    } catch {
      setError("Network error. Please try again.");
      setLoading(false);
    }
  }

  async function copyKey() {
    if (!challenge?.enrollment) return;
    try {
      await navigator.clipboard.writeText(challenge.enrollment.secret);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can be refused; the key stays selectable.
    }
  }

  function completeSignIn(data: {
    accessToken?: string;
    token?: string;
    refreshToken?: string;
    refresh_token?: string;
    expiresInSeconds?: number;
    refreshExpiresInSeconds?: number;
  }) {
    // Store tokens in the legacy @taptrade-ui/utils token store (localStorage)
    // so the Pages Router session guard can find them. The Go gateway returns
    // opaque bearer tokens (atk_...) instead of JWTs — the dev-mode bypass
    // in utils/auth.ts accepts these without JWT validation.
    const accessToken = data.accessToken || data.token || "";
    const refreshToken = data.refreshToken || data.refresh_token || "";
    if (accessToken) {
      localStorage.setItem("JdaToken", accessToken);
      if (refreshToken) {
        localStorage.setItem("RefreshToken", refreshToken);
      }
      // Set generous expiry so the session guard doesn't expire the token
      const oneHourMs = Date.now() + (data.expiresInSeconds || 3600) * 1000;
      localStorage.setItem("JdaTokenExpDate", JSON.stringify(oneHourMs));
      if (refreshToken) {
        const refreshExpiry =
          Date.now() + (data.refreshExpiresInSeconds || 7200) * 1000;
        localStorage.setItem(
          "RefreshTokenExpDate",
          JSON.stringify(refreshExpiry),
        );
      }
    }

    // Guard against open-redirect: only allow same-origin absolute paths.
    // Reject protocol-relative ("//evil.com") and backslash ("/\evil.com")
    // forms that browsers normalize to a cross-origin destination.
    const isSafeReturn =
      returnUrl.startsWith("/") &&
      !returnUrl.startsWith("//") &&
      !returnUrl.startsWith("/\\");
    const destination = isSafeReturn ? returnUrl : "/dashboard";
    window.location.assign(destination);
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--bg-deep,#f7f3ed)] bg-[image:var(--bg-pattern)] bg-[length:var(--bg-pattern-size,32px_32px)] p-5">
      <div className="w-full max-w-[420px] rounded-2xl border border-[var(--border-1,#e5dfd2)] bg-[var(--surface-1,#ffffff)] px-10 py-11 shadow-[0_12px_48px_rgba(26,26,26,0.06),0_1px_2px_rgba(26,26,26,0.04)]">
        {/* Logo */}
        <div className="mb-9 text-center">
          <div className="mb-4 inline-flex items-end justify-center gap-3 text-[var(--focus-ring,#0e7a53)]">
            <span className="text-[40px] font-black leading-none tracking-normal">
              {brand.name}
            </span>
            <svg
              aria-hidden="true"
              className="mb-2 h-6 w-12 overflow-visible"
              viewBox="0 0 48 24"
              fill="none"
            >
              <path
                d="M4 16 L18 9 L31 13 L44 5"
                stroke="currentColor"
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              {[4, 18, 31, 44].map((cx, index) => (
                <circle
                  key={cx}
                  cx={cx}
                  cy={[16, 9, 13, 5][index]}
                  r="3"
                  fill="var(--surface-1,#ffffff)"
                  stroke="currentColor"
                  strokeWidth="3"
                />
              ))}
            </svg>
          </div>
          <h1 className="mb-1.5 text-[22px] font-bold tracking-normal text-[var(--t1,#1a1a1a)]">
            Backoffice
          </h1>
          <p className="text-sm font-normal text-[var(--t2,#4a4a4a)]">
            {!challenge
              ? "Sign in to your admin account"
              : challenge.enrollment
                ? "Set up two-factor sign-in"
                : "Enter the code from your authenticator app"}
          </p>
        </div>

        {challenge ? (
          <form onSubmit={handleCode} className="flex flex-col gap-5">
            {challenge.enrollment && (
              <div className="flex flex-col gap-2.5 rounded-lg border border-[var(--border-1,#e5dfd2)] bg-[var(--surface-2,#f7f3ed)] px-4 py-3.5">
                <p className="m-0 text-[13px] text-[var(--t2,#4a4a4a)]">
                  Staff accounts sign in with a code from an authenticator app.
                  Add this key to one (1Password, Google Authenticator, Authy),
                  then enter the 6-digit code it shows.
                </p>
                <p className="m-0 select-all break-words font-mono text-[15px] font-semibold tracking-[0.04em] text-[var(--t1,#1a1a1a)]">
                  {challenge.enrollment.secret.replace(/(.{4})(?=.)/g, "$1 ")}
                </p>
                <div className="flex flex-wrap items-center gap-4 text-[13px] font-medium">
                  <button
                    type="button"
                    onClick={copyKey}
                    className="cursor-pointer border-0 bg-transparent p-0 font-medium text-[var(--focus-ring,#0e7a53)]"
                  >
                    {copied ? "Copied" : "Copy key"}
                  </button>
                  <a
                    href={challenge.enrollment.otpauthUrl}
                    className="text-[var(--focus-ring,#0e7a53)]"
                  >
                    Open in authenticator app
                  </a>
                </div>
              </div>
            )}

            {error && (
              <div className="rounded-lg border border-[var(--no,#ff8b6b)] bg-[var(--no-soft,rgba(255,139,107,0.16))] px-4 py-3 text-[13px] font-medium text-[var(--no-text,#a8472d)]">
                {error}
              </div>
            )}

            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="office-mfa-code"
                className="text-[13px] font-medium tracking-[0.02em] text-[var(--t2,#4a4a4a)]"
              >
                6-digit code
              </label>
              <input
                id="office-mfa-code"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={7}
                autoFocus
                placeholder="123456"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                className={`${inputClassName} font-mono tabular-nums`}
                required
              />
            </div>

            <button
              type="submit"
              disabled={loading || code.replace(/\s/g, "").length < 6}
              className={buttonClassName(
                loading || code.replace(/\s/g, "").length < 6,
              )}
            >
              {loading ? "Verifying..." : "Verify"}
            </button>

            <button
              type="button"
              onClick={() => {
                setChallenge(null);
                setCode("");
                setError("");
              }}
              className="cursor-pointer border-0 bg-transparent p-0 text-xs font-medium text-[var(--t3,#8b8378)]"
            >
              Sign in with a different account
            </button>
          </form>
        ) : (
        <form onSubmit={handleSubmit} className="flex flex-col gap-5">
          {error && (
            <div className="rounded-lg border border-[var(--no,#ff8b6b)] bg-[var(--no-soft,rgba(255,139,107,0.16))] px-4 py-3 text-[13px] font-medium text-[var(--no-text,#a8472d)]">
              {error}
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="office-login-email"
              className="text-[13px] font-medium tracking-[0.02em] text-[var(--t2,#4a4a4a)]"
            >
              Email
            </label>
            <input
              id="office-login-email"
              type="email"
              placeholder="admin@taptrade.local"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={inputClassName}
              required
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <label
                htmlFor="office-login-password"
                className="text-[13px] font-medium tracking-[0.02em] text-[var(--t2,#4a4a4a)]"
              >
                Password
              </label>
              {/*
                Admin password recovery is intentionally not self-serve:
                an XSS in any admin page would otherwise let an attacker
                trigger a reset email to a fresh account. Locked-out
                admins email IT to be re-issued credentials. We surface
                the address inline so the dead `href="#"` link is gone.
              */}
              <span className="text-xs font-medium text-[var(--t3,#8b8378)]">
                Locked out?{" "}
                <a
                  href="mailto:admin@taptrade.com?subject=Backoffice%20password%20reset"
                  className="font-medium text-[var(--focus-ring,#0e7a53)]"
                >
                  Email IT
                </a>
              </span>
            </div>
            <input
              id="office-login-password"
              type="password"
              placeholder="Enter your password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={inputClassName}
              required
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className={buttonClassName(loading)}
          >
            {loading ? "Signing in..." : "Sign In"}
          </button>
        </form>
        )}

        <p className="mt-7 text-center text-xs text-[var(--t3,#8b8378)]">
          {brand.name} Admin
        </p>
      </div>
    </div>
  );
}

const inputClassName =
  "box-border w-full rounded-lg border-[1.5px] border-[var(--border-1,#e5dfd2)] bg-[var(--surface-1,#ffffff)] px-4 py-3 font-['Inter',sans-serif] text-sm text-[var(--t1,#1a1a1a)] outline-none transition-[border-color,box-shadow] duration-200 focus:border-[var(--focus-ring,#0e7a53)] focus:shadow-[0_0_0_3px_var(--accent-soft,rgba(43,228,128,0.14))]";

function buttonClassName(loading: boolean): string {
  return [
    "mt-1 w-full rounded-lg border-0 px-5 py-3 font-['Inter',sans-serif] text-sm font-semibold transition-all duration-200",
    loading
      ? "cursor-not-allowed bg-[var(--accent-soft,rgba(43,228,128,0.14))] text-[var(--t3,#8b8378)] opacity-70 shadow-none"
      : "cursor-pointer bg-[var(--accent,#2be480)] text-[#003827] shadow-[0_4px_12px_rgba(43,228,128,0.18)]",
  ].join(" ");
}
