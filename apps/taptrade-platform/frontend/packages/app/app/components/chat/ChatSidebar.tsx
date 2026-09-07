"use client";

import type { FormEvent } from "react";
import { useEffect, useState } from "react";
import { Flag, MessageCircle, X } from "lucide-react";
import { FEATURE_CHAT } from "../../lib/features";
import { reportChatMessage } from "../../lib/api/chat-client";
import { useAuth } from "../../hooks/useAuth";
import { logger } from "../../lib/logger";

const STORAGE_KEY = "taptrade_chat_collapsed";
const DEFAULT_ROOM_ID = "general";

type LoadState = "idle" | "loading" | "ready" | "unavailable";
type ChatMessage = {
  username: string;
  timestamp: string;
  content: string;
};

const MOCK_CHAT_MESSAGES: ChatMessage[] = [
  {
    username: "marketmaker23",
    timestamp: "now",
    content: "MLBB finals map-one YES moved to 63 after roster news.",
  },
  {
    username: "marketwatcher",
    timestamp: "1m",
    content: "Valorant underdog NO moved to 41 after scrim notes.",
  },
  {
    username: "island_alpha",
    timestamp: "3m",
    content: "Local festival rain market moved after the weather update.",
  },
  {
    username: "pricewatcher",
    timestamp: "4m",
    content: "Dota finals map-three YES ticked up with deeper NO liquidity.",
  },
  {
    username: "macro_mina",
    timestamp: "6m",
    content: "Fed cut by September is holding near 48c.",
  },
  {
    username: "researchdesk",
    timestamp: "7m",
    content: "Someone swept YES side on the grand prix safety-car market.",
  },
  {
    username: "chalk_eater",
    timestamp: "9m",
    content: "Election turnout is moving faster than the polls.",
  },
  {
    username: "signal_hunter",
    timestamp: "11m",
    content: "NBA MVP spread widened after the injury report.",
  },
  {
    username: "quant_kai",
    timestamp: "13m",
    content: "Creator award finalist stayed above 70 into close.",
  },
  {
    username: "weather_sam",
    timestamp: "15m",
    content: "Rain probability jumped on the grand prix market.",
  },
  {
    username: "creator_lani",
    timestamp: "18m",
    content: "Debate viewership over 50M has a clean source path.",
  },
  {
    username: "vol_trader",
    timestamp: "21m",
    content: "One review batch could move the Metacritic market.",
  },
  {
    username: "risk_check",
    timestamp: "24m",
    content: "Thin markets can gap hard. Size accordingly.",
  },
  {
    username: "mod_malia",
    timestamp: "27m",
    content: "Keep it to market discussion and verified sources.",
  },
];

const chatClasses = {
  statusRow:
    "flex min-h-[58px] items-center gap-2.5 border-b border-[var(--border-1)] bg-[var(--surface-1)] px-4 py-3",
  statusCopy: "flex min-w-0 flex-col gap-0.5",
  statusTitle:
    "text-[12px] font-semibold leading-none tracking-[-0.01em] text-[var(--t1)]",
  statusSub:
    "text-[10px] font-medium uppercase tracking-[0.12em] text-[var(--t3)]",
  onlineDot:
    "h-2 w-2 shrink-0 rounded-full bg-[var(--live)] shadow-[0_0_9px_var(--live-soft)]",
  reportToggle:
    "inline-flex min-h-10 cursor-pointer items-center justify-center gap-2 border-0 border-t border-[var(--border-1)] bg-[var(--surface-1)] text-xs font-semibold text-[var(--t2)] transition-[background-color,color] hover:bg-[var(--accent-soft)] hover:text-[var(--accent-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] focus-visible:ring-inset active:bg-[var(--brand-lavender)]",
  mobileButton:
    "fixed right-[18px] bottom-[calc(92px+env(safe-area-inset-bottom))] z-[95] inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-[var(--r-rh-md)] border-0 bg-[var(--accent)] px-3.5 text-[13px] font-semibold text-[var(--on-brand)] shadow-[var(--shadow-pop)] transition-[background-color,box-shadow,transform] duration-150 hover:bg-[var(--brand-dark)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-1)] active:translate-y-px",
  mobileOverlay:
    "fixed inset-0 z-[120] flex items-end justify-stretch bg-[color-mix(in_srgb,var(--ink)_28%,transparent)] px-2.5 pt-0 pb-[max(10px,env(safe-area-inset-bottom))]",
  mobileSheet:
    "chat-mobile-sheet flex h-[min(78vh,680px)] min-h-[420px] w-full flex-col overflow-hidden rounded-2xl border border-[var(--border-1)] bg-[var(--surface-2)] shadow-[var(--shadow-pop)]",
  mobileHeader:
    "flex min-h-12 items-center justify-between gap-3 border-b border-[var(--border-1)] bg-[var(--surface-1)] py-0 pr-3 pl-3.5",
  mobileTitle:
    "flex min-w-0 items-center gap-2 text-[13px] font-extrabold text-[var(--t1)]",
  mobileClose:
    "grid h-[34px] w-[34px] cursor-pointer place-items-center rounded-[var(--r-rh-sm)] border-0 bg-[var(--surface-2)] text-[var(--t2)] transition-[background-color,color] hover:bg-[var(--accent-soft)] hover:text-[var(--accent-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-1)] active:bg-[var(--brand-lavender)]",
  sidebarBase:
    "sticky top-[82px] left-0 z-[70] flex h-[calc(100vh-104px)] flex-col overflow-hidden rounded-[var(--r-rh-lg)] border border-[var(--border-1)] bg-[var(--surface-1)] shadow-[var(--shadow-card)] max-[1099px]:hidden",
  sidebarOpen: "w-[280px] min-w-[280px]",
  sidebarCollapsed: "w-[52px] min-w-[52px]",
  railButton:
    "inline-flex h-full w-full cursor-pointer flex-col items-center justify-start gap-2 border-0 bg-[var(--surface-1)] pt-3.5 text-xs font-semibold text-[var(--t2)]",
  railIcon:
    "h-7 w-7 rounded-lg bg-[var(--accent)] p-1.5 text-[var(--on-brand)]",
  reportForm:
    "grid gap-2 border-t border-[var(--border-1)] bg-[var(--surface-2)] p-3",
  reportRow: "flex items-center justify-between gap-2",
  reportClose:
    "grid h-7 w-7 cursor-pointer place-items-center rounded-[var(--r-rh-sm)] border-0 bg-[var(--surface-1)] text-[var(--t3)] transition-[background-color,color] hover:bg-[var(--accent-soft)] hover:text-[var(--accent-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-2)] active:bg-[var(--brand-lavender)]",
  reportLabel: "text-[11px] font-bold text-[var(--t2)]",
  reportInput:
    "w-full rounded-[var(--r-rh-sm)] border border-[var(--border-1)] bg-[var(--surface-1)] px-2.5 text-xs text-[var(--t1)] font-[inherit] outline-none transition-[border-color,box-shadow] focus-visible:border-[var(--accent)] focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-2)]",
  reportTextArea:
    "min-h-[72px] w-full resize-y rounded-[var(--r-rh-sm)] border border-[var(--border-1)] bg-[var(--surface-1)] px-2.5 py-2 text-xs text-[var(--t1)] font-[inherit] outline-none transition-[border-color,box-shadow] focus-visible:border-[var(--accent)] focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-2)]",
  reportSubmit:
    "min-h-9 cursor-pointer rounded-[var(--r-rh-md)] border-0 bg-[var(--accent)] text-xs font-extrabold text-[var(--on-brand)] transition-[background-color,transform] hover:bg-[var(--brand-dark)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-2)] active:translate-y-px disabled:cursor-not-allowed disabled:bg-[var(--inert-fill)] disabled:text-[var(--inert-label)] disabled:opacity-100",
  reportStatus: "text-xs font-bold text-[var(--t2)]",
  reportError: "text-[var(--brand-dark)]",
  state:
    "relative grid flex-1 place-items-center bg-[var(--surface-1)] p-3.5 text-center text-xs font-medium text-[var(--t3)]",
  stream: "flex min-h-0 flex-1 flex-col gap-3 bg-[var(--surface-1)] p-3",
  messageList:
    "flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto pr-1 [scrollbar-color:var(--border-2)_transparent] [scrollbar-width:thin]",
  message:
    "rounded-[var(--r-rh-md)] border border-[var(--border-1)] bg-[var(--surface-2)] px-3 py-2.5",
  messageMeta:
    "mb-1.5 flex items-center justify-between gap-2 text-[10px] font-medium text-[var(--t3)]",
  messageUser:
    "min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-[var(--t3)]",
  messageTime: "shrink-0 text-[var(--t3)] opacity-75",
  messageText:
    "m-0 overflow-hidden text-[12px] font-normal leading-[1.45] text-[var(--t1)] [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:3]",
  readonlyComposer:
    "shrink-0 rounded-[var(--r-rh-md)] border border-[var(--border-1)] bg-[var(--surface-2)] p-3 shadow-[var(--shadow-card)]",
  readonlyComposerTitle:
    "m-0 text-[12px] font-semibold leading-tight text-[var(--t1)]",
  readonlyComposerCopy:
    "mt-1 mb-2.5 text-[11px] leading-[1.35] text-[var(--t3)]",
  readonlyComposerButton:
    "inline-flex min-h-8 items-center justify-center rounded-md bg-[var(--accent)] px-3 text-xs font-semibold text-[var(--on-brand)] no-underline transition-[background-color,transform] hover:bg-[var(--brand-dark)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-2)] active:translate-y-px",
  composer:
    "grid shrink-0 grid-cols-[1fr_auto] gap-2 rounded-[var(--r-rh-md)] border border-[var(--border-1)] bg-[var(--surface-2)] p-1.5 shadow-[var(--shadow-card)]",
  composerInput:
    "h-8 min-w-0 rounded-[var(--r-rh-sm)] border-0 bg-transparent px-1 text-xs font-medium text-[var(--t1)] outline-none placeholder:text-[var(--t3)] focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]",
  composerButton:
    "h-8 rounded-md border-0 bg-[var(--accent)] px-3 text-xs font-semibold text-[var(--on-brand)] transition-[background-color,transform] hover:bg-[var(--brand-dark)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-2)] active:translate-y-px disabled:cursor-not-allowed disabled:bg-[var(--inert-fill)] disabled:text-[var(--inert-label)] disabled:opacity-100",
};

export function ChatSidebar() {
  const { isAuthenticated, isLoading, user } = useAuth();
  const [isDesktop, setIsDesktop] = useState(false);
  const [collapsed, setCollapsed] = useState(true);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [state, setState] = useState<LoadState>("idle");
  const [roomId, setRoomId] = useState(DEFAULT_ROOM_ID);
  const [messages, setMessages] = useState<ChatMessage[]>(MOCK_CHAT_MESSAGES);
  const [message, setMessage] = useState("");
  const [reportOpen, setReportOpen] = useState(false);
  const [reportEnabled, setReportEnabled] = useState(false);

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
    const shouldPrepareChat = isDesktop ? !collapsed : mobileOpen;
    if (!FEATURE_CHAT || !shouldPrepareChat || isLoading) return;
    setRoomId(DEFAULT_ROOM_ID);
    setMessage("");
    setReportEnabled(isAuthenticated);
    setState("ready");
  }, [collapsed, isAuthenticated, isDesktop, isLoading, mobileOpen]);

  useEffect(() => {
    if (isDesktop) setMobileOpen(false);
  }, [isDesktop]);

  const handleSendMessage = (content: string) => {
    const trimmed = content.trim();
    if (!trimmed || !isAuthenticated) return;
    setMessages((current) => [
      {
        username: user?.username || "you",
        timestamp: "now",
        content: trimmed,
      },
      ...current,
    ]);
  };

  if (!FEATURE_CHAT) return null;

  const renderChatPanel = (showStatus = true) => (
    <>
      {showStatus && (
        <div className={chatClasses.statusRow}>
          <span className={chatClasses.onlineDot} aria-hidden="true" />
          <div className={chatClasses.statusCopy}>
            <span className={chatClasses.statusTitle}>Live activity</span>
            <span className={chatClasses.statusSub}>Market chatter</span>
          </div>
        </div>
      )}
      <ChatFrame
        state={state}
        message={message}
        messages={messages}
        readOnly={!isAuthenticated}
        onSend={handleSendMessage}
      />
      {isAuthenticated && reportEnabled && (
        <>
          <button
            className={chatClasses.reportToggle}
            type="button"
            onClick={() => setReportOpen((open) => !open)}
          >
            <Flag size={15} aria-hidden="true" />
            Report message
          </button>
          {reportOpen && (
            <ChatReportForm
              roomId={roomId}
              onClose={() => setReportOpen(false)}
            />
          )}
        </>
      )}
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
                  <span className={chatClasses.onlineDot} aria-hidden="true" />
                  <span>Live activity</span>
                </div>
                <button
                  className={chatClasses.mobileClose}
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
        className="fixed bottom-6 right-6 z-[70] inline-flex h-12 cursor-pointer items-center gap-2 rounded-[var(--r-pill)] border border-[var(--border-1)] bg-[var(--surface-1)] pl-3 pr-4 text-[13px] font-semibold text-[var(--t1)] shadow-[var(--shadow-card)] transition-[transform,box-shadow,border-color] duration-150 ease-out hover:-translate-y-0.5 hover:border-[var(--accent)] hover:shadow-[var(--shadow-card-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-1)] active:translate-y-0 max-[1099px]:hidden"
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

function ChatReportForm({
  roomId,
  onClose,
}: {
  roomId: string;
  onClose: () => void;
}) {
  const [messageId, setMessageId] = useState("");
  const [reason, setReason] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">(
    "idle",
  );

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!messageId.trim() || !reason.trim()) return;
    setStatus("saving");
    try {
      await reportChatMessage({
        roomId,
        messageId: messageId.trim(),
        reason: reason.trim(),
      });
      setStatus("saved");
      setMessageId("");
      setReason("");
    } catch (err) {
      logger.warn("Chat", "chat report failed", err);
      setStatus("error");
    }
  };

  return (
    <form className={chatClasses.reportForm} onSubmit={submit}>
      <div className={chatClasses.reportRow}>
        <label
          className={chatClasses.reportLabel}
          htmlFor="chat-report-message"
        >
          Message ID or link
        </label>
        <button
          className={chatClasses.reportClose}
          type="button"
          onClick={onClose}
          aria-label="Close report form"
        >
          <X size={14} aria-hidden="true" />
        </button>
      </div>
      <input
        id="chat-report-message"
        className={`${chatClasses.reportInput} h-[34px]`}
        value={messageId}
        onChange={(event) => setMessageId(event.target.value)}
        autoComplete="off"
        maxLength={255}
      />
      <label className={chatClasses.reportLabel} htmlFor="chat-report-reason">
        Reason
      </label>
      <textarea
        id="chat-report-reason"
        className={chatClasses.reportTextArea}
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        maxLength={1000}
        rows={3}
      />
      <button
        className={chatClasses.reportSubmit}
        type="submit"
        disabled={status === "saving" || !messageId.trim() || !reason.trim()}
      >
        {status === "saving" ? "Submitting..." : "Submit report"}
      </button>
      {status === "saved" && (
        <div className={chatClasses.reportStatus}>Report submitted</div>
      )}
      {status === "error" && (
        <div
          className={`${chatClasses.reportStatus} ${chatClasses.reportError}`}
        >
          Report unavailable
        </div>
      )}
    </form>
  );
}

function ChatFrame({
  state,
  message,
  messages,
  readOnly,
  onSend,
}: {
  state: LoadState;
  message: string;
  messages: ChatMessage[];
  readOnly: boolean;
  onSend: (message: string) => void;
}) {
  if (state === "loading" || state === "idle") {
    return <div className={chatClasses.state}>Loading chat...</div>;
  }

  if (state === "unavailable") {
    return (
      <div className={chatClasses.state}>{message || "Chat unavailable"}</div>
    );
  }

  return (
    <NativeChatStream messages={messages} readOnly={readOnly} onSend={onSend} />
  );
}

function NativeChatStream({
  messages,
  readOnly,
  onSend,
}: {
  messages: ChatMessage[];
  readOnly: boolean;
  onSend: (message: string) => void;
}) {
  const [draft, setDraft] = useState("");

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (readOnly || !draft.trim()) return;
    onSend(draft);
    setDraft("");
  };

  return (
    <div className={chatClasses.stream} role="log" aria-label="Community chat">
      <div className={chatClasses.messageList}>
        {messages.map((chatMessage) => (
          <article
            className={chatClasses.message}
            key={`${chatMessage.username}-${chatMessage.timestamp}-${chatMessage.content}`}
          >
            <div className={chatClasses.messageMeta}>
              <span className={chatClasses.messageUser}>
                {chatMessage.username}
              </span>
              <time className={chatClasses.messageTime}>
                {chatMessage.timestamp}
              </time>
            </div>
            <p className={chatClasses.messageText}>{chatMessage.content}</p>
          </article>
        ))}
      </div>
      {readOnly ? (
        <div className={chatClasses.readonlyComposer}>
          <p className={chatClasses.readonlyComposerTitle}>
            Log in to join the chat
          </p>
          <p className={chatClasses.readonlyComposerCopy}>
            Follow the live read without crowding the market view.
          </p>
          <a className={chatClasses.readonlyComposerButton} href="/auth/login">
            Log in
          </a>
        </div>
      ) : (
        <form className={chatClasses.composer} onSubmit={submit}>
          <input
            aria-label="Chat message"
            className={chatClasses.composerInput}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Message community"
            maxLength={500}
          />
          <button
            className={chatClasses.composerButton}
            type="submit"
            disabled={!draft.trim()}
          >
            Send
          </button>
        </form>
      )}
    </div>
  );
}
