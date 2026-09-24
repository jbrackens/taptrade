"use client";

/**
 * LeadMoment — the Kilig front of /predict: one poster for the most-traded
 * open market, beside a "Happening now" stack of the next two.
 *
 * Honest by construction: the poster only ever shows the #1 market of the
 * activity-sorted list, so its scorebug says "Trending #1", never "Live"
 * (there is no live-event signal on a market to back that claim). The
 * poster word is derived from the category and question (market-poster).
 */

import Link from "next/link";
import { useTranslation } from "react-i18next";
import type { PredictionMarket } from "@taptrade-ui/api-client/src/prediction-types";
import { formatCompactPoints } from "../../lib/points";
import { categoryLabel as labelForCategory } from "./market-content";
import { posterParts } from "./market-poster";

type Side = "yes" | "no";

function clampPercentage(value: number): number {
  if (!Number.isFinite(value)) return 50;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function formatCloseAt(iso: string): string {
  return new Date(iso)
    .toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
    .toUpperCase();
}

const POSTER_SIDE_CLASS =
  "inline-flex min-h-12 min-w-[150px] cursor-pointer items-center justify-between gap-6 rounded-[var(--r-rh-md)] border-0 px-4 text-[15px] font-bold text-[var(--on-ink)] transition-[filter,transform] duration-150 hover:brightness-110 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--poster-ink)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--poster)] max-[640px]:min-w-0 max-[640px]:flex-1";

const CHIP_CLASS =
  "flex min-h-10 cursor-pointer items-center justify-between rounded-[var(--r-rh-md)] border-0 px-3 text-[13px] font-bold transition-[background-color,color,transform] duration-150 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-1)] max-[640px]:min-h-11";

export function LeadMoment({
  lead,
  next,
  onQuickTrade,
}: {
  lead: PredictionMarket;
  next: PredictionMarket[];
  onQuickTrade: (market: PredictionMarket, side: Side) => void;
}) {
  const { t } = useTranslation("prediction");
  const { t: contentT } = useTranslation("market-content");
  const leadCategory = lead.categorySlug
    ? labelForCategory(contentT, lead.categorySlug)
    : lead.categoryName || t("MARKET", "Market");
  const headline =
    lead.eventTitle && lead.eventTitle.length <= 34 ? lead.eventTitle : leadCategory;
  const { accent } = posterParts(lead.title, leadCategory);
  // Short accents ("7", "?") can run huge; four-digit years scale down so
  // the art never runs under the question or the buttons. On phones the
  // headline spans the full width, so the art steps aside entirely.
  const accentSize =
    accent.length <= 2
      ? "text-[clamp(200px,24vw,320px)]"
      : "text-[clamp(120px,12vw,190px)]";
  const yes = clampPercentage(lead.yesPricePoints);
  const no = clampPercentage(lead.noPricePoints);

  return (
    <section
      aria-labelledby="lead-moment-question"
      className="grid grid-cols-[minmax(0,1.85fr)_minmax(280px,1fr)] gap-4 max-[1023px]:grid-cols-1"
    >
      <article className="relative isolate flex min-h-[380px] flex-col justify-between gap-6 overflow-hidden rounded-[var(--r-rh-lg)] bg-[var(--poster)] p-6 text-[var(--poster-ink)] max-[640px]:min-h-[320px] max-[640px]:p-4">
        <span
          aria-hidden="true"
          className={`pointer-events-none absolute -bottom-[0.18em] -right-[0.04em] -z-10 select-none font-poster font-black uppercase leading-[0.8] text-[var(--kilig-bright)] max-[640px]:hidden ${accentSize}`}
        >
          {accent}
        </span>

        <div className="inline-flex items-center gap-2.5 self-start rounded-[var(--r-rh-md)] border border-[rgb(255_255_255/0.14)] bg-[rgb(255_255_255/0.08)] px-2.5 py-1.5 font-mono text-[11px] font-semibold uppercase tracking-[0.06em]">
          <span className="inline-flex items-center gap-1.5 text-[var(--kilig-bright)]">
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--kilig-bright)]" aria-hidden="true" />
            {t("LEAD_TRENDING_ONE", "Trending #1")}
          </span>
          <span className="text-[var(--poster-ink-2)]">{leadCategory}</span>
        </div>

        <div className="relative max-w-[min(460px,58%)] max-[1023px]:max-w-[min(460px,62%)] max-[640px]:max-w-none">
          <p className="type-poster m-0 text-[clamp(40px,4.8vw,72px)] font-black">
            {headline}
          </p>
          <h2
            id="lead-moment-question"
            className="m-0 mt-3 text-[18px] font-medium leading-[1.35] tracking-[-0.01em] text-[rgb(244_243_239/0.9)] max-[640px]:text-[16px]"
          >
            <Link
              href={`/market/${lead.ticker}`}
              className="text-inherit no-underline hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--poster-ink)]"
            >
              {lead.title}
            </Link>
          </h2>
          <div className="mt-5 flex flex-wrap gap-2.5">
            {(["yes", "no"] as const).map((side) => (
              <button
                key={side}
                type="button"
                aria-haspopup="dialog"
                aria-label={`${side === "yes" ? yes : no}% ${side === "yes" ? t("BUY_YES", "Yes") : t("BUY_NO", "No")}`}
                onClick={() => onQuickTrade(lead, side)}
                className={`${POSTER_SIDE_CLASS} ${side === "yes" ? "bg-[var(--yes)]" : "bg-[var(--no)]"}`}
              >
                <span>{side === "yes" ? t("YES") : t("NO")}</span>
                <span className="font-mono text-[14px] font-semibold">
                  {side === "yes" ? lead.yesPricePoints : lead.noPricePoints} {t("PTS", "pts")}
                </span>
              </button>
            ))}
          </div>
          <p className="m-0 mt-3 font-mono text-[11.5px] text-[var(--poster-ink-2)]">
            {formatCompactPoints(lead.volumePoints)} {t("ACTIVITY", "activity")} ·{" "}
            {t("CLOSES", "Closes")} {formatCloseAt(lead.closeAt)}
          </p>
        </div>
      </article>

      <div className="grid content-start gap-3">
        <h2 className="type-poster m-0 flex items-center gap-2.5 text-[28px]">
          <span className="h-2 w-2 rounded-full bg-[var(--live)]" aria-hidden="true" />
          {t("HAPPENING_NOW", "Happening now")}
        </h2>
        {next.map((market) => {
          const pct = clampPercentage(market.yesPricePoints);
          const noPct = clampPercentage(market.noPricePoints);
          const label = market.categorySlug
            ? labelForCategory(contentT, market.categorySlug)
            : market.categoryName || t("MARKET", "Market");
          return (
            <article
              key={market.id}
              className="grid gap-2.5 rounded-[var(--r-rh-lg)] border border-[var(--border-1)] bg-[var(--surface-1)] p-4 transition-colors duration-150 hover:border-[var(--border-2)]"
            >
              <div className="flex items-center justify-between text-[12px] font-semibold text-[var(--t3)]">
                <span className="truncate">{label}</span>
                <span className="font-mono text-[var(--t1)]">{pct}%</span>
              </div>
              <Link
                href={`/market/${market.ticker}`}
                className="text-[15px] font-semibold leading-[1.3] tracking-[-0.01em] text-[var(--t1)] no-underline hover:underline"
              >
                {market.title}
              </Link>
              <span className="flex h-1.5 gap-[2px]" aria-hidden="true">
                <span className="h-full rounded-full bg-[var(--yes)]" style={{ width: `${pct}%` }} />
                <span className="h-full min-w-0 flex-1 rounded-full bg-[var(--no-bar)]" />
              </span>
              <div className="grid grid-cols-2 gap-2">
                {(["yes", "no"] as const).map((side) => (
                  <button
                    key={side}
                    type="button"
                    aria-haspopup="dialog"
                    aria-label={`${side === "yes" ? pct : noPct}% ${side === "yes" ? t("BUY_YES", "Yes") : t("BUY_NO", "No")}`}
                    onClick={() => onQuickTrade(market, side)}
                    className={`${CHIP_CLASS} ${
                      side === "yes"
                        ? "bg-[var(--yes-soft)] text-[var(--yes-text)] hover:bg-[var(--yes)] hover:text-[var(--on-ink)]"
                        : "bg-[var(--no-soft)] text-[var(--no-text)] hover:bg-[var(--no)] hover:text-[var(--on-ink)]"
                    }`}
                  >
                    <span>{side === "yes" ? t("YES") : t("NO")}</span>
                    <span className="font-mono text-[12.5px]">{side === "yes" ? pct : noPct}</span>
                  </button>
                ))}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
