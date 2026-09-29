"use client";

/**
 * AuthenticatorKey — the setup key for two-factor sign-in, shown while an
 * account enrolls (sign-in for staff, Account → Security for players).
 *
 * The key is typed or pasted into an authenticator app; on a phone the
 * otpauth link opens the app directly. There is no QR code yet.
 */

import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { MfaEnrollment } from "../../lib/api/auth-client";
import { logger } from "../../lib/logger";
import { Button } from "../ui";

const WRAP_CLASS =
  "flex flex-col gap-2.5 rounded-[var(--r-rh-md)] border border-[var(--border-1)] bg-[var(--surface-2)] px-3.5 py-3";
const EYEBROW_CLASS = "text-[12px] font-semibold text-[var(--t3)]";
const KEY_CLASS =
  "m-0 block select-all break-words font-mono text-[15px] font-semibold leading-[1.5] tracking-[0.04em] text-[var(--t1)]";
const LINK_CLASS =
  "inline-flex min-h-11 items-center text-[13px] font-semibold text-[var(--t1)] underline-offset-2 hover:underline";

// Groups of four read back reliably when typed by hand.
function groupKey(secret: string): string {
  return secret.replace(/(.{4})(?=.)/g, "$1 ");
}

export default function AuthenticatorKey({
  enrollment,
}: {
  enrollment: MfaEnrollment;
}) {
  const { t } = useTranslation("login");
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(enrollment.secret);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch (err: unknown) {
      logger.warn(
        "Auth",
        "Copying the setup key failed",
        err instanceof Error ? err.message : String(err),
      );
    }
  };

  return (
    <div className={WRAP_CLASS}>
      <span className={EYEBROW_CLASS}>
        {t("MFA_SETUP_KEY", "Setup key")}
      </span>
      <code className={KEY_CLASS}>
        {groupKey(enrollment.secret)}
      </code>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <Button type="button" variant="secondary" size="sm" onClick={copy}>
          {copied ? t("MFA_COPIED", "Copied") : t("MFA_COPY_KEY", "Copy key")}
        </Button>
        <a href={enrollment.otpauthUrl} className={LINK_CLASS}>
          {t("MFA_OPEN_APP", "Open in authenticator app")}
        </a>
      </div>
    </div>
  );
}
