"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { verifyEmail } from "../../lib/api/auth-client";
import { brand } from "../../lib/brand";
import BrandMark from "../../components/BrandMark";
import { Button, Card } from "../../components/ui";

// Card + CTA-link recipes migrated to components/ui primitives (P2).
// Chrome is ink + white + hairlines (Kilig, 2026-09-24); the failure
// message uses --danger, never market colour.
const SHELL_CLASS = "flex min-h-screen items-center justify-center px-5 py-10 max-[480px]:px-4";
const BRAND_ROW_CLASS = "mb-8 inline-flex items-center gap-2.5";
const BRAND_WORDMARK_CLASS =
  "text-[19px] font-bold leading-none tracking-[-0.03em] text-[var(--brand-ink)]";
const TITLE_CLASS =
  "type-poster m-0 mb-4 text-[28px] max-[480px]:text-[24px] text-[var(--t1)]";
const MESSAGE_CLASS = "m-0 mb-6 text-sm leading-[1.6] text-[var(--t2)]";
const ERROR_CLASS = "m-0 mb-4 text-[13px] text-[var(--danger)]";
const SPINNER_WRAP_CLASS = "mb-6 flex justify-start";
const SPINNER_CLASS =
  "inline-block size-7 animate-spin rounded-full border-2 border-[var(--border-2)] border-t-[var(--accent)]";

export default function VerifyEmailPage() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  const [state, setState] = useState<"loading" | "success" | "error">(
    "loading",
  );
  const [errorMessage, setErrorMessage] = useState<string>("");

  useEffect(() => {
    if (!token) {
      setState("error");
      setErrorMessage("No verification token provided");
      return;
    }

    const verify = async () => {
      try {
        await verifyEmail({ token });
        setState("success");
      } catch (err) {
        setState("error");
        const message =
          err instanceof Error ? err.message : "Verification failed";
        setErrorMessage(message);
      }
    };

    verify();
  }, [token]);

  return (
    <div className={SHELL_CLASS}>
      <Card as="div" padding="lg" className="w-full max-w-[440px] text-[var(--t1)]">
        <div className={BRAND_ROW_CLASS}>
          <BrandMark size={26} tone="ink" />
          <span className={BRAND_WORDMARK_CLASS}>
            {brand.name}
            <span className="text-[var(--brand-period)]" aria-hidden="true">
              .
            </span>
          </span>
        </div>

        {state === "loading" && (
          <>
            <h1 className={TITLE_CLASS}>Verifying email…</h1>
            <div className={SPINNER_WRAP_CLASS}>
              <div className={SPINNER_CLASS} aria-hidden="true" />
            </div>
            <p className={MESSAGE_CLASS}>Hold tight — confirming the token.</p>
          </>
        )}

        {state === "success" && (
          <>
            <h1 className={TITLE_CLASS}>Email verified</h1>
            <p className={MESSAGE_CLASS}>
              You&apos;re all set. Log in to pick up where you left off.
            </p>
            <Button
              variant="cta"
              size="none"
              render={<Link href="/auth/login" />}
            >
              Go to login
            </Button>
          </>
        )}

        {state === "error" && (
          <>
            <h1 className={TITLE_CLASS}>Verification failed</h1>
            <p className={ERROR_CLASS}>{errorMessage}</p>
            <p className={MESSAGE_CLASS}>
              The link may have expired. Request a fresh verification email from
              the login page.
            </p>
            <Button
              variant="cta"
              size="none"
              render={<Link href="/auth/login" />}
            >
              Back to login
            </Button>
          </>
        )}
      </Card>
    </div>
  );
}
