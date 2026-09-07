"use client";

/**
 * RegisterPage — split-screen signup (P9, 2026-07-08).
 *
 * Layout mirrors the WorkOS-style reference the owner specified: a narrow
 * centered form column (brand lockup → heading → fields → Continue → OR →
 * Continue with Google/Facebook/Discord → sign-in link → legal line) beside a
 * full-bleed event panel built from our in-house ambient crowd footage
 * (public/brand/hero-ambient.mp4 + auth-event-poster.jpg) under a deep-purple
 * scrim — no stock imagery, no external hotlinks. The 2-step wizard and the
 * launch-compliance terms/disclosure acceptance are unchanged; only the
 * shell moved. Social buttons render unconditionally here (owner call) and
 * degrade honestly when a provider isn't configured.
 */

import { useCallback, useEffect, useId, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "../../hooks/useAuth";
import { register as registerUser } from "../../lib/api";
import { safeReturnPath, returnUrlSuffix } from "../../lib/safeReturnPath";
import SocialAuthButtons from "../../components/auth/SocialAuthButtons";
import BrandMark from "../../components/BrandMark";
import { brand } from "../../lib/brand";
import { useToast } from "../../components/ToastProvider";
import { Button, Input } from "../../components/ui";

interface FormData {
  username: string;
  email: string;
  password: string;
  confirmPassword: string;
  acceptTerms: boolean;
}

type Errors = Partial<Record<keyof FormData, string>>;

const EMPTY_FORM: FormData = {
  username: "",
  email: "",
  password: "",
  confirmPassword: "",
  acceptTerms: false,
};

const TOTAL_STEPS = 2;
const STEP_TITLES = ["Account", "Terms"];
const TERMS_VERSION = "taptrade-launch-v1";
const LAUNCH_DISCLOSURE_VERSION = "points-no-cashout-v1";

const SHELL_CLASS =
  "grid min-h-screen w-full bg-[var(--surface-1)] lg:grid-cols-[minmax(0,44%)_1fr]";
const FORM_COL_CLASS =
  "flex min-h-screen flex-col overflow-y-auto px-6 py-8 sm:px-12 lg:px-16";
const FORM_INNER_CLASS = "mx-auto flex w-full max-w-[400px] flex-1 flex-col";
const BRAND_ROW_CLASS = "mb-10 inline-flex items-center gap-2.5 no-underline";
const BRAND_WORDMARK_CLASS =
  "text-[21px] font-semibold leading-none tracking-[-0.025em] text-[var(--brand-ink)]";
const EVENT_PANEL_CLASS =
  "relative hidden overflow-hidden bg-[var(--brand-ink)] lg:block";
const EVENT_MEDIA_CLASS =
  "absolute inset-0 h-full w-full object-cover opacity-[0.82] motion-reduce:hidden";
const EVENT_POSTER_CLASS =
  "absolute inset-0 h-full w-full object-cover opacity-[0.82]";
const EVENT_SCRIM_CLASS =
  "absolute inset-0 bg-[linear-gradient(200deg,var(--brand-purple)_0%,var(--brand-deep)_55%,var(--brand-dark)_100%)] opacity-[0.86]";
const EVENT_COPY_CLASS =
  "absolute inset-x-0 bottom-0 p-12 text-[var(--brand-on-dark)]";
const EVENT_STATEMENT_CLASS =
  "type-display m-0 max-w-[480px] text-[clamp(28px,3vw,44px)] font-semibold leading-[1.08] tracking-[-0.02em]";
const EVENT_SUB_CLASS =
  "mt-4 max-w-[420px] text-sm leading-[1.55] text-[var(--brand-on-dark)] opacity-75";
const HEAD_CLASS = "mb-6";
const EYEBROW_CLASS =
  "mb-3 inline-block font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--t3)]";
const TITLE_CLASS =
  "m-0 mb-1.5 text-[26px] font-bold tracking-[-0.02em] text-[var(--t1)]";
const SUBTITLE_CLASS = "m-0 text-[13px] text-[var(--t3)]";
const PROGRESS_CLASS =
  "relative mb-[22px] h-1 overflow-hidden rounded-full border border-[var(--border-1)] bg-[var(--surface-2)]";
const PROGRESS_FILL_BASE_CLASS =
  "absolute inset-y-0 left-0 rounded-[inherit] bg-[var(--accent)] transition-[width] duration-300 ease-[ease]";
const DIVIDER_CLASS =
  "my-0.5 flex items-center gap-3 before:h-px before:flex-1 before:bg-[var(--border-1)] before:content-[''] after:h-px after:flex-1 after:bg-[var(--border-1)] after:content-['']";
const DIVIDER_TEXT_CLASS =
  "text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--t3)]";
const BANNER_BASE_CLASS =
  "mb-3.5 rounded-[var(--r-rh-md)] px-3 py-2.5 text-[13px]";
const BANNER_ERROR_CLASS =
  "border border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--brand-dark)]";
const BANNER_SUCCESS_CLASS =
  "border border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--brand-dark)]";
const FORM_CLASS = "flex flex-col gap-3.5";
const FIELD_CLASS = "flex flex-col gap-1.5";
const FIELD_LABEL_CLASS =
  "text-[11px] font-bold uppercase tracking-[0.08em] text-[var(--t3)]";
// Input + step-button recipes migrated to components/ui primitives (P2).
const FIELD_ERROR_CLASS = "text-[11px] text-[var(--accent-text)]";
const TERMS_CLASS =
  "max-h-[220px] overflow-y-auto rounded-[var(--r-rh-md)] border border-[var(--border-1)] bg-[var(--surface-2)] px-4 py-3.5";
const TERMS_TITLE_CLASS = "m-0 mb-2 text-sm font-bold text-[var(--t1)]";
const TERMS_COPY_CLASS = "m-0 mb-2.5 text-xs leading-[1.55] text-[var(--t2)]";
const CHECK_CLASS =
  "flex cursor-pointer items-center gap-2.5 text-[13px] text-[var(--t1)]";
const CHECK_INPUT_CLASS = "size-4 accent-[var(--accent)]";
const SUMMARY_CLASS =
  "rounded-[var(--r-rh-md)] border border-[var(--border-1)] bg-[var(--surface-2)] px-3.5 py-3";
const SUMMARY_EYEBROW_CLASS =
  "mb-2 block text-[10px] font-bold uppercase tracking-[0.08em] text-[var(--t3)]";
const SUMMARY_LIST_CLASS = "m-0 flex flex-col gap-1";
const SUMMARY_ROW_CLASS = "flex justify-between gap-2.5 text-xs";
const SUMMARY_TERM_CLASS = "text-[var(--t3)]";
const SUMMARY_DESC_CLASS = "m-0 text-[var(--t1)]";
const MONO_CLASS = "tabular-nums font-mono";
const ACTIONS_CLASS = "mt-5 flex gap-2.5";
const FOOTER_CLASS =
  "mt-[18px] border-t border-[var(--border-1)] pt-3.5 text-center text-[13px] text-[var(--t2)]";
const LINK_ACCENT_CLASS =
  "font-semibold text-[var(--accent)] no-underline hover:brightness-110";

function progressWidthClass(step: number): string {
  return step === 1 ? "w-1/2" : "w-full";
}

export default function RegisterPage() {
  const router = useRouter();
  const { login } = useAuth();
  const toast = useToast();
  const [step, setStep] = useState(1);
  // SSR-safe reduced-motion probe: default true (poster only) so the
  // heavy ambient loop never loads before the preference is known.
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(true);
  useEffect(() => {
    setPrefersReducedMotion(
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    );
  }, []);
  const [form, setForm] = useState<FormData>(EMPTY_FORM);
  const [errors, setErrors] = useState<Errors>({});
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  // LC-05: preserve a deep-link returnUrl threaded in from the login page
  // so signup doesn't drop the user's original destination.
  const searchParams = useSearchParams();
  const returnSuffix = returnUrlSuffix(searchParams.get("returnUrl"));

  const update = useCallback(
    <K extends keyof FormData>(key: K, value: FormData[K]) => {
      setForm((f) => ({ ...f, [key]: value }));
      setErrors((e) => ({ ...e, [key]: undefined }));
    },
    [],
  );

  const validate = useCallback(
    (currentStep: number): Errors => {
      const next: Errors = {};
      if (currentStep === 1) {
        if (!form.username.trim()) next.username = "Required";
        else if (form.username.length < 3)
          next.username = "At least 3 characters";
        if (!form.email.trim()) next.email = "Required";
        else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email))
          next.email = "Invalid email";
        if (!form.password) next.password = "Required";
        else if (form.password.length < 7)
          next.password = "At least 7 characters";
        if (!form.confirmPassword) next.confirmPassword = "Required";
        else if (form.password !== form.confirmPassword)
          next.confirmPassword = "Passwords don't match";
      }
      if (currentStep === 2) {
        if (!form.acceptTerms) next.acceptTerms = "You must accept the terms";
      }
      return next;
    },
    [form],
  );

  const onNext = useCallback(() => {
    const v = validate(step);
    setErrors(v);
    if (Object.keys(v).length === 0 && step < TOTAL_STEPS) {
      setStep(step + 1);
    }
  }, [step, validate]);

  const onPrev = useCallback(() => {
    if (step > 1) {
      setStep(step - 1);
      setErrors({});
    }
  }, [step]);

  const onSubmit = useCallback(async () => {
    const v = validate(TOTAL_STEPS);
    setErrors(v);
    if (Object.keys(v).length > 0) return;

    setSubmitting(true);
    setErrorMessage("");
    setSuccessMessage("");
    let accountCreated = false;
    try {
      await registerUser({
        username: form.username,
        email: form.email,
        password: form.password,
        terms_accepted: true,
        terms_version: TERMS_VERSION,
        launch_disclosure_accepted: true,
        launch_disclosure_version: LAUNCH_DISCLOSURE_VERSION,
      });
      accountCreated = true;
      setSuccessMessage("Account created. Signing you in...");
      // QA fix ISSUE-010: suppress login()'s "Welcome back!" — this is a
      // brand-new account; announce the creation instead.
      const newUser = await login(form.username, form.password, {
        welcomeToast: false,
      });
      toast.success("Account created", `Welcome, ${newUser.username}!`);
      // QA fix ISSUE-011 (grant announcement), since moved: AuthProvider
      // claims the starter grant once per session and toasts on the
      // server-truth `granted` flag — one claim, one announcement, and it
      // also covers OAuth signups and returning users when the faucet
      // first turns on. Claiming here too raced that claim (concurrent
      // same-key credits) and stacked a duplicate toast.
      router.replace(safeReturnPath(searchParams.get("returnUrl")));
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Registration failed";
      setErrorMessage(
        accountCreated
          ? `Account created, but automatic sign-in failed: ${message}`
          : message,
      );
    } finally {
      setSubmitting(false);
    }
  }, [form, validate, login, router, searchParams, toast]);

  return (
    <div className={SHELL_CLASS}>
      <div className={FORM_COL_CLASS}>
        <div className={FORM_INNER_CLASS}>
          <Link
            href="/"
            className={BRAND_ROW_CLASS}
            aria-label={`${brand.name} home`}
          >
            <BrandMark size={26} tone="ink" />
            <span className={BRAND_WORDMARK_CLASS}>{brand.name}</span>
          </Link>

          <header className={HEAD_CLASS}>
            <span className={EYEBROW_CLASS}>
              Step {step} of {TOTAL_STEPS} · {STEP_TITLES[step - 1]}
            </span>
            <h1 className={TITLE_CLASS}>Create your account</h1>
            <p className={SUBTITLE_CLASS}>
              Track positions, follow the crowd, trade real-world outcomes.
            </p>
          </header>

          <div className={PROGRESS_CLASS} aria-hidden="true">
            <div
              className={`${PROGRESS_FILL_BASE_CLASS} ${progressWidthClass(step)}`}
            />
          </div>

          {errorMessage && (
            <div className={`${BANNER_BASE_CLASS} ${BANNER_ERROR_CLASS}`}>
              {errorMessage}
            </div>
          )}
          {successMessage && (
            <div className={`${BANNER_BASE_CLASS} ${BANNER_SUCCESS_CLASS}`}>
              {successMessage}
            </div>
          )}

          {step === 1 && (
            <div className={FORM_CLASS}>
              <Field
                label="Username"
                value={form.username}
                onChange={(v) => update("username", v)}
                placeholder="your-handle"
                error={errors.username}
                autoComplete="username"
              />
              <Field
                label="Email"
                type="email"
                value={form.email}
                onChange={(v) => update("email", v)}
                placeholder="you@example.com"
                error={errors.email}
                autoComplete="email"
              />
              <Field
                label="Password"
                type="password"
                value={form.password}
                onChange={(v) => update("password", v)}
                placeholder="At least 7 characters"
                error={errors.password}
                autoComplete="new-password"
              />
              <Field
                label="Confirm password"
                type="password"
                value={form.confirmPassword}
                onChange={(v) => update("confirmPassword", v)}
                placeholder="Confirm your password"
                error={errors.confirmPassword}
                autoComplete="new-password"
              />
            </div>
          )}

          {step === 2 && (
            <div className={FORM_CLASS}>
              <div className={TERMS_CLASS}>
                <h3 className={TERMS_TITLE_CLASS}>Terms and conditions</h3>
                <p className={TERMS_COPY_CLASS}>
                  By creating a {brand.name} account you agree to our Terms of
                  Service and Privacy Policy. You must be 18 or older to make
                  predictions on this platform.
                </p>
                <p className="m-0 text-xs leading-[1.55] text-[var(--t2)]">
                  {brand.name} uses non-redeemable gameplay points. Starter
                  points are for predictions only; they are not money and cannot
                  be cashed out, withdrawn, transferred, or redeemed for prizes.
                </p>
              </div>

              <label className={CHECK_CLASS}>
                <input
                  type="checkbox"
                  className={CHECK_INPUT_CLASS}
                  checked={form.acceptTerms}
                  onChange={(e) => update("acceptTerms", e.target.checked)}
                />
                <span>
                  I agree to the Terms of Service, Privacy Policy, and
                  points-only no-cashout disclosure
                </span>
              </label>
              {errors.acceptTerms && (
                <div className={FIELD_ERROR_CLASS}>{errors.acceptTerms}</div>
              )}

              <div className={SUMMARY_CLASS}>
                <span className={SUMMARY_EYEBROW_CLASS}>Account summary</span>
                <dl className={SUMMARY_LIST_CLASS}>
                  <div className={SUMMARY_ROW_CLASS}>
                    <dt className={SUMMARY_TERM_CLASS}>Username</dt>
                    <dd className={`${SUMMARY_DESC_CLASS} ${MONO_CLASS}`}>
                      {form.username}
                    </dd>
                  </div>
                  <div className={SUMMARY_ROW_CLASS}>
                    <dt className={SUMMARY_TERM_CLASS}>Email</dt>
                    <dd className={SUMMARY_DESC_CLASS}>{form.email}</dd>
                  </div>
                </dl>
              </div>
            </div>
          )}

          <div className={ACTIONS_CLASS}>
            {step > 1 && (
              <Button
                size="none"
                type="button"
                onClick={onPrev}
                disabled={submitting}
                className="flex-1 px-4 py-[11px] text-[13px]"
              >
                Back
              </Button>
            )}
            <Button
              variant="primary"
              size="none"
              type="button"
              onClick={step === TOTAL_STEPS ? onSubmit : onNext}
              disabled={submitting}
              className="flex-1 px-4 py-[11px] text-[13px]"
            >
              {submitting
                ? "Processing…"
                : step === TOTAL_STEPS
                  ? "Create account"
                  : "Continue"}
            </Button>
          </div>

          {/* QA fix ISSUE-008 (2026-07-26): the stacked list offered
              Apple/SSO — providers the auth service has never implemented
              (oauth start → hard 404), so the honest-degrade notice was
              promising a provider that cannot exist on any deployment.
              List only backend-registered providers with a verified-email
              flow (google/facebook/discord; see services/auth oauth.go).
              Rendering stays UNCONDITIONAL per the owner call recorded in
              the file header — unconfigured real providers degrade to the
              inline notice. */}
          {step === 1 && (
            <>
              <div className={`${DIVIDER_CLASS} my-5`}>
                <span className={DIVIDER_TEXT_CLASS}>or</span>
              </div>
              <SocialAuthButtons
                variant="stacked"
                providers={["google", "facebook", "discord"]}
              />
            </>
          )}

          <p className="mt-6 text-xs leading-[1.55] text-[var(--t3)]">
            By creating an account you agree to the{" "}
            <Link href="/tos" className="text-[var(--t2)] underline">
              Terms of Use
            </Link>{" "}
            and{" "}
            <Link href="/privacy" className="text-[var(--t2)] underline">
              Privacy Policy
            </Link>
            . {brand.name} uses non-redeemable gameplay points.
          </p>

          <footer className={FOOTER_CLASS}>
            Already have an account?{" "}
            <Link
              href={`/auth/login${returnSuffix}`}
              className={LINK_ACCENT_CLASS}
            >
              Sign in
            </Link>
          </footer>
        </div>
      </div>

      {/* Event panel — in-house ambient crowd footage under a deep-purple scrim.
          Poster renders for reduced-motion and while the loop buffers. */}
      <aside className={EVENT_PANEL_CLASS} aria-hidden="true">
        <img
          src="/brand/auth-event-poster.jpg"
          alt=""
          className={EVENT_POSTER_CLASS}
        />
        {/* 2026-07-12: reduced-motion users get the poster only — the
            1.6MB ambient loop previously downloaded and auto-played
            unconditionally (the landing hero's equivalent already gated
            on the same media query). */}
        {!prefersReducedMotion && (
          <video
            className={EVENT_MEDIA_CLASS}
            src="/brand/hero-ambient.mp4"
            poster="/brand/auth-event-poster.jpg"
            autoPlay
            muted
            loop
            playsInline
            preload="metadata"
          />
        )}
        <div className={EVENT_SCRIM_CLASS} />
        <div className={EVENT_COPY_CLASS}>
          <p className={EVENT_STATEMENT_CLASS}>
            Trade what the world is watching.
          </p>
          <p className={EVENT_SUB_CLASS}>
            Elections, finals, premieres — every price is the crowd&apos;s live
            probability. Pick a side and see if you read it right.
          </p>
        </div>
      </aside>
    </div>
  );
}

function Field({
  label,
  type = "text",
  value,
  onChange,
  placeholder,
  error,
  autoComplete,
}: {
  label: string;
  type?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  error?: string;
  autoComplete?: string;
}) {
  const inputId = useId();
  return (
    <label className={FIELD_CLASS} htmlFor={inputId}>
      <span className={FIELD_LABEL_CLASS}>{label}</span>
      <Input
        id={inputId}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
        aria-invalid={error ? true : undefined}
      />
      {error && <span className={FIELD_ERROR_CLASS}>{error}</span>}
    </label>
  );
}
