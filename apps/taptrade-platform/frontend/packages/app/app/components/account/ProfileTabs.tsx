"use client";

/**
 * ProfileTabs — the lower half of the profile: Positions (active holdings
 * valued at today's price, or closed ones with what they returned) and
 * Activity (the player's recent orders). Every row carries the market's
 * image tile and title, the same identity the board's cards use.
 */

import { useState } from "react";
import Link from "next/link";
import { useTranslation } from "react-i18next";
import type {
  Position,
  PredictionMarket,
  PredictionOrder,
  SettledPositionResult,
} from "@taptrade-ui/api-client/src/prediction-types";
import { formatPoints } from "../../lib/points";
import { localizedMarket } from "../prediction/market-content";
import { MarketThumb } from "../prediction/MarketThumb";
import { positionMark } from "./profile-data";

type Tab = "positions" | "activity";
type PositionView = "active" | "closed";

const TAB_CLASS = (active: boolean) =>
  `relative cursor-pointer border-0 bg-transparent px-0 pb-3 text-[15px] font-semibold transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] ${
    active
      ? "text-[var(--t1)] after:absolute after:inset-x-0 after:bottom-[-1px] after:h-[2px] after:rounded-full after:bg-[var(--ink)]"
      : "text-[var(--t3)] hover:text-[var(--t1)]"
  }`;
const SEGMENT_CLASS = (active: boolean) =>
  `min-h-8 pointer-coarse:min-h-11 cursor-pointer rounded-[var(--r-rh-sm)] border-0 px-3.5 text-[13px] font-semibold transition-colors duration-150 max-[640px]:min-h-10 ${
    active
      ? "bg-[var(--surface-1)] text-[var(--t1)] shadow-[var(--shadow-card)]"
      : "bg-transparent text-[var(--t3)] hover:text-[var(--t1)]"
  }`;
// Market | Avg | Now | Value on desktop; the price columns fold away on phones.
const ROW_GRID =
  "grid grid-cols-[minmax(0,1fr)_64px_64px_128px] items-center gap-4 max-[640px]:grid-cols-[minmax(0,1fr)_auto]";
const HEAD_CLASS =
  "text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--t3)]";
const PRICE_CELL = "text-right text-[14px] tabular-nums text-[var(--t2)] max-[640px]:hidden";

interface Props {
  positions: Position[];
  history: SettledPositionResult[];
  orders: PredictionOrder[];
  marketsById: Map<string, PredictionMarket>;
  loading: boolean;
}

export function ProfileTabs({ positions, history, orders, marketsById, loading }: Props) {
  const { t } = useTranslation("account");
  const [tab, setTab] = useState<Tab>("positions");
  const [view, setView] = useState<PositionView>("active");
  const active = positions.filter((p) => p.quantity > 0);

  return (
    <section aria-label={t("profile.tabsLabel", "Positions and activity")}>
      <div className="flex gap-6 border-b border-[var(--border-1)]" role="tablist">
        {(["positions", "activity"] as const).map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            className={TAB_CLASS(tab === id)}
            onClick={() => setTab(id)}
          >
            {id === "positions"
              ? t("profile.tabs.positions", "Positions")
              : t("profile.tabs.activity", "Activity")}
          </button>
        ))}
      </div>

      {tab === "positions" && (
        <>
          <div className="mt-4 mb-3 flex items-center justify-between gap-3">
            <fieldset className="m-0 inline-flex min-w-0 gap-1 rounded-[var(--r-rh-md)] border-0 bg-[var(--surface-2)] p-1">
              <legend className="sr-only">{t("profile.tabs.positions", "Positions")}</legend>
              {(["active", "closed"] as const).map((id) => (
                <button
                  key={id}
                  type="button"
                  aria-pressed={view === id}
                  className={SEGMENT_CLASS(view === id)}
                  onClick={() => setView(id)}
                >
                  {id === "active"
                    ? t("profile.view.active", "Active")
                    : t("profile.view.closed", "Closed")}
                  <span className="ml-1.5 tabular-nums text-[var(--t3)]">
                    {id === "active" ? active.length : history.length}
                  </span>
                </button>
              ))}
            </fieldset>
            <Link
              href="/portfolio"
              className="inline-flex min-h-10 items-center text-[13px] font-semibold text-[var(--t2)] no-underline hover:text-[var(--t1)] hover:underline"
            >
              {t("profile.fullPortfolio", "Full portfolio")} →
            </Link>
          </div>
          {view === "active" ? (
            <ActiveList positions={active} marketsById={marketsById} loading={loading} />
          ) : (
            <ClosedList history={history} marketsById={marketsById} loading={loading} />
          )}
        </>
      )}

      {tab === "activity" && (
        <div className="mt-4">
          <ActivityList orders={orders} marketsById={marketsById} loading={loading} />
        </div>
      )}
    </section>
  );
}

function ActiveList({
  positions,
  marketsById,
  loading,
}: {
  positions: Position[];
  marketsById: Map<string, PredictionMarket>;
  loading: boolean;
}) {
  const { t } = useTranslation("account");
  if (loading) return <RowsSkeleton />;
  if (positions.length === 0) {
    return (
      <EmptyRows
        title={t("profile.empty.activeTitle", "No open positions")}
        body={t("profile.empty.activeBody", "Markets you take a side on show up here with their value today.")}
      />
    );
  }
  // Biggest holdings first: what the player has most riding on.
  const rows = [...positions].sort((a, b) => b.totalCostPoints - a.totalCostPoints);
  return (
    <List
      head={[
        t("profile.col.market", "Market"),
        t("profile.col.avg", "Avg"),
        t("profile.col.now", "Now"),
        t("profile.col.value", "Value"),
      ]}
    >
      {rows.map((p) => {
        const market = marketsById.get(p.marketId);
        const mark = positionMark(p, market);
        return (
          <Row
            key={p.id}
            market={market}
            sub={
              <>
                <SideChip side={p.side} />
                <span className="tabular-nums">
                  {t("profile.shares", { count: p.quantity, defaultValue: `${p.quantity} shares` })}
                </span>
              </>
            }
            cells={[
              <span key="avg" className={PRICE_CELL}>{p.avgPricePoints}%</span>,
              <span key="now" className={PRICE_CELL}>{mark.price !== undefined ? `${mark.price}%` : "—"}</span>,
            ]}
            value={mark.value !== undefined ? formatPoints(mark.value) : "—"}
            delta={mark.gain}
          />
        );
      })}
    </List>
  );
}

function ClosedList({
  history,
  marketsById,
  loading,
}: {
  history: SettledPositionResult[];
  marketsById: Map<string, PredictionMarket>;
  loading: boolean;
}) {
  const { t } = useTranslation("account");
  if (loading) return <RowsSkeleton />;
  if (history.length === 0) {
    return (
      <EmptyRows
        title={t("profile.empty.closedTitle", "Nothing settled yet")}
        body={t("profile.empty.closedBody", "When a market you hold settles, its result lands here.")}
      />
    );
  }
  const rows = [...history].sort((a, b) => Date.parse(b.paidAt) - Date.parse(a.paidAt));
  return (
    <List
      head={[
        t("profile.col.market", "Market"),
        t("profile.col.avg", "Avg"),
        t("profile.col.result", "Result"),
        t("profile.col.returned", "Returned"),
      ]}
    >
      {rows.map((h) => {
        const won = h.exitPricePoints >= 100;
        const voided = !won && h.exitPricePoints > 0;
        return (
          <Row
            key={h.id}
            market={marketsById.get(h.marketId)}
            sub={
              <>
                <SideChip side={h.side} />
                <span className="tabular-nums">
                  {t("profile.shares", { count: h.quantity, defaultValue: `${h.quantity} shares` })}
                </span>
                <span aria-hidden="true">·</span>
                <span>{formatDate(h.paidAt)}</span>
              </>
            }
            cells={[
              <span key="avg" className={PRICE_CELL}>{h.entryPricePoints}%</span>,
              <span key="result" className={`${PRICE_CELL} font-semibold !text-[var(--t1)]`}>
                {won
                  ? t("profile.result.won", "Won")
                  : voided
                    ? t("profile.result.voided", "Voided")
                    : t("profile.result.lost", "Lost")}
              </span>,
            ]}
            value={formatPoints(h.settlementPoints)}
            delta={h.realizedPoints}
          />
        );
      })}
    </List>
  );
}

const ORDER_STATUS_KEYS: Record<string, [string, string]> = {
  open: ["profile.status.open", "Open"],
  pending: ["profile.status.open", "Open"],
  partial: ["profile.status.partial", "Part filled"],
  cancelled: ["profile.status.cancelled", "Cancelled"],
  expired: ["profile.status.expired", "Expired"],
  rejected: ["profile.status.rejected", "Rejected"],
};

function ActivityList({
  orders,
  marketsById,
  loading,
}: {
  orders: PredictionOrder[];
  marketsById: Map<string, PredictionMarket>;
  loading: boolean;
}) {
  const { t, i18n } = useTranslation("account");
  if (loading) return <RowsSkeleton />;
  if (orders.length === 0) {
    return (
      <EmptyRows
        title={t("profile.empty.activityTitle", "No activity yet")}
        body={t("profile.empty.activityBody", "Your orders appear here as you make calls.")}
      />
    );
  }
  const rows = [...orders].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  return (
    <List head={null}>
      {rows.map((o) => {
        const filled = o.filledQuantity > 0 ? o.filledQuantity : o.quantity;
        const price = o.averageFillPricePoints ?? o.pricePoints;
        const side = o.side === "yes" ? t("profile.side.yes", "Yes") : t("profile.side.no", "No");
        const verb =
          o.action === "sell"
            ? t("profile.activity.sold", { count: filled, side, defaultValue: `Sold ${filled} ${side}` })
            : t("profile.activity.bought", { count: filled, side, defaultValue: `Bought ${filled} ${side}` });
        const status = ORDER_STATUS_KEYS[o.status];
        const cost = o.filledCostPoints ?? o.totalCostPoints;
        return (
          <Row
            key={o.id}
            market={marketsById.get(o.marketId)}
            sub={
              <>
                <span className="text-[var(--t2)]">
                  {verb}
                  {price !== undefined ? ` · ${price}%` : ""}
                </span>
                {status && (
                  <span className="rounded-[var(--r-rh-sm)] bg-[var(--surface-2)] px-1.5 py-px text-[11px] font-semibold text-[var(--t2)]">
                    {t(status[0], status[1])}
                  </span>
                )}
              </>
            }
            cells={[]}
            value={cost > 0 ? formatPoints(cost) : "—"}
            note={relativeTime(o.createdAt, i18n.language)}
          />
        );
      })}
    </List>
  );
}

function List({ head, children }: { head: string[] | null; children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-[var(--r-rh-lg)] border border-[var(--border-1)] bg-[var(--surface-1)] shadow-[var(--shadow-card)]">
      {head && (
        <div className={`${ROW_GRID} border-b border-[var(--border-1)] px-4 py-2.5 max-[640px]:hidden`}>
          <span className={HEAD_CLASS}>{head[0]}</span>
          <span className={`${HEAD_CLASS} text-right`}>{head[1]}</span>
          <span className={`${HEAD_CLASS} text-right`}>{head[2]}</span>
          <span className={`${HEAD_CLASS} text-right`}>{head[3]}</span>
        </div>
      )}
      <ul className="m-0 list-none divide-y divide-[var(--border-1)] p-0">{children}</ul>
    </div>
  );
}

function Row({
  market,
  sub,
  cells,
  value,
  delta,
  note,
}: {
  market: PredictionMarket | undefined;
  sub: React.ReactNode;
  cells: React.ReactNode[];
  value: string;
  delta?: number;
  note?: string;
}) {
  const { t } = useTranslation("market-content");
  const { t: ta } = useTranslation("account");
  const display = market ? localizedMarket(t, market) : undefined;
  const photo = display ? display.imagePath || display.imageUrl || display.image_url : undefined;
  const titleText = display?.title ?? ta("profile.marketUnavailable", "Market details unavailable");
  const grid = cells.length > 0 ? ROW_GRID : "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4";
  return (
    <li className={`${grid} px-4 py-3 transition-colors duration-150 hover:bg-[var(--surface-2)]`}>
      <div className="flex min-w-0 items-center gap-3">
        <MarketThumb categorySlug={display?.categorySlug} imageUrl={photo} size={40} />
        <div className="min-w-0">
          {display ? (
            <Link
              href={`/market/${display.ticker}`}
              className="line-clamp-2 text-[14px] font-semibold leading-[1.3] text-[var(--t1)] no-underline hover:underline"
            >
              {titleText}
            </Link>
          ) : (
            <span className="text-[14px] font-semibold text-[var(--t3)]">{titleText}</span>
          )}
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[12px] text-[var(--t3)]">{sub}</div>
        </div>
      </div>
      {cells}
      <div className="text-right">
        <div className="text-[14px] font-semibold tabular-nums text-[var(--t1)]">{value}</div>
        {delta !== undefined && (
          <div
            className={`mt-0.5 text-[12px] font-semibold tabular-nums ${
              delta >= 0 ? "text-[var(--yes-text)]" : "text-[var(--no-text)]"
            }`}
          >
            {delta >= 0 ? "+" : "−"}
            {formatPoints(Math.abs(delta))}
          </div>
        )}
        {note && <div className="mt-0.5 text-[12px] text-[var(--t3)]">{note}</div>}
      </div>
    </li>
  );
}

function SideChip({ side }: { side: "yes" | "no" }) {
  const { t } = useTranslation("account");
  return (
    <span
      className={`rounded-[var(--r-rh-sm)] px-1.5 py-px text-[11px] font-semibold ${
        side === "yes"
          ? "bg-[var(--yes-soft)] text-[var(--yes-text)]"
          : "bg-[var(--no-soft)] text-[var(--no-text)]"
      }`}
    >
      {side === "yes" ? t("profile.side.yes", "Yes") : t("profile.side.no", "No")}
    </span>
  );
}

function EmptyRows({ title, body }: { title: string; body: string }) {
  const { t } = useTranslation("account");
  return (
    <div className="rounded-[var(--r-rh-lg)] border border-dashed border-[var(--border-2)] px-6 py-10 text-center">
      <p className="m-0 text-[15px] font-semibold text-[var(--t1)]">{title}</p>
      <p className="m-0 mt-1 text-[13px] text-[var(--t3)]">{body}</p>
      <Link
        href="/predict"
        className="mt-4 inline-flex min-h-10 items-center rounded-[var(--r-rh-md)] bg-[var(--ink)] px-4 text-[13px] font-semibold text-[var(--on-ink)] no-underline hover:opacity-90"
      >
        {t("profile.browseMarkets", "Browse markets")}
      </Link>
    </div>
  );
}

function RowsSkeleton() {
  return (
    <div className="overflow-hidden rounded-[var(--r-rh-lg)] border border-[var(--border-1)] bg-[var(--surface-1)]" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex items-center gap-3 border-b border-[var(--border-1)] px-4 py-3 last:border-b-0">
          <span className="h-10 w-10 animate-pulse rounded-[8px] bg-[var(--surface-2)]" />
          <span className="h-3.5 w-1/2 animate-pulse rounded bg-[var(--surface-2)]" />
        </div>
      ))}
    </div>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function relativeTime(iso: string, locale: string): string {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return "";
  const seconds = Math.round((then - Date.now()) / 1000);
  const rtf = new Intl.RelativeTimeFormat(locale || "en", { numeric: "auto", style: "short" });
  const abs = Math.abs(seconds);
  if (abs < 60) return rtf.format(seconds, "second");
  if (abs < 3600) return rtf.format(Math.round(seconds / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(seconds / 3600), "hour");
  if (abs < 86400 * 30) return rtf.format(Math.round(seconds / 86400), "day");
  return formatDate(iso);
}
