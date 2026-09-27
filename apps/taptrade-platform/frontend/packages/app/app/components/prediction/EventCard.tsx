"use client";

/**
 * EventCard — one upstream event (a game, a race, a nominee field) with its
 * markets stacked inside, in the discovery grid.
 *
 * Anatomy: the event's image tile, a small-caps category eyebrow, the
 * title and the time left on top, then up to three hairline-ruled market
 * rows (label, Yes and No chances as tappable chips), and a footer with
 * volume and a "+N more" link to the event page. Same chrome and footprint
 * as MarketCard so the two mix in one grid.
 */

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { createPredictionClient } from "@taptrade-ui/api-client/src/prediction-client";
import type { PredictionMarket } from "@taptrade-ui/api-client/src/prediction-types";
import { formatCompactPoints } from "../../lib/points";
import { categoryLabel } from "./market-content";
import { EVENT_CARD_ROWS, marketLabelInEvent } from "./event-groups";
import { isOpenMarketStatus, timeLeft } from "./market-display";
import { MarketThumb } from "./MarketThumb";

interface EventCardProps {
  eventId: string;
  title: string;
  markets: PredictionMarket[];
  /** Open markets in the event; when the list carries fewer, rows are fetched. */
  openMarkets?: number;
  onQuickTrade?: (market: PredictionMarket, side: "yes" | "no") => void;
}

const api = createPredictionClient();

function clampPercentage(value: number): number {
  if (!Number.isFinite(value)) return 50;
  return Math.max(0, Math.min(100, Math.round(value)));
}

const CHIP_CLASS =
  "inline-flex h-7 min-w-[64px] cursor-pointer items-center justify-center gap-1 rounded-[var(--r-rh-md)] border-0 px-2 text-[13px] font-semibold no-underline transition-[background-color,color] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] max-[640px]:h-9";
const CHIP_TONE: Record<"yes" | "no", string> = {
  yes: "bg-[var(--yes-soft)] text-[var(--yes-text)] hover:bg-[var(--yes)] hover:text-[var(--on-ink)]",
  no: "bg-[var(--no-soft)] text-[var(--no-text)] hover:bg-[var(--no)] hover:text-[var(--on-ink)]",
};

export function EventCard({ eventId, title, markets: listed, openMarkets = 0, onQuickTrade }: EventCardProps) {
  const { t } = useTranslation("prediction");
  const { t: tc } = useTranslation("market-content");
  // The ranking keeps an event's siblings apart, so the list often carries
  // one of its markets: fetch the event's busiest open markets for the rows.
  const wantRows = Math.min(openMarkets, EVENT_CARD_ROWS);
  const { data: fetched } = useQuery({
    queryKey: ["event-card", eventId, wantRows],
    queryFn: async () => {
      const res = await api.getMarkets({ eventId, status: "open", sort: "activity", pageSize: EVENT_CARD_ROWS });
      return res.data;
    },
    enabled: listed.length < wantRows,
    staleTime: 60_000,
  });
  const markets = fetched && fetched.length > listed.length ? fetched : listed;
  const lead = markets[0];
  const photo = markets
    .map((m) => m.imagePath || m.imageUrl || m.image_url)
    .find((value) => value && value.trim().length > 0);
  const rows = markets.slice(0, EVENT_CARD_ROWS);
  const more = Math.max(openMarkets, markets.length) - rows.length;
  // The event closes with its last market; the corner shows the time left
  // to that, pink in the last 24 hours, like a market card.
  const lastClose = markets.reduce(
    (latest, m) => (m.closeAt > latest ? m.closeAt : latest),
    lead.closeAt,
  );
  const left = markets.some((m) => isOpenMarketStatus(m.status)) ? timeLeft(lastClose) : null;
  const volume = markets.reduce((sum, m) => sum + (m.volumePoints || 0), 0);
  const category = lead.categorySlug
    ? categoryLabel(tc, lead.categorySlug)
    : lead.categoryName || "";

  return (
    <article
      data-testid="event-card"
      className="group relative flex h-full flex-col rounded-[var(--r-rh-lg)] border border-[var(--border-1)] bg-[var(--surface-1)] p-3.5 text-[var(--t1)] shadow-[var(--shadow-card)] transition-[border-color,box-shadow] duration-150 hover:border-[var(--border-2)] hover:shadow-[var(--shadow-card-hover)] focus-within:border-[var(--t3)]"
    >
      <Link
        href={`/event/${eventId}`}
        className="flex items-start gap-2.5 text-inherit no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-1)]"
        aria-label={left ? `${title} · ${left.value} ${t("TIME_LEFT", "left")}` : title}
      >
        <MarketThumb categorySlug={lead.categorySlug} imageUrl={photo} size={40} />
        <span className="flex min-w-0 flex-1 flex-col">
          {category && (
            <span className="mb-0.5 truncate text-[10.5px] font-semibold uppercase leading-[1.3] tracking-[0.06em] text-[var(--t3)]">
              {category}
            </span>
          )}
          <h3 className="m-0 line-clamp-2 min-w-0 text-[14.5px] font-semibold leading-[1.3] tracking-[-0.011em] text-[var(--t1)] group-hover:underline group-hover:decoration-[var(--border-2)] group-hover:underline-offset-2">
            {title}
          </h3>
        </span>
        {left && (
          <span className="flex shrink-0 flex-col items-end pl-1">
            <span
              className={`text-[20px] font-semibold leading-none tracking-[-0.02em] tabular-nums ${
                left.urgent ? "text-[var(--live-text)]" : "text-[var(--t1)]"
              }`}
            >
              {left.value}
            </span>
            <span className="mt-1 whitespace-nowrap text-[11px] font-medium text-[var(--t3)]">
              {t("TIME_LEFT", "left")}
            </span>
          </span>
        )}
      </Link>

      <ul className="m-0 mt-2.5 flex list-none flex-col divide-y divide-[var(--border-1)] p-0">
        {rows.map((m) => {
          const yes = clampPercentage(m.yesPricePoints);
          const no = clampPercentage(m.noPricePoints);
          const label = marketLabelInEvent(m.title, title, t("EVENT_MATCH_WINNER", "Match winner"));
          const open = isOpenMarketStatus(m.status);
          return (
            <li key={m.id} className="flex items-center gap-2 py-1.5 first:pt-0">
              <Link
                href={`/market/${m.ticker}`}
                className="min-w-0 flex-1 truncate text-[13px] font-medium text-[var(--t1)] no-underline hover:underline"
                title={m.title}
              >
                {label}
              </Link>
              {(["yes", "no"] as const).map((side) => {
                const pct = side === "yes" ? yes : no;
                const content = (
                  <>
                    <span>{side === "yes" ? t("YES") : t("NO")}</span>
                    <span className="font-medium tabular-nums opacity-80">{pct}%</span>
                  </>
                );
                const aria = `${pct}% ${side === "yes" ? t("BUY_YES", "Yes") : t("BUY_NO", "No")} · ${label}`;
                return open && onQuickTrade ? (
                  <button
                    key={side}
                    type="button"
                    className={`${CHIP_CLASS} ${CHIP_TONE[side]}`}
                    aria-label={aria}
                    aria-haspopup="dialog"
                    onClick={() => onQuickTrade(m, side)}
                  >
                    {content}
                  </button>
                ) : (
                  <Link
                    key={side}
                    href={`/market/${m.ticker}?side=${side}`}
                    className={`${CHIP_CLASS} ${CHIP_TONE[side]}`}
                    aria-label={aria}
                  >
                    {content}
                  </Link>
                );
              })}
            </li>
          );
        })}
      </ul>

      <div className="mt-auto flex items-center justify-between gap-3 border-t border-[var(--border-1)] pt-2.5 text-[12px] text-[var(--t3)]">
        <span className="truncate tabular-nums">
          {formatCompactPoints(volume)} {t("VOL_SHORT", "vol")}
        </span>
        {more > 0 && (
          <Link href={`/event/${eventId}`} className="shrink-0 font-medium text-[var(--t2)] no-underline hover:underline">
            {t("EVENT_MORE_MARKETS", { count: more, defaultValue: `+${more} more` })}
          </Link>
        )}
      </div>
    </article>
  );
}
