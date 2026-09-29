"use client";

/**
 * SettingsPage — the one profile settings page (the Account page's
 * "Profile" link and its edit button). It absorbed the retired /profile
 * page, which now redirects here:
 *   Personal details   name, phone, date of birth (email is read-only)
 *   Language & region  display language + timezone, saved on change
 *   Privacy            appear anonymously on leaderboards
 *   Verification       real KYC status (FEATURE_KYC)
 * Password, sessions and two-factor live under Security.
 */

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "../../hooks/useAuth";
import { getProfile, updateProfile } from "../../lib/api/user-client";
import type { UpdateProfileRequest, UserProfile } from "../../lib/api/user-client";
import { getPrivacy, updatePrivacy } from "../../lib/api/privacy-client";
import { verifyIdentity } from "../../lib/api/compliance-client";
import { FEATURE_KYC } from "../../lib/features";
import { normalizeLocale, supportedLocales } from "../../lib/i18n/locales";
import { logger } from "../../lib/logger";
import { Button, Input } from "../../components/ui";
import { useToast } from "../../components/ToastProvider";
import { getStoredLocale, persistLocale } from "../../components/i18n/LanguageSelector";
import { ProfileAvatar } from "../../components/account/ProfileAvatar";
import { SettingsCard, SettingsShell } from "../../components/account/SettingsShell";

const TIMEZONE_KEY = "taptrade_timezone";
// A short list; the browser's own zone is added at the top.
const TIMEZONES = [
  "UTC",
  "Asia/Manila",
  "Asia/Singapore",
  "Asia/Jakarta",
  "Asia/Kuala_Lumpur",
  "Asia/Hong_Kong",
  "Asia/Shanghai",
  "Asia/Tokyo",
  "Australia/Sydney",
  "Europe/London",
  "Europe/Paris",
  "America/New_York",
  "America/Los_Angeles",
];

const LABEL_CLASS = "mb-1.5 block text-[13px] font-semibold text-[var(--t2)]";
const HINT_CLASS = "m-0 mt-1.5 text-[12px] text-[var(--t3)]";
const SELECT_CLASS =
  "box-border w-full cursor-pointer rounded-[var(--r-rh-md)] border border-[var(--border-2)] bg-[var(--surface-1)] px-3 py-2.5 text-sm text-[var(--t1)] outline-none transition-colors duration-150 hover:border-[var(--t3)] focus:border-[var(--accent)] focus-visible:shadow-[0_0_0_2px_var(--focus-ring)]";

function browserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

interface Details {
  firstName: string;
  lastName: string;
  phone: string;
  dateOfBirth: string;
}

function detailsOf(p: UserProfile | null): Details {
  return {
    firstName: p?.firstName ?? "",
    lastName: p?.lastName ?? "",
    phone: p?.phone ?? "",
    dateOfBirth: p?.dateOfBirth ?? "",
  };
}

export default function SettingsPage() {
  const { t } = useTranslation("settings");
  const { user } = useAuth();
  const toast = useToast();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [details, setDetails] = useState<Details>(detailsOf(null));
  const [saving, setSaving] = useState(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: toast and t are used only on failure; a language switch must not refetch and wipe unsaved edits
  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    getProfile(user.id)
      .then((p) => {
        if (cancelled) return;
        setProfile(p);
        setDetails(detailsOf(p));
      })
      .catch((err: unknown) => {
        logger.warn("Settings", "profile fetch failed", err);
        if (!cancelled) toast.error(t("details.loadFailed", "Couldn’t load your details"));
      });
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  const saved = detailsOf(profile);
  const dirty = (Object.keys(details) as (keyof Details)[]).some((k) => details[k] !== saved[k]);
  const name =
    [details.firstName, details.lastName].filter(Boolean).join(" ").trim() ||
    profile?.username ||
    user?.username ||
    "";

  async function saveDetails() {
    if (!user?.id) return;
    setSaving(true);
    try {
      const request: UpdateProfileRequest = {
        first_name: details.firstName,
        last_name: details.lastName,
        phone: details.phone || undefined,
        date_of_birth: details.dateOfBirth || undefined,
      };
      const updated = await updateProfile(user.id, request);
      setProfile(updated);
      setDetails(detailsOf(updated));
      toast.success(t("details.saved", "Details saved"));
    } catch (err: unknown) {
      toast.error(
        t("details.saveFailed", "Couldn’t save your details"),
        err instanceof Error ? err.message : undefined,
      );
    } finally {
      setSaving(false);
    }
  }

  const set = (key: keyof Details) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setDetails((d) => ({ ...d, [key]: e.target.value }));

  return (
    <SettingsShell active="profile">
      <SettingsCard
        id="details"
        title={t("details.title", "Personal details")}
        description={t("details.description", "Only you see these. Your public name on boards is your username.")}
        footer={
          <>
            {dirty && (
              <Button type="button" variant="ghost" size="sm" onClick={() => setDetails(saved)} disabled={saving}>
                {t("cancel", "Cancel")}
              </Button>
            )}
            <Button type="button" variant="primary" size="sm" onClick={saveDetails} disabled={!dirty || saving}>
              {saving ? t("saving", "Saving…") : t("details.save", "Save changes")}
            </Button>
          </>
        }
      >
        <div className="mb-5 flex items-center gap-3.5">
          <ProfileAvatar name={name} size={48} />
          <div className="min-w-0">
            <div className="truncate text-[15px] font-semibold text-[var(--t1)]">{name || "—"}</div>
            <div className="truncate text-[13px] text-[var(--t3)]">{profile?.username || user?.username}</div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4 max-[640px]:grid-cols-1">
          <div>
            <label htmlFor="first-name" className={LABEL_CLASS}>
              {t("details.firstName", "First name")}
            </label>
            <Input id="first-name" autoComplete="given-name" value={details.firstName} onChange={set("firstName")} className="w-full" />
          </div>
          <div>
            <label htmlFor="last-name" className={LABEL_CLASS}>
              {t("details.lastName", "Last name")}
            </label>
            <Input id="last-name" autoComplete="family-name" value={details.lastName} onChange={set("lastName")} className="w-full" />
          </div>
          <div className="col-span-2 max-[640px]:col-span-1">
            <label htmlFor="email-address" className={LABEL_CLASS}>
              {t("details.email", "Email")}
            </label>
            <Input id="email-address" type="email" value={profile?.email ?? user?.email ?? ""} disabled className="w-full" />
            <p className={HINT_CLASS}>{t("details.emailHint", "Contact support to change the email you sign in with.")}</p>
          </div>
          <div>
            <label htmlFor="phone-number" className={LABEL_CLASS}>
              {t("details.phone", "Phone")}
            </label>
            <Input
              id="phone-number"
              type="tel"
              autoComplete="tel"
              value={details.phone}
              onChange={set("phone")}
              placeholder={t("details.optional", "Optional")}
              className="w-full"
            />
          </div>
          <div>
            <label htmlFor="date-of-birth" className={LABEL_CLASS}>
              {t("details.dateOfBirth", "Date of birth")}
            </label>
            <Input
              id="date-of-birth"
              type="date"
              autoComplete="bday"
              value={details.dateOfBirth}
              onChange={set("dateOfBirth")}
              className="w-full tabular-nums"
            />
          </div>
        </div>
      </SettingsCard>

      <LanguageRegionCard />
      <PrivacyCard />
      {FEATURE_KYC && user?.id && (
        <VerificationCard userId={user.id} status={profile?.kycStatus} onChanged={setProfile} />
      )}
    </SettingsShell>
  );
}

function LanguageRegionCard() {
  const { t, i18n } = useTranslation("settings");
  const toast = useToast();
  const [language, setLanguage] = useState<string>("en");
  const [timezone, setTimezone] = useState<string>("UTC");
  const browserTz = browserTimezone();

  // Read on mount only: the server render has no storage (hydration safety).
  useEffect(() => {
    setLanguage(getStoredLocale());
    setTimezone(window.localStorage.getItem(TIMEZONE_KEY) || browserTimezone());
  }, []);

  function changeLanguage(next: string) {
    const locale = normalizeLocale(next);
    setLanguage(locale);
    persistLocale(locale);
    void i18n.changeLanguage(locale);
    toast.success(t("flash.languageUpdated", "Language updated"));
  }

  function changeTimezone(next: string) {
    setTimezone(next);
    window.localStorage.setItem(TIMEZONE_KEY, next);
    toast.success(t("flash.timezoneUpdated", "Timezone updated"));
  }

  let preview = "";
  try {
    preview = new Intl.DateTimeFormat(language, {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: timezone,
    }).format(new Date());
  } catch {
    preview = new Date().toLocaleString();
  }
  const zones = Array.from(new Set([browserTz, ...TIMEZONES]));

  return (
    <SettingsCard
      id="language"
      title={t("region.title", "Language and region")}
      description={t("region.description", "Saved as you change them, on this device.")}
    >
      <div className="grid grid-cols-2 gap-4 max-[640px]:grid-cols-1">
        <div>
          <label htmlFor="set-lang" className={LABEL_CLASS}>
            {t("language.display", "Display language")}
          </label>
          <select id="set-lang" className={SELECT_CLASS} value={language} onChange={(e) => changeLanguage(e.target.value)}>
            {supportedLocales.map((l) => (
              <option key={l.code} value={l.code}>
                {l.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="set-tz" className={LABEL_CLASS}>
            {t("timezone.display", "Display timezone")}
          </label>
          <select id="set-tz" className={SELECT_CLASS} value={timezone} onChange={(e) => changeTimezone(e.target.value)}>
            {zones.map((tz) => (
              <option key={tz} value={tz}>
                {(tz === browserTz ? `${tz} (${t("timezone.browser", "browser")})` : tz).replace(/_/g, " ")}
              </option>
            ))}
          </select>
        </div>
      </div>
      <p className={HINT_CLASS}>
        {t("timezone.preview", "Preview")}: <span className="font-medium tabular-nums text-[var(--t2)]">{preview}</span>
      </p>
    </SettingsCard>
  );
}

function PrivacyCard() {
  const { t } = useTranslation("settings");
  const [anonymous, setAnonymous] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A late fetch must not overwrite a toggle the player already made.
  const touched = useRef(false);

  useEffect(() => {
    let cancelled = false;
    getPrivacy()
      .then((prefs) => {
        if (!cancelled && !touched.current) setAnonymous(prefs.displayAnonymous);
      })
      .catch((err: unknown) => logger.warn("Settings", "privacy fetch failed", err));
    return () => {
      cancelled = true;
    };
  }, []);

  async function toggle(next: boolean) {
    if (saving) return;
    touched.current = true;
    setSaving(true);
    setError(null);
    try {
      const updated = await updatePrivacy({ displayAnonymous: next });
      setAnonymous(updated.displayAnonymous);
    } catch (err: unknown) {
      logger.warn("Settings", "privacy update failed", err);
      setError(t("privacy.saveError", "Couldn’t save that change"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <SettingsCard id="privacy" title={t("privacy.title", "Privacy")}>
      <label className="flex cursor-pointer items-start justify-between gap-6">
        <span>
          <span className="block text-[14px] font-semibold text-[var(--t1)]">
            {t("privacy.label", "Appear anonymously on leaderboards")}
          </span>
          <span className="mt-1 block text-[13px] leading-normal text-[var(--t3)]">
            {t(
              "privacy.description",
              "Boards show your rank instead of your username, for example “Trader #14”. Your stats still count.",
            )}
          </span>
        </span>
        <span className="relative mt-0.5 inline-flex h-7 w-12 shrink-0 items-center">
          <input
            type="checkbox"
            role="switch"
            aria-checked={anonymous ?? false}
            className="peer sr-only"
            checked={anonymous ?? false}
            disabled={anonymous === null || saving}
            onChange={(e) => toggle(e.target.checked)}
          />
          <span
            aria-hidden="true"
            className="absolute inset-0 rounded-[var(--r-pill)] bg-[var(--border-2)] transition-colors duration-150 before:absolute before:left-[3px] before:top-[3px] before:h-[22px] before:w-[22px] before:rounded-full before:bg-[var(--on-ink)] before:shadow-[var(--shadow-card)] before:transition-transform before:duration-150 peer-checked:bg-[var(--accent)] peer-checked:before:translate-x-5 peer-disabled:opacity-60 peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[var(--focus-ring)]"
          />
        </span>
      </label>
      {error && (
        <p className="m-0 mt-3 text-[13px] font-medium text-[var(--danger)]" role="alert">
          {error}
        </p>
      )}
    </SettingsCard>
  );
}

type KycBadge = "verified" | "pending" | "failed" | "unverified";

const KYC_BADGE_CLASS: Record<KycBadge, string> = {
  verified: "bg-[color-mix(in_srgb,var(--success)_12%,transparent)] text-[var(--success)]",
  pending: "bg-[color-mix(in_srgb,var(--warning)_14%,transparent)] text-[var(--warning)]",
  failed: "bg-[color-mix(in_srgb,var(--danger)_10%,transparent)] text-[var(--danger)]",
  unverified: "bg-[var(--surface-2)] text-[var(--t2)]",
};

function kycBadge(status: string | undefined): KycBadge {
  if (status === "approved") return "verified";
  if (status === "pending") return "pending";
  if (status === "declined" || status === "blocked") return "failed";
  return "unverified";
}

function VerificationCard({
  userId,
  status,
  onChanged,
}: {
  userId: string;
  status: string | undefined;
  onChanged: (p: UserProfile) => void;
}) {
  const { t } = useTranslation("settings");
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const badge = kycBadge(status);
  const labels: Record<KycBadge, string> = {
    verified: t("kyc.verified", "Verified"),
    pending: t("kyc.pending", "In review"),
    failed: t("kyc.failed", "Not approved"),
    unverified: t("kyc.unverified", "Not verified"),
  };

  async function start() {
    setBusy(true);
    try {
      const result = await verifyIdentity(userId);
      onChanged(await getProfile(userId));
      toast.success(
        result.status === "approved"
          ? t("kyc.approved", "Identity verified")
          : t("kyc.submitted", "Verification submitted"),
      );
    } catch (err: unknown) {
      logger.error("Settings", "KYC verification failed", err instanceof Error ? err.message : String(err));
      toast.error(t("kyc.startFailed", "Couldn’t start verification"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <SettingsCard
      id="verification"
      title={t("kyc.title", "Identity verification")}
      description={t("kyc.description", "Some markets and higher limits need a verified identity.")}
      footer={
        badge === "unverified" || badge === "failed" ? (
          <Button type="button" variant="primary" size="sm" onClick={start} disabled={busy}>
            {busy ? t("kyc.starting", "Starting…") : t("kyc.start", "Start verification")}
          </Button>
        ) : undefined
      }
    >
      <div className="flex items-center justify-between gap-4">
        <span className="text-[14px] text-[var(--t2)]">{t("kyc.status", "Status")}</span>
        <span className={`rounded-[var(--r-rh-sm)] px-2.5 py-1 text-[12px] font-semibold ${KYC_BADGE_CLASS[badge]}`}>
          {labels[badge]}
        </span>
      </div>
    </SettingsCard>
  );
}
