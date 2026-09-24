"use client";

import { useEffect, useState } from "react";
import { MessageCircle, X } from "lucide-react";
import { FEATURE_CHAT } from "../../lib/features";

const STORAGE_KEY = "taptrade_chat_collapsed";

const chatClasses = {
  statusRow:
    "flex min-h-[58px] items-center justify-between gap-2.5 border-b border-[var(--border-1)] bg-[var(--surface-1)] px-4 py-3",
  statusCopy: "flex min-w-0 flex-col gap-0.5",
  statusTitle:
    "text-[12px] font-semibold leading-none tracking-[-0.01em] text-[var(--t1)]",
  statusSub:
    "text-[12px] font-medium text-[var(--t3)]",
  // Floating FAB (fixed corner) — --shadow-pop is for floating layers.
  mobileButton:
    "fixed right-[18px] bottom-[calc(92px+env(safe-area-inset-bottom))] z-[95] inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-[var(--r-rh-md)] border-0 bg-[var(--accent)] px-3.5 text-[13px] font-semibold text-[var(--ticket-cta-text)] shadow-[var(--shadow-pop)] transition-[background-color,box-shadow,transform] duration-150 hover:bg-[color-mix(in_srgb,var(--accent)_86%,var(--surface-1))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-1)] active:translate-y-px",
  mobileOverlay:
    "fixed inset-0 z-[120] flex items-end justify-stretch bg-[color-mix(in_srgb,var(--ink)_28%,transparent)] px-2.5 pt-0 pb-[max(10px,env(safe-area-inset-bottom))]",
  mobileSheet:
    "chat-mobile-sheet flex h-[min(78vh,680px)] min-h-[420px] w-full flex-col overflow-hidden rounded-[var(--r-rh-xl)] border border-[var(--border-1)] bg-[var(--surface-2)] shadow-[var(--shadow-pop)]",
  mobileHeader:
    "flex min-h-12 items-center justify-between gap-3 border-b border-[var(--border-1)] bg-[var(--surface-1)] py-0 pr-3 pl-3.5",
  mobileTitle:
    "flex min-w-0 items-center gap-2 text-[13px] font-extrabold text-[var(--t1)]",
  // Shared by the mobile sheet header and the desktop status row. Ink on
  // hover/focus, no shadow at rest.
  closeButton:
    "grid h-[34px] w-[34px] shrink-0 cursor-pointer place-items-center rounded-[var(--r-rh-sm)] border-0 bg-[var(--surface-2)] text-[var(--t2)] transition-[background-color,color] hover:bg-[var(--accent-soft)] hover:text-[var(--accent-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-1)] active:bg-[var(--accent-soft)]",
  // Resting card — no shadow (DESIGN.md §5: elevation is none at rest).
  sidebarBase:
    "sticky top-[82px] left-0 z-[70] flex h-[calc(100vh-104px)] flex-col overflow-hidden rounded-[var(--r-rh-lg)] border border-[var(--border-1)] bg-[var(--surface-1)] max-[1099px]:hidden",
  sidebarOpen: "w-[280px] min-w-[280px]",
  sidebarCollapsed: "w-[52px] min-w-[52px]",
  railButton:
    "inline-flex h-full w-full cursor-pointer flex-col items-center justify-start gap-2 border-0 bg-[var(--surface-1)] pt-3.5 text-xs font-semibold text-[var(--t2)]",
  railIcon:
    "h-7 w-7 rounded-[var(--r-rh-md)] bg-[var(--accent)] p-1.5 text-[var(--ticket-cta-text)]",
  state:
    "relative grid flex-1 place-items-center bg-[var(--surface-1)] p-3.5 text-center text-xs font-medium text-[var(--t3)]",
};

export function ChatSidebar() {
  const [isDesktop, setIsDesktop] = useState(false);
  const [collapsed, setCollapsed] = useState(true);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(min-width: 1100px)");
    const sync = () => setIsDesktop(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setCollapsed(localStorage.getItem(STORAGE_KEY) !== "false");
  }, []);

  const persistCollapsed = (next: boolean) => {
    setCollapsed(next);
    if (typeof window !== "undefined") {
      localStorage.setItem(STORAGE_KEY, String(next));
    }
  };

  useEffect(() => {
    if (isDesktop) setMobileOpen(false);
  }, [isDesktop]);

  if (!FEATURE_CHAT) return null;

  // No chat transport exists yet: the gateway serves no /api/v1/chat/*
  // routes, so there is no room to read from or post to. The panel says so
  // instead of seeding a feed or claiming liveness (DESIGN.md §2 rule 5:
  // honest data or no data).
  const renderChatPanel = (showStatus = true) => (
    <>
      {showStatus && (
        <div className={chatClasses.statusRow}>
          <div className={chatClasses.statusCopy}>
            <span className={chatClasses.statusTitle}>Community chat</span>
            <span className={chatClasses.statusSub}>Market discussion</span>
          </div>
          <button
            className={chatClasses.closeButton}
            type="button"
            aria-label="Close chat"
            onClick={() => persistCollapsed(true)}
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>
      )}
      <div className={chatClasses.state} role="status">
        Chat isn&apos;t connected yet.
      </div>
    </>
  );

  if (!isDesktop) {
    return (
      <>
        {!mobileOpen && (
          <button
            className={chatClasses.mobileButton}
            type="button"
            aria-label="Open chat"
            onClick={() => setMobileOpen(true)}
          >
            <MessageCircle size={20} aria-hidden="true" />
            <span>Chat</span>
          </button>
        )}
        {mobileOpen && (
          <div className={chatClasses.mobileOverlay}>
            <section
              className={chatClasses.mobileSheet}
              role="dialog"
              aria-modal="true"
              aria-label="Community chat"
            >
              <div className={chatClasses.mobileHeader}>
                <div className={chatClasses.mobileTitle}>
                  <span>Community chat</span>
                </div>
                <button
                  className={chatClasses.closeButton}
                  type="button"
                  aria-label="Close chat"
                  onClick={() => setMobileOpen(false)}
                >
                  <X size={18} aria-hidden="true" />
                </button>
              </div>
              {renderChatPanel(false)}
            </section>
          </div>
        )}
      </>
    );
  }

  // Collapsed: a floating pill (mirrors the mobile FAB) instead of a
  // full-height empty rail — the old 52px sticky column read as a broken
  // layout artifact and wasted a content column.
  if (collapsed) {
    return (
      <button
        className="fixed bottom-6 right-6 z-[70] inline-flex h-12 cursor-pointer items-center gap-2 rounded-[var(--r-pill)] border border-[var(--border-1)] bg-[var(--surface-1)] pl-3 pr-4 text-[13px] font-semibold text-[var(--t1)] shadow-[var(--shadow-pop)] transition-[transform,border-color] duration-150 ease-out hover:-translate-y-0.5 hover:border-[var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-1)] active:translate-y-0 max-[1099px]:hidden"
        type="button"
        aria-label="Open chat"
        onClick={() => persistCollapsed(false)}
      >
        <MessageCircle
          size={20}
          className={chatClasses.railIcon}
          aria-hidden="true"
        />
        <span>Chat</span>
      </button>
    );
  }

  return (
    <aside className={`${chatClasses.sidebarBase} ${chatClasses.sidebarOpen}`}>
      {renderChatPanel()}
    </aside>
  );
}
