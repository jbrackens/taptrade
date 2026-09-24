"use client";

import { useState, useEffect, useCallback } from "react";
import { useAuth } from "../hooks/useAuth";
import { getProfile, updateProfile } from "../lib/api/user-client";
import type { UserProfile, UpdateProfileRequest } from "../lib/api/user-client";
import {
  setPredictionLimits,
  setPointUseLimits,
  verifyIdentity,
} from "../lib/api/compliance-client";
import type {
  SetPredictionLimitsRequest,
  SetPointUseLimitsRequest,
} from "../lib/api/compliance-client";
import { useToast } from "../components/ToastProvider";
import { useTranslation } from "react-i18next";
import { logger } from "../lib/logger";
import { Button, Input } from "../components/ui";
import { FEATURE_KYC, FEATURE_LIMITS } from "../lib/features";
import {
  legacyLocaleStorageKey,
  localeStorageKey,
  normalizeLocale,
  supportedLocales,
} from "../lib/i18n/locales";

type TabType = "settings" | "limits" | "verification" | "security";

const tabValues: TabType[] = (
  ["settings", "limits", "verification", "security"] as TabType[]
).filter((v) => FEATURE_LIMITS || v !== "limits");

// Status badges use system-message tokens, never Kilig pink (identity +
// liveness only) and never YES/NO (market direction only): verified =
// success, pending = warning, failed = danger, unverified = neutral ink.
const statusBadgeClasses: Record<string, string> = {
  verified:
    "inline-flex items-center rounded-[var(--r-rh-sm)] bg-[color-mix(in_srgb,var(--success)_10%,transparent)] px-2.5 py-1 text-xs font-semibold text-[var(--success)]",
  pending:
    "inline-flex items-center rounded-[var(--r-rh-sm)] bg-[color-mix(in_srgb,var(--warning)_10%,transparent)] px-2.5 py-1 text-xs font-semibold text-[var(--warning)]",
  failed:
    "inline-flex items-center rounded-[var(--r-rh-sm)] bg-[color-mix(in_srgb,var(--danger)_8%,transparent)] px-2.5 py-1 text-xs font-semibold text-[var(--danger)]",
  unverified:
    "inline-flex items-center rounded-[var(--r-rh-sm)] bg-[var(--surface-2)] px-2.5 py-1 text-xs font-semibold text-[var(--t3)]",
  default:
    "inline-flex items-center rounded-[var(--r-rh-sm)] bg-[var(--accent-soft)] px-2.5 py-1 text-xs font-semibold text-[var(--accent-text)]",
};

// Segmented pills, ink selected state (DESIGN.md §6 selection rule).
const tabTrackClass =
  "mb-6 inline-flex flex-wrap gap-1 rounded-[var(--r-rh-md)] bg-[var(--surface-2)] p-1";
const tabButtonClass = (active: boolean) =>
  active
    ? "min-h-9 max-[640px]:min-h-11 cursor-pointer rounded-[var(--r-rh-sm)] border-0 bg-[var(--accent)] px-4 py-2 text-[13px] font-semibold text-[var(--ticket-cta-text)]"
    : "min-h-9 max-[640px]:min-h-11 cursor-pointer rounded-[var(--r-rh-sm)] border-0 bg-transparent px-4 py-2 text-[13px] font-semibold text-[var(--t2)] hover:text-[var(--t1)]";

const selectClass =
  "box-border w-full cursor-pointer rounded-[var(--r-rh-md)] border border-[var(--border-2)] bg-[var(--surface-1)] px-3 py-2.5 text-sm text-[var(--t1)] outline-none transition-colors duration-150 hover:border-[var(--t3)] focus:border-[var(--accent)] focus-visible:shadow-[0_0_0_2px_var(--focus-ring)]";
const labelClass = "mb-2 block text-[14px] font-semibold text-[var(--t1)]";
const loadingClass =
  "mx-auto max-w-[800px] px-4 py-10 text-center text-sm text-[var(--t3)]";
const pageClass = "mx-auto max-w-[800px] px-4 py-6";
const pageTitleClass =
  "type-poster m-0 mb-6 text-[28px] text-[var(--t1)] max-[640px]:text-[24px]";
const cardClass =
  "mb-6 rounded-[var(--r-rh-lg)] border border-[var(--border-1)] bg-[var(--surface-1)] p-6";
const sectionClass = "mb-6";
const sectionTitleClass = "mb-4 text-[16px] font-semibold text-[var(--t1)]";
const twoColumnGridClass = "grid grid-cols-2 gap-4 max-[480px]:grid-cols-1";
const hintClass = "mt-2 text-[12px] text-[var(--t3)]";
const preferenceSectionClass = "border-t border-[var(--border-1)] pt-6";
const fieldClass = "mb-4";
const verificationRowClass =
  "flex justify-between gap-3 border-b border-[var(--border-1)] py-3 last:border-b-0";
const mutedTextClass = "text-[14px] text-[var(--t3)]";
const securityRowClass =
  "flex items-center justify-between gap-3 border-b border-[var(--border-1)] py-4 last:border-b-0";
const accountValueClass = "font-semibold text-[var(--t1)]";
// Same visual toggle-switch recipe as /account/notifications — purely a
// style upgrade over the native (uncontrolled) checkbox; no behaviour change.
const toggleWrapClass = "relative inline-flex h-7 w-12 shrink-0 cursor-pointer items-center";
const toggleInputClass = "peer sr-only";
const toggleSliderClass =
  "absolute inset-0 cursor-pointer rounded-[var(--r-pill)] bg-[var(--border-2)] transition-all duration-150 before:absolute before:bottom-[3px] before:left-[3px] before:h-[22px] before:w-[22px] before:rounded-full before:bg-[var(--on-ink)] before:transition-all before:duration-150 peer-checked:bg-[var(--accent)] peer-checked:before:translate-x-5 peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-[var(--focus-ring)] peer-focus-visible:outline-offset-2";

function StatusBadge({
  status,
}: {
  status?: "verified" | "pending" | "failed" | "unverified";
}) {
  return (
    <span className={statusBadgeClasses[status ?? "default"]}>
      {status === "verified" && "Verified"}
      {status === "pending" && "Pending"}
      {status === "failed" && "Failed"}
      {status === "unverified" && "Not Verified"}
    </span>
  );
}

function TabNavigation({
  activeTabIndex,
  onChange,
}: {
  activeTabIndex: number;
  onChange: (index: number) => void;
}) {
  const tabs = ["Settings", "Limits", "Verification", "Security"].filter(
    (label) => FEATURE_LIMITS || label !== "Limits",
  );

  return (
    <div className={tabTrackClass} role="tablist" aria-label="Profile sections">
      {tabs.map((label, index) => (
        <button
          type="button"
          role="tab"
          aria-selected={activeTabIndex === index}
          key={label}
          onClick={() => onChange(index)}
          className={tabButtonClass(activeTabIndex === index)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

const TIMEZONES = [
  "UTC",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Anchorage",
  "Pacific/Honolulu",
  "Europe/London",
  "Europe/Berlin",
  "Europe/Paris",
  "Europe/Moscow",
  "Asia/Dubai",
  "Asia/Kolkata",
  "Asia/Shanghai",
  "Asia/Tokyo",
  "Asia/Singapore",
  "Australia/Sydney",
  "Pacific/Auckland",
  "America/Sao_Paulo",
  "Africa/Johannesburg",
];

// Prediction markets price in cents (0–99 = implied probability), so an
// "odds format" preference (Decimal/American/Fractional) does not apply.
// This radio group + the taptrade_odds_format localStorage key are
// sportsbook leftovers from the fork and were removed on 2026-05-03.

export default function ProfilePage() {
  const { user } = useAuth();
  const toast = useToast();
  const { i18n } = useTranslation();
  const [activeTabIndex, setActiveTabIndex] = useState(0);
  const activeTab = tabValues[activeTabIndex];

  // Preferences state
  const [prefLanguage, setPrefLanguage] = useState(() => {
    if (typeof window !== "undefined") {
      return normalizeLocale(
        localStorage.getItem(localeStorageKey) ||
          localStorage.getItem(legacyLocaleStorageKey),
      );
    }
    return "en";
  });
  const [prefTimezone, setPrefTimezone] = useState(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("taptrade_timezone") || "UTC";
    }
    return "UTC";
  });
  // Profile state
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [saving, setSaving] = useState(false);

  // Limits state
  const [dailyLimit, setDailyLimit] = useState("");
  const [weeklyLimit, setWeeklyLimit] = useState("");
  const [monthlyLimit, setMonthlyLimit] = useState("");
  const [maxOrderPoints, setMaxOrderPoints] = useState("");
  const [savingLimits, setSavingLimits] = useState(false);

  // Security state
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  // KYC verification (LC-22 / D-8)
  const [verifying, setVerifying] = useState(false);

  // Load profile on mount
  // biome-ignore lint/correctness/useExhaustiveDependencies: toast is used only in the failure path; depending on provider identity would re-run the profile fetch on unrelated re-renders
  useEffect(() => {
    if (!user?.id) return;

    let cancelled = false;
    const loadProfile = async () => {
      try {
        setProfileLoading(true);
        const p = await getProfile(user.id);
        if (!cancelled) {
          setProfile(p);
          setFirstName(p.firstName || "");
          setLastName(p.lastName || "");
          setEmail(p.email || "");
          setPhone(p.phone || "");
          setDateOfBirth(p.dateOfBirth || "");
        }
      } catch {
        if (!cancelled) {
          toast.error("Load Failed", "Could not load profile data.");
        }
      } finally {
        if (!cancelled) setProfileLoading(false);
      }
    };

    loadProfile();
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  // Save profile
  const handleSaveProfile = useCallback(async () => {
    if (!user?.id) return;
    setSaving(true);
    try {
      const request: UpdateProfileRequest = {
        first_name: firstName,
        last_name: lastName,
        phone: phone || undefined,
        date_of_birth: dateOfBirth || undefined,
      };
      const updated = await updateProfile(user.id, request);
      setProfile(updated);
      toast.success("Profile Updated", "Your changes have been saved.");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to save profile";
      toast.error("Save Failed", msg);
    } finally {
      setSaving(false);
    }
  }, [user?.id, firstName, lastName, phone, dateOfBirth, toast]);

  // Save limits
  const handleSaveLimits = useCallback(async () => {
    if (!user?.id) return;
    setSavingLimits(true);
    try {
      if (dailyLimit || weeklyLimit || monthlyLimit) {
        const pointUseReq: SetPointUseLimitsRequest = {
          user_id: user.id,
          dailyLimitPoints: dailyLimit ? Number(dailyLimit) : undefined,
          weeklyLimitPoints: weeklyLimit ? Number(weeklyLimit) : undefined,
          monthlyLimitPoints: monthlyLimit ? Number(monthlyLimit) : undefined,
        };
        await setPointUseLimits(pointUseReq);
      }
      if (maxOrderPoints) {
        const predictionReq: SetPredictionLimitsRequest = {
          user_id: user.id,
          maxOrderPoints: Number(maxOrderPoints),
        };
        await setPredictionLimits(predictionReq);
      }
      toast.success(
        "Limits Updated",
        "Your responsible-play limits have been saved.",
      );
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Failed to update limits";
      toast.error("Update Failed", msg);
    } finally {
      setSavingLimits(false);
    }
  }, [user?.id, dailyLimit, weeklyLimit, monthlyLimit, maxOrderPoints, toast]);

  // Save preferences
  const handleSavePreferences = useCallback(() => {
    try {
      if (typeof window !== "undefined") {
        localStorage.setItem(localeStorageKey, prefLanguage);
        localStorage.setItem(legacyLocaleStorageKey, prefLanguage);
        localStorage.setItem("taptrade_timezone", prefTimezone);
        // biome-ignore lint/suspicious/noDocumentCookie: same locale persistence cookie the LanguageSelector writes
        document.cookie = `${localeStorageKey}=${encodeURIComponent(prefLanguage)}; Max-Age=31536000; Path=/; SameSite=Lax`;
      }
      i18n.changeLanguage(prefLanguage);
      logger.info("Profile", "Preferences saved", {
        prefLanguage,
        prefTimezone,
      });
      toast.success("Preferences Saved", "Your preferences have been updated.");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error("Save Failed", msg);
    }
  }, [prefLanguage, prefTimezone, i18n, toast]);

  // Change password
  const handleChangePassword = useCallback(async () => {
    if (newPassword !== confirmPassword) {
      toast.error(
        "Password Mismatch",
        "New password and confirmation do not match.",
      );
      return;
    }
    if (!currentPassword || !newPassword) {
      toast.error("Missing Fields", "Please fill in all password fields.");
      return;
    }
    try {
      const response = await fetch("/api/v1/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          currentPassword,
          newPassword,
        }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data?.error?.message || "Failed to change password");
      }
      toast.success(
        "Password Changed",
        "Your password has been updated successfully.",
      );
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Failed to change password";
      toast.error("Error", message);
    }
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
  }, [currentPassword, newPassword, confirmPassword, toast]);

  // Start KYC verification (LC-22 / D-8): submit identity for verification,
  // then refresh the profile so the badge reflects the new real status.
  const handleStartVerification = useCallback(async () => {
    if (!user?.id) return;
    setVerifying(true);
    try {
      const { status } = await verifyIdentity(user.id);
      try {
        const p = await getProfile(user.id);
        setProfile(p);
      } catch (refreshErr: unknown) {
        logger.error(
          "Profile",
          "KYC status refresh after verification failed",
          refreshErr instanceof Error ? refreshErr.message : String(refreshErr),
        );
      }
      if (status === "approved") {
        toast.success("Identity Verified", "Your identity has been verified.");
      } else {
        toast.success(
          "Verification Submitted",
          "Your identity verification is being processed.",
        );
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("Profile", "KYC verification failed", message);
      toast.error(
        "Verification Failed",
        "Could not start identity verification.",
      );
    } finally {
      setVerifying(false);
    }
  }, [user?.id, toast]);

  if (profileLoading) {
    return <div className={loadingClass}>Loading profile…</div>;
  }

  return (
    <div className={pageClass}>
      <h1 className={pageTitleClass}>My Account</h1>

      <div className={cardClass}>
        <TabNavigation
          activeTabIndex={activeTabIndex}
          onChange={setActiveTabIndex}
        />

        {activeTab === "settings" && (
          <>
            <div className={sectionClass}>
              <h2 className={sectionTitleClass}>Personal Information</h2>
              <div className={twoColumnGridClass}>
                <div>
                  <label htmlFor="first-name" className={labelClass}>
                    First Name
                  </label>
                  <Input
                    id="first-name"
                    type="text"
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    className="w-full"
                  />
                </div>
                <div>
                  <label htmlFor="last-name" className={labelClass}>
                    Last Name
                  </label>
                  <Input
                    id="last-name"
                    type="text"
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    className="w-full"
                  />
                </div>
              </div>
            </div>

            <div className={sectionClass}>
              <label htmlFor="email-address" className={labelClass}>
                Email Address
              </label>
              <Input
                id="email-address"
                type="email"
                value={email}
                disabled
                className="w-full"
              />
              <p className={hintClass}>
                Email cannot be changed. Contact support if you need to update
                it.
              </p>
            </div>

            <div className={sectionClass}>
              <label htmlFor="phone-number" className={labelClass}>
                Phone Number
              </label>
              <Input
                id="phone-number"
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+1 (555) 123-4567"
                className="w-full"
              />
            </div>

            <div className={sectionClass}>
              <label htmlFor="date-of-birth" className={labelClass}>
                Date of Birth
              </label>
              <Input
                id="date-of-birth"
                type="date"
                value={dateOfBirth}
                onChange={(e) => setDateOfBirth(e.target.value)}
                className="w-full font-mono"
              />
            </div>

            <div className={sectionClass}>
              <Button
                type="button"
                variant="primary"
                onClick={handleSaveProfile}
                disabled={saving}
              >
                {saving ? "Saving…" : "Save Changes"}
              </Button>
            </div>

            {/* Preferences Section */}
            <div className={preferenceSectionClass}>
              <h2 className={sectionTitleClass}>Preferences</h2>

              <div className={fieldClass}>
                <label htmlFor="language" className={labelClass}>
                  Language
                </label>
                <select
                  id="language"
                  value={prefLanguage}
                  onChange={(e) =>
                    setPrefLanguage(normalizeLocale(e.target.value))
                  }
                  className={selectClass}
                >
                  {supportedLocales.map((lang) => (
                    <option key={lang.code} value={lang.code}>
                      {lang.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className={fieldClass}>
                <label htmlFor="timezone" className={labelClass}>
                  Timezone
                </label>
                <select
                  id="timezone"
                  value={prefTimezone}
                  onChange={(e) => setPrefTimezone(e.target.value)}
                  className={selectClass}
                >
                  {TIMEZONES.map((tz) => (
                    <option key={tz} value={tz}>
                      {tz.replace(/_/g, " ")}
                    </option>
                  ))}
                </select>
              </div>

              <Button type="button" variant="primary" onClick={handleSavePreferences}>
                Save Preferences
              </Button>
            </div>
          </>
        )}

        {activeTab === "limits" && (
          <>
            <div className={sectionClass}>
              <h2 className={sectionTitleClass}>Point-Use Limits</h2>
              <div className={twoColumnGridClass}>
                <div>
                  <label htmlFor="daily-limit-pts" className={labelClass}>
                    Daily Limit (pts)
                  </label>
                  <Input
                    id="daily-limit-pts"
                    type="number"
                    inputMode="numeric"
                    value={dailyLimit}
                    onChange={(e) => setDailyLimit(e.target.value)}
                    placeholder="1000"
                    className="w-full font-mono"
                  />
                </div>
                <div>
                  <label htmlFor="weekly-limit-pts" className={labelClass}>
                    Weekly Limit (pts)
                  </label>
                  <Input
                    id="weekly-limit-pts"
                    type="number"
                    inputMode="numeric"
                    value={weeklyLimit}
                    onChange={(e) => setWeeklyLimit(e.target.value)}
                    placeholder="5000"
                    className="w-full font-mono"
                  />
                </div>
                <div>
                  <label htmlFor="monthly-limit-pts" className={labelClass}>
                    Monthly Limit (pts)
                  </label>
                  <Input
                    id="monthly-limit-pts"
                    type="number"
                    inputMode="numeric"
                    value={monthlyLimit}
                    onChange={(e) => setMonthlyLimit(e.target.value)}
                    placeholder="10000"
                    className="w-full font-mono"
                  />
                </div>
              </div>
            </div>

            <div className={sectionClass}>
              <h2 className={sectionTitleClass}>Prediction Limits</h2>
              <div className={twoColumnGridClass}>
                <div>
                  <label htmlFor="max-order-size-pts" className={labelClass}>
                    Max Order Size (pts)
                  </label>
                  <Input
                    id="max-order-size-pts"
                    type="number"
                    inputMode="numeric"
                    value={maxOrderPoints}
                    onChange={(e) => setMaxOrderPoints(e.target.value)}
                    placeholder="500"
                    className="w-full font-mono"
                  />
                </div>
              </div>
            </div>

            <div>
              <Button
                type="button"
                variant="primary"
                onClick={handleSaveLimits}
                disabled={savingLimits}
              >
                {savingLimits ? "Saving…" : "Update Limits"}
              </Button>
            </div>
          </>
        )}

        {activeTab === "verification" && (
          <>
            <div className={sectionClass}>
              <h2 className={sectionTitleClass}>Verification Status</h2>
              <div>
                <div className={verificationRowClass}>
                  <span className={mutedTextClass}>Email Verification</span>
                  <StatusBadge status="verified" />
                </div>
                <div className={verificationRowClass}>
                  <span className={mutedTextClass}>Phone Verification</span>
                  <StatusBadge
                    status={profile?.phone ? "verified" : "pending"}
                  />
                </div>
                {FEATURE_KYC && (
                  <div className={verificationRowClass}>
                    <span className={mutedTextClass}>
                      Identity Verification (KYC)
                    </span>
                    <StatusBadge
                      status={
                        profile?.kycStatus === "approved"
                          ? "verified"
                          : profile?.kycStatus === "pending"
                            ? "pending"
                            : profile?.kycStatus === "declined" ||
                                profile?.kycStatus === "blocked"
                              ? "failed"
                              : "unverified"
                      }
                    />
                  </div>
                )}
              </div>
            </div>

            {FEATURE_KYC && (
              <div className={sectionClass}>
                <h2 className={sectionTitleClass}>Complete Verification</h2>
                <p className="mb-4 text-[14px] text-[var(--t3)]">
                  Verify your identity to unlock higher limits and improved
                  features.
                </p>
                <Button
                  type="button"
                  variant="primary"
                  onClick={handleStartVerification}
                  disabled={verifying}
                >
                  {verifying ? "Verifying…" : "Start Verification"}
                </Button>
              </div>
            )}
          </>
        )}

        {activeTab === "security" && (
          <>
            <div className={sectionClass}>
              <h2 className={sectionTitleClass}>Password</h2>
              <div className={fieldClass}>
                <label htmlFor="current-password" className={labelClass}>
                  Current Password
                </label>
                <Input
                  id="current-password"
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  placeholder="Enter current password"
                  className="w-full"
                />
              </div>
              <div className={fieldClass}>
                <label htmlFor="new-password" className={labelClass}>
                  New Password
                </label>
                <Input
                  id="new-password"
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Enter new password"
                  className="w-full"
                />
              </div>
              <div className={fieldClass}>
                <label htmlFor="confirm-password" className={labelClass}>
                  Confirm Password
                </label>
                <Input
                  id="confirm-password"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Confirm new password"
                  className="w-full"
                />
              </div>
              <Button type="button" variant="primary" onClick={handleChangePassword}>
                Change Password
              </Button>
            </div>

            <div className={sectionClass}>
              <h2 className={sectionTitleClass}>Two-Factor Authentication</h2>
              <div className={securityRowClass}>
                <span className={mutedTextClass}>
                  Enable 2FA for added security
                </span>
                <label className={toggleWrapClass}>
                  <input type="checkbox" className={toggleInputClass} />
                  <span className={toggleSliderClass} />
                </label>
              </div>
            </div>

            <div className={sectionClass}>
              <h2 className={sectionTitleClass}>Account Info</h2>
              <div>
                <div className={verificationRowClass}>
                  <span className={mutedTextClass}>Username</span>
                  <span className={accountValueClass}>
                    {profile?.username || user?.username}
                  </span>
                </div>
                <div className={verificationRowClass}>
                  <span className={mutedTextClass}>Member Since</span>
                  <span className={`${accountValueClass} font-mono tabular-nums`}>
                    {profile?.createdAt
                      ? new Date(profile.createdAt).toLocaleDateString()
                      : "-"}
                  </span>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
