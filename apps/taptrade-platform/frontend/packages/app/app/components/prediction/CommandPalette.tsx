"use client";

/**
 * CommandPalette — the ⌘K command surface: one overlay absorbing search
 * and navigation. Sections: Markets (ranked by the shared searchMarkets
 * scorer over live open markets, opening the market detail page), Events
 * (derived from the same data, opening the event page), and Actions (the
 * TopBar's primary destinations, filtered by the same auth rule).
 */

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { createPredictionClient } from "@taptrade-ui/api-client/src/prediction-client";
import type { PredictionMarket } from "@taptrade-ui/api-client/src/prediction-types";
import { useAuth } from "../../hooks/useAuth";
import { logger } from "../../lib/logger";
import { searchMarkets } from "../../lib/marketSearch";
import { localizedMarket } from "./market-content";

const api = createPredictionClient();

interface Entry {
  id: string;
  kind: "market" | "event" | "action";
  label: string;
  meta: string;
  href: string;
}

const EYEBROW_CLASS =
  "font-mono text-[8.5px] font-semibold uppercase tracking-[0.13em] text-[var(--t3)]";

export function CommandPalette({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation("prediction");
  const { t: contentT } = useTranslation("market-content");
  const { t: navT } = useTranslation("header");
  const { isAuthenticated } = useAuth();
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [markets, setMarkets] = useState<PredictionMarket[]>([]);
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setCursor(0);
    const focusT = setTimeout(() => inputRef.current?.focus(), 30);
    if (markets.length === 0) {
      api
        .getMarkets({ status: "open", pageSize: 100 })
        .then((res) => setMarkets(res.data || []))
        .catch((err: unknown) => {
          logger.warn("CommandPalette", "market index fetch failed", err);
        });
    }
    return () => clearTimeout(focusT);
  }, [open, markets.length]);

  const entries = useMemo<Entry[]>(() => {
    const q = query.trim();
    const goLabel = t("CMDK_GO", "Go to");
    const allActions: (Entry & { requiresAuth?: boolean })[] = [
      { id: "a-markets", kind: "action", label: navT("NAV_MARKETS"), meta: goLabel, href: "/predict" },
      { id: "a-trending", kind: "action", label: navT("NAV_TRENDING"), meta: goLabel, href: "/discover" },
      { id: "a-portfolio", kind: "action", label: navT("NAV_PORTFOLIO"), meta: goLabel, href: "/portfolio", requiresAuth: true },
      { id: "a-leaderboards", kind: "action", label: navT("NAV_LEADERBOARDS"), meta: goLabel, href: "/leaderboards", requiresAuth: true },
      { id: "a-rewards", kind: "action", label: navT("NAV_REWARDS"), meta: goLabel, href: "/rewards", requiresAuth: true },
    ];
    const actions = allActions.filter(
      (a) =>
        (!a.requiresAuth || isAuthenticated) &&
        (!q || a.label.toLowerCase().includes(q.toLowerCase())),
    );
    const localized = markets.map((m) => localizedMarket(contentT, m));
    const hits = q ? searchMarkets(localized, q, 6) : localized.slice(0, 5);
    const marketEntries: Entry[] = hits.map((m) => ({
      id: `m-${m.id}`,
      kind: "market",
      label: m.title,
      meta: `${m.yesPricePoints}¢ · ${m.eventTitle || m.ticker}`,
      href: `/market/${m.ticker}`,
    }));
    const seen = new Set<string>();
    const eventEntries: Entry[] = [];
    for (const m of q ? localized : []) {
      if (!m.eventId || !m.eventTitle || seen.has(m.eventId)) continue;
      if (!m.eventTitle.toLowerCase().includes(q.toLowerCase())) continue;
      seen.add(m.eventId);
      eventEntries.push({
        id: `e-${m.eventId}`,
        kind: "event",
        label: m.eventTitle,
        meta: t("FLOOR_EVENT", "Event"),
        href: `/event/${m.eventId}`,
      });
      if (eventEntries.length >= 3) break;
    }
    return [...marketEntries, ...eventEntries, ...actions];
  }, [query, markets, contentT, t, navT, isAuthenticated]);

  useEffect(() => {
    setCursor(0);
  }, [entries.length]);

  const go = useCallback(
    (entry: Entry) => {
      onClose();
      router.push(entry.href);
    },
    [onClose, router],
  );

  const onKey = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setCursor((c) => Math.min(c + 1, entries.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setCursor((c) => Math.max(c - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        const hit = entries[cursor] ?? entries[0];
        if (hit) go(hit);
      }
    },
    [entries, cursor, go, onClose],
  );

  if (!open) return null;

  let lastKind: Entry["kind"] | null = null;

  return (
    <div
      className="fixed inset-0 z-[200] flex items-start justify-center bg-[color-mix(in_srgb,var(--ink)_35%,transparent)] px-4 pt-[12vh]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label={t("CMDK_TITLE", "Command palette")}
    >
      <div className="w-full max-w-[560px] overflow-hidden rounded-[10px] border border-[var(--border-1)] bg-[var(--surface-1)] shadow-[var(--shadow-pop)]">
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKey}
          placeholder={t("CMDK_PLACEHOLDER", "Search markets, events, actions…")}
          aria-label={t("CMDK_TITLE", "Command palette")}
          className="h-[46px] w-full border-b border-[var(--border-1)] bg-transparent px-4 font-mono text-[13px] text-[var(--t1)] outline-none placeholder:text-[var(--t3)]"
        />
        <ul className="terminal-scrollbar m-0 max-h-[340px] list-none overflow-y-auto p-1.5">
          {entries.length === 0 ? (
            <li className="px-3 py-4 text-center font-mono text-[11px] text-[var(--t3)]">
              {t("CMDK_EMPTY", "No matches")}
            </li>
          ) : (
            entries.map((entry, i) => {
              const showHead = entry.kind !== lastKind;
              lastKind = entry.kind;
              const active = i === cursor;
              return (
                <li key={entry.id}>
                  {showHead && (
                    <div className={`${EYEBROW_CLASS} px-2.5 pb-1 pt-2`}>
                      {entry.kind === "market"
                        ? t("CMDK_MARKETS", "Markets")
                        : entry.kind === "event"
                          ? t("CMDK_EVENTS", "Events")
                          : t("CMDK_ACTIONS", "Actions")}
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => go(entry)}
                    onMouseEnter={() => setCursor(i)}
                    className={`flex w-full cursor-pointer items-center justify-between gap-3 rounded-[6px] border-0 px-2.5 py-2 text-left ${
                      active ? "bg-[var(--accent-soft)]" : "bg-transparent"
                    }`}
                  >
                    <span className="line-clamp-1 text-[12.5px] font-semibold text-[var(--t1)]">
                      {entry.label}
                    </span>
                    <span className="flex-none font-mono text-[9.5px] font-semibold uppercase tracking-[0.08em] text-[var(--t3)] tabular-nums">
                      {entry.meta}
                    </span>
                  </button>
                </li>
              );
            })
          )}
        </ul>
      </div>
    </div>
  );
}
