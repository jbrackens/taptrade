"use client";

/**
 * NotificationsBell — the top-bar inbox for settlement notifications.
 *
 * Three moments, one component:
 *   live    — subscribed to portfolio:{uid}; a settlement event toasts
 *             immediately and bumps the badge (predict-ws refcounts the
 *             channel, so coexisting portfolio subscribers are free)
 *   later   — the badge hydrates from GET /api/v1/notifications on auth,
 *             so users who were offline at settlement see the count
 *   opened  — the dropdown lists recent rows and marks everything read
 *
 * 1C: hairline dropdown reusing the TopBar menu idiom, mono micro-labels,
 * no new colors — the payout number is data, not decoration.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { BellSimpleIcon as Bell } from "@phosphor-icons/react/dist/csr/BellSimple";
import { useTranslation } from "react-i18next";
import { subscribePredictWs } from "../../lib/websocket/predict-ws";
import {
  getNotifications,
  markAllNotificationsRead,
  type UserNotification,
} from "../../lib/api/notifications-client";
import { useToast } from "../ToastProvider";
import { settlementNotice } from "./notifications";

const BELL_BUTTON_CLASS =
  "relative grid size-11 shrink-0 cursor-pointer place-items-center rounded-md border-0 bg-transparent text-[var(--t2)] transition-colors duration-150 hover:bg-[var(--surface-2)] hover:text-[var(--t1)]";
// Unread count is a liveness signal — Kilig pink, per DESIGN.md §2 ("Kilig
// pink is identity and liveness"), white label for contrast on the fill.
const BADGE_CLASS =
  "absolute right-1.5 top-1.5 grid min-w-[16px] place-items-center rounded-full bg-[var(--live)] px-1 font-mono text-[9px] font-bold leading-[16px] text-[var(--on-kilig)]";
const PANEL_CLASS =
  "absolute right-0 top-[calc(100%_+_6px)] z-[110] w-[320px] rounded-[var(--r-rh-md)] border border-[var(--border-1)] bg-[var(--surface-1)] p-1 shadow-[var(--shadow-pop)]";
const PANEL_HEAD_CLASS =
  "px-3 py-2 text-[12px] font-semibold text-[var(--t3)]";
const ROW_CLASS = "rounded-[var(--r-sm)] px-3 py-2 hover:bg-[var(--surface-2)]";
const ROW_TITLE_CLASS = "text-[13px] font-semibold text-[var(--t1)]";
const ROW_BODY_CLASS = "mt-0.5 truncate text-[12px] text-[var(--t2)]";
const ROW_TIME_CLASS =
  "mt-1 text-[12px] text-[var(--t3)] [font-variant-numeric:tabular-nums]";
const EMPTY_CLASS = "px-3 py-6 text-center text-[12px] text-[var(--t3)]";

function noticeTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const sameDay = new Date().toDateString() === d.toDateString();
  return sameDay
    ? d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function NotificationsBell({
  userId,
  className,
}: {
  userId: string;
  className?: string;
}) {
  const { t } = useTranslation("header");
  const toast = useToast();
  const [unread, setUnread] = useState(0);
  const [items, setItems] = useState<UserNotification[]>([]);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  const refresh = useCallback(async () => {
    const inbox = await getNotifications(20);
    if (!inbox) return;
    setItems(inbox.items);
    setUnread(inbox.unreadCount);
  }, []);

  // Hydrate on mount / user change.
  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Live settlements: toast + refetch. The refetch (not a local append) keeps
  // the inbox authoritative — the WS payload and the stored row are the same
  // event, written by the same seam.
  useEffect(() => {
    if (!userId) return;
    return subscribePredictWs(`portfolio:${userId}`, (_eventId, data) => {
      const notice = settlementNotice(data);
      if (!notice) return;
      toast.success(t(notice.titleKey, notice.params) as string, notice.body);
      void refresh();
    });
  }, [userId, toast, t, refresh]);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const toggle = useCallback(() => {
    setOpen((was) => {
      const now = !was;
      if (now && unread > 0) {
        // Opening the panel IS reading it. Optimistic clear; the server
        // mark-read follows and the next refresh reconciles.
        setUnread(0);
        void markAllNotificationsRead();
      }
      return now;
    });
  }, [unread]);

  const rowTitle = useCallback(
    (n: UserNotification): string => {
      const notice = settlementNotice(n.payload);
      if (notice) return t(notice.titleKey, notice.params) as string;
      return n.title;
    },
    [t],
  );

  return (
    <div ref={wrapRef} className={`relative ${className ?? ""}`}>
      <button
        type="button"
        className={BELL_BUTTON_CLASS}
        onClick={toggle}
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={t("NOTIFICATIONS_LABEL")}
        data-testid="notifications-bell"
      >
        <Bell size={18} aria-hidden="true" />
        {unread > 0 && (
          <span className={BADGE_CLASS} data-testid="notifications-badge">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>
      {open && (
        <div className={PANEL_CLASS} role="menu" data-testid="notifications-panel">
          <div className={PANEL_HEAD_CLASS}>{t("NOTIFICATIONS_LABEL")}</div>
          {items.length === 0 ? (
            <div className={EMPTY_CLASS}>{t("NOTIFICATIONS_EMPTY")}</div>
          ) : (
            items.map((n) => (
              <div key={n.id} className={ROW_CLASS}>
                <div className={ROW_TITLE_CLASS}>{rowTitle(n)}</div>
                {(n.payload?.title || n.body) && (
                  <div className={ROW_BODY_CLASS}>
                    {n.payload?.title || n.body}
                  </div>
                )}
                <div className={ROW_TIME_CLASS}>{noticeTime(n.createdAt)}</div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
