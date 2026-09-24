"use client";

import type React from "react";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Lock } from "lucide-react";
import { useAuth } from "../../hooks/useAuth";
import { useToast } from "../../components/ToastProvider";
import { Button, Input } from "../../components/ui";
import {
  changePassword,
  getSessions,
  revokeSession,
} from "../../lib/api/auth-client";
import type { Session } from "../../lib/api/auth-client";
import { logger } from "../../lib/logger";

type Tab = "password" | "twofa" | "sessions";

const pageClass = "mx-auto max-w-[800px] px-4 py-6";
const headerClass =
  "mb-6 flex items-start justify-between max-[640px]:flex-col max-[640px]:gap-4";
const backClass =
  "inline-flex min-h-11 items-center rounded-[var(--r-rh-md)] border border-[var(--border-1)] bg-[var(--surface-1)] px-4 py-2.5 text-[13px] font-semibold text-[var(--t1)] no-underline transition-colors duration-150 hover:border-[var(--border-2)]";
const cardClass =
  "rounded-[var(--r-rh-lg)] border border-[var(--border-1)] bg-[var(--surface-1)] p-6";
const descClass = "mb-6 text-[13px] text-[var(--t2)]";
const labelClass = "text-[13px] font-semibold text-[var(--t2)]";

// Segmented pills, ink selected state (DESIGN.md §6 selection rule).
const TAB_TRACK_CLASS =
  "mb-6 inline-flex gap-1 rounded-[var(--r-rh-md)] bg-[var(--surface-2)] p-1";
function tabClass(active: boolean) {
  return `min-h-9 max-[640px]:min-h-11 cursor-pointer rounded-[var(--r-rh-sm)] border-0 px-4 py-2 text-[13px] font-semibold transition-colors duration-150 ${
    active
      ? "bg-[var(--accent)] text-[var(--ticket-cta-text)]"
      : "bg-transparent text-[var(--t2)] hover:text-[var(--t1)]"
  }`;
}

const TABS: { id: Tab; label: string }[] = [
  { id: "password", label: "Password" },
  { id: "twofa", label: "Two-factor auth" },
  { id: "sessions", label: "Active sessions" },
];

export default function SecurityPage() {
  const { user } = useAuth();
  const toast = useToast();

  const [tab, setTab] = useState<Tab>("password");

  // Password form
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [passwordError, setPasswordError] = useState("");

  // 2FA state
  const [twoFaEnabled, setTwoFaEnabled] = useState(false);
  const [twoFaLoading, setTwoFaLoading] = useState(false);

  // Sessions list
  const [sessions, setSessions] = useState<Session[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  // Load sessions from API
  useEffect(() => {
    if (!user?.id) return;
    const loadSessions = async () => {
      setSessionsLoading(true);
      try {
        const data = await getSessions(user.id);
        setSessions(data);
      } catch (err) {
        logger.error(
          "Security",
          "Failed to load sessions",
          err instanceof Error ? err.message : String(err),
        );
      } finally {
        setSessionsLoading(false);
      }
    };
    loadSessions();
  }, [user?.id]);

  const handleRevokeSession = async (sessionId: string) => {
    setRevokingId(sessionId);
    try {
      await revokeSession(sessionId);
      setSessions((prev) => prev.filter((s) => s.id !== sessionId));
      toast.success("Session revoked", "The session has been signed out");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error("Failed to revoke session", message);
    } finally {
      setRevokingId(null);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordError("");

    if (!currentPassword || !newPassword || !confirmPassword) {
      setPasswordError("All fields are required");
      return;
    }

    if (newPassword !== confirmPassword) {
      setPasswordError("New passwords do not match");
      return;
    }

    if (newPassword.length < 12) {
      setPasswordError("Password must be at least 12 characters");
      return;
    }

    setPasswordLoading(true);
    try {
      await changePassword({
        user_id: user?.id || "",
        current_password: currentPassword,
        new_password: newPassword,
      });
      toast.success(
        "Password changed",
        "Your password has been updated successfully",
      );
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const msg = message || "Failed to change password";
      setPasswordError(msg);
      toast.error("Password change failed", msg);
    } finally {
      setPasswordLoading(false);
    }
  };

  const handleToggle2FA = async () => {
    setTwoFaLoading(true);
    try {
      const response = await fetch("/api/v1/auth/2fa/toggle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ enabled: !twoFaEnabled }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data?.error?.message || "Failed to update 2FA setting");
      }
      setTwoFaEnabled(!twoFaEnabled);
      toast.success(`2FA ${!twoFaEnabled ? "enabled" : "disabled"}`);
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Failed to update 2FA";
      toast.error(message);
    } finally {
      setTwoFaLoading(false);
    }
  };

  return (
    <div className={pageClass}>
      <div className={headerClass}>
        <div>
          <h1 className="type-poster m-0 mb-1.5 text-[28px] text-[var(--t1)] max-[640px]:text-[24px]">
            Security
          </h1>
          <p className="text-sm text-[var(--t3)]">
            Manage your password, authentication, and active sessions
          </p>
        </div>
        <Link href="/account" className={backClass}>
          ← Back
        </Link>
      </div>

      {/* Tabs */}
      <div className={TAB_TRACK_CLASS} role="tablist" aria-label="Security settings">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            className={tabClass(tab === t.id)}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Password Tab */}
      {tab === "password" && (
        <div className={cardClass}>
          <h2 className="mb-2 text-lg font-bold text-[var(--t1)]">
            Change password
          </h2>
          <p className={descClass}>
            Update your password to keep your account secure
          </p>

          <form onSubmit={handleChangePassword} className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <label htmlFor="current-password" className={labelClass}>
                Current password
              </label>
              <Input
                id="current-password"
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                placeholder="Enter current password"
              />
            </div>

            <div className="flex flex-col gap-2">
              <label htmlFor="new-password" className={labelClass}>
                New password
              </label>
              <Input
                id="new-password"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Enter new password (min 12 chars)"
              />
            </div>

            <div className="flex flex-col gap-2">
              <label htmlFor="confirm-password" className={labelClass}>
                Confirm password
              </label>
              <Input
                id="confirm-password"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Confirm new password"
              />
            </div>

            {passwordError && (
              <div
                className="rounded-[var(--r-rh-md)] border border-[var(--danger)] bg-[color-mix(in_srgb,var(--danger)_8%,transparent)] px-3 py-2.5 text-[13px] font-medium text-[var(--danger)]"
                role="alert"
              >
                {passwordError}
              </div>
            )}

            <Button type="submit" variant="primary" disabled={passwordLoading}>
              {passwordLoading ? "Updating…" : "Change password"}
            </Button>
          </form>
        </div>
      )}

      {/* 2FA Tab */}
      {tab === "twofa" && (
        <div className={cardClass}>
          <h2 className="mb-2 text-lg font-bold text-[var(--t1)]">
            Two-factor authentication
          </h2>
          <p className={descClass}>
            Add an extra layer of security to your account
          </p>

          <div className="flex items-center justify-between gap-4 rounded-[var(--r-rh-md)] border border-[var(--border-1)] bg-[var(--surface-2)] p-4 max-[640px]:flex-col max-[640px]:items-start">
            <div className="flex flex-1 items-start gap-3">
              <Lock
                size={20}
                strokeWidth={1.75}
                className="mt-0.5 shrink-0 text-[var(--t2)]"
                aria-hidden="true"
              />
              <div>
                <div className="mb-1 text-[15px] font-bold text-[var(--t1)]">
                  {twoFaEnabled ? "2FA enabled" : "2FA disabled"}
                </div>
                <div className="text-[13px] text-[var(--t3)]">
                  {twoFaEnabled
                    ? "Your account is protected with two-factor authentication"
                    : "Enable 2FA to add extra security via authenticator app"}
                </div>
              </div>
            </div>

            <Button
              type="button"
              variant={twoFaEnabled ? "secondary" : "primary"}
              size="none"
              className="min-h-11 px-4 text-[13px]"
              onClick={handleToggle2FA}
              disabled={twoFaLoading}
            >
              {twoFaLoading
                ? "Updating…"
                : twoFaEnabled
                  ? "Disable 2FA"
                  : "Enable 2FA"}
            </Button>
          </div>
        </div>
      )}

      {/* Sessions Tab */}
      {tab === "sessions" && (
        <div className={cardClass}>
          <h2 className="mb-2 text-lg font-bold text-[var(--t1)]">
            Active sessions
          </h2>
          <p className={descClass}>
            View and manage devices logged into your account
          </p>

          <div className="flex flex-col">
            {sessionsLoading && (
              <div className="p-6 text-center text-sm text-[var(--t3)]">
                Loading sessions…
              </div>
            )}
            {!sessionsLoading && sessions.length === 0 && (
              <div className="p-6 text-center text-sm text-[var(--t3)]">
                No active sessions found.
              </div>
            )}
            {sessions.map((session) => (
              <div
                key={session.id}
                className="flex items-center justify-between gap-3 border-b border-[var(--border-1)] py-4 last:border-b-0 max-[640px]:flex-col max-[640px]:items-start max-[640px]:gap-3"
              >
                <div className="flex-1">
                  <div className="mb-1 text-sm font-semibold text-[var(--t1)]">
                    {session.device}
                  </div>
                  <div className="mb-1 text-xs text-[var(--t3)]">
                    {session.location}
                  </div>
                  <div className="font-mono text-xs text-[var(--t3)]">
                    Last active: {new Date(session.lastActive).toLocaleString()}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {session.current && (
                    <span className="inline-block rounded-[var(--r-rh-sm)] bg-[var(--accent-soft)] px-2 py-1 text-xs font-semibold text-[var(--accent-text)]">
                      Current
                    </span>
                  )}
                  {!session.current && (
                    <Button
                      type="button"
                      variant="secondary"
                      size="none"
                      className="min-h-11 px-4 text-[13px]"
                      onClick={() => handleRevokeSession(session.id)}
                      disabled={revokingId === session.id}
                    >
                      {revokingId === session.id ? "Revoking…" : "Sign out"}
                    </Button>
                  )}
                </div>
              </div>
            ))}

            <div className="mt-3 border-t border-[var(--border-1)] pt-3 text-xs text-[var(--t3)]">
              Showing all active sessions. You can sign out of other devices
              above.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
