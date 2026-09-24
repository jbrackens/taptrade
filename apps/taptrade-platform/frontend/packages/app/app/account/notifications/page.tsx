"use client";

import { useState } from "react";
import Link from "next/link";
import { Calendar, Gift, Megaphone, ShieldCheck } from "lucide-react";
import { useAuth } from "../../hooks/useAuth";
import { useToast } from "../../components/ToastProvider";
import { Button } from "../../components/ui";
import { updatePreferences } from "../../lib/api/user-client";

const pageClass = "mx-auto max-w-[800px] px-4 py-6";
const headerClass =
  "mb-8 flex items-start justify-between max-[640px]:flex-col max-[640px]:gap-4";
const backClass =
  "inline-flex min-h-11 items-center rounded-[var(--r-rh-md)] border border-[var(--border-1)] bg-[var(--surface-1)] px-4 py-2.5 text-[13px] font-semibold text-[var(--t1)] no-underline transition-colors duration-150 hover:border-[var(--border-2)]";
const cardClass =
  "mb-6 rounded-[var(--r-rh-lg)] border border-[var(--border-1)] bg-[var(--surface-1)] p-6";
const descClass = "mb-6 text-[13px] text-[var(--t2)]";
const rowClass =
  "flex items-center justify-between gap-4 border-b border-[var(--border-1)] py-4 first:pt-0 last:border-b-0 last:pb-0 max-[640px]:flex-col max-[640px]:items-start max-[640px]:gap-3";
const rowTitleClass = "mb-1 text-sm font-bold text-[var(--t1)]";
const rowDescClass = "text-xs text-[var(--t3)]";
const toggleClass = "relative inline-flex h-7 w-12 shrink-0 cursor-pointer items-center";
const toggleInputClass = "peer sr-only";
const toggleSliderClass =
  "absolute inset-0 cursor-pointer rounded-[var(--r-pill)] bg-[var(--border-2)] transition-all duration-150 before:absolute before:bottom-[3px] before:left-[3px] before:h-[22px] before:w-[22px] before:rounded-full before:bg-[var(--on-ink)] before:transition-all before:duration-150 peer-checked:bg-[var(--accent)] peer-checked:before:translate-x-5 peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-[var(--focus-ring)] peer-focus-visible:outline-offset-2";

export default function NotificationsPage() {
  const { user } = useAuth();
  const toast = useToast();

  const [prefs, setPrefs] = useState({
    notification_email: true,
    notification_sms: false,
    notification_push: true,
    marketing_email: false,
  });
  const [saveLoading, setSaveLoading] = useState(false);

  // Email frequency
  const [emailFrequency, setEmailFrequency] = useState<
    "instant" | "daily" | "weekly"
  >("instant");

  // Notification categories
  const [categories, setCategories] = useState({
    market_results: true,
    promotions: true,
    account_updates: true,
    new_markets: false,
    price_alerts: false,
  });

  const handleCategoryToggle = (key: keyof typeof categories) => {
    setCategories((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  const handleToggle = (key: keyof typeof prefs) => {
    setPrefs((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  const handleSave = async () => {
    if (!user?.id) return;

    setSaveLoading(true);
    try {
      await updatePreferences(user.id, prefs);
      // LC-13: do NOT claim success. The backend does not persist these yet
      // (the write goes to an in-process map that is never read), so a
      // "Preferences saved" toast would be a false success / silent data
      // loss. Be honest until the persistence build lands.
      toast.info(
        "Not saved yet",
        "Notification preferences aren't stored yet — this feature is still being built. Your selections won't persist after you leave this page.",
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const msg = message || "Failed to save preferences";
      toast.error("Save failed", msg);
    } finally {
      setSaveLoading(false);
    }
  };

  return (
    <div className={pageClass}>
      <div className={headerClass}>
        <div>
          <h1 className="type-poster m-0 mb-1.5 text-[28px] text-[var(--t1)] max-[640px]:text-[24px]">
            Alerts
          </h1>
          <p className="text-sm text-[var(--t3)]">
            Choose how you want to receive updates
          </p>
        </div>
        <Link href="/account" className={backClass}>
          ← Back
        </Link>
      </div>

      {/* Notification Settings Card */}
      <div className={cardClass}>
        <h2 className="mb-2 text-lg font-bold text-[var(--t1)]">
          Communication channels
        </h2>
        <p className={descClass}>
          Select which channels you want to receive notifications on
        </p>

        <div
          className="mb-6 rounded-[var(--r-rh-md)] border border-[var(--border-1)] border-l-[3px] border-l-[var(--t1)] bg-[var(--surface-2)] px-[14px] py-3 text-[13px] leading-normal text-[var(--t2)]"
          role="status"
        >
          Heads up — notification preferences aren&apos;t saved yet.
          We&apos;re still building this, so your selections won&apos;t
          persist after you leave this page.
        </div>

        <div className="mb-6 flex flex-col">
          {/* Email Notifications */}
          <div className={rowClass}>
            <div className="flex-1">
              <div className={rowTitleClass}>Email notifications</div>
              <div className={rowDescClass}>
                Receive notifications about your account activity via email
              </div>
            </div>
            <label className={toggleClass}>
              <input
                className={toggleInputClass}
                type="checkbox"
                checked={prefs.notification_email}
                onChange={() => handleToggle("notification_email")}
              />
              <span className={toggleSliderClass}></span>
            </label>
          </div>

          {/* SMS Notifications */}
          <div className={rowClass}>
            <div className="flex-1">
              <div className={rowTitleClass}>SMS notifications</div>
              <div className={rowDescClass}>
                Receive important alerts via text message
              </div>
            </div>
            <label className={toggleClass}>
              <input
                className={toggleInputClass}
                type="checkbox"
                checked={prefs.notification_sms}
                onChange={() => handleToggle("notification_sms")}
              />
              <span className={toggleSliderClass}></span>
            </label>
          </div>

          {/* Push Notifications */}
          <div className={rowClass}>
            <div className="flex-1">
              <div className={rowTitleClass}>Push notifications</div>
              <div className={rowDescClass}>
                Get real-time notifications on your browser or mobile app
              </div>
            </div>
            <label className={toggleClass}>
              <input
                className={toggleInputClass}
                type="checkbox"
                checked={prefs.notification_push}
                onChange={() => handleToggle("notification_push")}
              />
              <span className={toggleSliderClass}></span>
            </label>
          </div>

          {/* Marketing Email */}
          <div className={rowClass}>
            <div className="flex-1">
              <div className={rowTitleClass}>Marketing emails</div>
              <div className={rowDescClass}>
                Receive emails about new features, promotions, and special
                offers
              </div>
            </div>
            <label className={toggleClass}>
              <input
                className={toggleInputClass}
                type="checkbox"
                checked={prefs.marketing_email}
                onChange={() => handleToggle("marketing_email")}
              />
              <span className={toggleSliderClass}></span>
            </label>
          </div>
        </div>

        {/* Email Frequency */}
        <div className="mb-6">
          <h3 className="mb-1 text-[15px] font-bold text-[var(--t1)]">
            Email frequency
          </h3>
          <div className="flex flex-col">
            {(
              [
                {
                  value: "instant",
                  label: "Instant",
                  desc: "Receive emails as events happen",
                },
                {
                  value: "daily",
                  label: "Daily digest",
                  desc: "One summary email per day",
                },
                {
                  value: "weekly",
                  label: "Weekly digest",
                  desc: "One summary email per week",
                },
              ] as const
            ).map((opt) => (
              <label key={opt.value} className={`${rowClass} cursor-pointer`}>
                <div className="flex-1">
                  <div className={rowTitleClass}>{opt.label}</div>
                  <div className={rowDescClass}>{opt.desc}</div>
                </div>
                <input
                  className="h-[18px] w-[18px] shrink-0 accent-[var(--accent)]"
                  type="radio"
                  name="emailFrequency"
                  value={opt.value}
                  checked={emailFrequency === opt.value}
                  onChange={() => setEmailFrequency(opt.value)}
                />
              </label>
            ))}
          </div>
        </div>

        {/* Notification Categories */}
        <div className="mb-6">
          <h3 className="mb-1 text-[15px] font-bold text-[var(--t1)]">
            Notification categories
          </h3>
          <div className="flex flex-col">
            {[
              {
                key: "market_results" as const,
                label: "Market results",
                desc: "Get notified when your positions are settled",
              },
              {
                key: "promotions" as const,
                label: "Promotions",
                desc: "Point bonus updates, missions, and community events",
              },
              {
                key: "account_updates" as const,
                label: "Account updates",
                desc: "Point ledger activity, profile changes, and security alerts",
              },
              {
                key: "new_markets" as const,
                label: "New markets",
                desc: "Be notified when new topics or series are added",
              },
              {
                key: "price_alerts" as const,
                label: "Price alerts",
                desc: "Get alerted when prices change significantly on your favorites",
              },
            ].map((cat) => (
              <label key={cat.key} className={`${rowClass} cursor-pointer`}>
                <div className="flex-1">
                  <div className={rowTitleClass}>{cat.label}</div>
                  <div className={rowDescClass}>{cat.desc}</div>
                </div>
                <input
                  className="h-[18px] w-[18px] shrink-0 accent-[var(--accent)]"
                  type="checkbox"
                  checked={categories[cat.key]}
                  onChange={() => handleCategoryToggle(cat.key)}
                />
              </label>
            ))}
          </div>
        </div>

        {/* Save Button */}
        <Button
          type="button"
          variant="primary"
          onClick={handleSave}
          disabled={saveLoading}
        >
          {saveLoading ? "Saving…" : "Save preferences"}
        </Button>
      </div>

      {/* Notification Types Info */}
      <div className={cardClass}>
        <h3 className="mb-4 text-base font-bold text-[var(--t1)]">
          What you&apos;ll receive
        </h3>
        <div className="flex flex-col">
          <InfoRow
            icon={<Megaphone size={18} strokeWidth={1.75} />}
            title="Announcements"
            desc="Important updates about your account and our service"
          />
          <InfoRow
            icon={<Gift size={18} strokeWidth={1.75} />}
            title="Promotions"
            desc="Point bonus updates and community events"
          />
          <InfoRow
            icon={<Calendar size={18} strokeWidth={1.75} />}
            title="Market Updates"
            desc="Reminders for followed markets and closing windows"
          />
          <InfoRow
            icon={<ShieldCheck size={18} strokeWidth={1.75} />}
            title="Sign-in notifications"
            desc="Alerts when your account is accessed"
          />
        </div>
      </div>
    </div>
  );
}

function InfoRow({
  icon,
  title,
  desc,
}: {
  icon: React.ReactNode;
  title: string;
  desc: string;
}) {
  return (
    <div className="flex items-start gap-3 border-b border-[var(--border-1)] py-3 first:pt-0 last:border-b-0 last:pb-0">
      <span className="mt-0.5 shrink-0 text-[var(--t2)]" aria-hidden="true">
        {icon}
      </span>
      <div>
        <div className="text-[13px] font-bold text-[var(--t1)]">{title}</div>
        <div className="text-xs leading-snug text-[var(--t3)]">{desc}</div>
      </div>
    </div>
  );
}
