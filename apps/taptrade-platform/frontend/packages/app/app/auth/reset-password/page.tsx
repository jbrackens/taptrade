"use client";

import { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { resetPassword } from "../../lib/api";
import { brand } from "../../lib/brand";
import BrandMark from "../../components/BrandMark";
import { Button, Card, Input } from "../../components/ui";

// Card/Input/Button recipes migrated to components/ui primitives (P2).
// Chrome is ink + white + hairlines (Kilig, 2026-09-24); validation uses
// --danger, success uses --success — never market direction colour.
const SHELL_CLASS = "flex min-h-screen items-center justify-center px-5 py-10 max-[480px]:px-4";
const HEAD_CLASS = "mb-6";
const BRAND_ROW_CLASS = "mb-8 inline-flex items-center gap-2.5";
const BRAND_WORDMARK_CLASS =
  "text-[19px] font-bold leading-none tracking-[-0.03em] text-[var(--brand-ink)]";
const TITLE_CLASS =
  "type-poster m-0 mb-2 text-[26px] max-[480px]:text-[24px] text-[var(--t1)]";
const SUBTITLE_CLASS = "m-0 text-sm leading-[1.55] text-[var(--t2)]";
const ALERT_BASE_CLASS = "mb-4 rounded-[var(--r-rh-md)] px-3 py-2.5 text-xs";
const ALERT_ERROR_CLASS =
  "border border-[var(--danger)] bg-[color-mix(in_srgb,var(--danger)_8%,transparent)] text-[var(--danger)]";
const ALERT_SUCCESS_CLASS =
  "border border-[var(--success)] bg-[color-mix(in_srgb,var(--success)_8%,transparent)] text-[var(--success)]";
const FORM_CLASS = "flex flex-col gap-3.5";
const LABEL_CLASS =
  "mb-1.5 block text-[12px] font-semibold text-[var(--t3)]";
const FIELD_ERROR_CLASS = "mt-1 text-xs text-[var(--danger)]";
const DIVIDER_CLASS =
  "mb-4 mt-[22px] flex items-center gap-3 before:h-px before:flex-1 before:bg-[var(--border-1)] before:content-[''] after:h-px after:flex-1 after:bg-[var(--border-1)] after:content-['']";
const DIVIDER_TEXT_CLASS =
  "text-[12px] font-semibold text-[var(--t3)]";
const LINKS_CLASS = "text-[13px] text-[var(--t2)]";
const LINK_ROW_CLASS = "mb-2 last:mb-0";
const LINK_CLASS =
  "font-semibold text-[var(--t1)] no-underline hover:underline";

interface Errors {
  [key: string]: string;
}

export default function ResetPasswordPage() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token") || "";

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const [isLoading, setIsLoading] = useState(false);
  const [successMessage, setSuccessMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    if (!token) {
      setErrorMessage(
        "Invalid or missing reset token. Please request a new password reset.",
      );
    }
  }, [token]);

  const validateForm = (): boolean => {
    const newErrors: Errors = {};

    if (!password) {
      newErrors.password = "Password is required";
    } else if (password.length < 8) {
      newErrors.password = "Password must be at least 8 characters";
    }

    if (!confirmPassword) {
      newErrors.confirmPassword = "Please confirm your password";
    } else if (password !== confirmPassword) {
      newErrors.confirmPassword = "Passwords do not match";
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage("");
    setSuccessMessage("");

    if (!token) {
      setErrorMessage("Invalid or missing reset token");
      return;
    }

    if (!validateForm()) {
      return;
    }

    setIsLoading(true);

    try {
      await resetPassword({
        token,
        new_password: password,
      });

      setSuccessMessage("Password reset successfully! Redirecting to login...");
      setSubmitted(true);

      setTimeout(() => {
        window.location.href = "/auth/login";
      }, 2000);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      setErrorMessage(message || "Failed to reset password. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

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
          <h1 className={TITLE_CLASS}>Reset password</h1>
          <p className={SUBTITLE_CLASS}>Pick something at least 8 characters long.</p>
        </div>

        {errorMessage && (
          <div className={`${ALERT_BASE_CLASS} ${ALERT_ERROR_CLASS}`}>
            {errorMessage}
          </div>
        )}
        {successMessage && (
          <div className={`${ALERT_BASE_CLASS} ${ALERT_SUCCESS_CLASS}`}>
            {successMessage}
          </div>
        )}

        {!submitted && token && (
          <form onSubmit={handleSubmit} className={FORM_CLASS}>
            <div>
              <label className={LABEL_CLASS} htmlFor="rp-pw">
                New password
              </label>
              <Input
                id="rp-pw"
                type="password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  if (errors.password) {
                    setErrors((prev) => {
                      const newErrors = { ...prev };
                      delete newErrors.password;
                      return newErrors;
                    });
                  }
                }}
                placeholder="At least 8 characters"
                className="w-full"
                disabled={isLoading}
              />
              {errors.password && (
                <div className={FIELD_ERROR_CLASS}>{errors.password}</div>
              )}
            </div>

            <div>
              <label className={LABEL_CLASS} htmlFor="rp-pw2">
                Confirm password
              </label>
              <Input
                id="rp-pw2"
                type="password"
                value={confirmPassword}
                onChange={(e) => {
                  setConfirmPassword(e.target.value);
                  if (errors.confirmPassword) {
                    setErrors((prev) => {
                      const newErrors = { ...prev };
                      delete newErrors.confirmPassword;
                      return newErrors;
                    });
                  }
                }}
                placeholder="Confirm your password"
                className="w-full"
                disabled={isLoading}
              />
              {errors.confirmPassword && (
                <div className={FIELD_ERROR_CLASS}>{errors.confirmPassword}</div>
              )}
            </div>

            <Button variant="cta" size="none" type="submit" disabled={isLoading}>
              {isLoading ? "Resetting…" : "Reset password"}
            </Button>
          </form>
        )}

        <div className={DIVIDER_CLASS}>
          <span className={DIVIDER_TEXT_CLASS}>or</span>
        </div>

        <div className={LINKS_CLASS}>
          <div className={LINK_ROW_CLASS}>
            <Link href="/auth/login" className={LINK_CLASS}>
              Back to login
            </Link>
          </div>
          <div className={LINK_ROW_CLASS}>
            Need help?{" "}
            <Link href="/auth/forgot-password" className={LINK_CLASS}>
              Request another reset
            </Link>
          </div>
        </div>
      </Card>
    </div>
  );
}
