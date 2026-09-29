"use client";

/**
 * LoginPage — Predict-native auth entry (Kilig, 2026-09-24).
 *
 * A single left-aligned white card on the paper ground — deliberately NOT
 * the register split-screen: someone logging in has already been sold, so
 * a persuasion panel would just be in the way. Two states: default (CTA
 * inert until both fields have content — the inert surface, never a faded
 * button, so the label stays readable) and error (the failure message sits
 * ABOVE the CTA, in the reading path before the retry, while the CTA
 * returns to active ink so retrying is obviously available).
 *
 * Accounts with two-factor sign-in get a second step in the same card: the
 * code from their authenticator app (plus, for staff enrolling on first
 * sign-in, the setup key). Social sign-in lands here with ?mfa=1 for it
 * (honoured only when FEATURE_MFA is on).
 */

import { useCallback, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslation } from "react-i18next";
import { useAuth } from "../../hooks/useAuth";
import { safeReturnPath, returnUrlSuffix } from "../../lib/safeReturnPath";
import { FEATURE_MFA, FEATURE_SOCIAL_AUTH } from "../../lib/features";
import { brand } from "../../lib/brand";
import SocialAuthButtons from "../../components/auth/SocialAuthButtons";
import AuthenticatorKey from "../../components/auth/AuthenticatorKey";
import {
  MfaRequiredError,
  type MfaChallenge,
} from "../../lib/api/auth-client";
import BrandMark from "../../components/BrandMark";
import { Button, Card, Input } from "../../components/ui";

// Card/Input/Button recipes come from components/ui (P2). Chrome is ink +
// white + hairlines; the wordmark carries the one Kilig pink flash (the
// period), matching TopBar. Validation uses --danger, never market colour.
const SHELL_CLASS = "flex min-h-screen items-center justify-center px-5 py-10 max-[480px]:px-4";
const HEAD_CLASS = "mb-7";
const BRAND_ROW_CLASS = "mb-8 inline-flex items-center gap-2.5";
const BRAND_WORDMARK_CLASS =
  "text-[19px] font-bold leading-none tracking-[-0.03em] text-[var(--brand-ink)]";
const TITLE_CLASS =
  "type-poster m-0 mb-2 text-[26px] max-[480px]:text-[24px] text-[var(--t1)]";
const SUBTITLE_CLASS = "m-0 text-sm leading-[1.55] text-[var(--t2)]";
const FORM_CLASS = "flex flex-col gap-3.5";
const FIELD_CLASS = "flex flex-col gap-1.5";
const FIELD_LABEL_CLASS =
  "text-[12px] font-semibold text-[var(--t3)]";
const ERROR_CLASS =
  "rounded-[var(--r-rh-md)] border border-[var(--danger)] bg-[color-mix(in_srgb,var(--danger)_8%,transparent)] px-3 py-2.5 text-xs leading-[1.5] text-[var(--danger)]";
const LINKS_CLASS = "flex justify-end";
const BACK_ROW_CLASS = "flex justify-start";
const LINK_CLASS =
  "inline-flex min-h-11 items-center text-xs text-[var(--t3)] no-underline transition-colors duration-150 hover:text-[var(--t1)]";
const LINK_ACCENT_CLASS =
  "px-0 text-[13px] font-semibold text-[var(--t1)] hover:underline";
const DEV_CLASS =
  "mt-[18px] rounded-[var(--r-rh-md)] border border-[var(--border-1)] bg-[var(--surface-2)] px-3.5 py-3";
const DEV_EYEBROW_CLASS =
  "mb-1 block text-[12px] font-semibold text-[var(--t3)]";
const MONO_CLASS = "tabular-nums font-mono";
const DIVIDER_CLASS =
  "my-5 mb-4 flex items-center gap-3 before:h-px before:flex-1 before:bg-[var(--border-1)] before:content-[''] after:h-px after:flex-1 after:bg-[var(--border-1)] after:content-['']";
const DIVIDER_TEXT_CLASS =
  "text-[12px] font-semibold text-[var(--t3)]";
const SOCIAL_CLASS = "mb-5";
const FOOTER_CLASS =
  "border-t border-[var(--border-1)] pt-3.5 text-[13px] text-[var(--t2)]";

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { t } = useTranslation("login");
  const { login, verifyMfa } = useAuth();
  const isLocalDev = process.env.NODE_ENV !== "production";

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // The code step: after a password that needs a code, or arriving from
  // social sign-in with ?mfa=1 (the challenge is in an HttpOnly cookie).
  const [challenge, setChallenge] = useState<MfaChallenge | null>(null);
  const [codeStep, setCodeStep] = useState(
    FEATURE_MFA && searchParams.get("mfa") === "1",
  );
  const [code, setCode] = useState("");

  const onSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!username || !password) return;
      setSubmitting(true);
      setError(null);
      try {
        await login(username, password);
        // Honor ?returnUrl=… if it's a safe same-origin path. Falls
        // back to /predict otherwise. This is what makes logging in
        // from /portfolio, /rewards, /leaderboards, etc. land back on
        // the page the user originally asked for.
        router.push(safeReturnPath(searchParams.get("returnUrl")));
      } catch (err: unknown) {
        if (err instanceof MfaRequiredError) {
          setChallenge(err.challenge);
          setCodeStep(true);
          setPassword("");
          return;
        }
        const raw = err instanceof Error ? err.message : "";
        // The auth service answers a credential failure with the raw
        // "invalid username or password" — humanize it (localized);
        // anything else surfaces as-is so real faults stay diagnosable.
        setError(
          raw.toLowerCase().includes("invalid username or password")
            ? t("INCORRECT_CREDENTIALS", "Incorrect username or password.")
            : raw || t("LOGIN_FAILED", "Login failed. Please try again."),
        );
      } finally {
        setSubmitting(false);
      }
    },
    [username, password, login, router, searchParams, t],
  );

  const startOver = useCallback(
    (message: string | null) => {
      setChallenge(null);
      setCodeStep(false);
      setCode("");
      setError(message);
      if (searchParams.get("mfa")) router.replace("/auth/login");
    },
    [router, searchParams],
  );

  const onVerify = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      const digits = code.replace(/\s/g, "");
      if (!digits) return;
      setSubmitting(true);
      setError(null);
      try {
        await verifyMfa(digits, challenge?.mfaToken);
        router.push(safeReturnPath(searchParams.get("returnUrl")));
      } catch (err: unknown) {
        const raw = err instanceof Error ? err.message : "";
        const lower = raw.toLowerCase();
        if (lower.includes("sign-in expired")) {
          startOver(
            t("MFA_EXPIRED", "Your sign-in timed out. Enter your password again."),
          );
        } else if (lower.includes("incorrect code")) {
          setCode("");
          setError(
            t(
              "MFA_INCORRECT_CODE",
              "That code didn't work. Check your authenticator app and try the current code.",
            ),
          );
        } else {
          setError(raw || t("LOGIN_FAILED", "Login failed. Please try again."));
        }
      } finally {
        setSubmitting(false);
      }
    },
    [code, challenge, verifyMfa, router, searchParams, startOver, t],
  );

  // LC-05: carry a deep-link returnUrl across to the sign-up flow so a
  // user who chose "Sign up" from a gated page still lands back on it.
  const registerHref = `/auth/register${returnUrlSuffix(searchParams.get("returnUrl"))}`;

  return (
    <div className={SHELL_CLASS}>
      <Card as="div" padding="lg" className="w-full max-w-[440px]">
        <header className={HEAD_CLASS}>
          <div className={BRAND_ROW_CLASS}>
            <BrandMark size={24} tone="ink" />
            <span className={BRAND_WORDMARK_CLASS}>
              {brand.name}
              <span className="text-[var(--brand-period)]" aria-hidden="true">
                .
              </span>
            </span>
          </div>
          {!codeStep ? (
            <>
              <h1 className={TITLE_CLASS}>
                {t("WELCOME_TITLE", "Welcome back")}
              </h1>
              <p className={SUBTITLE_CLASS}>
                Sign in to track your positions, follow market moves, and trade
                on real-world outcomes.
              </p>
            </>
          ) : challenge?.enrollment ? (
            <>
              <h1 className={TITLE_CLASS}>
                {t("MFA_SETUP_TITLE", "Set up two-factor sign-in")}
              </h1>
              <p className={SUBTITLE_CLASS}>
                {t(
                  "MFA_SETUP_SUBTITLE",
                  "This account signs in with a code from an authenticator app. Add this key to one, such as 1Password, Google Authenticator or Authy, then enter the 6-digit code it shows.",
                )}
              </p>
            </>
          ) : (
            <>
              <h1 className={TITLE_CLASS}>
                {t("MFA_TITLE", "Enter your code")}
              </h1>
              <p className={SUBTITLE_CLASS}>
                {t(
                  "MFA_SUBTITLE",
                  "Open your authenticator app and enter the 6-digit code for {{brand}}.",
                  { brand: brand.name },
                )}
              </p>
            </>
          )}
        </header>

        {codeStep ? (
          <form onSubmit={onVerify} className={FORM_CLASS} noValidate>
            {challenge?.enrollment && (
              <AuthenticatorKey enrollment={challenge.enrollment} />
            )}

            <label className={FIELD_CLASS} htmlFor="login-mfa-code">
              <span className={FIELD_LABEL_CLASS}>
                {t("MFA_CODE_LABEL", "6-digit code")}
              </span>
              <Input
                id="login-mfa-code"
                type="text"
                name="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={7}
                autoFocus
                value={code}
                onChange={(e) => setCode(e.target.value)}
                className={`w-full ${MONO_CLASS}`}
                placeholder="123456"
                required
              />
            </label>

            {error && (
              <div className={ERROR_CLASS} role="alert">
                {error}
              </div>
            )}

            <Button
              variant="cta"
              size="none"
              type="submit"
              disabled={submitting || code.replace(/\s/g, "").length < 6}
              className="mt-1"
            >
              {submitting
                ? t("MFA_VERIFYING", "Verifying…")
                : t("MFA_VERIFY", "Verify")}
            </Button>

            <div className={BACK_ROW_CLASS}>
              <button
                type="button"
                className={`${LINK_CLASS} cursor-pointer border-0 bg-transparent p-0`}
                onClick={() => startOver(null)}
              >
                {t("MFA_START_OVER", "Sign in with a different account")}
              </button>
            </div>
          </form>
        ) : (
        <form onSubmit={onSubmit} className={FORM_CLASS} noValidate>
          <label className={FIELD_CLASS} htmlFor="login-username">
            <span className={FIELD_LABEL_CLASS}>Username or email</span>
            <Input
              id="login-username"
              type="text"
              name="username"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full"
              placeholder="you@example.com"
              required
            />
          </label>

          <label className={FIELD_CLASS} htmlFor="login-password">
            <span className={FIELD_LABEL_CLASS}>Password</span>
            <Input
              id="login-password"
              type="password"
              name="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full"
              placeholder="••••••••"
              required
            />
          </label>

          {error && (
            <div className={ERROR_CLASS} role="alert">
              {error}
            </div>
          )}

          <Button
            variant="cta"
            size="none"
            type="submit"
            disabled={submitting || !username || !password}
            className="mt-1"
          >
            {submitting ? "Signing in…" : "Log in"}
          </Button>

          <div className={LINKS_CLASS}>
            <Link href="/auth/forgot-password" className={LINK_CLASS}>
              Forgot password?
            </Link>
          </div>
        </form>
        )}

        {isLocalDev && !codeStep && (
          <aside className={DEV_CLASS}>
            <span className={DEV_EYEBROW_CLASS}>Local demo access</span>
            <p className="m-0 text-[13px] text-[var(--t2)]">
              <span className={MONO_CLASS}>demo@taptrade.local</span> · password{" "}
              <span className={MONO_CLASS}>demo123</span>
            </p>
          </aside>
        )}

        {FEATURE_SOCIAL_AUTH && !codeStep && (
          <>
            <div className={DIVIDER_CLASS}>
              <span className={DIVIDER_TEXT_CLASS}>or continue with</span>
            </div>

            <div className={SOCIAL_CLASS}>
              <SocialAuthButtons />
            </div>
          </>
        )}

        {!codeStep && (
        <footer className={FOOTER_CLASS}>
          New to {brand.name}?{" "}
          <Link
            href={registerHref}
            className={`${LINK_CLASS} ${LINK_ACCENT_CLASS}`}
          >
            Create an account
          </Link>
        </footer>
        )}
      </Card>
    </div>
  );
}
