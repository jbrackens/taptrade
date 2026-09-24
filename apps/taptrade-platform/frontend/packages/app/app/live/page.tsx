"use client";

import { Activity, Radio, RotateCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../components/ui";
import {
  getLiveMarkets,
  type LiveMarketEvent,
  type LiveProviderStatus,
} from "../lib/api/live-markets-client";
import { FEATURE_LIVE_MARKETS } from "../lib/features";

const ROUTE_LOADING_CLASS = "p-20 text-center text-[13px] text-[var(--t3)]";
// No resting shadow anywhere (DESIGN.md §5) — hairline only.
const NEUTRAL_SURFACE_CLASS =
  "border border-[var(--border-1)] bg-[var(--surface-1)]";
const STATE_CARD_CLASS = `${NEUTRAL_SURFACE_CLASS} mx-auto my-[60px] max-w-[560px] rounded-[var(--r-rh-lg)] p-14 text-center`;
const HEADER_CLASS = "mb-6 flex flex-wrap items-end justify-between gap-4";
// The only pink on this page: the live eyebrow label.
const EYEBROW_CLASS =
  "mt-0 mb-1.5 inline-flex items-center gap-2 font-mono text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[var(--live-text)]";
const TITLE_CLASS = "type-poster mt-0 mb-2 text-[32px] max-[640px]:text-[28px] text-[var(--t1)]";
const SUB_CLASS = "m-0 max-w-[680px] text-sm leading-[1.5] text-[var(--t2)]";
const PROVIDER_GRID_CLASS =
  "mb-6 grid grid-cols-2 gap-3 max-[720px]:grid-cols-1";
const PROVIDER_CARD_CLASS =
  "rounded-[var(--r-rh-lg)] border border-[var(--border-1)] bg-[var(--surface-1)] p-4";
const PROVIDER_LABEL_CLASS = "mb-1 text-[13px] font-semibold text-[var(--t1)]";
const PROVIDER_META_CLASS =
  "text-[11px] leading-[1.5] text-[var(--t3)] font-mono";
const EVENT_GRID_CLASS = "grid gap-3";
// Hover is a border step only — never a shadow or a lift.
const EVENT_CARD_CLASS =
  "group rounded-[var(--r-rh-lg)] border border-[var(--border-1)] bg-[var(--surface-1)] p-0 transition-colors duration-150 hover:border-[var(--border-2)]";
const EVENT_META_CLASS =
  "flex min-h-10 flex-wrap items-center gap-2 border-b border-[var(--border-1)] px-4 py-2.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--t3)]";
const LIVE_PILL_CLASS =
  "inline-flex items-center gap-1.5 rounded-[var(--r-rh-sm)] bg-[var(--live-soft)] px-2 py-1 text-[10px] font-bold text-[var(--live-text)]";
const STATE_PILL_CLASS =
  "inline-flex rounded-[var(--r-rh-sm)] bg-[var(--surface-2)] px-2 py-1 text-[10px] font-bold text-[var(--t2)]";
const EVENT_BODY_CLASS =
  "grid grid-cols-[minmax(0,1fr)_minmax(220px,0.42fr)] gap-5 px-4 py-4 max-[760px]:grid-cols-1 max-[640px]:gap-4 max-[640px]:px-3.5";
const MATCHUP_CLASS =
  "m-0 line-clamp-2 text-[17px] font-semibold leading-[1.28] text-[var(--t1)]";
const MARKET_STYLE_COPY_CLASS =
  "mt-1.5 text-[12px] leading-[1.35] text-[var(--t3)]";
const SIDE_PANEL_CLASS =
  "grid gap-2 rounded-[var(--r-rh-lg)] border border-[var(--border-1)] bg-[var(--surface-2)] p-2.5";
const SIDE_ROW_CLASS =
  "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-[var(--r-rh-md)] bg-[var(--surface-1)] px-3 py-2";
const SIDE_LABEL_CLASS =
  "min-w-0 truncate text-[13px] font-semibold text-[var(--t1)]";
const SIDE_SCORE_CLASS =
  "font-mono text-[14px] font-bold tabular-nums text-[var(--t1)]";
const DETAIL_ROW_CLASS =
  "mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-[var(--t3)]";
const FOOTER_CLASS =
  "border-t border-[var(--border-1)] px-4 py-3 text-[12px] text-[var(--t3)]";

type LiveState = {
  events: LiveMarketEvent[];
  providers: LiveProviderStatus[];
  generatedAt: string;
};

function statusLabel(provider: LiveProviderStatus): string {
  if (provider.state === "connected" && provider.lastMessageAt) {
    return `connected · message ${timeAgo(provider.lastMessageAt)}`;
  }
  if (provider.state === "connected") return "connected";
  if (provider.state === "not_configured") return "not configured";
  if (provider.state === "not_wired") return "credentials present, not wired";
  return provider.state.replace(/_/g, " ");
}

function timeAgo(iso: string): string {
  const stamp = new Date(iso).getTime();
  if (!Number.isFinite(stamp)) return "unknown";
  const seconds = Math.max(0, Math.round((Date.now() - stamp) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.round(minutes / 60)}h ago`;
}

function eventTitle(event: LiveMarketEvent): string {
  if (event.title) return event.title;
  const home = event.homeTeam || "Home";
  const away = event.awayTeam || "Away";
  return `${away} at ${home}`;
}

function scoreParts(score?: string): [string, string] | null {
  if (!score) return null;
  const parts = score.split(/\s*[-–]\s*/);
  if (parts.length < 2) return null;
  return [parts[0]?.trim() || "—", parts[1]?.trim() || "—"];
}

function eventSides(event: LiveMarketEvent): Array<{
  label: string;
  score: string;
}> {
  const parsed = scoreParts(event.score);
  if (event.awayTeam || event.homeTeam) {
    return [
      {
        label: event.awayTeam || "Away",
        score: parsed?.[0] || event.score || "—",
      },
      {
        label: event.homeTeam || "Home",
        score: parsed?.[1] || event.score || "—",
      },
    ];
  }
  return [
    {
      label: "Current score",
      score: event.score || "—",
    },
  ];
}

function eventMetaLabels(event: LiveMarketEvent): string[] {
  const labels = [
    event.league,
    event.sport,
    event.source === "market-data" ? "market data" : undefined,
  ].filter(Boolean) as string[];

  return Array.from(new Set(labels.map((label) => label.toLowerCase()))).map(
    (key) => labels.find((label) => label.toLowerCase() === key) || key,
  );
}

export default function LiveMarketsPage() {
  const { t } = useTranslation("prediction");
  const router = useRouter();
  const [state, setState] = useState<LiveState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!FEATURE_LIVE_MARKETS) return;
    setError(null);
    try {
      const next = await getLiveMarkets();
      setState(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!FEATURE_LIVE_MARKETS) {
      router.replace("/predict");
      return;
    }
    let cancelled = false;
    const tick = async () => {
      if (!cancelled) await load();
    };
    tick();
    const id = window.setInterval(tick, 15_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [load, router]);

  const liveEvents = useMemo(
    () => (state?.events ?? []).filter((event) => event.live && !event.ended),
    [state],
  );
  const recentEvents =
    liveEvents.length > 0 ? liveEvents : (state?.events ?? []);

  if (!FEATURE_LIVE_MARKETS) {
    return <div className={ROUTE_LOADING_CLASS}>{t("LIVE_LOADING")}</div>;
  }

  if (loading) {
    return <div className={ROUTE_LOADING_CLASS}>{t("LIVE_LOADING")}</div>;
  }

  return (
    <div>
      <header className={HEADER_CLASS}>
        <div>
          <p className={EYEBROW_CLASS}>
            <Radio size={13} aria-hidden="true" />
            {t("LIVE_EYEBROW")}
          </p>
          <h1 className={TITLE_CLASS}>{t("LIVE_TITLE")}</h1>
          <p className={SUB_CLASS}>{t("LIVE_SUBTITLE")}</p>
        </div>
        <Button variant="secondary" size="md" onClick={load}>
          <RotateCw size={15} aria-hidden="true" />
          {t("LIVE_REFRESH")}
        </Button>
      </header>

      {(state?.providers?.length ?? 0) > 0 && (
        <section
          className={PROVIDER_GRID_CLASS}
          aria-label={t("LIVE_PROVIDERS")}
        >
          {state?.providers.map((provider) => (
            <div key={provider.key} className={PROVIDER_CARD_CLASS}>
              <div className={PROVIDER_LABEL_CLASS}>{provider.label}</div>
              <div className={PROVIDER_META_CLASS}>{statusLabel(provider)}</div>
            </div>
          ))}
        </section>
      )}

      {error && !state ? (
        <div className={STATE_CARD_CLASS}>
          <h2 className="m-0 text-[18px] font-bold text-[var(--t1)]">
            {t("LIVE_LOAD_ERROR_TITLE")}
          </h2>
          <p className="mt-2 mb-0 text-[13px] text-[var(--t3)]">{error}</p>
        </div>
      ) : recentEvents.length === 0 ? (
        <div className={STATE_CARD_CLASS}>
          <Activity
            className="mx-auto mb-4 text-[var(--t3)]"
            size={32}
            aria-hidden="true"
          />
          <h2 className="m-0 text-[18px] font-bold text-[var(--t1)]">
            {t("LIVE_EMPTY_TITLE")}
          </h2>
          <p className="mt-2 mb-0 text-[13px] text-[var(--t3)]">
            {t("LIVE_EMPTY_COPY")}
          </p>
        </div>
      ) : (
        <section className={EVENT_GRID_CLASS}>
          {recentEvents.map((event) => (
            <article key={event.id} className={EVENT_CARD_CLASS}>
              <div className={EVENT_META_CLASS}>
                {event.live ? (
                  <span className={LIVE_PILL_CLASS}>
                    <span className="live-dot" aria-hidden="true" />
                    {t("LIVE_NOW")}
                  </span>
                ) : (
                  <span className={STATE_PILL_CLASS}>
                    {event.ended
                      ? t("LIVE_ENDED")
                      : event.status || t("LIVE_RECENT")}
                  </span>
                )}
                {eventMetaLabels(event).map((label) => (
                  <span key={label}>{label}</span>
                ))}
              </div>
              <div className={EVENT_BODY_CLASS}>
                <div>
                  <h2 className={MATCHUP_CLASS}>{eventTitle(event)}</h2>
                  <p className={MARKET_STYLE_COPY_CLASS}>
                    {event.detail ||
                      event.period ||
                      event.score ||
                      t("LIVE_SCORE_PENDING")}
                  </p>
                  <div className={DETAIL_ROW_CLASS}>
                    {event.period && <span>{event.period}</span>}
                    {event.clock && <span>{event.clock}</span>}
                    <span>
                      {t("LIVE_UPDATED", { value: timeAgo(event.updatedAt) })}
                    </span>
                  </div>
                </div>
                {/* biome-ignore lint/a11y/useSemanticElements: labeled control group; fieldset/legend swap is queued for the P2 primitives pass (fieldset layout quirks) */}
                <div
                  role="group"
                  className={SIDE_PANEL_CLASS}
                  aria-label={eventTitle(event)}
                >
                  {eventSides(event).map((side) => (
                    <div className={SIDE_ROW_CLASS} key={side.label}>
                      <span className={SIDE_LABEL_CLASS}>{side.label}</span>
                      <span className={SIDE_SCORE_CLASS}>{side.score}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className={FOOTER_CLASS}>
                <span>
                  {event.source === "market-data"
                    ? "Live market signal"
                    : "Live event signal"}
                </span>
              </div>
            </article>
          ))}
        </section>
      )}
    </div>
  );
}
