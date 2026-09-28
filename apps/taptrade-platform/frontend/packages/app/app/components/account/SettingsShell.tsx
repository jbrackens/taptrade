"use client";

/**
 * SettingsShell — one frame for every account settings page: a "Settings"
 * heading, a side menu (a scrolling pill row on phones) and the page's own
 * section. Replaces the per-page headers and "← Back" buttons, so Profile,
 * Security, Alerts and the point ledger read as one area.
 */

import Link from "next/link";
import { useTranslation } from "react-i18next";
import { BellRingingIcon as Bell } from "@phosphor-icons/react/dist/csr/BellRinging";
import { CaretLeftIcon as ChevronLeft } from "@phosphor-icons/react/dist/csr/CaretLeft";
import { HandHeartIcon as HeartHandshake } from "@phosphor-icons/react/dist/csr/HandHeart";
import { ShieldCheckIcon as Lock } from "@phosphor-icons/react/dist/csr/ShieldCheck";
import { ReceiptIcon as ReceiptText } from "@phosphor-icons/react/dist/csr/Receipt";
import { UserCircleIcon as UserRound } from "@phosphor-icons/react/dist/csr/UserCircle";
import { FEATURE_RG } from "../../lib/features";

export type SettingsSection = "profile" | "security" | "alerts" | "ledger" | "responsible";

const NAV: {
  id: SettingsSection;
  href: string;
  icon: typeof UserRound;
  key: string;
  fallback: string;
  enabled?: boolean;
}[] = [
  { id: "profile", href: "/account/settings", icon: UserRound, key: "nav.profile", fallback: "Profile" },
  { id: "security", href: "/account/security", icon: Lock, key: "nav.security", fallback: "Security" },
  { id: "alerts", href: "/account/notifications", icon: Bell, key: "nav.alerts", fallback: "Alerts" },
  { id: "ledger", href: "/account/transactions", icon: ReceiptText, key: "nav.ledger", fallback: "Clout history" },
  {
    id: "responsible",
    href: "/responsible-gaming",
    icon: HeartHandshake,
    key: "nav.responsible",
    fallback: "Play responsibly",
    enabled: FEATURE_RG,
  },
];

// Each section's heading, so pages that predate the shell stay one-liners.
const SECTION_COPY: Record<SettingsSection, [string, string, string, string]> = {
  profile: ["profile.title", "Profile", "profile.subtitle", "Your details, language and privacy."],
  security: ["security.title", "Security", "security.subtitle", "Password, two-factor authentication and active sessions."],
  alerts: ["alerts.title", "Alerts", "alerts.subtitle", "Choose how you hear about markets and your account."],
  ledger: ["ledger.title", "Clout history", "ledger.subtitle", "Every bit of Clout in and out of your account."],
  responsible: ["responsible.title", "Play responsibly", "responsible.subtitle", "Limits, cool-offs and self-exclusion."],
};

export function SettingsShell({
  active,
  wide = false,
  children,
}: {
  active: SettingsSection;
  /** Tables (the point ledger) take the full content width. */
  wide?: boolean;
  children: React.ReactNode;
}) {
  const { t } = useTranslation("settings");
  const items = NAV.filter((item) => item.enabled !== false);
  const [titleKey, titleFallback, descKey, descFallback] = SECTION_COPY[active];
  const title = t(titleKey, titleFallback);
  const description = t(descKey, descFallback);

  return (
    <div className="mx-auto max-w-[1080px] px-6 pb-16 pt-6 max-[640px]:px-4">
      <Link
        href="/account"
        className="mb-3 inline-flex min-h-9 items-center gap-1 text-[13px] font-semibold text-[var(--t2)] no-underline hover:text-[var(--t1)]"
      >
        <ChevronLeft size={14} weight="bold" aria-hidden="true" />
        {t("nav.account", "Account")}
      </Link>
      <h1 className="type-poster m-0 mb-6 text-[28px] text-[var(--t1)] max-[640px]:mb-4 max-[640px]:text-[24px]">
        {t("TITLE", "Settings")}
      </h1>

      <div className="grid grid-cols-[200px_minmax(0,1fr)] items-start gap-10 max-[900px]:grid-cols-1 max-[900px]:gap-5">
        <nav aria-label={t("nav.label", "Settings sections")} className="sticky top-20 max-[900px]:static">
          <ul className="m-0 flex list-none flex-col gap-0.5 p-0 max-[900px]:-mx-4 max-[900px]:flex-row max-[900px]:gap-2 max-[900px]:overflow-x-auto max-[900px]:px-4 max-[900px]:pb-1">
            {items.map(({ id, href, icon: Icon, key, fallback }) => {
              const current = id === active;
              return (
                <li key={id} className="shrink-0">
                  <Link
                    href={href}
                    aria-current={current ? "page" : undefined}
                    className={`flex min-h-10 items-center gap-2.5 rounded-[var(--r-rh-md)] px-3 text-[14px] font-medium no-underline transition-colors duration-150 max-[900px]:rounded-[var(--r-pill)] max-[900px]:border max-[900px]:px-3.5 ${
                      current
                        ? "bg-[var(--surface-1)] font-semibold text-[var(--t1)] shadow-[var(--shadow-card)] max-[900px]:border-[var(--ink)] max-[900px]:bg-[var(--ink)] max-[900px]:text-[var(--on-ink)]"
                        : "text-[var(--t2)] hover:bg-[var(--surface-2)] hover:text-[var(--t1)] max-[900px]:border-[var(--border-1)] max-[900px]:bg-[var(--surface-1)]"
                    }`}
                  >
                    <Icon size={18} weight="duotone" aria-hidden="true" className="max-[900px]:hidden" />
                    {t(key, fallback)}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className={`min-w-0 ${wide ? "" : "max-w-[720px]"}`}>
          <header className="mb-5">
            <h2 className="m-0 text-[20px] font-semibold tracking-[-0.015em] text-[var(--t1)]">{title}</h2>
            <p className="m-0 mt-1 text-[14px] text-[var(--t3)]">{description}</p>
          </header>
          {children}
        </div>
      </div>
    </div>
  );
}

/** A settings card: the board's card recipe with a titled header. */
export function SettingsCard({
  id,
  title,
  description,
  children,
  footer,
}: {
  id?: string;
  title: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <section
      id={id}
      aria-labelledby={id ? `${id}-title` : undefined}
      className="mb-4 scroll-mt-24 rounded-[var(--r-rh-lg)] border border-[var(--border-1)] bg-[var(--surface-1)] shadow-[var(--shadow-card)]"
    >
      <div className="px-6 pt-5 max-[640px]:px-4">
        <h3 id={id ? `${id}-title` : undefined} className="m-0 text-[16px] font-semibold text-[var(--t1)]">
          {title}
        </h3>
        {description && <p className="m-0 mt-1 text-[13px] leading-normal text-[var(--t3)]">{description}</p>}
      </div>
      <div className="px-6 py-5 max-[640px]:px-4">{children}</div>
      {footer && (
        <div className="flex items-center justify-end gap-3 border-t border-[var(--border-1)] px-6 py-3.5 max-[640px]:px-4">
          {footer}
        </div>
      )}
    </section>
  );
}
