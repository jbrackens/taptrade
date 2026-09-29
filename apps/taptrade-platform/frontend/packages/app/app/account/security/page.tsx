"use client";

import type React from "react";
import { useEffect, useState } from "react";
import { LockIcon as Lock } from "@phosphor-icons/react/dist/csr/Lock";
import { useAuth } from "../../hooks/useAuth";
import { useToast } from "../../components/ToastProvider";
import { Button, Input } from "../../components/ui";
import {
  activateMfa,
  changePassword,
  disableMfa,
  getMfaStatus,
  getSessions,
  revokeSession,
  startMfaEnrollment,
} from "../../lib/api/auth-client";
import type {
  MfaEnrollment,
  MfaStatus,
  Session,
} from "../../lib/api/auth-client";
import AuthenticatorKey from "../../components/auth/AuthenticatorKey";
import { FEATURE_MFA } from "../../lib/features";
import { logger } from "../../lib/logger";
import { SettingsShell } from "../../components/account/SettingsShell";

type Tab = "password" | "twofa" | "sessions";

const cardClass =
  "rounded-[var(--r-rh-lg)] border border-[var(--border-1)] bg-[var(--surface-1)] p-6 shadow-[var(--shadow-card)]";
const descClass = "mb-6 text-[13px] text-[var(--t2)]";
const labelClass = "text-[13px] font-semibold text-[var(--t2)]";
const errorClass =
  "rounded-[var(--r-rh-md)] border border-[var(--danger)] bg-[color-mix(in_srgb,var(--danger)_8%,transparent)] px-3 py-2.5 text-[13px] font-medium text-[var(--danger)]";

function errorText(err: unknown, fallback: string): string {
  const message = err instanceof Error ? err.message : "";
  const lower = message.toLowerCase();
  if (lower.includes("incorrect code")) {
    return "That code didn't work. Enter the current code from your authenticator app.";
  }
  if (lower.includes("already used")) {
    return "That code was already used. Wait for the next one, then enter it.";
  }
  return message || fallback;
}

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

// The two-factor tab is behind FEATURE_MFA (off by default).
const TABS: { id: Tab; label: string }[] = [
  { id: "password", label: "Password" },
  ...(FEATURE_MFA ? [{ id: "twofa" as const, label: "Two-factor sign-in" }] : []),
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

  // Two-factor sign-in: the server's status, a setup in progress, and the
  // code field shared by "turn on" and "turn off".
  const [mfaStatus, setMfaStatus] = useState<MfaStatus | null>(null);
  const [mfaLoadFailed, setMfaLoadFailed] = useState(false);
  const [enrollment, setEnrollment] = useState<MfaEnrollment | null>(null);
  const [mfaCode, setMfaCode] = useState("");
  const [mfaBusy, setMfaBusy] = useState(false);
  const [mfaError, setMfaError] = useState("");
  const [disabling, setDisabling] = useState(false);

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

  useEffect(() => {
    if (!FEATURE_MFA || !user?.id) return;
    let active = true;
    getMfaStatus()
      .then((status) => {
        if (active) setMfaStatus(status);
      })
      .catch((err: unknown) => {
        logger.error(
          "Security",
          "Failed to load two-factor status",
          err instanceof Error ? err.message : String(err),
        );
        if (active) setMfaLoadFailed(true);
      });
    return () => {
      active = false;
    };
  }, [user?.id]);

  const resetMfaForm = () => {
    setEnrollment(null);
    setDisabling(false);
    setMfaCode("");
    setMfaError("");
  };

  const handleStartSetup = async () => {
    setMfaBusy(true);
    setMfaError("");
    try {
      setEnrollment(await startMfaEnrollment());
      setMfaCode("");
    } catch (err: unknown) {
      setMfaError(errorText(err, "Couldn't start setup. Try again."));
    } finally {
      setMfaBusy(false);
    }
  };

  const handleMfaSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const code = mfaCode.replace(/\s/g, "");
    if (!code) return;
    setMfaBusy(true);
    setMfaError("");
    try {
      if (disabling) {
        await disableMfa(code);
        setMfaStatus((s) => (s ? { ...s, enabled: false, pending: false } : s));
        toast.success(
          "Two-factor sign-in is off",
          "You'll sign in with your password only",
        );
      } else {
        await activateMfa(code);
        setMfaStatus((s) => (s ? { ...s, enabled: true, pending: false } : s));
        toast.success(
          "Two-factor sign-in is on",
          "You'll enter a code from your authenticator app when you sign in",
        );
      }
      resetMfaForm();
    } catch (err: unknown) {
      setMfaCode("");
      setMfaError(errorText(err, "Something went wrong. Try again."));
    } finally {
      setMfaBusy(false);
    }
  };

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

  return (
    <SettingsShell active="security">
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
              <div className={errorClass} role="alert">
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
      {FEATURE_MFA && tab === "twofa" && (
        <div className={cardClass}>
          <h2 className="mb-2 text-lg font-bold text-[var(--t1)]">
            Two-factor sign-in
          </h2>
          <p className={descClass}>
            Sign in with your password and a code from an authenticator app,
            such as 1Password, Google Authenticator or Authy.
          </p>

          {!mfaStatus && !mfaLoadFailed && (
            <div className="p-6 text-center text-sm text-[var(--t3)]">
              Loading…
            </div>
          )}
          {mfaLoadFailed && (
            <div className={errorClass} role="alert">
              Couldn't load your two-factor settings. Reload the page to try
              again.
            </div>
          )}
          {mfaStatus && !mfaStatus.available && !mfaStatus.enabled && (
            <div className="rounded-[var(--r-rh-md)] border border-[var(--border-1)] bg-[var(--surface-2)] p-4 text-[13px] text-[var(--t2)]">
              Two-factor sign-in isn't available right now.
            </div>
          )}

          {mfaStatus && (mfaStatus.available || mfaStatus.enabled) && (
            <div className="flex flex-col gap-4">
              <div className="flex items-center justify-between gap-4 rounded-[var(--r-rh-md)] border border-[var(--border-1)] bg-[var(--surface-2)] p-4 max-[640px]:flex-col max-[640px]:items-start">
                <div className="flex flex-1 items-start gap-3">
                  <Lock
                    size={20}
                    className="mt-0.5 shrink-0 text-[var(--t2)]"
                    aria-hidden="true"
                  />
                  <div>
                    <div className="mb-1 text-[15px] font-bold text-[var(--t1)]">
                      {mfaStatus.enabled ? "On" : "Off"}
                    </div>
                    <div className="text-[13px] text-[var(--t3)]">
                      {mfaStatus.enabled
                        ? mfaStatus.required
                          ? "Required for staff accounts. If you lose your authenticator, ask an operator to reset it."
                          : "You enter a code from your authenticator app when you sign in."
                        : "Anyone with your password can sign in."}
                    </div>
                  </div>
                </div>

                {!enrollment && !disabling && !mfaStatus.enabled && (
                  <Button
                    type="button"
                    variant="primary"
                    size="none"
                    className="min-h-11 px-4 text-[13px]"
                    onClick={handleStartSetup}
                    disabled={mfaBusy}
                  >
                    {mfaBusy ? "Starting…" : "Set up"}
                  </Button>
                )}
                {!enrollment &&
                  !disabling &&
                  mfaStatus.enabled &&
                  !mfaStatus.required && (
                    <Button
                      type="button"
                      variant="secondary"
                      size="none"
                      className="min-h-11 px-4 text-[13px]"
                      onClick={() => {
                        setDisabling(true);
                        setMfaError("");
                      }}
                    >
                      Turn off
                    </Button>
                  )}
              </div>

              {(enrollment || disabling) && (
                <form
                  onSubmit={handleMfaSubmit}
                  className="flex flex-col gap-4"
                  noValidate
                >
                  {enrollment && (
                    <>
                      <p className="m-0 text-[13px] text-[var(--t2)]">
                        Add this key to your authenticator app, then enter the
                        6-digit code it shows.
                      </p>
                      <AuthenticatorKey enrollment={enrollment} />
                    </>
                  )}
                  {disabling && (
                    <p className="m-0 text-[13px] text-[var(--t2)]">
                      Enter the current code from your authenticator app to
                      turn two-factor sign-in off.
                    </p>
                  )}

                  <div className="flex flex-col gap-2">
                    <label htmlFor="mfa-code" className={labelClass}>
                      6-digit code
                    </label>
                    <Input
                      id="mfa-code"
                      type="text"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      maxLength={7}
                      value={mfaCode}
                      onChange={(e) => setMfaCode(e.target.value)}
                      className="tabular-nums font-mono"
                      placeholder="123456"
                    />
                  </div>

                  {mfaError && (
                    <div className={errorClass} role="alert">
                      {mfaError}
                    </div>
                  )}

                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="submit"
                      variant={disabling ? "danger" : "primary"}
                      disabled={
                        mfaBusy || mfaCode.replace(/\s/g, "").length < 6
                      }
                    >
                      {mfaBusy
                        ? "Checking…"
                        : disabling
                          ? "Turn off"
                          : "Turn on"}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={resetMfaForm}
                      disabled={mfaBusy}
                    >
                      Cancel
                    </Button>
                  </div>
                </form>
              )}

              {!enrollment && !disabling && mfaError && (
                <div className={errorClass} role="alert">
                  {mfaError}
                </div>
              )}
            </div>
          )}
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
    </SettingsShell>
  );
}
