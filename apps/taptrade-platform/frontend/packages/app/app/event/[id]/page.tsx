"use client";

/**
 * /event/[id] — every sibling market of one event, comparable in one
 * place, with a single resolution block and the user's aggregate
 * exposure, beside the persistent Inspector (and the real ticket).
 * Reached from the market page breadcrumb and the ⌘K Events section.
 * The only survivor of the 2026-08 Floor redesign trial, which was
 * retired in favour of /predict + /market/[ticker].
 */

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { createPredictionClient } from "@taptrade-ui/api-client/src/prediction-client";
import type {
  Position,
  PredictionEvent,
  PredictionMarket,
} from "@taptrade-ui/api-client/src/prediction-types";
import { useAuth } from "../../hooks/useAuth";
import { logger } from "../../lib/logger";
import {
  RowMarketV2,
  type RowPosition,
} from "../../components/prediction/RowMarketV2";
import { InspectorPanel } from "../../components/prediction/InspectorPanel";

const api = createPredictionClient();

const EYEBROW_CLASS =
  "font-mono text-[9px] font-semibold uppercase tracking-[0.13em] text-[var(--t3)]";

function formatCloseAt(iso: string): string {
  return new Date(iso)
    .toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
    .toUpperCase();
}

export default function EventWorkspacePage() {
  const params = useParams<{ id: string }>();
  const eventId = params?.id ?? "";
  const { t } = useTranslation("prediction");
  const { isAuthenticated } = useAuth();
  const [event, setEvent] = useState<PredictionEvent | null>(null);
  const [markets, setMarkets] = useState<PredictionMarket[]>([]);
  const [positions, setPositions] = useState<Position[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);

  useEffect(() => {
    if (!eventId) return;
    let cancelled = false;
    setLoading(true);
    Promise.all([
      api.getEvent(eventId),
      api.getMarkets({ eventId, page: 1, pageSize: 50 }),
    ])
      .then(([ev, res]) => {
        if (cancelled) return;
        setEvent(ev);
        const list = res.data || [];
        setMarkets(list);
        setSelectedId((prev) => prev ?? list[0]?.id ?? null);
        setError(null);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [eventId, reloadNonce]);

  const refetchPositions = useCallback(() => {
    if (!isAuthenticated) {
      setPositions([]);
      return;
    }
    api
      .getPositions()
      .then(setPositions)
      .catch((err: unknown) => {
        logger.warn("EventWorkspace", "positions fetch failed", err);
      });
  }, [isAuthenticated]);

  useEffect(() => {
    refetchPositions();
  }, [refetchPositions]);

  const positionByMarket = useMemo(() => {
    const map = new Map<string, RowPosition>();
    for (const p of positions) {
      if (p.quantity > 0) {
        map.set(p.marketId, {
          side: p.side,
          quantity: p.quantity,
          avgPricePoints: p.avgPricePoints,
        });
      }
    }
    return map;
  }, [positions]);

  const myEventPositions = useMemo(
    () =>
      markets
        .map((m) => ({ market: m, pos: positionByMarket.get(m.id) }))
        .filter((x): x is { market: PredictionMarket; pos: RowPosition } =>
          Boolean(x.pos),
        ),
    [markets, positionByMarket],
  );

  const selected = markets.find((m) => m.id === selectedId) ?? null;

  const handleMarketUpdate = useCallback(
    (updated: PredictionMarket) => {
      setMarkets((prev) =>
        prev.map((m) => (m.id === updated.id ? { ...m, ...updated } : m)),
      );
      refetchPositions();
    },
    [refetchPositions],
  );

  return (
    <div className="mx-auto grid w-full max-w-[1920px] grid-cols-[minmax(0,1fr)_340px] items-start bg-[var(--bg-deep)] max-[1179px]:grid-cols-1">
      <main className="min-w-0 px-6 py-5 max-[760px]:px-4">
        <Link
          href="/predict"
          className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--t3)] no-underline hover:text-[var(--t1)]"
        >
          ← {t("BACK_TO_MARKETS")}
        </Link>

        {loading ? (
          <div className="mt-4 flex flex-col gap-2">
            {Array.from({ length: 4 }, (_, i) => (
              <div
                key={i}
                className="h-[62px] animate-[shimmer_1.5s_infinite] rounded-[8px] bg-[linear-gradient(90deg,var(--surface-2)_25%,var(--border-1)_50%,var(--surface-2)_75%)] bg-[length:200%_100%]"
                aria-hidden="true"
              />
            ))}
          </div>
        ) : error ? (
          <div
            role="alert"
            className="mt-4 rounded-[8px] border border-[var(--border-1)] border-l-[3px] border-l-[var(--no)] bg-[var(--surface-1)] px-4 py-3"
          >
            <p className="m-0 text-[13px] font-semibold text-[var(--t1)]">
              {t("COULD_NOT_LOAD_MARKETS")}
            </p>
            <p className="mb-0 mt-1 text-[12px] text-[var(--t2)]">{error}</p>
            <button
              type="button"
              onClick={() => setReloadNonce((n) => n + 1)}
              className="mt-2.5 inline-flex min-h-9 cursor-pointer items-center rounded-[6px] border border-[var(--border-2)] bg-[var(--surface-1)] px-3.5 text-[12px] font-semibold text-[var(--t1)]"
            >
              {t("RETRY", "Retry")}
            </button>
          </div>
        ) : event ? (
          <>
            <header className="mt-3 rounded-[8px] border border-[var(--border-1)] bg-[var(--surface-1)] px-4 py-3.5">
              <span className={EYEBROW_CLASS}>
                {t("FLOOR_EVENT", "Event")} · {event.status.toUpperCase()}
              </span>
              <h1 className="m-0 mt-1 text-[20px] font-semibold leading-[1.25] tracking-[-0.01em] text-[var(--t1)]">
                {event.title}
              </h1>
              <p className="m-0 mt-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--t3)]">
                {t("MOMENT_MARKETS_COUNT", { count: markets.length })} ·{" "}
                {t("CLOSES")} {formatCloseAt(event.closeAt)}
              </p>
              {event.description && (
                <p className="mb-0 mt-2.5 max-w-[640px] text-[12px] leading-[1.55] text-[var(--t2)]">
                  {event.description}
                </p>
              )}
            </header>

            {myEventPositions.length > 0 && (
              <div className="mt-3 flex flex-wrap items-baseline gap-x-4 gap-y-1 rounded-[8px] bg-[var(--accent-soft)] px-4 py-2.5">
                <span className={EYEBROW_CLASS}>
                  {t("FLOOR_EVENT_EXPOSURE", "My exposure in this event")}
                </span>
                {myEventPositions.map(({ market, pos }) => (
                  <span
                    key={market.id}
                    className="font-mono text-[10.5px] font-semibold text-[var(--accent-text)] tabular-nums"
                  >
                    {pos.quantity} {pos.side === "yes" ? t("YES") : t("NO")} @{" "}
                    {pos.avgPricePoints}¢ · {market.ticker}
                  </span>
                ))}
              </div>
            )}

            <div className="mt-4 flex flex-col gap-2">
              <span className={EYEBROW_CLASS}>
                {t("FLOOR_EVENT_MARKETS", "Markets — one question-space, comparable")}
              </span>
              {markets.length === 0 ? (
                <div className="rounded-[8px] border border-dashed border-[var(--border-2)] bg-[var(--surface-1)] px-4 py-6 text-center">
                  <p className="m-0 text-[13px] font-semibold text-[var(--t1)]">
                    {t("NO_OPEN_MARKETS")}
                  </p>
                </div>
              ) : (
                markets.map((m) => (
                  <RowMarketV2
                    key={m.id}
                    market={m}
                    position={positionByMarket.get(m.id)}
                    selected={selectedId === m.id}
                    onSelect={() => setSelectedId(m.id)}
                  />
                ))
              )}
            </div>
          </>
        ) : null}
      </main>

      {/* Rule on the full-height grid cell; sticky panel inside it. A
          sticky child paints only its own 100vh, so the border used to
          stop mid-page once the ramp made it visible. */}
      <div className="h-full border-l border-[var(--border-1)] max-[1179px]:hidden">
        <aside
          aria-label={t("FLOOR_INSPECTOR", "Inspector")}
          className="terminal-scrollbar sticky top-16 h-[calc(100vh-64px)] overflow-y-auto p-4"
        >
        <InspectorPanel
          market={selected}
          position={selected ? positionByMarket.get(selected.id) : undefined}
          openPositions={positionByMarket.size}
          onMarketUpdate={handleMarketUpdate}
        />
        </aside>
      </div>

      {selected && (
        <div className="fixed inset-x-0 bottom-0 z-[90] hidden max-h-[70vh] overflow-y-auto rounded-t-[14px] border-t border-[var(--border-1)] bg-[var(--surface-1)] p-4 pb-6 shadow-[var(--shadow-pop)] max-[1179px]:block">
          <button
            type="button"
            onClick={() => setSelectedId(null)}
            aria-label={t("CLOSE", "Close")}
            className="mx-auto mb-3 block h-1.5 w-10 cursor-pointer rounded-full border-0 bg-[var(--border-2)] p-0"
          />
          <InspectorPanel
            market={selected}
            position={positionByMarket.get(selected.id)}
            openPositions={positionByMarket.size}
            onMarketUpdate={handleMarketUpdate}
          />
        </div>
      )}
    </div>
  );
}
