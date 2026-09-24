"use client";

// Self-service password reset is not yet implemented backend-side (no
// /api/v1/auth/forgot-password route, no reset-token store, no email
// delivery in the stack — UAT 2026-05-16 LC-12). Until the feature ships,
// this page is an honest notice rather than a form that POSTs to a 404
// and tells the user "check your email" when nothing was sent.
import Link from "next/link";
import { brand } from "../../lib/brand";
import BrandMark from "../../components/BrandMark";
import { Card } from "../../components/ui";

const SUPPORT_EMAIL = brand.supportEmail;
// Card recipe migrated to the components/ui Card primitive (P2). Chrome is
// ink + white + hairlines (Kilig, 2026-09-24); the wordmark carries the
// one pink flash (the period), matching TopBar.
const SHELL_CLASS = "flex min-h-screen items-center justify-center px-5 py-10 max-[480px]:px-4";
const HEAD_CLASS = "mb-6";
const BRAND_ROW_CLASS = "mb-8 inline-flex items-center gap-2.5";
const BRAND_WORDMARK_CLASS =
  "text-[19px] font-bold leading-none tracking-[-0.03em] text-[var(--brand-ink)]";
const TITLE_CLASS =
  "type-poster m-0 mb-2 text-[26px] max-[480px]:text-[24px] text-[var(--t1)]";
const SUBTITLE_CLASS = "m-0 text-sm leading-[1.55] text-[var(--t2)]";
const NOTICE_CLASS =
  "rounded-[var(--r-rh-md)] border border-[var(--border-2)] bg-[var(--surface-2)] px-3.5 py-3 text-xs leading-[1.55] text-[var(--t2)]";
const LINK_CLASS =
  "font-semibold text-[var(--t1)] no-underline hover:underline";
const DIVIDER_CLASS =
  "mb-4 mt-[22px] flex items-center gap-3 before:h-px before:flex-1 before:bg-[var(--border-1)] before:content-[''] after:h-px after:flex-1 after:bg-[var(--border-1)] after:content-['']";
const DIVIDER_TEXT_CLASS =
  "text-[12px] font-semibold text-[var(--t3)]";
const LINKS_CLASS = "text-[13px] text-[var(--t2)]";
const LINK_ROW_CLASS = "mb-2 last:mb-0";

export default function ForgotPasswordPage() {
  return (
    <div className={SHELL_CLASS}>
      <Card as="div" padding="lg" className="w-full max-w-[440px]">
        <div className={HEAD_CLASS}>
          <div className={BRAND_ROW_CLASS}>
            <BrandMark size={26} tone="ink" />
            <span className={BRAND_WORDMARK_CLASS}>
              {brand.name}
              <span className="text-[var(--brand-period)]" aria-hidden="true">
                .
              </span>
            </span>
          </div>
          <h1 className={TITLE_CLASS}>Forgot password?</h1>
          <p className={SUBTITLE_CLASS}>
            Self-service password reset isn&apos;t available yet.
          </p>
        </div>

        <div className={NOTICE_CLASS} role="status">
          To recover your account, email{" "}
          <a className={LINK_CLASS} href={`mailto:${SUPPORT_EMAIL}`}>
            {SUPPORT_EMAIL}
          </a>{" "}
          from your registered address and our team will help you reset your
          password.
        </div>

        <div className={DIVIDER_CLASS}>
          <span className={DIVIDER_TEXT_CLASS}>or</span>
        </div>

        <div className={LINKS_CLASS}>
          <div className={LINK_ROW_CLASS}>
            Remembered it?{" "}
            <Link href="/auth/login" className={LINK_CLASS}>
              Sign in
            </Link>
          </div>
          <div className={LINK_ROW_CLASS}>
            New here?{" "}
            <Link href="/auth/register" className={LINK_CLASS}>
              Create an account
            </Link>
          </div>
        </div>
      </Card>
    </div>
  );
}
