"use client";

/**
 * LoginPage — Predict-native auth entry (purple/lavender, Auth 16a/16b).
 *
 * A centred 440px card, deliberately NOT the register split-screen:
 * someone logging in has already been sold, so the persuasion panel
 * would just be in the way. Two states: default (CTA inert until both
 * fields have content — the inert surface, never faded purple, so the
 * label stays readable) and error (the failure message sits ABOVE the
 * CTA, in the reading path before the retry, while the CTA returns to
 * active purple so retrying is obviously available).
 */

import { useCallback, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslation } from "react-i18next";
import { useAuth } from "../../hooks/useAuth";
import { safeReturnPath, returnUrlSuffix } from "../../lib/safeReturnPath";
import { FEATURE_SOCIAL_AUTH } from "../../lib/features";
import { brand } from "../../lib/brand";
import SocialAuthButtons from "../../components/auth/SocialAuthButtons";
import BrandMark from "../../components/BrandMark";
import { Button, Card, Input } from "../../components/ui";

// Card/Input/Button recipes migrated to components/ui primitives (P2).
const SHELL_CLASS = "flex min-h-screen items-center justify-center px-5 py-10";
const HEAD_CLASS = "mb-6 text-center";
// Ink on the lavender tint: the eyebrow stays readable without turning an
// informational label into a competing interactive control.
const EYEBROW_CLASS =
  "mb-3.5 inline-block rounded-full border border-[var(--border-1)] bg-[var(--accent-soft)] px-3 py-1 text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--t1)]";
// The selected Tap Trade mark pairs with the data-driven title-case wordmark.
const TITLE_CLASS =
  "m-0 mb-2 inline-flex items-center justify-center gap-2.5 text-[27px] font-semibold tracking-[-0.025em] text-[var(--t1)]";
const SUBTITLE_CLASS = "m-0 text-sm leading-[1.55] text-[var(--t2)]";
const FORM_CLASS = "flex flex-col gap-3.5";
const FIELD_CLASS = "flex flex-col gap-1.5";
const FIELD_LABEL_CLASS =
  "text-[11px] font-bold uppercase tracking-[0.08em] text-[var(--t3)]";
const ERROR_CLASS =
  "rounded-[var(--r-sm)] border border-[var(--accent)] bg-[var(--accent-soft)] px-3 py-2.5 text-xs leading-[1.5] text-[var(--brand-dark)]";
const LINKS_CLASS = "flex justify-end";
const LINK_CLASS =
  "inline-flex min-h-11 items-center text-xs text-[var(--t3)] no-underline transition-colors duration-150 hover:text-[var(--t1)]";
const LINK_ACCENT_CLASS =
  "px-1 text-[13px] font-semibold text-[var(--accent-text)] hover:text-[var(--accent-text)] hover:underline";
const DEV_CLASS =
  "mt-[18px] rounded-[var(--r-rh-md)] border border-[var(--border-1)] bg-[var(--surface-2)] px-3.5 py-3";
const DEV_EYEBROW_CLASS =
  "mb-1 block text-[10px] font-bold uppercase tracking-[0.08em] text-[var(--t3)]";
const MONO_CLASS = "tabular-nums font-mono";
const DIVIDER_CLASS =
  "my-5 mb-4 flex items-center gap-3 before:h-px before:flex-1 before:bg-[var(--border-1)] before:content-[''] after:h-px after:flex-1 after:bg-[var(--border-1)] after:content-['']";
const DIVIDER_TEXT_CLASS =
  "text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--t3)]";
const SOCIAL_CLASS = "mb-5";
const FOOTER_CLASS =
  "border-t border-[var(--border-1)] pt-3.5 text-center text-[13px] text-[var(--t2)]";

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { t } = useTranslation("login");
  const { login } = useAuth();
  const isLocalDev = process.env.NODE_ENV !== "production";

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

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

  // LC-05: carry a deep-link returnUrl across to the sign-up flow so a
  // user who chose "Sign up" from a gated page still lands back on it.
  const registerHref = `/auth/register${returnUrlSuffix(searchParams.get("returnUrl"))}`;

  return (
    <div className={SHELL_CLASS}>
      <Card as="div" padding="lg" className="relative w-full max-w-[440px]">
        <header className={HEAD_CLASS}>
          <span className={EYEBROW_CLASS}>Player access</span>
          <h1 className={TITLE_CLASS}>
            <BrandMark size={32} tone="ink" />
            <span>{brand.name}</span>
          </h1>
          <p className={SUBTITLE_CLASS}>
            Sign in to track your positions, follow market moves, and trade on
            real-world outcomes.
          </p>
        </header>

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

        {isLocalDev && (
          <aside className={DEV_CLASS}>
            <span className={DEV_EYEBROW_CLASS}>Local demo access</span>
            <p className="m-0 text-[13px] text-[var(--t2)]">
              <span className={MONO_CLASS}>demo@taptrade.local</span> · password{" "}
              <span className={MONO_CLASS}>demo123</span>
            </p>
          </aside>
        )}

        {FEATURE_SOCIAL_AUTH && (
          <>
            <div className={DIVIDER_CLASS}>
              <span className={DIVIDER_TEXT_CLASS}>or continue with</span>
            </div>

            <div className={SOCIAL_CLASS}>
              <SocialAuthButtons />
            </div>
          </>
        )}

        <footer className={FOOTER_CLASS}>
          New to {brand.name}?{" "}
          <Link
            href={registerHref}
            className={`${LINK_CLASS} ${LINK_ACCENT_CLASS}`}
          >
            Create an account
          </Link>
        </footer>
      </Card>
    </div>
  );
}
