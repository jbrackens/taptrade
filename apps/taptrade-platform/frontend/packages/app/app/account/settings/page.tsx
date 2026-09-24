"use client";

/**
 * SettingsPage — language + timezone preferences (App Router).
 *
 * Replaces the legacy pages-router /account/settings (pages/account/settings)
 * which crashed with "could not find react-redux context value" because the
 * pages router has no _app.tsx providing a Redux Provider after the App
 * Router migration. This rewrite uses the existing app i18n config
 * (app/lib/i18n/config.ts) and stores the timezone preference in
 * localStorage under `taptrade_timezone` (mirroring the language key).
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { useTranslation } from "react-i18next";
import i18n, { SUPPORTED_LANGUAGES } from "../../lib/i18n/config";

const LANGUAGE_LABELS: Record<string, string> = {
  en: "English",
  "zh-Hans": "简体中文",
  "zh-Hant": "繁體中文",
  tl: "Tagalog",
  ms: "Bahasa Melayu",
  id: "Bahasa Indonesia",
};

// A small but reasonable set. Browser default goes at the top.
const TIMEZONES = [
  "UTC",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "Europe/London",
  "Europe/Berlin",
  "Europe/Paris",
  "Asia/Tokyo",
  "Asia/Singapore",
  "Australia/Sydney",
];

const pageClass = "mx-auto max-w-[800px] px-4 py-6";
const headerClass =
  "mb-6 flex items-start justify-between max-[640px]:flex-col max-[640px]:gap-4";
const backClass =
  "inline-flex min-h-11 items-center rounded-[var(--r-rh-md)] border border-[var(--border-1)] bg-[var(--surface-1)] px-4 py-2.5 text-[13px] font-semibold text-[var(--t1)] no-underline transition-colors duration-150 hover:border-[var(--border-2)]";
const cardClass =
  "mb-4 rounded-[var(--r-rh-lg)] border border-[var(--border-1)] bg-[var(--surface-1)] px-6 py-[22px]";
const descClass = "m-0 mb-4 text-[13px] leading-normal text-[var(--t3)]";
const labelClass = "text-[13px] font-semibold text-[var(--t2)]";
const selectClass =
  "cursor-pointer rounded-[var(--r-rh-md)] border border-[var(--border-2)] bg-[var(--surface-1)] px-3 py-2.5 text-sm text-[var(--t1)] outline-none transition-colors duration-150 hover:border-[var(--t3)] focus:border-[var(--accent)] focus-visible:shadow-[0_0_0_2px_var(--focus-ring)]";

function browserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

export default function SettingsPage() {
  const { t } = useTranslation("settings");
  const [language, setLanguage] = useState<string>("en");
  const [timezone, setTimezone] = useState<string>("UTC");
  const [savedFlash, setSavedFlash] = useState<string | null>(null);

  useEffect(() => {
    const storedLang = localStorage.getItem("taptrade_language");
    const storedTz = localStorage.getItem("taptrade_timezone");
    if (storedLang && SUPPORTED_LANGUAGES.includes(storedLang)) {
      setLanguage(storedLang);
    } else {
      setLanguage(i18n.language || "en");
    }
    setTimezone(storedTz || browserTimezone());
  }, []);

  function handleLanguageChange(next: string) {
    setLanguage(next);
    localStorage.setItem("taptrade_language", next);
    void i18n.changeLanguage(next);
    flash(t("flash.languageUpdated", "Language updated"));
  }

  function handleTimezoneChange(next: string) {
    setTimezone(next);
    localStorage.setItem("taptrade_timezone", next);
    flash(t("flash.timezoneUpdated", "Timezone updated"));
  }

  function flash(message: string) {
    setSavedFlash(message);
    window.setTimeout(() => setSavedFlash(null), 2000);
  }

  const browserTz = browserTimezone();
  const tzOptions = Array.from(new Set([browserTz, ...TIMEZONES]));
  const now = new Date();
  let zonedExample = "—";
  try {
    zonedExample = new Intl.DateTimeFormat(language, {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: timezone,
    }).format(now);
  } catch {
    zonedExample = now.toLocaleString();
  }

  return (
    <div className={pageClass}>
      <div className={headerClass}>
        <div>
          <h1 className="type-poster m-0 mb-1.5 text-[28px] text-[var(--t1)] max-[640px]:text-[24px]">
            {t("TITLE", "Settings")}
          </h1>
          <p className="m-0 text-sm text-[var(--t3)]">
            {t("subtitle", "Language and timezone preferences for your account.")}
          </p>
        </div>
        <Link href="/account" className={backClass}>
          ← {t("back", "Back")}
        </Link>
      </div>

      {savedFlash && (
        <div
          className="mb-4 rounded-[var(--r-rh-md)] border border-[var(--success)] bg-[color-mix(in_srgb,var(--success)_8%,transparent)] px-[14px] py-2.5 text-[13px] font-semibold text-[var(--success)]"
          role="status"
        >
          {savedFlash}
        </div>
      )}

      <section className={cardClass}>
        <h2 className="m-0 mb-1.5 text-base font-bold tracking-[-0.01em] text-[var(--t1)]">
          {t("language.title", "Language")}
        </h2>
        <p className={descClass}>
          {t(
            "language.description",
            "Translations apply across the app immediately, and persist for future sessions on this device.",
          )}
        </p>
        <div className="flex flex-col gap-2">
          <label className={labelClass} htmlFor="set-lang">
            {t("language.display", "Display language")}
          </label>
          <select
            id="set-lang"
            className={selectClass}
            value={language}
            onChange={(e) => handleLanguageChange(e.target.value)}
          >
            {SUPPORTED_LANGUAGES.map((lng) => (
              <option key={lng} value={lng}>
                {LANGUAGE_LABELS[lng] ?? lng.toUpperCase()}
              </option>
            ))}
          </select>
        </div>
      </section>

      <section className={cardClass}>
        <h2 className="m-0 mb-1.5 text-base font-bold tracking-[-0.01em] text-[var(--t1)]">
          {t("timezone.title", "Timezone")}
        </h2>
        <p className={descClass}>
          {t(
            "timezone.description",
            "Used to display market close times and trade history in your local time. Defaults to your browser’s timezone",
          )}
          {browserTz ? ` (${browserTz})` : ""}.
        </p>
        <div className="flex flex-col gap-2">
          <label className={labelClass} htmlFor="set-tz">
            {t("timezone.display", "Display timezone")}
          </label>
          <select
            id="set-tz"
            className={selectClass}
            value={timezone}
            onChange={(e) => handleTimezoneChange(e.target.value)}
          >
            {tzOptions.map((tz) => (
              <option key={tz} value={tz}>
                {tz === browserTz ? `${tz} (${t("timezone.browser", "browser")})` : tz}
              </option>
            ))}
          </select>
        </div>
        <div className="mt-[14px] flex items-baseline gap-[14px] border-t border-[var(--border-1)] pt-[14px]">
          <span className="text-[12px] font-semibold text-[var(--t3)]">
            {t("timezone.preview", "Preview")}
          </span>
          <span className="font-mono text-sm font-semibold text-[var(--t1)] tabular-nums">
            {zonedExample}
          </span>
        </div>
      </section>

      <p className="mt-2 text-[13px] leading-relaxed text-[var(--t3)]">
        {t(
          "footer.beforeLinks",
          "Need security, password, or notification settings? Find them in",
        )}{" "}
        <Link href="/account/security" className="text-[var(--accent)] no-underline hover:underline">
          {t("footer.security", "Security")}
        </Link>
        ,{" "}
        <Link href="/account/notifications" className="text-[var(--accent)] no-underline hover:underline">
          {t("footer.alerts", "Alerts")}
        </Link>
        , {t("footer.and", "and")}{" "}
        <Link href="/account" className="text-[var(--accent)] no-underline hover:underline">
          {t("footer.account", "Account")}
        </Link>
        .
      </p>
    </div>
  );
}
